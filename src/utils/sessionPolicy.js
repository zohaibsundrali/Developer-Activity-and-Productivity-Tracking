export const SESSION_MAX_AGE_DAYS = 7;
export const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
// Cookie expiry has a small grace window so middleware doesn't redirect right at the boundary.
// Actual session validity is still enforced via isSessionExpired (no grace).
const COOKIE_GRACE_MS = 2 * 60 * 1000;

function parseIsoToMs(iso) {
  const parsed = Date.parse(String(iso || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function getSessionReferenceIso(sessionOrIso) {
  if (sessionOrIso && typeof sessionOrIso === 'object') {
    return sessionOrIso.lastActivity || sessionOrIso.loginTime;
  }
  return sessionOrIso;
}

// Sliding inactivity expiry:
// - Session is valid while (now - lastActivity) <= 7 days
// - Exactly 7 days is allowed; expires only when it's strictly greater.
export function isSessionExpired(sessionOrIso) {
  const referenceIso = getSessionReferenceIso(sessionOrIso);
  const parsed = parseIsoToMs(referenceIso);
  if (parsed === null) return true;
  return Date.now() - parsed > SESSION_MAX_AGE_MS;
}

function expireCookie(name) {
  try {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
  } catch {
    // ignore
  }
}

export function clearAdminSession() {
  try {
    localStorage.removeItem('adminUser');
  } catch {
    // ignore
  }
  expireCookie('admin_auth');
  expireCookie('admin_id');
}

export function clearDeveloperSession() {
  try {
    localStorage.removeItem('developerUser');
  } catch {
    // ignore
  }
  expireCookie('developer_auth');
  expireCookie('developer_id');
}

export function getSessionCookieExpiryDate(sessionOrIso) {
  const referenceIso = getSessionReferenceIso(sessionOrIso);
  const parsed = parseIsoToMs(referenceIso);
  if (parsed === null) return null;
  return new Date(parsed + SESSION_MAX_AGE_MS + COOKIE_GRACE_MS);
}

function setCookie(name, value, expires) {
  try {
    document.cookie = `${name}=${encodeURIComponent(String(value))}; expires=${expires.toUTCString()}; path=/`;
  } catch {
    // ignore
  }
}

function touchStoredSession(storageKey, authCookieName, idCookieName, existingSession) {
  if (typeof window === 'undefined') return null;

  let session = existingSession;
  if (!session) {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      session = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (!session || typeof session !== 'object') return null;

  const nowIso = new Date().toISOString();
  const updated = {
    ...session,
    loginTime: session.loginTime || nowIso,
    lastActivity: nowIso
  };

  // Ensure we always have a stable top-level id for cookie scoping.
  // Some session shapes store the ID under `user.id` (e.g. Supabase auth session).
  const sessionId = updated?.id ?? updated?.user?.id ?? updated?.user_id;
  if (updated?.id == null && sessionId != null) {
    updated.id = sessionId;
  }

  try {
    localStorage.setItem(storageKey, JSON.stringify(updated));
  } catch {
    // ignore
  }

  const expiryDate = new Date(Date.now() + SESSION_MAX_AGE_MS + COOKIE_GRACE_MS);
  setCookie(authCookieName, 'true', expiryDate);
  if (sessionId != null) {
    setCookie(idCookieName, sessionId, expiryDate);
  }

  return updated;
}

export function touchAdminSession(existingAdminSession) {
  return touchStoredSession('adminUser', 'admin_auth', 'admin_id', existingAdminSession);
}

export function touchDeveloperSession(existingDeveloperSession) {
  return touchStoredSession('developerUser', 'developer_auth', 'developer_id', existingDeveloperSession);
}
