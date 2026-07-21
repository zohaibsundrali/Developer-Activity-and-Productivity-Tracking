import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(
  supabaseUrl,
  serviceRoleKey
);

function normalizeProjectId(projectId) {
  if (typeof projectId === 'number') return projectId;
  const asString = String(projectId || '').trim();
  if (!asString) return null;
  // If your `projects.id` is an integer, normalize numeric strings to numbers.
  if (/^\d+$/.test(asString)) return Number(asString);
  // Otherwise keep as string (e.g., UUID).
  return asString;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export async function POST(request) {
  try {
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Server misconfigured: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
        },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { projectId, adminId, adminEmail, action, rejectionReason } = body;

    const normalizedProjectId = normalizeProjectId(projectId);

    if (!normalizedProjectId || !adminId || !action) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: projectId, adminId, action' },
        { status: 400 }
      );
    }

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json(
        { success: false, error: 'Invalid action. Must be "approve" or "reject"' },
        { status: 400 }
      );
    }

    if (action === 'reject' && !String(rejectionReason || '').trim()) {
      return NextResponse.json(
        { success: false, error: 'Rejection reason is required' },
        { status: 400 }
      );
    }

    // 1) Verify project exists and is reviewable
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      // Use `*` to avoid hard-failing when some deployments have different columns.
      .select('*')
      .eq('id', normalizedProjectId)
      .single();

    if (projectError) {
      // `single()` returns PGRST116 when no rows.
      const notFound = projectError.code === 'PGRST116';
      return NextResponse.json(
        {
          success: false,
          error: notFound ? 'Project not found' : `Failed to load project: ${projectError.message}`,
          code: projectError.code,
        },
        { status: notFound ? 404 : 500 }
      );
    }
    if (!project) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    const adminEmailNormalized = normalizeEmail(adminEmail);
    const addedByAdminEmail = normalizeEmail(project.added_by_admin);
    const addedByEmailMatch = Boolean(adminEmailNormalized) && addedByAdminEmail === adminEmailNormalized;

    const isAllowedAdmin =
      project.created_by === adminId ||
      project.added_by === adminId ||
      // Some deployments include `admin_id` on projects; treat it as allowed when present.
      project.admin_id === adminId ||
      // Some flows link ownership by email.
      addedByEmailMatch;

    if (!isAllowedAdmin) {
      return NextResponse.json(
        { success: false, error: 'You are not allowed to review this project' },
        { status: 403 }
      );
    }

    if (!project.task_plan_submitted || project.task_plan_status !== 'pending') {
      return NextResponse.json(
        {
          success: false,
          error: 'Task plan is not submitted for review yet',
          currentStatus: project.task_plan_status,
          taskPlanSubmitted: project.task_plan_submitted,
        },
        { status: 409 }
      );
    }

    const reviewedAt = new Date().toISOString();
    const nextStatus = action === 'approve' ? 'approved' : 'rejected';

    const updatePayload = {
      task_plan_status: nextStatus,
      task_plan_reviewed_at: reviewedAt,
      task_plan_reviewed_by: adminId,
      task_plan_rejection_reason: action === 'reject' ? String(rejectionReason).trim() : null,
    };

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('projects')
      .update(updatePayload)
      .eq('id', normalizedProjectId)
      .select('*')
      .single();

    if (updateError) {
      return NextResponse.json(
        { success: false, error: `Failed to ${action} task plan: ${updateError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Task plan ${action}ed successfully`,
      project: updated,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
