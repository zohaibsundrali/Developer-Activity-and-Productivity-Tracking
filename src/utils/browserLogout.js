import { supabase, SUPABASE_AUTH_STORAGE_KEY } from '@/utils/supabaseClient';
import { clearApplicationSessions } from '@/utils/sessionPolicy';

const LOGOUT_TIMEOUT_MS = 1500;
let pendingLogout = null;

function removeSdkStorage() {
  for (const name of ['sessionStorage', 'localStorage']) {
    try {
      const storage = window[name];
      for (const suffix of ['', '-code-verifier', '-user']) storage.removeItem(`${SUPABASE_AUTH_STORAGE_KEY}${suffix}`);
    } catch { /* A blocked storage API must not prevent leaving the document. */ }
  }
}

/** End this browser session; other devices remain signed in.
 * Revoke remotely when reachable, always remove local identity on timeout. */
export function clearBrowserAuthentication() {
  if (typeof window === 'undefined') return Promise.resolve();
  if (pendingLogout) return pendingLogout;
  pendingLogout = (async () => {
    clearApplicationSessions();
    // Stop user-facing access immediately, while giving the SDK its existing
    // stored token long enough to request refresh-token revocation.
    window.dispatchEvent(new Event('auth-state-changed'));
    const attempt = task => Promise.resolve().then(task).catch(() => null);
    const operations = [
      attempt(() => supabase.auth.stopAutoRefresh()),
      attempt(() => supabase.removeAllChannels()),
      // Revoke only this browser session. A slow global request could arrive
      // after another device or a fresh login creates a new session.
      attempt(() => supabase.auth.signOut({ scope: 'local' })),
      attempt(() => fetch('/api/auth/session', { method: 'DELETE', keepalive: true })),
    ];
    let timeout;
    try {
      await Promise.race([
        Promise.allSettled(operations),
        new Promise(resolve => { timeout = setTimeout(resolve, LOGOUT_TIMEOUT_MS); }),
      ]);
    } finally {
      clearTimeout(timeout);
      // signOut returns early without clearing storage on some network errors.
      // Force removal of only this project's SDK keys, including PKCE/user data.
      removeSdkStorage();
      clearApplicationSessions();
    }
  })().finally(() => { pendingLogout = null; });
  return pendingLogout;
}

export async function logoutAndRedirect() {
  await clearBrowserAuthentication();
  // Destroy retained React state, in-flight requests and realtime subscriptions.
  // A client router push would leave the old authenticated document alive.
  window.location.href = '/login';
}
