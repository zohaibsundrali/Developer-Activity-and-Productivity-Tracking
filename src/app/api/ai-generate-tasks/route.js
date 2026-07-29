import { NextResponse } from 'next/server';
import mammoth from 'mammoth';
import { createClient } from '@supabase/supabase-js';
import { getAuthedOrg } from '@/utils/serverAuth';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Hugging Face Router URL (OpenAI-compatible)
const HF_ROUTER_URL = 'https://router.huggingface.co/v1/chat/completions';
const HF_TOKEN = process.env.HUGGINGFACE_API_KEY;

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
 * SECURITY (audit finding C7): `fileUrl` was passed straight to fetch() with no
 * validation, so a caller could point this at cloud metadata (169.254.169.254)
 * or any internal service and have the response fed into the LLM prompt —
 * server-side request forgery.
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

    const { projectId, fileUrl } = await request.json();

    if (!projectId || !fileUrl) {
      return NextResponse.json({ error: 'Missing projectId or fileUrl' }, { status: 400 });
    }

    if (!isAllowedFileUrl(fileUrl)) {
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

    // 2. Download and extract text
    const fileResponse = await fetch(fileUrl);
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
    let currentDate = defaultStartDate;
    const tasksToInsert = tasks.map((task, index) => {
      const noOfDays = Math.max(1, Math.min(10, task.noOfDays || 2));
      const startDate = currentDate;
      const endDate = addDays(startDate, noOfDays - 1);
      currentDate = addDays(endDate, 1);

      return {
        project_id: projectId,
        developer_id: developerId,
        task_title: task.title,
        task_description: task.description || '',
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
      title: task.title,
      description: task.description || '',
      noOfDays: task.noOfDays || 2,
      status: 'pending',
    }));

    await supabaseAdmin
      .from('projects')
      .update({ ai_task_template: JSON.stringify(templateData) })
      .eq('id', projectId);

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