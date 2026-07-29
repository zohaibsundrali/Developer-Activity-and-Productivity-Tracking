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

function safeRemove(storage, key) {
  try {
    storage?.removeItem(key);
  } catch {
    // ignore
  }
}

function safeGet(storage, key) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(storage, key, value) {
  try {
    storage?.setItem(key, value);
  } catch {
    // ignore
  }
}

function getPrimaryStorage() {
  if (typeof window === 'undefined') return null;
  // sessionStorage is per-tab, which prevents cross-account bleed between tabs.
  return window.sessionStorage;
}

function getLegacyStorage() {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

/**
 * Clear the server-issued signed session cookie.
 *
 * It is HttpOnly, so JavaScript cannot expire it directly — the server has to
 * do it. Fire-and-forget: sign-out must never block on this request.
 */
function clearServerSession() {
  if (typeof window === 'undefined') return;
  try {
    fetch('/api/auth/session', { method: 'DELETE', keepalive: true }).catch(() => {});
  } catch {
    /* sign-out proceeds regardless */
  }
}

export function clearAdminSession() {
  const primary = getPrimaryStorage();
  const legacy = getLegacyStorage();
  safeRemove(primary, 'adminUser');
  safeRemove(legacy, 'adminUser');
  expireCookie('admin_auth');
  expireCookie('admin_id');
  clearServerSession();
}

export function clearDeveloperSession() {
  const primary = getPrimaryStorage();
  const legacy = getLegacyStorage();
  safeRemove(primary, 'developerUser');
  safeRemove(legacy, 'developerUser');
  expireCookie('developer_auth');
  expireCookie('developer_id');
  clearServerSession();
}

export function clearClientSession() {
  const primary = getPrimaryStorage();
  const legacy = getLegacyStorage();
  safeRemove(primary, 'clientUser');
  safeRemove(legacy, 'clientUser');
  expireCookie('client_auth');
  expireCookie('client_id');
  clearServerSession();
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

  const primary = getPrimaryStorage();
  const legacy = getLegacyStorage();

  let session = existingSession;
  if (!session) {
    const raw = safeGet(primary, storageKey) || safeGet(legacy, storageKey);
    if (!raw) return null;
    try {
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

  // Write to per-tab storage; remove legacy shared storage to avoid cross-tab bleed.
  safeSet(primary, storageKey, JSON.stringify(updated));
  safeRemove(legacy, storageKey);

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

export function touchClientSession(existingClientSession) {
  return touchStoredSession('clientUser', 'client_auth', 'client_id', existingClientSession);
}

export function getStoredAdminSession() {
  const primary = getPrimaryStorage();
  const raw = safeGet(primary, 'adminUser');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getStoredDeveloperSession() {
  const primary = getPrimaryStorage();
  const raw = safeGet(primary, 'developerUser');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getStoredClientSession() {
  const primary = getPrimaryStorage();
  const raw = safeGet(primary, 'clientUser');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setStoredAdminSession(sessionObj) {
  const primary = getPrimaryStorage();
  const legacy = getLegacyStorage();
  if (!primary) return;
  safeSet(primary, 'adminUser', JSON.stringify(sessionObj));
  safeRemove(legacy, 'adminUser');
}

export function setStoredDeveloperSession(sessionObj) {
  const primary = getPrimaryStorage();
  const legacy = getLegacyStorage();
  if (!primary) return;
  safeSet(primary, 'developerUser', JSON.stringify(sessionObj));
  safeRemove(legacy, 'developerUser');
}

export function setStoredClientSession(sessionObj) {
  const primary = getPrimaryStorage();
  const legacy = getLegacyStorage();
  if (!primary) return;
  safeSet(primary, 'clientUser', JSON.stringify(sessionObj));
  safeRemove(legacy, 'clientUser');
}
