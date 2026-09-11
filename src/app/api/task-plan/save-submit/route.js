import { notifyTaskPlanReviewers } from '@/utils/taskPlanNotifications';
import { NextResponse } from 'next/server';
import { getAuthedOrg, serviceClient } from '@/utils/serverAuth';
import { requirePermission } from '@/utils/serverPermissions';
import { requireUnlocked } from '@/utils/entitlements';

export async function POST(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (auth.userType !== 'developer') return NextResponse.json({ error: 'A developer profile is required' }, { status: 403 });
    const denied = requirePermission(auth, 'task.update_own');
    if (denied) return denied;
    const body = await request.json().catch(() => null);
    if (!body || typeof body.projectId !== 'string' || (body.notificationOnly !== true && (!Array.isArray(body.tasks) || !body.tasks.length))) {
      return NextResponse.json({ error: 'Project and tasks are required' }, { status: 400 });
    }
    const svc = serviceClient();
    const gate = await requireUnlocked(svc, auth.orgId);
    if (gate) return NextResponse.json(gate, { status: gate.status });
    // Notification recovery never calls the plan-save transaction: the plan
    // may have been reviewed since the warning was shown in another browser.
    if (body.notificationOnly === true) {
      const { data: project, error } = await svc.from('projects').select('*')
        .eq('organization_id', auth.orgId).eq('id', body.projectId)
        .eq('assigned_developer_id', auth.appUserId).maybeSingle();
      if (error) return NextResponse.json({ error: 'Could not verify the saved task plan' }, { status: 503 });
      if (!project) return NextResponse.json({ error: 'Task plan not found' }, { status: 404 });
      if (project.task_plan_status !== 'pending') return NextResponse.json({ error: 'This task plan is no longer awaiting review' }, { status: 409 });
      const notice = await notifyTaskPlanReviewers(svc, auth.orgId, project);
      return NextResponse.json({ success: true, notificationWarning: notice.warning || null });
    }
    const { data, error } = await svc.rpc('save_and_submit_task_plan', {
      p_org: auth.orgId, p_project: body.projectId, p_developer: auth.appUserId, p_tasks: body.tasks,
    });
    if (error) {
      const message = error.message || '';
      const status = error.code === '42501' ? 403 : error.code === 'P0002' ? 404 :
        message.startsWith('PLAN_CONFLICT:') ? 409 : /^(BILLING_LOCKED|PLAN_LIMIT_REACHED):/.test(message) ? 402 :
        ['22023', '22007', '22008', '22P02'].includes(error.code) ? 400 : 503;
      return NextResponse.json({ error: status === 503 ? 'Could not confirm task-plan submission; retry to check its saved state' :
        status === 400 ? 'Tasks require titles and valid date ranges' : message.split(':').slice(1).join(':').trim() || 'Task plan request refused' }, { status });
    }
    try {
      const notice = await notifyTaskPlanReviewers(svc, auth.orgId, data?.project);
      if (notice.warning) return NextResponse.json({ ...data, notificationWarning: notice.warning });
    } catch (error) {
      console.error('Task-plan review notification failed:', error.message);
      return NextResponse.json({ ...data, notificationWarning: 'Task plan saved. Review notification could not be confirmed; use Retry notification to resend it.' });
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Could not submit task plan; retry to check its saved state' }, { status: 503 });
  }
}
