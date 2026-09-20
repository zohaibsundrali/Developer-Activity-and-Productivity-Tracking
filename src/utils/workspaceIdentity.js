import { getBearerToken, serviceClient } from '@/utils/serverAuth';
import { workspaceTokenClaims } from '@/utils/workspaceClaims';

// Chooser auth deliberately does not require access to the PREVIOUS workspace:
// a revoked member must still be able to choose another authorized membership.
export async function workspaceIdentity(request) {
  const token = getBearerToken(request);
  if (!token) return null;
  const svc = serviceClient({ requestTimeoutMs: 15000 });
  const { data, error } = await svc.auth.getUser(token);
  const user = data?.user;
  if (error || !user || user.is_anonymous || user.deleted_at ||
      (user.banned_until && Date.parse(user.banned_until) > Date.now())) return null;
  const claims = workspaceTokenClaims(token);
  if (claims?.sub !== user.id || !isUuid(claims?.session_id)) return null;
  try {
    const session = await svc.rpc('platform_session_active', { p_auth: user.id, p_session: claims.session_id });
    if (session.error || session.data !== true) return null;
  } catch { return null; }
  return { svc, user, sessionId: claims.session_id, claims };
}
export function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
