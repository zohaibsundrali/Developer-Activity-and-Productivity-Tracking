import { loadMonitoringBrowserUsage, summarizeBrowserUsage } from '@/utils/monitoringBrowserUsage';

export function createBrowserUsageController({ client, query, guard, onChange, load = loadMonitoringBrowserUsage }) {
  let disposed = false, inflight = null, abort = null;
  const current = () => !disposed && guard.current();
  const empty = { rows: [], summary: { sites: [], records: 0, totalSeconds: 0 } };
  async function refresh() {
    if (!current()) return;
    if (inflight) return inflight;
    abort = new AbortController();
    const request = abort;
    onChange({ ...empty, loading: true, error: '' });
    inflight = (async () => {
      let timer;
      try {
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => { request.abort(); reject(new Error('Website activity timed out. Please retry.')); }, 15000);
        });
        const rows = await Promise.race([load(client, query, current, request.signal), timeout]);
        if (!current() || !rows) return;
        onChange({ rows, summary: summarizeBrowserUsage(rows), loading: false, error: '' });
      } catch {
        if (current()) onChange({ ...empty, loading: false, error: 'Website activity could not be loaded completely. Please retry.' });
      } finally {
        clearTimeout(timer); inflight = null;
      }
    })();
    return inflight;
  }
  return { refresh, current, dispose() { disposed = true; abort?.abort(); guard.dispose(); } };
}
