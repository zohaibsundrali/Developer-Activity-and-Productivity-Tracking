import { sameWorkspace, workspaceTokenClaims } from '@/utils/workspaceClaims';

// Duplicated tabs can inherit an Auth session_id. Reconcile against THIS tab's
// stored SDK session, not another tab's broadcast payload. Defer SDK calls
// until its Auth callback releases the session lock.
export function observeWorkspaceSession(auth, readContext, onChange) {
  let leaving = false, generation = 0, timer;
  const { data } = auth.onAuthStateChange(event => {
    if (leaving || !['INITIAL_SESSION', 'TOKEN_REFRESHED', 'SIGNED_IN'].includes(event)) return;
    const own = ++generation;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const result = await auth.getSession();
        if (leaving || own !== generation || result.error || !result.data?.session) return;
        const current = readContext();
        if (!current) return; // Explicit switching and sign-in clear it first.
        const claims = workspaceTokenClaims(result.data.session.access_token);
        if (!sameWorkspace(current, claims?.app_metadata)) {
          leaving = true;
          onChange();
        }
      } catch { /* An unavailable check is not confirmed context drift. */ }
    }, 0);
  });
  return () => { leaving = true; ++generation; clearTimeout(timer); data?.subscription?.unsubscribe(); };
}
