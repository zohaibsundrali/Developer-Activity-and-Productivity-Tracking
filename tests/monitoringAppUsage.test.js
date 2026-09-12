import { describe, expect, it } from 'vitest';
import { loadMonitoringAppUsage } from '@/utils/monitoringAppUsage';
const org = '10000000-0000-4000-8000-000000000001';
const opts = { organizationId: org, email: 'dev@example.com', start: '2026-09-12T00:00:00Z', end: '2026-09-13T00:00:00Z' };
const row = id => ({ id, organization_id: org, user_email: opts.email, start_time: '2026-09-12T10:00:00Z', tracked_at: '2026-09-14T10:00:00Z', duration_seconds: '120', duration_minutes: '2' });
function database(count, pages = [], onRead = () => {}) {
  const calls = [];
  const client = { from: table => {
    const call = { table, filters: [], orders: [] }; calls.push(call);
    const q = { select: (fields, options) => { Object.assign(call, { fields, options }); return q; },
      eq: (...a) => { call.filters.push(['eq', ...a]); return q; }, gte: (...a) => { call.filters.push(['gte', ...a]); return q; }, lt: (...a) => { call.filters.push(['lt', ...a]); return q; },
      order: (...a) => { call.orders.push(a); return q; }, range: (...a) => { call.range = a; return q; },
      then: resolve => { onRead(call); return Promise.resolve(call.options.head ? { count } : pages.shift()).then(resolve); } };
    return q;
  } };
  return { client, calls };
}
describe('complete captured-time app activity', () => {
  it('fills low-cap responses using actual rows and never requests beyond exact total', async () => {
    const db = database(3, [{ count: 3, data: [row(3)] }, { count: 3, data: [row(2), row(1)] }]);
    const result = await loadMonitoringAppUsage(db.client, opts);
    expect(result.map(r => r.id)).toEqual([3, 2, 1]);
    expect(result[0]).toMatchObject({ duration_seconds: 120, duration_minutes: 2 });
    expect(db.calls.slice(1).map(c => c.range)).toEqual([[0, 2], [1, 2]]);
    for (const call of db.calls) {
      expect(call.filters).toEqual([['eq', 'organization_id', org], ['eq', 'user_email', opts.email], ['gte', 'start_time', opts.start], ['lt', 'start_time', opts.end]]);
      expect(call.fields).not.toContain('ingest_payload');
    }
    expect(db.calls[1].orders).toEqual([['start_time', { ascending: false }], ['id', { ascending: false }]]);
  });
  it('loads beyond the old 1000-row cap', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => row(i + 1));
    const db = database(1001, [rows.slice(0, 500), rows.slice(500, 1000), rows.slice(1000)].map(data => ({ count: 1001, data })));
    expect(await loadMonitoringAppUsage(db.client, opts)).toHaveLength(1001);
    expect(db.calls.at(-1).range).toEqual([1000, 1000]);
  });
  it('returns an empty complete result without a range request', async () => {
    const db = database(0); expect(await loadMonitoringAppUsage(db.client, opts)).toEqual([]); expect(db.calls).toHaveLength(1);
  });
  it.each([
    [{ duration_seconds: null, duration_minutes: '1.5' }, 90, 1.5],
    [{ duration_seconds: '90', duration_minutes: undefined }, 90, 1.5],
    [{ duration_seconds: 0, duration_minutes: 0 }, 0, 0],
    [{ duration_seconds: 90, duration_minutes: 1.4999 }, 90, 1.4999],
  ])('normalizes and preserves independent existing units %j', async (patch, seconds, minutes) => {
    const db = database(1, [{ count: 1, data: [{ ...row(1), ...patch }] }]);
    expect((await loadMonitoringAppUsage(db.client, opts))[0]).toMatchObject({ duration_seconds: seconds, duration_minutes: minutes });
  });
  it.each(['', ' ', 'abc', 'Infinity', '0x10', -1, true, {}, NaN, Infinity])('rejects malformed present duration %j even with a valid other unit', async value => {
    const db = database(1, [{ count: 1, data: [{ ...row(1), duration_seconds: value }] }]);
    await expect(loadMonitoringAppUsage(db.client, opts)).rejects.toThrow('completely');
  });
  it.each([
    [{ count: 3, data: [row(1)] }],
    [{ count: 2, data: [] }],
    [{ count: 2, data: [row(1), row(2), row(3)] }],
    [{ count: 2, data: [row(1)] }, { count: 2, data: [row('1')] }],
    [{ count: 2, data: [{ ...row(1), id: null }] }],
    [{ count: 2, data: [{ ...row(1), organization_id: 'other' }] }],
    [{ count: 2, data: [{ ...row(1), user_email: 'other@example.com' }] }],
    [{ count: 2, data: [{ ...row(1), start_time: opts.end }] }],
    [{ count: 2, data: [{ ...row(1), duration_seconds: null, duration_minutes: null }] }],
    [{ count: 2, data: null, error: { message: 'secret server internals' } }],
  ])('rejects incomplete or malformed receipts %#', async (...pages) => {
    const db = database(2, pages); await expect(loadMonitoringAppUsage(db.client, opts)).rejects.toThrow('completely');
  });
  it.each([null, -1, '2', 1.5])('requires a usable exact count %j', async count => {
    const db = database(count); await expect(loadMonitoringAppUsage(db.client, opts)).rejects.toThrow('completely');
  });
  it.each([{ organizationId: '' }, { email: '' }, { start: '2026-02-30' }, { end: opts.start }])('rejects invalid scope before network %j', async patch => {
    const db = database(0); await expect(loadMonitoringAppUsage(db.client, { ...opts, ...patch })).rejects.toThrow('Invalid'); expect(db.calls).toHaveLength(0);
  });
  it('discards a stale response without continuing pagination', async () => {
    let active = true;
    const db = database(2, [{ count: 2, data: [row(1)] }], call => { if (!call.options.head) active = false; });
    expect(await loadMonitoringAppUsage(db.client, opts, () => active)).toBeNull(); expect(db.calls).toHaveLength(2);
  });
  it('does not query when already stale', async () => {
    const db = database(0); expect(await loadMonitoringAppUsage(db.client, opts, () => false)).toBeNull(); expect(db.calls).toHaveLength(0);
  });
});
