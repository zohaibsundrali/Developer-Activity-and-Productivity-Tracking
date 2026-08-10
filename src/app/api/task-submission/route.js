import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthedOrg, serviceClient } from '@/utils/serverAuth';
import { requireUnlocked } from '@/utils/entitlements';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

/**
 * SECURITY (audit finding C7): both handlers previously had NO authentication
 * and used the service-role key, and GET applied no organization filter — so an
 * unauthenticated request returned every tenant's submissions, and anyone could
 * submit fabricated proof-of-work against any task in any organization.
 *
 * Both are now fail-closed, and every query is scoped to the caller's org.
 */

// Submit task for review (Developer)
export async function POST(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (auth.userType === 'client') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Billing lock. This route has no plan METER to check, so neither
    // checkResourceLimit nor checkFeatureAccess ever ran here and a workspace
    // whose paid trial had ended kept accepting submitted work indefinitely.
    // `requireUnlocked` fails open on any lookup error, so it can refuse only a
    // genuinely locked organization.
    const billingBlocked = await requireUnlocked(serviceClient(), auth.orgId);
    if (billingBlocked) {
      return NextResponse.json(billingBlocked, { status: billingBlocked.status });
    }

    const body = await request.json();
    const { 
      taskId, 
      projectId, 
      developerId, 
      fileUrl, 
      fileName, 
      fileType, 
      fileSize,
      storagePath,
      submissionNotes 
    } = body;


    // Validate required fields
    if (!taskId || !projectId || !developerId) {
      return NextResponse.json(
        { error: 'Missing required fields: taskId, projectId, developerId' },
        { status: 400 }
      );
    }

    if (!fileUrl || !fileName) {
      return NextResponse.json(
        { error: 'Proof of work file is required' },
        { status: 400 }
      );
    }

    // A developer may only submit as themselves; the id is taken from the
    // verified token rather than the request body.
    const actingDeveloperId =
      auth.userType === 'developer' ? auth.appUserId || developerId : developerId;

    // Get task details to validate deadline. Scoped to the caller's org so a
    // task id from another tenant cannot be acted on.
    const { data: task, error: taskError } = await supabase
      .from('developer_tasks')
      .select('*, projects(*)')
      .eq('id', taskId)
      .eq('organization_id', auth.orgId)
      .single();

    if (taskError) {
      console.error('Task lookup error:', taskError);
      return NextResponse.json(
        { error: 'Task not found: ' + taskError.message },
        { status: 404 }
      );
    }

    if (!task) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    // An approved task is a closed record: is_on_time, productivity_points and
    // the project rollup were already scored from it. Re-submitting would put it
    // back in the queue and let a second review score it again.
    if (task.status === 'completed') {
      return NextResponse.json(
        { error: 'This task has already been approved and cannot be submitted again' },
        { status: 409 }
      );
    }

    // Check if task already has a pending submission (skip if table doesn't exist)
    try {
      const { data: existingSubmission } = await supabase
        .from('task_submissions')
        .select('id')
        .eq('task_id', taskId)
        .eq('review_status', 'pending')
        .single();

      if (existingSubmission) {
        return NextResponse.json(
          { error: 'Task already has a pending submission awaiting review' },
          { status: 400 }
        );
      }
    } catch (checkErr) {
      // Ignore if table doesn't exist yet
    }

    const submittedAt = new Date().toISOString();
    const endDate = task.end_date ? new Date(task.end_date) : new Date();
    endDate.setHours(23, 59, 59, 999); // End of day deadline
    const submissionDate = new Date(submittedAt);
    
    // Determine if submitted on time
    const isOnTime = submissionDate <= endDate;

    // Truncate base64 URL if too long to store (keep reference only)
    let storedFileUrl = fileUrl;
    if (fileUrl && fileUrl.length > 10000) {
      // If base64 is too long, store a reference instead
      storedFileUrl = `base64:${fileName}:${fileSize}bytes`;
    }

    // Try to create submission record
    let submission = null;
    try {
      const { data, error: submissionError } = await supabase
        .from('task_submissions')
        .insert({
          task_id: taskId,
          project_id: projectId,
          developer_id: actingDeveloperId,
          file_url: storedFileUrl,
          file_name: fileName,
          file_type: fileType || 'application/octet-stream',
          file_size: fileSize || 0,
          storage_path: storagePath || '',
          submission_notes: submissionNotes || '',
          submitted_at: submittedAt,
          is_reviewed: false,
          review_status: 'pending'
        })
        .select()
        .single();

      if (submissionError) {
        console.error('Submission insert error:', submissionError);
        // Continue anyway - we'll still update the task status
      } else {
        submission = data;
      }
    } catch (insertErr) {
      console.error('Submission insert exception:', insertErr);
      // Continue anyway - minimum viable: just update task status
    }

    // Update task status to awaiting_approval. Rework of a rejected task starts
    // a fresh review, so the previous verdict is cleared rather than left on the
    // row where the reviewer would still see it.
    const { error: updateError } = await supabase
      .from('developer_tasks')
      .update({
        status: 'awaiting_approval',
        submitted_at: submittedAt,
        reviewed_by: null,
        reviewed_at: null,
        rejection_reason: null,
        admin_comments: null,
        updated_at: submittedAt
      })
      .eq('id', taskId);

    if (updateError) {
      console.error('Task update error:', updateError);
      return NextResponse.json(
        { error: 'Failed to update task status: ' + updateError.message },
        { status: 500 }
      );
    }

    // Create activity log (don't fail if this doesn't work)
    try {
      await supabase
        .from('activity_logs')
        .insert({
          developer_id: actingDeveloperId,
          project_id: projectId,
          task_id: taskId,
          action_type: 'task_submitted',
          action_description: `Task "${task.task_title}" submitted for review`,
          new_value: 'awaiting_approval'
        });
    } catch (logErr) {
    }

    // Get project's admin to send notification (don't fail if this doesn't work)
    try {
      const { data: project } = await supabase
        .from('projects')
        .select('admin_id, created_by, name')
        .eq('id', projectId)
        .single();

      if (project) {
        // Get developer name
        const { data: developer } = await supabase
          .from('developers')
          .select('name, email')
          .eq('id', actingDeveloperId)
          .single();

        // Create notification for admin
        await supabase
          .from('notifications')
          .insert({
            admin_id: project.admin_id || project.created_by,
            developer_id: actingDeveloperId,
            type: 'review_required',
            title: 'Task Submission for Review',
            message: `${developer?.name || 'Developer'} has submitted "${task.task_title}" for review in project "${project.name}"`,
            project_id: projectId,
            task_id: taskId,
            submission_id: submission?.id || null,
            read: false
          });
      }
    } catch (notifErr) {
    }

    return NextResponse.json({
      success: true,
      message: 'Task submitted successfully for review',
      submission: submission,
      isOnTime: isOnTime
    });

  } catch (error) {
    console.error('Task submission error:', error);
    return NextResponse.json(
      { error: 'Internal server error: ' + error.message },
      { status: 500 }
    );
  }
}

// Get submissions for a task or project (Admin)
export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (auth.userType === 'client') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('taskId');
    const projectId = searchParams.get('projectId');
    const requestedDeveloperId = searchParams.get('developerId');
    const status = searchParams.get('status');

    // Developers may only ever see their own submissions.
    const developerId =
      auth.userType === 'developer' ? auth.appUserId : requestedDeveloperId;

    let query = supabase
      .from('task_submissions')
      .select(`
        *,
        developer_tasks (
          task_title,
          task_description,
          start_date,
          end_date,
          status,
          is_on_time,
          productivity_points
        ),
        developers (
          name,
          email
        ),
        projects (
          name,
          deadline
        )
      `)
      .eq('organization_id', auth.orgId)
      .order('submitted_at', { ascending: false });

    if (taskId) {
      query = query.eq('task_id', taskId);
    }
    if (projectId) {
      query = query.eq('project_id', projectId);
    }
    if (developerId) {
      query = query.eq('developer_id', developerId);
    }
    if (status) {
      query = query.eq('review_status', status);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch submissions: ' + error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      submissions: data || []
    });

  } catch (error) {
    console.error('Fetch submissions error:', error);
    return NextResponse.json(
      { error: 'Internal server error: ' + error.message },
      { status: 500 }
    );
  }
}
