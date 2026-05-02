import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Admin approves or rejects a task submission
export async function POST(request) {
  try {
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

    // Validate required fields
    if (!submissionId || !taskId || !adminId || !action) {
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
      .single();

    if (taskError || !task) {
      console.error('Admin review task lookup error:', taskError);
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    // Authorization: ensure this admin owns the project this task belongs to.
    // This prevents one admin from reviewing another admin's project submissions.
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, admin_id')
      .eq('id', task.project_id)
      .single();

    if (projectError || !project) {
      console.error('Admin review project lookup error:', projectError);
      return NextResponse.json(
        { error: 'Project not found for task' },
        { status: 404 }
      );
    }

    if (project.admin_id && project.admin_id !== adminId) {
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
      .single();

    if (subError || !submission) {
      return NextResponse.json(
        { error: 'Submission not found' },
        { status: 404 }
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
        reviewed_by: adminId,
        reviewed_at: reviewedAt,
        admin_comments: comments,
        rejection_reason: action === 'reject' ? rejectionReason : null,
        updated_at: reviewedAt
      })
      .eq('id', taskId);

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
        reviewed_by: adminId,
        reviewed_at: reviewedAt,
        review_status: action === 'approve' ? 'approved' : 'rejected',
        review_comments: action === 'approve' ? comments : rejectionReason
      })
      .eq('id', submissionId);

    if (updateSubError) {
      console.error('Submission update error:', updateSubError);
    }

    // Create admin review record
    await supabase
      .from('admin_reviews')
      .insert({
        admin_id: adminId,
        admin_email: adminEmail,
        admin_name: adminName,
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

    // Create activity log
    await supabase
      .from('activity_logs')
      .insert({
        developer_id: task.developer_id,
        project_id: task.project_id,
        task_id: taskId,
        action_type: action === 'approve' ? 'task_approved' : 'task_rejected',
        action_description: `Task "${task.task_title}" ${action === 'approve' ? 'approved' : 'rejected'} by admin`,
        old_value: 'awaiting_approval',
        new_value: newStatus
      });

    // Update productivity metrics
    await updateProductivityMetrics(task.developer_id, task.project_id);

    // Create notification for developer
    const notificationMessage = action === 'approve'
      ? `Your task "${task.task_title}" has been approved! ${isOnTime ? '(Completed on time - +1 point)' : '(Completed late - -1 point)'}`
      : `Your task "${task.task_title}" was rejected. Reason: ${rejectionReason}`;

    await supabase
      .from('notifications')
      .insert({
        developer_id: task.developer_id,
        admin_id: adminId,
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
async function updateProductivityMetrics(developerId, projectId) {
  try {
    // Get all tasks for this developer and project
    const { data: tasks, error } = await supabase
      .from('developer_tasks')
      .select('status, is_on_time, productivity_points')
      .eq('developer_id', developerId)
      .eq('project_id', projectId);

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
      .eq('id', projectId);

  } catch (error) {
    console.error('Update productivity metrics error:', error);
  }
}

// Get pending or reviewed submissions for admin
// Note: For a solo setup we deliberately keep this simple and
// return all submissions filtered only by review_status. This
// avoids issues where project/admin relationships are misaligned
// and ensures the Task Review panel always shows developer work.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'pending';
    const adminId = searchParams.get('adminId');

    if (!adminId) {
      return NextResponse.json(
        { error: 'Missing required query param: adminId' },
        { status: 400 }
      );
    }

    // Build queries per tab.
    // IMPORTANT: For "reviewed" history we must *not* require an INNER join
    // on projects, otherwise legacy submissions with missing/NULL project_id
    // (or deleted projects) will be dropped and history will look like 0.
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
          projects!inner (
            id,
            name,
            deadline,
            admin_id
          )
        `,
          { count: 'exact' }
        )
        .eq('review_status', 'pending')
        .eq('projects.admin_id', adminId)
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
        .eq('reviewed_by', adminId)
        .order('submitted_at', { ascending: false });
    } else {
      return NextResponse.json(
        { error: 'Invalid status. Must be "pending" or "reviewed"' },
        { status: 400 }
      );
    }

    const { data, error, count } = await query;

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch reviews: ' + error.message },
        { status: 500 }
      );
    }

    // Get activity logs and screenshots for each submission
    const enrichedData = await Promise.all((data || []).map(async (submission) => {
      // Recent activity logs for this task/project/developer
      const { data: activityLogs } = await supabase
        .from('activity_logs')
        .select('*')
        .eq('developer_id', submission.developer_id)
        .eq('project_id', submission.project_id)
        .order('created_at', { ascending: false })
        .limit(10);

      // Tracker screenshots (if table exists)
      let screenshots = [];
      try {
        const { data: screenshotData } = await supabase
          .from('screenshots')
          .select('id, public_url, timestamp, app_active')
          .or(`developer_id.eq.${submission.developer_id},developer_email.eq.${submission.developers?.email}`)
          .order('timestamp', { ascending: false })
          .limit(5);

        screenshots = screenshotData || [];
      } catch (e) {
        // If screenshots table doesn't exist, just skip it
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
