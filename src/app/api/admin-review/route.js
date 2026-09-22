import { isTaskAssignee } from '@/utils/taskAssignment';
import { projectActorCanReview } from '@/utils/projectActorIdentity';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthedOrg, serviceClient, orgScopedClient } from '@/utils/serverAuth';
import { authCan, requirePermission } from '@/utils/serverPermissions';
import { requireUnlocked } from '@/utils/entitlements';

/** The shape of every id column this route interpolates into a filter. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Roles allowed to review task submissions (matches permissions.js `review_tasks`).
// QA and team_lead join the reviewers. Reviewing submitted work is the whole
// reason the QA role exists; without this the role would be a label with no
// power, which is worse than not having it.

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
    if (!['admin', 'developer'].includes(auth.userType)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    // Billing lock — see the note in src/app/api/task-submission/route.js.
    const billingBlocked = await requireUnlocked(serviceClient(), auth.orgId);
    if (billingBlocked) {
      return NextResponse.json(billingBlocked, { status: billingBlocked.status });
    }
    // Permission, not a role list. See utils/permissionCatalogue.js — the
    // hand-typed array this replaces was one of fifteen, and roles added to the
    // product reached some of them and not others.
    const denied = requirePermission(auth, "task.review");
    if (denied) return denied;

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

    // Authorization: verify project ownership or assigned manager delegation.
    // The projects table uses created_by / added_by for ownership — there is no admin_id column.
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, created_by, created_by_type, added_by, added_by_type')
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

    const canReviewProject = await projectActorCanReview(serviceClient(), auth, project.id);

    if (!canReviewProject) {
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

    // Match the locked database review transaction: compare both the current
    // typed assignee and the proof's author. Owners are not exempt.
    const isOwnTask = isTaskAssignee(task, auth);
    const isOwnSubmission =
      isTaskAssignee(submission, auth);

    if (isOwnTask || isOwnSubmission) {
      return NextResponse.json(
        { error: 'You cannot review your own submitted work. Ask another reviewer.' },
        { status: 403 }
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

    // The database repeats authorization/state checks under locks and commits
    // the verdict, history, notification and rollups together.
    const { data: result, error: reviewError } = await serviceClient().rpc('commit_task_review', {
      p_org: auth.orgId, p_reviewer: auth.appUserId, p_profile_type: auth.userType,
      p_email: auth.email, p_task: taskId, p_submission: submissionId,
      p_action: action, p_comments: comments || null, p_reason: rejectionReason || null,
    });
    if (reviewError) {
      const message = reviewError.message || '';
      const status = reviewError.code === '42501' ? 403 : reviewError.code === 'P0002' ? 404 :
        reviewError.code === '22023' ? 400 : message.startsWith('REVIEW_CONFLICT:') ? 409 :
        message.startsWith('BILLING_LOCKED:') ? 402 : 503;
      return NextResponse.json({ error: status === 503 ? 'Could not confirm the review. Reload to check its saved state.' :
        message.split(':').slice(1).join(':').trim() || 'Review request refused' }, { status });
    }
    return NextResponse.json(result);

  } catch (error) {
    console.error('Admin review error:', error);
    return NextResponse.json(
      { error: 'Could not complete the review request. Please refresh and retry.' },
      { status: 500 }
    );
  }
}

// Get pending or reviewed submissions for admin
export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!['admin', 'developer'].includes(auth.userType)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    // Permission, not a role list. See utils/permissionCatalogue.js — the
    // hand-typed array this replaces was one of fifteen, and roles added to the
    // product reached some of them and not others.
    const denied = requirePermission(auth, "task.review");
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'pending';
    const requestedAdminId = searchParams.get('adminId');
    const requestedType = searchParams.get('userType');
    if (requestedType && !['admin', 'developer'].includes(requestedType)) return NextResponse.json({ error: 'Invalid userType' }, { status: 400 });

    // WHOSE QUEUE IS THIS? It used to be whoever the query string said.
    //
    // `adminId` was taken verbatim and never compared to the caller. The gate
    // above is `task.review`, which REVIEWERS holds — owner, admin, manager,
    // team_lead and qa — so any of them could name any other admin's id and
    // read that person's review queue. The org filter below kept it inside the
    // tenant, so this was horizontal exposure between colleagues rather than a
    // cross-tenant leak, but "which projects is that director sitting on"
    // is not a question a QA account should be able to ask by editing a URL.
    //
    // Default to the caller. Naming somebody else needs `task.view_all`, the
    // key that already means "see work that is not yours".
    const wantsSomeoneElse =
      (requestedAdminId && String(requestedAdminId) !== String(auth.appUserId)) ||
      (requestedType && requestedType !== auth.userType);
    if (wantsSomeoneElse && !authCan(auth, 'task.view_all')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const adminId = requestedAdminId || auth.appUserId;
    let profileType = requestedType || (!wantsSomeoneElse ? auth.userType : null);
    if (!profileType) {
      const member = await serviceClient().from('memberships').select('user_type').eq('organization_id', auth.orgId).eq('user_id', adminId).in('user_type', ['admin', 'developer']).maybeSingle();
      if (member.error || !member.data) return NextResponse.json({ error: 'Specify userType for an ambiguous or unknown reviewer identity' }, { status: 400 });
      profileType = member.data.user_type;
    }

    // AND IT IS INTERPOLATED INTO A FILTER. `.or()` takes a PostgREST filter
    // EXPRESSION, not bound parameters, so a comma or a dot in `adminId` is
    // syntax: `?adminId=x,created_by.not.is.null` would have rewritten the
    // clause into one that matches every project in the org. Nothing upstream
    // constrained the shape of the value. A uuid check is the whole fix,
    // because the column is a uuid and no legitimate id can fail it.
    if (!UUID_RE.test(String(adminId))) {
      return NextResponse.json(
        { error: 'Invalid adminId' },
        { status: 400 }
      );
    }

    // Step 1: Resolve all project IDs that belong to this admin.
    // The projects table uses created_by / added_by to track ownership
    // (there is no admin_id column), so we query both fields.
    const { data: adminProjects, error: projectsError } = await supabase
      .from('projects')
      .select('id')
      .or(`created_by.eq.${adminId},added_by.eq.${adminId},manager_id.eq.${adminId}`)
      .eq('organization_id', auth.orgId);

    if (projectsError) {
      console.error('Admin projects lookup error:', projectsError);
      return NextResponse.json(
        { error: 'Could not load review projects. Please retry.' },
        { status: 500 }
      );
    }

    const projectIds = [];
    for (const project of adminProjects || []) {
      if (await projectActorCanReview(serviceClient(), { ...auth, appUserId: adminId, userType: profileType }, project.id)) projectIds.push(project.id);
    }

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
        { error: 'Could not load reviews. Please retry.' },
        { status: 500 }
      );
    }

    // Step 3: Enrich each submission with activity logs and screenshots.
    const enrichedData = await Promise.all((data || []).map(async (submission) => {
      // Review authority does not grant access to private monitoring records.
      // Apply the reviewer's own database policies to both enrichment sources.
      const monitoringClient = orgScopedClient(auth.token);
      let activityLogs = [];
      try {
        const { data: logs, error: logsError } = await monitoringClient
          .from('activity_logs')
          .select('*')
          .eq('organization_id', auth.orgId)
          .eq('developer_id', submission.developer_id)
          .eq('project_id', submission.project_id)
          .order('created_at', { ascending: false })
          .limit(10);
        if (!logsError && Array.isArray(logs)) activityLogs = logs;
      } catch {
        // Unavailable monitoring must not bypass policies or prevent a review.
      }

      let screenshots = [];
      try {
        // Org-scoped: the service client bypasses RLS, and the developer_email
        // OR-match would otherwise pull a contractor's screenshots from ANOTHER
        // tenant that reuses the same email. Bind to this reviewer's org.
        const screenshotClient = monitoringClient;
        const { data: screenshotData } = await screenshotClient
          .from('screenshots')
          .select('*')
          .eq('organization_id', auth.orgId)
          .eq('developer_id', submission.developer_id)
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
            const { data: signed } = await screenshotClient.storage
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
      { error: 'Could not complete the review request. Please refresh and retry.' },
      { status: 500 }
    );
  }
}
