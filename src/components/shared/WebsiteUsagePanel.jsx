'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { setVisibleInterval } from '@/hooks/useVisibleInterval';
import { createBrowserUsageController } from '@/utils/monitoringBrowserController';
import { createMonitoringAppRefresh } from '@/utils/monitoringAppRefresh';
import { browserUsageCsv } from '@/utils/monitoringBrowserUsage';
import { downloadReportBlob } from '@/utils/reportExport';

const PAGE_SIZE = 25;
const formatTime = seconds => `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ${Math.floor(seconds % 60)}s`;

export default function WebsiteUsagePanel({ client, organizationId, email, start, end, makeGuard }) {
  const binding = useMemo(() => ({ client, organizationId, email, start, end, makeGuard }), [client, organizationId, email, start, end, makeGuard]);
  const live = useRef(binding); live.current = binding;
  const controller = useRef(null);
  const [result, setResult] = useState(null);
  const [page, setPage] = useState(1);
  const [exportError, setExportError] = useState('');
  useEffect(() => {
    setPage(1);
    const guard = makeGuard();
    const instance = createBrowserUsageController({ client, query: { organizationId, email, start, end }, guard,
      onChange: state => { if (live.current === binding) { setResult({ binding, state }); setExportError(''); } },
    });
    controller.current = { binding, instance };
    const refresh = createMonitoringAppRefresh({ guard: {
      current: instance.current,
      accepts: row => guard.accepts(row) && row.user_email === email,
    }, refresh: instance.refresh });
    let channel = client.channel(`monitoring-websites-${organizationId}`);
    for (const event of ['INSERT', 'UPDATE']) {
      channel = channel.on('postgres_changes', { event, schema: 'public', table: 'browser_usage', filter: `user_email=eq.${email}` }, payload => refresh.notify(payload.new));
    }
    channel.subscribe();
    instance.refresh();
    const stopPoll = setVisibleInterval(() => instance.refresh(), 30000);
    const focus = () => instance.refresh();
    window.addEventListener('focus', focus);
    return () => { instance.dispose(); refresh.dispose(); stopPoll(); client.removeChannel(channel); window.removeEventListener('focus', focus); controller.current = null; };
  }, [binding, client, organizationId, email, start, end, makeGuard]);
  const state = result?.binding === binding ? result.state : { loading: true, error: '', rows: [], summary: { sites: [], records: 0, totalSeconds: 0 } };
  const pages = Math.max(1, Math.ceil(state.summary.sites.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const visible = state.summary.sites.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  function exportCsv() {
    if (state.loading || state.error || controller.current?.binding !== live.current || !controller.current.instance.current()) return;
    try {
      downloadReportBlob(new Blob([browserUsageCsv(state.rows)], { type: 'text/csv;charset=utf-8;' }), `website-usage_${start.slice(0, 10)}_${new Date(Date.parse(end) - 1).toISOString().slice(0, 10)}.csv`);
    } catch { setExportError('Website export could not be created. Please retry.'); }
  }
  return <section className="space-y-4 rounded-xl border border-border bg-card p-5" aria-labelledby="website-usage-heading">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="website-usage-heading" className="text-lg font-semibold">Website usage</h2>
      <div className="flex gap-2">
        <Button type="button" variant="outline" disabled={state.loading} onClick={() => controller.current?.instance.refresh()}>Refresh websites</Button>
        <Button type="button" variant="outline" disabled={state.loading || !!state.error || !state.rows.length} onClick={exportCsv}>Export website CSV</Button>
      </div>
    </div>
    <p className="text-sm text-muted-foreground">Website labels or domains observed by the Windows tracker. Time is grouped by the aggregate’s first-seen date in UTC. These totals are browser activity, not additional work hours or a full browsing history.</p>
    {state.loading ? <p role="status">Loading website activity…</p> : state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : <>
      <p className="text-sm">{state.summary.sites.length} websites · {formatTime(state.summary.totalSeconds)} observed · {state.summary.records} records</p>
      {!visible.length ? <p className="text-sm text-muted-foreground">No website activity was recorded in this date range. This does not prove no browser was used; tracking support and availability affect capture.</p> : <>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead><tr className="border-b border-border"><th scope="col" className="p-3">Website label or domain</th><th scope="col" className="p-3">Observed time</th><th scope="col" className="p-3">Records</th></tr></thead>
          <tbody>{visible.map(site => <tr key={site.site} className="border-b border-border"><td className="max-w-xs break-words p-3">{site.site}</td><td className="whitespace-nowrap p-3">{formatTime(site.seconds)}</td><td className="p-3">{site.records}</td></tr>)}</tbody>
        </table></div>
        <div className="flex items-center justify-between gap-3">
          <Button type="button" variant="outline" disabled={currentPage <= 1} onClick={() => setPage(value => value - 1)}>Previous websites</Button>
          <span className="text-sm">Page {currentPage} of {pages}</span>
          <Button type="button" variant="outline" disabled={currentPage >= pages} onClick={() => setPage(value => value + 1)}>Next websites</Button>
        </div>
      </>}
    </>}
    {exportError && <p role="alert" className="text-sm text-destructive">{exportError}</p>}
  </section>;
}
