import { NextResponse } from 'next/server';
import { getAuthedOrg, orgScopedClient, serviceClient } from '@/utils/serverAuth';
import { authCan, requirePermission } from '@/utils/serverPermissions';
import { checkFeatureAccess } from '@/utils/entitlements';
import { calculateProjectProductivity, calculateDeveloperProductivity, calculateOverallProductivity } from '@/utils/productivityData';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization, Cookie' };
const json = (body, status = 200) => NextResponse.json(body, { status, headers });
function failure(error) {
  const token = String(error?.message || '').split(':')[0];
  if (token === 'PRODUCTIVITY_PLAN_REQUIRED' || token === 'BILLING_LOCKED') return json({ error: 'Your subscription does not allow this productivity action.' }, 402);
  if (error?.code === '42501') return json({ error: 'You do not have access to this productivity action.' }, 403);
  if (error?.code === 'P0002') return json({ error: 'Productivity target not found.' }, 404);
  if (error?.code === '22023') return json({ error: 'Invalid productivity request.' }, 400);
  return json({ error: 'Productivity is temporarily unavailable. Please retry.' }, 503);
}
async function plan(auth) {
  const denied = await checkFeatureAccess(serviceClient(), auth.orgId, 'reports', 'Productivity reports');
  return denied ? json(denied, denied.status) : null;
}
async function ownProjectAccess(client, auth, projectId) {
  const project = await client.from('projects').select('id, assigned_developer_id').eq('organization_id', auth.orgId).eq('id', projectId).maybeSingle();
  if (project.error) throw project.error;
  if (!project.data) return json({ error: 'Project not found.' }, 404);
  if (auth.userType === 'developer' && project.data.assigned_developer_id === auth.appUserId) return null;
  const membership = await client.from('project_members').select('id').eq('organization_id', auth.orgId).eq('project_id', projectId).eq('user_id', auth.appUserId).eq('user_type', auth.userType).limit(1);
  if (membership.error) throw membership.error;
  if (membership.data?.length) return null;
  if (auth.userType === 'developer') {
    const assigned = await client.from('developer_tasks').select('id').eq('organization_id', auth.orgId).eq('project_id', projectId).eq('developer_id', auth.appUserId).limit(1);
    if (assigned.error) throw assigned.error;
    if (assigned.data?.length) return null;
  }
  return json({ error: 'Forbidden' }, 403);
}

export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return json({ error: 'Unauthorized' }, 401);
    if (!['admin', 'developer'].includes(auth.userType)) return json({ error: 'Forbidden' }, 403);
    if (auth.overridesUnavailable) return json({ error: 'Permissions unavailable. Please retry.' }, 503);
    const isAdminViewer = authCan(auth, 'report.view');
    const isDeveloperViewer = !isAdminViewer && authCan(auth, 'productivity.view_own');
    if (!isAdminViewer && !isDeveloperViewer) return json({ error: 'Forbidden' }, 403);
    const q = new URL(request.url).searchParams;
    const type = q.get('type') || 'project';
    const developerId = q.get('developerId')?.toLowerCase() ?? null;
    const projectId = q.get('projectId')?.toLowerCase() ?? null;
    if (!['project', 'developer', 'overall'].includes(type) || (developerId !== null && !UUID.test(developerId)) || (projectId !== null && !UUID.test(projectId)) || (type === 'project' && !projectId)) return json({ error: 'Invalid productivity target or view.' }, 400);
    if (isDeveloperViewer && type === 'overall') return json({ error: 'Forbidden' }, 403);
    // A personal view retains the separate own-delivery entitlement. An explicit
    // administrator-selected developer ID is a developer target, never an admin profile.
    const personal = isDeveloperViewer || (type === 'developer' && !developerId && authCan(auth, 'productivity.view_own'));
    if (!personal) { const denied = await plan(auth); if (denied) return denied; }
    const client = orgScopedClient(auth.token);
    if (type === 'project') {
      if (isDeveloperViewer) { const denied = await ownProjectAccess(client, auth, projectId); if (denied) return denied; }
      const target = isDeveloperViewer ? auth.appUserId : developerId;
      const data = await calculateProjectProductivity(client, auth.orgId, projectId, target, isDeveloperViewer ? auth.userType : 'developer');
      return json({ success: true, orgId: auth.orgId, ...data });
    }
    if (type === 'developer') {
      const target = isDeveloperViewer ? auth.appUserId : (developerId || auth.appUserId);
      const userType = isDeveloperViewer || !developerId ? auth.userType : 'developer';
      const data = await calculateDeveloperProductivity(client, auth.orgId, target, userType);
      return json({ success: true, orgId: auth.orgId, ...data });
    }
    return json({ success: true, orgId: auth.orgId, ...await calculateOverallProductivity(client, auth.orgId) });
  } catch (error) { return failure(error); }
}

export async function POST(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return json({ error: 'Unauthorized' }, 401);
    if (!['admin', 'developer'].includes(auth.userType)) return json({ error: 'Forbidden' }, 403);
    if (auth.overridesUnavailable) return json({ error: 'Permissions unavailable. Please retry.' }, 503);
    const denied = requirePermission(auth, 'productivity.recalculate');
    if (denied) return new NextResponse(denied.body, { status: denied.status, headers });
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body.' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid productivity request.' }, 400);
    const { recalculateAll = false } = body;
    if ((body.developerId != null && typeof body.developerId !== 'string') || (body.projectId != null && typeof body.projectId !== 'string')) return json({ error: 'Productivity identifiers must be UUID strings.' }, 400);
    const developerId = body.developerId?.toLowerCase() ?? null;
    const projectId = body.projectId?.toLowerCase() ?? null;
    if (typeof recalculateAll !== 'boolean' || (recalculateAll ? developerId !== null || projectId !== null : !UUID.test(developerId || '') || !UUID.test(projectId || ''))) return json({ error: 'Provide developerId and projectId, or recalculateAll: true.' }, 400);
    const planDenied = await plan(auth); if (planDenied) return planDenied;
    const { data, error } = await orgScopedClient(auth.token).rpc('recalculate_productivity', { p_developer: developerId, p_project: projectId, p_all: recalculateAll });
    if (error) throw error;
    if (!data || data.orgId !== auth.orgId || !Number.isSafeInteger(data.updatedCount) || data.updatedCount < 0 || data.target?.developerId !== developerId || data.target?.projectId !== projectId || data.target?.all !== recalculateAll || (!recalculateAll && data.updatedCount !== 1)) throw new Error('Invalid productivity receipt');
    return json({ success: true, message: recalculateAll ? 'All productivity metrics recalculated' : 'Productivity metrics updated', ...data });
  } catch (error) { return failure(error); }
}
