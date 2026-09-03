import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthedOrg, serviceClient } from '@/utils/serverAuth';
import { authCan } from '@/utils/serverPermissions';
import { requireUnlocked } from '@/utils/entitlements';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (auth.userType === 'client') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    // Billing lock — see the note in src/app/api/task-submission/route.js.
    const billingBlocked = await requireUnlocked(serviceClient(), auth.orgId);
    if (billingBlocked) {
      return NextResponse.json({ success: false, ...billingBlocked }, { status: billingBlocked.status });
    }

    const body = await request.json().catch(() => ({}));
    let { projectId, developerId } = body;

    // EVERYONE SUBMITS AS THEMSELVES. This used to read `if (auth.userType ===
    // 'developer')`, which self-scoped nine of the twelve roles and left the
    // other two — owner and admin — free to name ANY developerId in the body
    // and file a task plan under that person's name.
    //
    // Narrowed rather than re-expressed, because nothing wanted the wide form:
    // the only caller is the developer's own project-details page, which sends
    // its own id. A plan is a statement about how the person who wrote it
    // intends to work, so submitting one on somebody else's behalf is not a
    // capability worth keeping just because a storage column happened to grant
    // it. The identity comes from the token; the body's developerId is now
    // ignored entirely.
    if (!authCan(auth, 'task.update_own')) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
    developerId = auth.appUserId;

    if (!projectId || !developerId) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: projectId, developerId' },
        { status: 400 }
      );
    }

    // 1) Validate assignment + current plan state
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('id, assigned_developer_id, task_plan_status')
      .eq('id', projectId)
      .eq('organization_id', auth.orgId)
      .single();

    if (projectError || !project) {
      return NextResponse.json(
        { success: false, error: 'Project not found' },
        { status: 404 }
      );
    }

    if (project.assigned_developer_id !== developerId) {
      return NextResponse.json(
        { success: false, error: 'You are not assigned to this project' },
        { status: 403 }
      );
    }

    if (project.task_plan_status === 'approved') {
      return NextResponse.json(
        { success: false, error: 'Task plan already approved and cannot be resubmitted' },
        { status: 409 }
      );
    }

    // Allow submit when draft or rejected (or null/empty)
    const currentStatus = project.task_plan_status || 'draft';
    if (!['draft', 'rejected', ''].includes(currentStatus)) {
      // If already pending, we can treat this as idempotent.
      if (currentStatus === 'pending') {
        return NextResponse.json({ success: true, message: 'Task plan already submitted', project });
      }
      return NextResponse.json(
        { success: false, error: `Cannot submit task plan while status is "${currentStatus}"` },
        { status: 409 }
      );
    }

    // 2) Ensure tasks exist (developer must have saved a plan)
    const { data: anyTask, error: taskError } = await supabaseAdmin
      .from('developer_tasks')
      .select('id')
      .eq('project_id', projectId)
      .eq('developer_id', developerId)
      .limit(1);

    if (taskError) {
      return NextResponse.json(
        { success: false, error: `Failed to verify tasks: ${taskError.message}` },
        { status: 500 }
      );
    }

    if (!anyTask || anyTask.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No tasks found. Please save tasks before submitting the plan.' },
        { status: 400 }
      );
    }

    // 3) Mark submitted in DB (single source of truth)
    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('projects')
      .update({
        task_plan_submitted: true,
        task_plan_status: 'pending',
        task_plan_submitted_at: now,
        task_plan_reviewed_at: null,
        task_plan_reviewed_by: null,
        task_plan_rejection_reason: null,
      })
      .eq('id', projectId)
      // Redundant with the ownership check above, but this update runs on the
      // service-role client so the org filter is kept here too — a future edit
      // that moves or drops that check cannot silently open a cross-tenant write.
      .eq('organization_id', auth.orgId)
      .select('*')
      .single();

    if (updateError) {
      return NextResponse.json(
        { success: false, error: `Failed to submit task plan: ${updateError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Task plan submitted successfully',
      project: updated,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
