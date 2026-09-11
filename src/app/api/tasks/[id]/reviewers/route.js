import { NextResponse } from 'next/server';
import { getAuthedOrg, orgScopedClient, serviceClient } from '@/utils/serverAuth';
import { authCan } from '@/utils/serverPermissions';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request, { params }) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return reply({ error: 'Unauthorized' }, 401);
    if (!['admin', 'developer'].includes(auth.userType)) return reply({ error: 'Forbidden' }, 403);
    if (auth.overridesUnavailable) return reply({ error: 'Permissions unavailable. Please retry.' }, 503);
    if (!authCan(auth, 'task.manage') && !authCan(auth, 'task.review')) return reply({ error: 'Forbidden' }, 403);
    const { id } = await params;
    if (!UUID.test(id || '')) return reply({ error: 'Invalid task ID' }, 400);
    // Prove caller access before using the privileged candidate lookup.
    const task = await orgScopedClient(auth.token).from('developer_tasks').select('id, project_id')
      .eq('organization_id', auth.orgId).eq('id', id).maybeSingle();
    if (task.error) throw task.error;
    if (!task.data) return reply({ error: 'Task not found' }, 404);
    const svc = serviceClient();
    const project = await svc.from('projects').select('created_by, added_by')
      .eq('organization_id', auth.orgId).eq('id', task.data.project_id).maybeSingle();
    if (project.error) throw project.error;
    if (!project.data) return reply({ error: 'Project not found' }, 404);
    const creatorIds = [...new Set([project.data.created_by, project.data.added_by].filter(Boolean))];
    if (!creatorIds.length) return reply({ reviewers: [] });
    const memberships = await svc.from('memberships').select('user_id, user_type')
      .eq('organization_id', auth.orgId).eq('status', 'active').in('user_id', creatorIds).in('user_type', ['admin', 'developer']);
    if (memberships.error) throw memberships.error;
    const reviewers = [];
    for (const member of memberships.data || []) {
      // Shared with watcher INSERT authorization: typed membership, effective
      // permission, unambiguous project ownership, and no self-review.
      const eligible = await svc.rpc('task_watcher_reviewer_eligible', {
        p_org: auth.orgId, p_task: id, p_user: member.user_id, p_type: member.user_type,
      });
      if (eligible.error) throw eligible.error;
      if (eligible.data !== true) continue;
      const developer = member.user_type === 'developer';
      const profile = await svc.from(developer ? 'developers' : 'admin_users')
        .select(developer ? 'name' : 'full_name').eq('organization_id', auth.orgId).eq('id', member.user_id).maybeSingle();
      if (profile.error) throw profile.error;
      if (!profile.data) continue;
      reviewers.push({ userId: member.user_id, userType: member.user_type,
        name: profile.data.name || profile.data.full_name || 'Member' });
    }
    return reply({ reviewers });
  } catch {
    return reply({ error: 'Could not load eligible reviewers. Please retry.' }, 503);
  }
}
