import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthedOrg } from '@/utils/serverAuth';

// Roles allowed to review task submissions (matches permissions.js `review_tasks`).
const REVIEWER_ROLES = ['owner', 'admin', 'manager'];

// Already-scored outcomes. Reviewing one again would re-award points and
// overwrite the record of what actually happened.
const TERMINAL_TASK_STATUSES = ['completed', 'rejected'];

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

// Admin approves or rejects a task submission
export async function POST(request) {
  try {
    // Fail-closed auth: caller must present a valid token and be a reviewer.
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (auth.userType === 'client') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!REVIEWER_ROLES.includes(auth.role)) {
      return NextResponse.json(
        { error: 'Forbidden: you are not allowed to review submissions.' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      submissionId,
      taskId,
      adminId,
      adminEmail,
      adminName,
      action, // 'approve' or 'reject'
      comments,
      rejectionReason
    } = body;

    // Validate required fields. The reviewer identity comes from the verified
    // token, so adminId is only a hint from the caller.
    if (!submissionId || !taskId || !action) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    if (action !== 'approve' && action !== 'reject') {
      return NextResponse.json(
        { error: 'Invalid action. Must be "approve" or "reject"' },
        { status: 400 }
      );
    }

    if (action === 'reject' && !rejectionReason) {
      return NextResponse.json(
        { error: 'Rejection reason is required' },
        { status: 400 }
      );
    }

    const reviewedAt = new Date().toISOString();

    // Get task details (simple select to avoid relationship issues)
    const { data: task, error: taskError } = await supabase
      .from('developer_tasks')
      .select('*')
      .eq('id', taskId)
      .eq('organization_id', auth.orgId)
      .single();

    if (taskError || !task) {
      console.error('Admin review task lookup error:', taskError);
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    // Authorization: ensure this admin owns the project this task belongs to.
    // The projects table uses created_by / added_by for ownership — there is no admin_id column.
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, created_by, added_by')
      .eq('id', task.project_id)
      .eq('organization_id', auth.orgId)
      .single();

    if (projectError || !project) {
      console.error('Admin review project lookup error:', projectError);
      return NextResponse.json(
        { error: 'Project not found for task' },
        { status: 404 }
      );
    }

    const isOwner =
      project.created_by === auth.appUserId ||
      project.added_by === auth.appUserId;

    if (!isOwner) {
      return NextResponse.json(
        { error: 'Not authorized to review submissions for this project' },
        { status: 403 }
      );
    }

    // Get submission
    const { data: submission, error: subError } = await supabase
      .from('task_submissions')
      .select('*')
      .eq('id', submissionId)
      .eq('organization_id', auth.orgId)
      .single();

    if (subError || !submission) {
      return NextResponse.json(
        { error: 'Submission not found' },
        { status: 404 }
      );
    }

    // Workflow integrity: a terminal status is only ever the outcome of an open
    // review of THIS task. Without these checks the route doubles as a way to
    // close any task, or to re-award points by replaying an old review.
    if (submission.task_id !== taskId) {
      return NextResponse.json(
        { error: 'Submission does not belong to this task' },
        { status: 400 }
      );
    }

    if (submission.review_status !== 'pending' || submission.is_reviewed) {
      return NextResponse.json(
        { error: 'This submission has already been reviewed' },
        { status: 409 }
      );
    }

    if (TERMINAL_TASK_STATUSES.includes(task.status)) {
      return NextResponse.json(
        { error: `Task has already been reviewed (current status: ${task.status})` },
        { status: 409 }
      );
    }

    // Calculate if task was completed on time
    const endDate = new Date(task.end_date);
    endDate.setHours(23, 59, 59, 999); // End of day
    const submittedAt = new Date(submission.submitted_at);
    const isOnTime = submittedAt <= endDate;

    // Determine new status and productivity points
    let newStatus, productivityPoints;
    
    if (action === 'approve') {
      newStatus = 'completed';
      productivityPoints = isOnTime ? 1 : -1; // +1 for on-time, -1 for late
    } else {
      newStatus = 'rejected';
      productivityPoints = 0;
    }

    // Update task
    const { error: updateTaskError } = await supabase
      .from('developer_tasks')
      .update({
        status: newStatus,
        is_on_time: action === 'approve' ? isOnTime : null,
        productivity_points: productivityPoints,
        actual_completion_date: action === 'approve' ? reviewedAt.split('T')[0] : null,
        reviewed_by: auth.appUserId,
        reviewed_at: reviewedAt,
        admin_comments: comments,
        rejection_reason: action === 'reject' ? rejectionReason : null,
        updated_at: reviewedAt
      })
      .eq('id', taskId)
      .eq('organization_id', auth.orgId);

    if (updateTaskError) {
      console.error('Task update error:', updateTaskError);
      return NextResponse.json(
        { error: 'Failed to update task: ' + updateTaskError.message },
        { status: 500 }
      );
    }

    // Update submission
    const { error: updateSubError } = await supabase
      .from('task_submissions')
      .update({
        is_reviewed: true,
        reviewed_by: auth.appUserId,
        reviewed_at: reviewedAt,
        review_status: action === 'approve' ? 'approved' : 'rejected',
        review_comments: action === 'approve' ? comments : rejectionReason
      })
      .eq('id', submissionId)
      .eq('organization_id', auth.orgId);

    if (updateSubError) {
      console.error('Submission update error:', updateSubError);
    }

    // Create admin review record
    const { error: adminReviewError } = await supabase
      .from('admin_reviews')
      .insert({
        admin_id: auth.appUserId,
        admin_email: auth.email,
        admin_name: adminName || auth.email,
        task_id: taskId,
        submission_id: submissionId,
        project_id: task.project_id,
        developer_id: task.developer_id,
        review_action: action === 'approve' ? 'approved' : 'rejected',
        review_comments: comments,
        rejection_reason: rejectionReason,
        task_title: task.task_title,
        // developer_name / project_name are optional; can be enriched later
        developer_name: null,
        project_name: null,
        submission_file_url: submission.file_url,
        deadline: task.end_date,
        submission_date: submission.submitted_at,
        reviewed_at: reviewedAt
      });

    if (adminReviewError) {
      console.error('Admin review insert error:', adminReviewError);
    }

    // Create activity log
    await supabase
      .from('activity_logs')
      .insert({
        developer_id: task.developer_id,
        project_id: task.project_id,
        task_id: taskId,
        action_type: action === 'approve' ? 'task_approved' : 'task_rejected',
        action_description: `Task "${task.task_title}" ${action === 'approve' ? 'approved' : 'rejected'} by admin`,
        old_value: task.status,
        new_value: newStatus
      });

    // Update productivity metrics
    await updateProductivityMetrics(task.developer_id, task.project_id, auth.orgId);

    // Create notification for developer
    const notificationMessage = action === 'approve'
      ? `Your task "${task.task_title}" has been approved! ${isOnTime ? '(Completed on time - +1 point)' : '(Completed late - -1 point)'}`
      : `Your task "${task.task_title}" was rejected. Reason: ${rejectionReason}`;

    await supabase
      .from('notifications')
      .insert({
        developer_id: task.developer_id,
        admin_id: auth.appUserId,
        type: action === 'approve' ? 'task_approved' : 'task_rejected',
        title: action === 'approve' ? 'Task Approved' : 'Task Rejected',
        message: notificationMessage,
        project_id: task.project_id,
        task_id: taskId,
        submission_id: submissionId,
        read: false
      });

    return NextResponse.json({
      success: true,
      message: `Task ${action === 'approve' ? 'approved' : 'rejected'} successfully`,
      task: {
        id: taskId,
        status: newStatus,
        is_on_time: isOnTime,
        productivity_points: productivityPoints
      }
    });

  } catch (error) {
    console.error('Admin review error:', error);
    return NextResponse.json(
      { error: 'Internal server error: ' + error.message },
      { status: 500 }
    );
  }
}

// Helper function to update productivity metrics
async function updateProductivityMetrics(developerId, projectId, organizationId) {
  try {
    // Get all tasks for this developer and project
    const { data: tasks, error } = await supabase
      .from('developer_tasks')
      .select('status, is_on_time, productivity_points')
      .eq('developer_id', developerId)
      .eq('project_id', projectId)
      .eq('organization_id', organizationId);

    if (error || !tasks) return;

    const totalTasks = tasks.length;
    const completedOnTime = tasks.filter(t => t.status === 'completed' && t.is_on_time === true).length;
    const completedLate = tasks.filter(t => t.status === 'completed' && t.is_on_time === false).length;
    const pendingTasks = tasks.filter(t => ['pending', 'in_progress', 'awaiting_approval'].includes(t.status)).length;
    const rejectedTasks = tasks.filter(t => t.status === 'rejected').length;
    const completedTasks = completedOnTime + completedLate;

    // Calculate productivity percentage
    // Formula: (completedOnTime / totalTasks) * 100 - (completedLate / totalTasks) * 100
    // Or simply: Each task = 100/totalTasks weight
    // On time = +weight, Late = -weight (from 100% baseline)
    let productivityPercentage = 0;
    if (totalTasks > 0) {
      const taskWeight = 100 / totalTasks;
      productivityPercentage = (completedOnTime * taskWeight) - (completedLate * taskWeight) + 
                               (pendingTasks * taskWeight * 0.5); // Pending tasks count as half
      // Ensure it's between 0 and 100
      productivityPercentage = Math.max(0, Math.min(100, productivityPercentage));
    }

    const productivityPoints = completedOnTime - completedLate;

    // Upsert productivity metrics
    const { error: upsertError } = await supabase
      .from('productivity_metrics')
      .upsert({
        developer_id: developerId,
        project_id: projectId,
        total_tasks: totalTasks,
        completed_on_time: completedOnTime,
        completed_late: completedLate,
        pending_tasks: pendingTasks,
        rejected_tasks: rejectedTasks,
        productivity_percentage: productivityPercentage.toFixed(2),
        productivity_points: productivityPoints,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'developer_id,project_id'
      });

    if (upsertError) {
      console.error('Productivity metrics update error:', upsertError);
    }

    // Update project's total productivity
    await supabase
      .from('projects')
      .update({
        total_productivity_score: productivityPercentage.toFixed(2),
        total_tasks_count: totalTasks,
        completed_tasks_count: completedTasks,
        progress: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
        updated_at: new Date().toISOString()
      })
      .eq('id', projectId)
      .eq('organization_id', organizationId);

  } catch (error) {
    console.error('Update productivity metrics error:', error);
  }
}

// Get pending or reviewed submissions for admin
export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (auth.userType === 'client') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!REVIEWER_ROLES.includes(auth.role)) {
      return NextResponse.json(
        { error: 'Forbidden: you are not allowed to view submissions.' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'pending';
    const adminId = searchParams.get('adminId');

    if (!adminId) {
      return NextResponse.json(
        { error: 'Missing required query param: adminId' },
        { status: 400 }
      );
    }

    // Step 1: Resolve all project IDs that belong to this admin.
    // The projects table uses created_by / added_by to track ownership
    // (there is no admin_id column), so we query both fields.
    const { data: adminProjects, error: projectsError } = await supabase
      .from('projects')
      .select('id')
      .or(`created_by.eq.${adminId},added_by.eq.${adminId}`)
      .eq('organization_id', auth.orgId);

    if (projectsError) {
      console.error('Admin projects lookup error:', projectsError);
      return NextResponse.json(
        { error: 'Failed to resolve admin projects: ' + projectsError.message },
        { status: 500 }
      );
    }

    const projectIds = (adminProjects || []).map((p) => p.id);

    // If the admin has no projects yet, return an empty list immediately.
    if (projectIds.length === 0) {
      return NextResponse.json({ success: true, reviews: [], count: 0 });
    }

    // Step 2: Query task_submissions filtered by those project IDs.
    let query;

    if (status === 'pending') {
      query = supabase
        .from('task_submissions')
        .select(
          `
          *,
          developer_tasks (
            id,
            task_title,
            task_description,
            start_date,
            end_date,
            status
          ),
          developers (
            id,
            name,
            email
          ),
          projects (
            id,
            name,
            deadline
          )
          `,
          { count: 'exact' }
        )
        .eq('review_status', 'pending')
        .in('project_id', projectIds)
        .eq('organization_id', auth.orgId)
        .order('submitted_at', { ascending: false });

    } else if (status === 'reviewed') {
      query = supabase
        .from('task_submissions')
        .select(
          `
          *,
          developer_tasks (
            id,
            task_title,
            task_description,
            start_date,
            end_date,
            status
          ),
          developers (
            id,
            name,
            email
          ),
          projects (
            id,
            name,
            deadline
          )
          `,
          { count: 'exact' }
        )
        .in('review_status', ['approved', 'rejected'])
        .in('project_id', projectIds)
        .eq('organization_id', auth.orgId)
        .order('submitted_at', { ascending: false });

    } else {
      return NextResponse.json(
        { error: 'Invalid status. Must be "pending" or "reviewed"' },
        { status: 400 }
      );
    }

    const { data, error, count } = await query;

    if (error) {
      console.error('Task submissions fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch reviews: ' + error.message },
        { status: 500 }
      );
    }

    // Step 3: Enrich each submission with activity logs and screenshots.
    const enrichedData = await Promise.all((data || []).map(async (submission) => {
      const { data: activityLogs } = await supabase
        .from('activity_logs')
        .select('*')
        .eq('developer_id', submission.developer_id)
        .eq('project_id', submission.project_id)
        .order('created_at', { ascending: false })
        .limit(10);

      let screenshots = [];
      try {
        const { data: screenshotData } = await supabase
          .from('screenshots')
          .select('*')
          .or(`developer_id.eq.${submission.developer_id},developer_email.eq.${submission.developers?.email}`)
          .order('timestamp', { ascending: false })
          .limit(5);
        // Resolve the display URL. Phase 2 screenshots live in the private
        // `monitoring` bucket and carry no durable public_url, so they are
        // signed here; older rows keep their stored public URL.
        screenshots = await Promise.all(
          (screenshotData || []).map(async (s) => {
            const legacyUrl = s.public_url || s.image_url || s.thumbnail_url || null;
            if (!s.storage_path || String(s.storage_path).startsWith('screenshots/')) {
              return { ...s, public_url: legacyUrl };
            }
            const { data: signed } = await supabase.storage
              .from('monitoring')
              .createSignedUrl(s.storage_path, 600);
            return { ...s, public_url: signed?.signedUrl || legacyUrl };
          })
        );
      } catch (_e) {
        screenshots = [];
      }

      return {
        ...submission,
        activityLogs: activityLogs || [],
        screenshots
      };
    }));

    return NextResponse.json({
      success: true,
      reviews: enrichedData,
      count: typeof count === 'number' ? count : (enrichedData?.length || 0)
    });

  } catch (error) {
    console.error('Fetch reviews error:', error);
    return NextResponse.json(
      { error: 'Internal server error: ' + error.message },
      { status: 500 }
    );
  }
}
