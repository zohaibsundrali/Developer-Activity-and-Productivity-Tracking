import { taskAssignee, isTaskAssignee } from '@/utils/taskAssignment';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthedOrg, serviceClient } from '@/utils/serverAuth';
import { authCan, requirePermission } from '@/utils/serverPermissions';
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
 *
 * ── AND WHOSE TASK IT IS (the follow-up finding) ─────────────────────────
 *
 * Closing C7 scoped the task lookup to the organization and stopped there. The
 * route still never asked whether the caller was the person the task was
 * ASSIGNED to, so any authenticated colleague could submit against anybody's
 * task — and the status update below clears `reviewed_by`, `reviewed_at`,
 * `rejection_reason` and `admin_comments`, so doing it to a rejected task threw
 * away the reviewer's verdict and the reason for it. The victim's work went
 * back into the review queue carrying a stranger's proof of work.
 *
 * Two rules now, both applied once the task row has been read:
 *
 *   1. Ordinarily you submit YOUR OWN task, and "your own" means the task row's
 *      developer_id, not a field in the request body.
 *   2. Submitting on someone else's behalf is a supervisor action and needs
 *      `task.manage` — and even then the submission is attributed to the real
 *      assignee, never to an id the caller chose.
 *
 * `developerId` in the body is now inert. It was the attribution-forgery hole:
 * the id was forced to the token identity only when `auth.userType ===
 * 'developer'`, so an owner, admin or HR user (all userType "admin") could name
 * anyone and the submission, the activity log and the notification would all say
 * that person filed it.
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
    // `requireUnlocked` also fails closed when billing cannot be verified.
    const billingBlocked = await requireUnlocked(serviceClient(), auth.orgId);
    if (billingBlocked) {
      return NextResponse.json(billingBlocked, { status: billingBlocked.status });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid submission' }, { status: 400 });
    const { 
      taskId, 
      projectId, 
      fileName, 
      storagePath,
      submissionNotes 
    } = body;


    // Validate required fields
    if (!taskId || !projectId) {
      return NextResponse.json(
        { error: 'Missing required fields: taskId, projectId' },
        { status: 400 }
      );
    }

    if (typeof storagePath !== 'string' || !storagePath || typeof fileName !== 'string' || !fileName.trim()) {
      return NextResponse.json(
        { error: 'Proof of work file is required' },
        { status: 400 }
      );
    }

    if (submissionNotes != null && typeof submissionNotes !== 'string') return NextResponse.json({ error: 'Submission notes must be text' }, { status: 400 });

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
        { error: taskError.code === 'PGRST116' ? 'Task not found' : 'Could not load task. Please retry.' },
        { status: taskError.code === 'PGRST116' ? 404 : 503 }
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

    // WHOSE TASK IS THIS. Resolved from the row, checked against the token, and
    // never from `developerId` in the body — see the file header.
    const assigneeId = taskAssignee(task)?.userId;
    if (!assigneeId) {
      return NextResponse.json(
        { error: 'This task has no assignee, so there is nobody to submit it as' },
        { status: 409 }
      );
    }

    const isAssignee =
      isTaskAssignee(task, auth);

    // The one way to submit work that is not yours. `task.manage` is
    // owner/admin/manager/team_lead — the people who assign the work in the
    // first place — and it is checked explicitly rather than inferred from
    // userType, which is how the old code let every "admin" userType (owner,
    // admin AND hr) name any developer they liked.
    if (!isAssignee && !authCan(auth, 'task.manage')) {
      return NextResponse.json(
        { error: 'You can only submit work for a task assigned to you' },
        { status: 403 }
      );
    }

    if (isAssignee && !(auth.userType === 'admin' && authCan(auth, 'task.manage'))) {
      const denied = requirePermission(auth, 'task.submit');
      if (denied) return denied;
    }
    if (task.project_id !== projectId) return NextResponse.json({ error: 'Project does not match task' }, { status: 400 });
    const canonicalUrl = new URL(`/storage/v1/object/public/task-submissions/${storagePath.split('/').map(encodeURIComponent).join('/')}`,
      process.env.NEXT_PUBLIC_SUPABASE_URL).href;
    const { data, error } = await serviceClient().rpc('commit_task_submission', {
      p_org: auth.orgId, p_actor: auth.appUserId, p_profile_type: auth.userType, p_task: taskId, p_project: projectId,
      p_file_url: canonicalUrl, p_file_name: fileName.trim(), p_storage_path: storagePath, p_notes: submissionNotes || '',
    });
    if (error) {
      const message = error.message || '';
      const status = error.code === '42501' ? 403 : error.code === 'P0002' ? 404 : ['22023', '22P02', '22007', '22008'].includes(error.code) ? 400 :
        message.startsWith('SUBMISSION_CONFLICT:') ? 409 : /^(BILLING_LOCKED|PLAN_LIMIT_REACHED):/.test(message) ? 402 : 503;
      return NextResponse.json({ error: status === 503 ? 'Could not confirm submission. Retry to check its saved state.' :
        message.split(':').slice(1).join(':').trim() || 'Submission refused' }, { status });
    }
    return NextResponse.json(data);

  } catch (error) {
    console.error('Task submission error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
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

    // WHO MAY READ SOMEBODY ELSE'S SUBMISSIONS, asked as a permission.
    //
    // This was `auth.userType === 'developer' ? own : requested`, and userType
    // is a storage column covering nine roles — so a manager, a team lead and a
    // QA were all pinned to their own submissions. The QA case is the plain
    // one: `task.review` exists so QA can review OTHER people's work, and this
    // is the endpoint that lists it. They could not read a single row.
    const canReadAnyone =
      authCan(auth, 'task.view_all') || authCan(auth, 'task.review');
    if (!canReadAnyone && (!['admin', 'developer'].includes(auth.userType) || !auth.appUserId || !authCan(auth, 'task.view_own'))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const developerId = canReadAnyone ? requestedDeveloperId : auth.appUserId;

    let query = supabase
      .from('task_submissions')
      .select(`
        *,
        developer_tasks!inner (
          developer_id,
          assignee_admin_id,
          task_title,
          task_description,
          start_date,
          end_date,
          status,
          is_on_time,
          productivity_points
        ),
        assignee_admin:admin_users!task_submissions_assignee_admin_id_fkey (full_name, email),
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
      query = query.eq(!canReadAnyone && auth.userType === 'admin' ? 'assignee_admin_id' : 'developer_id', developerId);
    }
    if (!canReadAnyone) {
      query = query.eq(auth.userType === 'admin' ? 'developer_tasks.assignee_admin_id' : 'developer_tasks.developer_id', auth.appUserId);
    }
    if (status) {
      query = query.eq('review_status', status);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: 'Could not load submissions. Please retry.' },
        { status: 503 }
      );
    }

    return NextResponse.json({
      success: true,
      submissions: data || []
    });

  } catch (error) {
    console.error('Fetch submissions error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
