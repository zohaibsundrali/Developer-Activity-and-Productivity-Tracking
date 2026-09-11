import { NextResponse } from 'next/server';
import { getAuthedOrg, serviceClient } from '@/utils/serverAuth';
import { requirePermission } from '@/utils/serverPermissions';
import { requireUnlocked } from '@/utils/entitlements';
import { notifyTaskPlanReviewers } from '@/utils/taskPlanNotifications';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function POST(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (auth.userType !== 'developer') return NextResponse.json({ success: false, error: 'A developer profile is required' }, { status: 403 });
    const denied = requirePermission(auth, 'task.update_own');
    if (denied) return denied;
    const body = await request.json().catch(() => null);
    if (!UUID.test(body?.projectId || '')) return NextResponse.json({ success: false, error: 'A valid project ID is required' }, { status: 400 });
    const svc = serviceClient();
    const blocked = await requireUnlocked(svc, auth.orgId);
    if (blocked) return NextResponse.json({ success: false, ...blocked }, { status: blocked.status });
    const { data, error } = await svc.rpc('submit_existing_task_plan', {
      p_org: auth.orgId, p_project: body.projectId, p_developer: auth.appUserId,
    });
    if (error) {
      const status = error.code === '42501' ? 403 : error.code === 'P0002' ? 404 :
        error.message?.startsWith('PLAN_CONFLICT:') ? 409 : error.message?.startsWith('BILLING_LOCKED:') ? 402 :
          error.code === '22023' ? 400 : 503;
      const messages = { 403: 'You are not allowed to submit this project plan', 404: 'Project not found',
        409: 'Task plan cannot be resubmitted in its current state', 402: 'Subscription requires attention',
        400: 'No tasks found. Please save tasks before submitting the plan.', 503: 'Could not confirm task-plan submission; retry to check its saved state' };
      return NextResponse.json({ success: false, error: messages[status] }, { status });
    }
    if (!data?.success || !data.project?.id) throw new Error('Unconfirmed submission');
    try {
      const notice = await notifyTaskPlanReviewers(svc, auth.orgId, data.project);
      if (notice.warning) return NextResponse.json({ ...data, notificationWarning: notice.warning });
    } catch {
      return NextResponse.json({ ...data, notificationWarning: 'Task plan saved. Review notification could not be confirmed; retry to resend it.' });
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ success: false, error: 'Could not submit task plan; retry to check its saved state' }, { status: 503 });
  }
}
