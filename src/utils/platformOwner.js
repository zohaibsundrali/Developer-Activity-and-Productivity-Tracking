import { NextResponse } from 'next/server';
import { workspaceIdentity } from '@/utils/workspaceIdentity';

export const platformJson = (body, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
});

export async function requirePlatformOwner(request) {
  const identity = await workspaceIdentity(request);
  if (!identity) return { error: platformJson({ error: 'Please sign in to continue.' }, 401) };
  const args = { p_auth: identity.user.id, p_session: identity.sessionId };
  const check = await identity.svc.rpc('platform_owner_access', args);
  if (check.error) return { error: platformJson({ error: 'Platform access is unavailable. Check the platform migration and owner provisioning.' }, 503) };
  if (check.data !== true) return { error: platformJson({ error: 'This account does not have Verisade platform-owner access.' }, 403) };
  return { ...identity, args };
}
export function platformPage(search) {
  const raw = search.get('page') || '1';
  return /^\d+$/.test(raw) && +raw >= 1 && +raw <= 100000 ? +raw : null;
}
export async function platformRpc(request, name, extra = {}) {
  try {
    const access = await requirePlatformOwner(request);
    if (access.error) return access.error;
    const result = await access.svc.rpc(name, { ...access.args, ...extra });
    if (result.error) return platformJson({ error: 'Platform data could not be loaded.' }, result.error.code === '42501' ? 403 : 503);
    return platformJson(result.data);
  } catch { return platformJson({ error: 'Platform data could not be loaded.' }, 503); }
}
