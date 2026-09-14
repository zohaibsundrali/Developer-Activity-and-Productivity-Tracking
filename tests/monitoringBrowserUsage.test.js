import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserUsageCsv, loadMonitoringBrowserUsage, summarizeBrowserUsage } from '@/utils/monitoringBrowserUsage';
import { createBrowserUsageController } from '@/utils/monitoringBrowserController';

const org = '10000000-0000-4000-8000-000000000001';
const query = { organizationId: org, email: 'dev@example.test', start: '2026-09-12T00:00:00Z', end: '2026-09-13T00:00:00Z' };
const row = id => ({ id, organization_id: org, user_email: query.email, session_id: 'session-one', site: 'GitHub', first_seen: '2026-09-12T10:00:00Z', last_seen: '2026-09-12T10:02:00Z', duration_seconds: '120', duration_minutes: '2' });
function database(total, pages = [], onRead = () => {}, finalCount = total) {
  const calls = []; let counts = 0;
  const client = { from: table => {
    const call = { table, filters: [], orders: [] }; calls.push(call);
    const q = { select: (fields, options) => { Object.assign(call, { fields, options }); return q; },
      eq: (...a) => { call.filters.push(['eq', ...a]); return q; }, gte: (...a) => { call.filters.push(['gte', ...a]); return q; }, lt: (...a) => { call.filters.push(['lt', ...a]); return q; },
      order: (...a) => { call.orders.push(a); return q; }, range: (...a) => { call.range = a; return q; }, abortSignal: signal => { call.signal = signal; return q; },
      then: resolve => { onRead(call); return Promise.resolve(call.options.head ? { count: counts++ ? finalCount : total } : pages.shift()).then(resolve); } };
    return q;
  } };
  return { client, calls };
}

describe('complete website usage', () => {
  it('uses captured dates and reads beyond the hosted row cap', async () => {
    const records = Array.from({ length: 1001 }, (_, i) => row(i + 1));
    const db = database(1001, [records.slice(0, 400), records.slice(400, 800), records.slice(800)].map(data => ({ count: 1001, data })));
    const result = await loadMonitoringBrowserUsage(db.client, query);
    expect(result).toHaveLength(1001);
    expect(result[0].duration_seconds).toBe(120);
    expect(db.calls.filter(c => c.range).map(c => c.range)).toEqual([[0, 499], [400, 899], [800, 1000]]);
    for (const call of db.calls) {
      expect(call.table).toBe('browser_usage');
      expect(call.filters).toEqual([['eq', 'organization_id', org], ['eq', 'user_email', query.email], ['gte', 'first_seen', query.start], ['lt', 'first_seen', query.end]]);
      expect(call.fields).not.toContain('ingest_payload');
    }
  });
  it.each([null, -1, '1', 1.5])('rejects unavailable count %j', async count => {
    await expect(loadMonitoringBrowserUsage(database(count).client, query)).rejects.toThrow('completely');
  });
  it.each([
    { organization_id: 'foreign' }, { user_email: 'other@example.test' }, { first_seen: query.end },
    { first_seen: '2026-02-30T10:00:00Z' }, { last_seen: null }, { site: '' }, { site: null }, { id: null },
    { duration_seconds: true }, { duration_seconds: '' }, { duration_seconds: Infinity },
    { duration_seconds: -1 }, { duration_seconds: null, duration_minutes: null },
  ])('fails closed on invalid or foreign row %j', async patch => {
    const db = database(1, [{ count: 1, data: [{ ...row(1), ...patch }] }]);
    await expect(loadMonitoringBrowserUsage(db.client, query)).rejects.toThrow('completely');
  });
  it('rejects duplicates and drift at the final count instead of exporting partial totals', async () => {
    const duplicate = database(2, [{ count: 2, data: [row(1)] }, { count: 2, data: [row('1')] }]);
    await expect(loadMonitoringBrowserUsage(duplicate.client, query)).rejects.toThrow();
    const changed = database(1, [{ count: 1, data: [row(1)] }], () => {}, 2);
    await expect(loadMonitoringBrowserUsage(changed.client, query)).rejects.toThrow();
  });
  it('supports zero and legacy minute-only records', async () => {
    const db = database(2, [{ count: 2, data: [{ ...row(1), duration_seconds: 0 }, { ...row(2), duration_seconds: null, duration_minutes: '1.5' }] }]);
    const result = await loadMonitoringBrowserUsage(db.client, query);
    expect(summarizeBrowserUsage(result)).toEqual({ totalSeconds: 90, records: 2, sites: [{ site: 'GitHub', seconds: 90, records: 2 }] });
  });
  it('drops stale replies without continuing pagination', async () => {
    let active = true;
    const db = database(2, [{ count: 2, data: [row(1)] }], call => { if (!call.options.head) active = false; });
    expect(await loadMonitoringBrowserUsage(db.client, query, () => active)).toBeNull();
    expect(db.calls).toHaveLength(2);
  });
  it('does not query invalid or already stale scope', async () => {
    const db = database(0);
    expect(await loadMonitoringBrowserUsage(db.client, query, () => false)).toBeNull();
    await expect(loadMonitoringBrowserUsage(db.client, { ...query, organizationId: 'bad' })).rejects.toThrow();
    expect(db.calls).toHaveLength(0);
  });
  it('exports all captured rows as literal CSV fields without personal emails', () => {
    const csv = browserUsageCsv([{ ...row(1), site: '=HYPERLINK("bad")', duration_seconds: 120 }]);
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
    expect(csv).not.toContain(query.email);
    expect(csv).toContain('Observed seconds');
    expect(csv).toContain(',120,session-one');
  });
});

describe('website request lifecycle', () => {
  afterEach(() => vi.useRealTimers());
  it('hides failures without exposing backend errors', async () => {
    const states = [], guard = { current: () => true, dispose: vi.fn() };
    const c = createBrowserUsageController({ guard, query, onChange: s => states.push(s), load: async () => { throw new Error('service-secret'); } });
    await c.refresh();
    expect(states.at(-1)).toMatchObject({ rows: [], loading: false });
    expect(states.at(-1).error).toContain('retry');
    expect(JSON.stringify(states)).not.toContain('service-secret');
    c.dispose();
  });
  it('discards replies after disposal and aborts the request', async () => {
    let resolve, signal;
    const states = [], guard = { current: () => true, dispose: vi.fn() };
    const c = createBrowserUsageController({ guard, query, onChange: s => states.push(s), load: (_, __, ___, requestSignal) => { signal = requestSignal; return new Promise(r => { resolve = r; }); } });
    const pending = c.refresh(); c.dispose(); resolve([row(1)]); await pending;
    expect(signal.aborted).toBe(true);
    expect(states).toHaveLength(1);
    expect(guard.dispose).toHaveBeenCalledOnce();
  });
  it('times out a stalled request without waiting forever', async () => {
    vi.useFakeTimers();
    const states = [], guard = { current: () => true, dispose: vi.fn() };
    const c = createBrowserUsageController({ guard, query, onChange: s => states.push(s), load: () => new Promise(() => {}) });
    const pending = c.refresh(); await vi.advanceTimersByTimeAsync(15000); await pending;
    expect(states.at(-1)).toMatchObject({ loading: false, rows: [] });
    expect(states.at(-1).error).toBeTruthy(); c.dispose();
  });
});
