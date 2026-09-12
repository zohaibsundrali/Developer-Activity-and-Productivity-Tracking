import { describe, expect, it } from 'vitest';
import { loadMonitoringLogins } from '@/utils/monitoringLogins';
const org = '10000000-0000-4000-8000-000000000001';
const profile = '20000000-0000-4000-8000-000000000001';
const opts = { organizationId: org, profileId: profile, start: '2026-09-12T00:00:00Z', end: '2026-09-13T00:00:00Z' };
const row = id => ({ id: typeof id === 'number' ? `30000000-0000-4000-8000-${String(id).padStart(12, '0')}` : id, organization_id: org, developer_id: profile, login_time: '2026-09-12T10:00:00Z', login_date: '2026-09-12' });
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
describe('complete login activity', () => {
  it('fills low-cap responses using actual rows and never requests beyond exact total', async () => {
    const db = database(3, [{ count: 3, data: [row(3)] }, { count: 3, data: [row(2), row(1)] }]);
    const result = await loadMonitoringLogins(db.client, opts);
    expect(result.map(r => r.id)).toEqual([row(3).id, row(2).id, row(1).id]);
    expect(db.calls.slice(1).map(c => c.range)).toEqual([[0, 2], [1, 2]]);
    for (const call of db.calls) {
      expect(call.filters).toEqual([['eq', 'organization_id', org], ['eq', 'developer_id', profile], ['gte', 'login_time', opts.start], ['lt', 'login_time', opts.end]]);
      expect(call.fields).not.toContain('ingest_payload');
    }
    expect(db.calls[1].orders).toEqual([['login_time', { ascending: true }], ['id', { ascending: true }]]);
  });
  it('loads beyond the old 1000-row cap', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => row(i + 1));
    const db = database(1001, [rows.slice(0, 500), rows.slice(500, 1000), rows.slice(1000)].map(data => ({ count: 1001, data })));
    expect(await loadMonitoringLogins(db.client, opts)).toHaveLength(1001);
    expect(db.calls.at(-1).range).toEqual([1000, 1000]);
  });
  it('returns an empty complete result without a range request', async () => {
    const db = database(0); expect(await loadMonitoringLogins(db.client, opts)).toEqual([]); expect(db.calls).toHaveLength(1);
  });
  it.each([
    [{ count: 3, data: [row(1)] }],
    [{ count: 2, data: [] }],
    [{ count: 2, data: [row(1), row(2), row(3)] }],
    [{ count: 2, data: [row(1)] }, { count: 2, data: [row(1)] }],
    [{ count: 2, data: [{ ...row(1), id: null }] }],
    [{ count: 2, data: [{ ...row(1), id: 'not-a-uuid' }] }],
    [{ count: 2, data: [{ ...row(1), login_time: '2026-02-30T10:00:00Z' }] }],
    [{ count: 2, data: [{ ...row(1), login_time: 'invalid' }] }],
    [{ count: 2, data: [{ ...row(1), organization_id: 'other' }] }],
    [{ count: 2, data: [{ ...row(1), developer_id: org }] }],
    [{ count: 2, data: [{ ...row(1), login_time: opts.end }] }],
    [{ count: 2, data: null, error: { message: 'secret server internals' } }],
  ])('rejects incomplete or malformed receipts %#', async (...pages) => {
    const db = database(2, pages); await expect(loadMonitoringLogins(db.client, opts)).rejects.toThrow('completely');
  });
  it.each([null, -1, '2', 1.5])('requires a usable exact count %j', async count => {
    const db = database(count); await expect(loadMonitoringLogins(db.client, opts)).rejects.toThrow('completely');
  });
  it.each([{ organizationId: '' }, { profileId: '' }, { start: '2026-02-30' }, { end: opts.start }])('rejects invalid scope before network %j', async patch => {
    const db = database(0); await expect(loadMonitoringLogins(db.client, { ...opts, ...patch })).rejects.toThrow('Invalid'); expect(db.calls).toHaveLength(0);
  });
  it('discards a stale response without continuing pagination', async () => {
    let active = true;
    const db = database(2, [{ count: 2, data: [row(1)] }], call => { if (!call.options.head) active = false; });
    expect(await loadMonitoringLogins(db.client, opts, () => active)).toBeNull(); expect(db.calls).toHaveLength(2);
  });
  it('does not query when already stale', async () => {
    const db = database(0); expect(await loadMonitoringLogins(db.client, opts, () => false)).toBeNull(); expect(db.calls).toHaveLength(0);
  });
});
