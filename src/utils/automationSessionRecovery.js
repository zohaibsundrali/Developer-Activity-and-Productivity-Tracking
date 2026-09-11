/** Retry durable work while a staff dashboard is active, and after reconnect.
 * Identity and permission checks remain in the authenticated processing API.
 */
export function startAutomationSessionRecovery({ windowTarget, documentTarget, recover, onError = () => {} }) {
  let stopped = false;
  let running = false;
  const run = async () => {
    if (stopped || running || documentTarget.hidden) return;
    running = true;
    try { await recover(); } catch { if (!stopped) onError(); }
    finally { running = false; }
  };
  windowTarget.addEventListener('online', run);
  documentTarget.addEventListener('visibilitychange', run);
  const interval = windowTarget.setInterval(run, 60_000);
  void run();
  return () => {
    stopped = true;
    windowTarget.clearInterval(interval);
    windowTarget.removeEventListener('online', run);
    documentTarget.removeEventListener('visibilitychange', run);
  };
}
