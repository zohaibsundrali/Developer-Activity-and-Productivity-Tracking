/** Serialize authoritative refreshes while coalescing bursts of realtime events. */
export function createMonitoringAppRefresh({ guard, refresh, delay = 200, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let disposed = false;
  let timer = null;
  let running = false;
  let dirty = false;
  const current = () => !disposed && guard.current();
  const schedule = () => {
    if (!current() || timer !== null || running || !dirty) return;
    timer = setTimer(async () => {
      timer = null;
      if (!current()) { dirty = false; return; }
      running = true;
      dirty = false;
      try {
        await refresh();
      } catch {
        // The caller renders request errors. Event callbacks must not reject.
      } finally {
        running = false;
        if (current() && dirty) schedule();
      }
    }, delay);
  };
  const notify = row => {
    if (disposed || !guard.accepts(row)) return;
    dirty = true;
    schedule();
  };
  return {
    notify,
    dispose() {
      disposed = true;
      dirty = false;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}
