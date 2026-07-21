import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { projectId, developerId } = body;

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
