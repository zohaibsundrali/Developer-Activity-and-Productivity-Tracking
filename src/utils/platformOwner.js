import { NextResponse } from 'next/server';
import { workspaceIdentity } from '@/utils/workspaceIdentity';

export const platformJson = (body, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
});

export async function requirePlatformOwner(request) {
  return requirePlatformPermission(request, 'team.manage');
}
export async function platformAccessIdentity(request) {
  const identity = await workspaceIdentity(request);
  if (!identity) return { error: platformJson({ error: 'Please sign in to continue.' }, 401) };
  const args = { p_auth: identity.user.id, p_session: identity.sessionId };
  const check = await identity.svc.rpc('platform_access', args);
  if (check.error) return { error: platformJson({ error: 'Platform access is unavailable.' }, 503) };
  if (!check.data?.role || !Array.isArray(check.data.permissions)) return { error: platformJson({ error: 'Platform access is required.' }, 403) };
  const capabilities = { ...check.data, mfaSatisfied: check.data.mfaSatisfied === true && identity.claims?.aal === 'aal2' };
  return { ...identity, args, capabilities, platformRole: check.data.role };
}
export async function requirePlatformPermission(request, permission) {
  const access = await platformAccessIdentity(request);
  if (access.error) return access;
  const { capabilities } = access;
  if (capabilities.mfaRequired && !capabilities.mfaSatisfied) return { error: platformJson({ error: 'Verify your authenticator to continue.', code: 'MFA_REQUIRED', ...capabilities }, 403) };
  if (!capabilities.permissions.includes(permission)) return { error: platformJson({ error: 'Your platform role cannot perform this action.' }, 403) };
  const audit = await access.svc.rpc('platform_record_access', { ...access.args, p_permission: permission, p_path: new URL(request.url).pathname });
  if (audit.error) return { error: platformJson({ error: 'Platform access could not be recorded.' }, audit.error.code === '42501' ? 403 : 503) };
  return access;
}
export function platformPage(search) {
  const raw = search.get('page') || '1';
  return /^\d+$/.test(raw) && +raw >= 1 && +raw <= 100000 ? +raw : null;
}
export async function platformRpc(request, name, extra = {}) {
  try {
    const permission = { platform_overview: 'overview.read', platform_organizations: 'organizations.read', platform_organizations_filtered: 'organizations.read', platform_activity: 'activity.read' }[name];
    const access = permission ? await requirePlatformPermission(request, permission) : await requirePlatformOwner(request);
    if (access.error) return access.error;
    const result = await access.svc.rpc(name, { ...access.args, ...extra });
    if (result.error) return platformJson({ error: 'Platform data could not be loaded.' }, result.error.code === '42501' ? 403 : 503);
    if (name === 'platform_overview' && access.capabilities && !access.capabilities.permissions.includes('billing.read')) { delete result.data.revenue; delete result.data.subscriptions; }
    return platformJson(result.data);
  } catch { return platformJson({ error: 'Platform data could not be loaded.' }, 503); }
}
