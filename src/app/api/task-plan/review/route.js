import { NextResponse } from 'next/server';
import { getAuthedOrg, serviceClient } from '@/utils/serverAuth';
import { requirePermission } from '@/utils/serverPermissions';

export async function POST(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    if (!['admin', 'developer'].includes(auth.userType)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    const denied = requirePermission(auth, 'task.review');
    if (denied) return denied;
    const body = await request.json().catch(() => null);
    if (!body || typeof body.projectId !== 'string' || !body.projectId.trim() || !['approve', 'reject'].includes(body.action) ||
        (body.action === 'reject' && (typeof body.rejectionReason !== 'string' || !body.rejectionReason.trim()))) {
      return NextResponse.json({ success: false, error: 'Project, valid action and rejection reason are required' }, { status: 400 });
    }
    // Caller-supplied adminId/adminEmail are legacy display fields, never authority.
    const { data, error } = await serviceClient().rpc('commit_task_plan_review', {
      p_org: auth.orgId, p_project: body.projectId.trim(), p_reviewer: auth.appUserId,
      p_type: auth.userType, p_action: body.action,
      p_reason: body.action === 'reject' ? body.rejectionReason.trim() : null,
    });
    if (error) {
      const message = error.message || '';
      const status = error.code === '42501' ? 403 : error.code === 'P0002' ? 404 :
        ['22023', '22P02'].includes(error.code) ? 400 : message.startsWith('PLAN_REVIEW_CONFLICT:') ? 409 :
          message.startsWith('BILLING_LOCKED:') ? 402 : 503;
      const reason = status === 503 ? 'Could not confirm task-plan review. Refresh the project before retrying.' :
        status === 400 ? 'Invalid project or review details' : message.split(':').slice(1).join(':').trim() || 'Task-plan review refused';
      return NextResponse.json({ success: false, error: reason }, { status });
    }
    if (!data?.success || !data?.project?.id) return NextResponse.json({ success: false, error: 'Could not confirm task-plan review. Refresh the project before retrying.' }, { status: 503 });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ success: false, error: 'Could not confirm task-plan review. Refresh the project before retrying.' }, { status: 503 });
  }
}
