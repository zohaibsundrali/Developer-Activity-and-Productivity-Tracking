import { NextResponse } from 'next/server';
import mammoth from 'mammoth';
import { createClient } from '@supabase/supabase-js';
import { getAuthedOrg, serviceClient } from '@/utils/serverAuth';
import { requirePermission } from '@/utils/serverPermissions';
import { requireUnlocked } from '@/utils/entitlements';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Hugging Face Router URL (OpenAI-compatible)
const HF_ROUTER_URL = 'https://router.huggingface.co/v1/chat/completions';
const HF_TOKEN = process.env.HUGGINGFACE_API_KEY;

/**
 * Caps on what one generation may write.
 *
 * The model's answer is parsed from free text and inserted straight into
 * `developer_tasks` with the service role, so the length of that array was
 * decided by whatever the model felt like returning against a document the
 * caller supplied. A prompt-injected requirements file asking for four thousand
 * tasks got four thousand rows, and every board, gantt and rollup in the project
 * is then unusable until somebody deletes them by hand. The title and
 * description caps are the same argument one column down.
 *
 * Truncating rather than refusing: the tasks are a draft a human edits, so a
 * clipped title is a worse draft, while a refusal throws away a real generation
 * over one long string.
 */
const MAX_GENERATED_TASKS = 100;
const MAX_TASK_TITLE = 200;
const MAX_TASK_DESCRIPTION = 2000;

function addDays(dateStr, days) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

function parseAIResponse(content) {
  let cleaned = content.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const valid = parsed.every(t => t.title && typeof t.title === 'string');
      return valid ? parsed : null;
    }
  } catch (e) {
    return null;
  }
  return null;
}

async function callHFRouter(model, prompt) {
  const response = await fetch(HF_ROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${HF_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000,
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HF Router error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

/**
 * Only files served by our own Supabase Storage may be fetched.
 *
 * An unvalidated `fileUrl` reaches fetch() directly, so a caller could point it
 * at cloud metadata (169.254.169.254) or any internal service and have the
 * response fed into the LLM prompt — server-side request forgery. This is the
 * legacy path: requirement documents uploaded before the move to the private
 * bucket are still addressed by URL. New uploads send `filePath` instead, which
 * is signed server-side and never leaves the tenant's own storage prefix.
 */
function isAllowedFileUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;

  const supabaseHost = (() => {
    try {
      return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host;
    } catch {
      return null;
    }
  })();
  if (!supabaseHost) return false;

  return url.host === supabaseHost;
}

export async function POST(request) {
  try {
    // Fail closed: only authenticated staff may drive AI task generation.
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (auth.userType === 'client') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    // WHO MAY MINT TASKS. "Authenticated and not a client" was the entire
    // authorization on a route that writes rows into any project in the
    // organization and spends money at a third-party model provider on every
    // call — so a designer or a QA could do both, against a project they have
    // nothing to do with. Creating and assigning tasks is `task.manage`
    // (owner/admin/manager/team_lead), the same capability the task screens
    // claim to require; it simply had no API call site until now.
    const denied = requirePermission(auth, 'task.manage');
    if (denied) return denied;

    // Billing lock — see the note in src/app/api/task-submission/route.js.
    // Worth having here for a second reason: this route spends money with a
    // third-party model provider on every call.
    const billingBlocked = await requireUnlocked(serviceClient(), auth.orgId);
    if (billingBlocked) {
      return NextResponse.json(billingBlocked, { status: billingBlocked.status });
    }

    const { projectId, filePath, fileUrl } = await request.json();

    if (!projectId || (!filePath && !fileUrl)) {
      return NextResponse.json({ error: 'Missing projectId or filePath' }, { status: 400 });
    }

    // A storage path must sit under the caller's own organization folder. This
    // is checked before signing so a path from another tenant is never minted
    // into a readable URL.
    if (filePath && !String(filePath).startsWith(`${auth.orgId}/`)) {
      return NextResponse.json(
        { error: 'filePath must reference this organization\'s own storage' },
        { status: 403 }
      );
    }

    if (!filePath && !isAllowedFileUrl(fileUrl)) {
      return NextResponse.json(
        { error: 'fileUrl must reference this project\'s own storage' },
        { status: 400 }
      );
    }

    // 1. Fetch project details — scoped to the caller's organization so a
    //    project id from another tenant cannot be targeted.
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('assigned_developer_id, name, created_at, assigned_at, assigned_date')
      .eq('id', projectId)
      .eq('organization_id', auth.orgId)
      .single();

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const developerId = project.assigned_developer_id;
    if (!developerId) {
      return NextResponse.json({ error: 'No developer assigned' }, { status: 400 });
    }

    const defaultStartDate =
      project.assigned_date || project.assigned_at || project.created_at || new Date().toISOString().split('T')[0];

    // 2. Download and extract text. Private-bucket documents are signed here
    //    with the service role; legacy rows still carry a public URL.
    let downloadUrl = fileUrl;
    if (filePath) {
      const { data: signed, error: signError } = await supabaseAdmin.storage
        .from('org-files')
        .createSignedUrl(filePath, 300);
      if (signError || !signed?.signedUrl) {
        return NextResponse.json({ error: 'Failed to access file' }, { status: 500 });
      }
      downloadUrl = signed.signedUrl;
    }

    const fileResponse = await fetch(downloadUrl);
    if (!fileResponse.ok) {
      return NextResponse.json({ error: 'Failed to download file' }, { status: 500 });
    }

    const arrayBuffer = await fileResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const { value: extractedText } = await mammoth.extractRawText({ buffer });

    if (!extractedText || extractedText.trim().length === 0) {
      return NextResponse.json({ error: 'No extractable text found' }, { status: 400 });
    }

    // 3. Try multiple models via the Router
    const modelsToTry = [
      'meta-llama/Llama-3.2-3B-Instruct',   // Larger, better quality
      'meta-llama/Llama-3.2-1B-Instruct',   // Fast, reliable (works in your test)
      'mistralai/Mistral-7B-Instruct-v0.3',
      'google/gemma-2-2b-it',
      'Qwen/Qwen2.5-7B-Instruct',
    ];

    let tasks = null;
    let lastError = null;
    let usedModel = null;

    const prompt = `Extract a list of development tasks from the following software requirements document. Output a valid JSON array. Each object must have:
- "title": a short task name (string)
- "description": a one-sentence summary (string)
- "noOfDays": estimated days as integer (1-5)

Return ONLY the JSON array, no extra text.

Document:
${extractedText.substring(0, 6000)}`;

    for (const model of modelsToTry) {
      try {
        const content = await callHFRouter(model, prompt);
        tasks = parseAIResponse(content);
        if (tasks) {
          usedModel = model;
          break;
        }
      } catch (err) {
        lastError = err;
        console.warn(`Model ${model} failed:`, err.message);
      }
    }

    if (!tasks || tasks.length === 0) {
      return NextResponse.json(
        {
          error: 'AI task generation failed. All models returned errors or invalid data.',
          details: lastError?.message || 'No tasks generated',
        },
        { status: 503 }
      );
    }

    // 4. Insert tasks with sequential dates
    // Capped BEFORE the map, so the template written back to the project below
    // describes the same set of tasks that was actually inserted.
    if (tasks.length > MAX_GENERATED_TASKS) {
      tasks = tasks.slice(0, MAX_GENERATED_TASKS);
    }

    let currentDate = defaultStartDate;
    const tasksToInsert = tasks.map((task, index) => {
      const noOfDays = Math.max(1, Math.min(10, task.noOfDays || 2));
      const startDate = currentDate;
      const endDate = addDays(startDate, noOfDays - 1);
      currentDate = addDays(endDate, 1);

      return {
        // From the VERIFIED token, never the body. This insert runs on the
        // service-role client, which bypasses RLS and therefore also bypasses
        // the stamp that would otherwise fill this in — so every task this
        // route has ever generated landed with a null organization_id, invisible
        // to every org-scoped read and to the policies that depend on it.
        organization_id: auth.orgId,
        project_id: projectId,
        developer_id: developerId,
        task_title: String(task.title).slice(0, MAX_TASK_TITLE),
        task_description: String(task.description || '').slice(0, MAX_TASK_DESCRIPTION),
        task_order: index,
        start_date: startDate,
        end_date: endDate,
        status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    });

    const { error: insertError } = await supabaseAdmin
      .from('developer_tasks')
      .insert(tasksToInsert);

    if (insertError) {
      throw new Error(`Database insert failed: ${insertError.message}`);
    }

    // 5. Update project template
    const templateData = tasks.map(task => ({
      title: String(task.title).slice(0, MAX_TASK_TITLE),
      description: String(task.description || '').slice(0, MAX_TASK_DESCRIPTION),
      noOfDays: task.noOfDays || 2,
      status: 'pending',
    }));

    // The org filter is redundant with the ownership check above, but this write
    // uses the service-role client, so it is repeated here as defence in depth.
    await supabaseAdmin
      .from('projects')
      .update({ ai_task_template: JSON.stringify(templateData) })
      .eq('id', projectId)
      .eq('organization_id', auth.orgId);

    return NextResponse.json({
      success: true,
      tasks: templateData,
      message: `Generated ${tasks.length} tasks using ${usedModel}`,
    });
  } catch (error) {
    console.error('Task generation error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}