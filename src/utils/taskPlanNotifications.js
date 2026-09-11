import { projectActorCanReview, isOwnDeveloperWork } from '@/utils/projectActorIdentity';
import { loadOverrides } from '@/utils/permissionOverrides';
import { authCan } from '@/utils/serverPermissions';

// Match task-plan/review delegation (creator, manager, optional admin_id,
// legacy added_by_admin email). Resolve each untyped address without guessing.
export async function notifyTaskPlanReviewers(svc, orgId, project) {
  if (!project?.id || !project.task_plan_submitted_at) return { notified: 0 };
  const candidates = new Map();
  const addresses = [
    ['user_id', project.created_by, project.created_by_type],
    ['user_id', project.added_by, project.added_by_type],
    ['user_id', project.manager_id, project.manager_type],
    ['user_id', project.admin_id, null],
    ['email', project.added_by_admin ? String(project.added_by_admin).trim().toLowerCase() : null, null],
  ];
  for (const [column, value, userType] of addresses) {
    if (!value) continue;
    let query = svc.from('memberships').select('user_id,user_type,role,status,email')
      .eq('organization_id', orgId).eq(column, value).in('user_type', ['admin','developer']);
    if (userType) query = query.eq('user_type', userType);
    const { data, error } = await query;
    if (error) throw new Error('Could not verify task-plan notification recipients');
    if (data?.length === 1 && data[0].status === 'active') candidates.set(`${data[0].user_type}:${data[0].user_id}`, data[0]);
  }
  const rows = [];
  for (const [key, member] of candidates) {
    // Preserve the review route's existing self-review refusal.
    const subject = { orgId, appUserId: member.user_id, userType: member.user_type, role: member.role };
    if (isOwnDeveloperWork(subject, project.assigned_developer_id)) continue;
    if (!(await projectActorCanReview(svc, subject, project.id, { allowLegacy: true }))) continue;
    subject.overrides = await loadOverrides(svc, subject);
    if (!authCan(subject, 'task.review')) continue;
    rows.push({ organization_id: orgId,
      ...(member.user_type === 'admin' ? { admin_id: member.user_id, admin_recipient_type: 'admin' } : { developer_id: member.user_id }),
      type: 'task_submitted', category: 'review', title: 'Task plan ready for review',
      message: `The task plan for "${project.name || 'a project'}" is ready for review.`,
      project_id: project.id, entity_type: 'project', entity_id: project.id,
      dedupe_key: `task_plan_submitted:${project.id}:${project.task_plan_submitted_at}:${key}`, read: false });
  }
  if (!rows.length) return { notified: 0, warning: 'Task plan saved, but no unambiguous active project owner or manager with review permission could be notified.' };
  let notified = 0;
  for (const row of rows) {
    const { data, error } = await svc.from('notifications').insert(row).select('id');
    if (error && error.code !== '23505') throw new Error('Task plan saved, but its review notification could not be delivered');
    notified += data?.length || 0;
  }
  return { notified };
}
