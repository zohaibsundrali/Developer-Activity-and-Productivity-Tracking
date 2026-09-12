import { describe, expect, it } from 'vitest';
import { loadMonitoringSessions, sumMonitoringSessionDuration } from '@/utils/monitoringSessions';
const org = '10000000-0000-4000-8000-000000000001', profile = '20000000-0000-4000-8000-000000000001';
const opts = { organizationId: org, profileId: profile, email: 'dev@example.com', start: '2026-09-12T00:00:00Z', end: '2026-09-13T00:00:00Z' };
const row = session_id => ({ session_id: String(session_id), organization_id: org, user_id: profile, user_email: opts.email, start_time: '2026-09-12T10:00:00Z', total_duration: '90', active_duration: '60', idle_duration: '30', productivity_score: '75.5' });
function database(responses, onRead = () => {}) {
  const calls = [];
  const client = { from: table => {
    const call = { table, filters: [], orders: [] }; calls.push(call);
    const q = { select: (fields, options) => { Object.assign(call, { fields, options }); return q; },
      eq: (...a) => { call.filters.push(['eq', ...a]); return q; }, is: (...a) => { call.filters.push(['is', ...a]); return q; }, gte: (...a) => { call.filters.push(['gte', ...a]); return q; }, lt: (...a) => { call.filters.push(['lt', ...a]); return q; },
      order: (...a) => { call.orders.push(a); return q; }, range: (...a) => { call.range = a; return q; },
      then: resolve => { onRead(call); return Promise.resolve(responses.shift()).then(resolve); } };
    return q;
  } };
  return { client, calls };
}
describe('complete monitoring session cohorts', () => {
  it('uses authoritative profile ID and separate null-ID email fallback, merges stable captured-time order', async () => {
    const db = database([{ count: 2 }, { count: 2, data: [row('z')] }, { count: 2, data: [row('a')] }, { count: 1 }, { count: 1, data: [{ ...row('m'), user_id: null }] }]);
    const result = await loadMonitoringSessions(db.client, opts);
    expect(result.map(r => r.session_id)).toEqual(['z', 'm', 'a']);
    expect(result[0]).toMatchObject({ total_duration: 90, active_duration: 60, idle_duration: 30, productivity_score: 75.5 });
    expect(db.calls[1].range).toEqual([0, 1]); expect(db.calls[2].range).toEqual([1, 1]);
    for (const call of db.calls) {
      expect(call.filters.slice(0, 3)).toEqual([['eq', 'organization_id', org], ['gte', 'start_time', opts.start], ['lt', 'start_time', opts.end]]);
      expect(call.fields).not.toContain('break_periods');
    }
    expect(db.calls[0].filters.slice(3)).toEqual([['eq', 'user_id', profile]]);
    expect(db.calls[3].filters.slice(3)).toEqual([['is', 'user_id', null], ['eq', 'user_email', opts.email]]);
    expect(db.calls[1].orders).toEqual([['start_time', { ascending: false }], ['session_id', { ascending: false }]]);
  });
  it('loads over 500 records without any out-of-range probe', async () => {
    const rows = Array.from({ length: 501 }, (_, i) => row(i));
    const db = database([{ count: 501 }, { count: 501, data: rows.slice(0, 500) }, { count: 501, data: rows.slice(500) }, { count: 0 }]);
    expect(await loadMonitoringSessions(db.client, opts)).toHaveLength(501); expect(db.calls[2].range).toEqual([500, 500]);
  });
  it('preserves null metrics as unknown and does not infer wall-clock duration', async () => {
    const db = database([{ count: 1 }, { count: 1, data: [{ ...row(1), total_duration: null, productivity_score: null, end_time: opts.end }] }]);
    const result = await loadMonitoringSessions(db.client, { ...opts, email: null });
    expect(result[0].total_duration).toBeNull(); expect(result[0].productivity_score).toBeNull(); expect(db.calls).toHaveLength(2);
  });
  it.each([
    [{ count: 2 }, { count: 3, data: [row(1)] }],
    [{ count: 2 }, { count: 2, data: [] }],
    [{ count: 1 }, { count: 1, data: [row(1), row(2)] }],
    [{ count: 2 }, { count: 2, data: [row(1)] }, { count: 2, data: [row(1)] }],
    [{ count: 1 }, { count: 1, data: [{ ...row(1), session_id: null }] }],
    [{ count: 1 }, { count: 1, data: [{ ...row(1), user_id: org }] }],
    [{ count: 1 }, { count: 1, data: [{ ...row(1), organization_id: profile }] }],
    [{ count: 1 }, { count: 1, data: [{ ...row(1), start_time: opts.end }] }],
    [{ count: 0 }, { count: 1 }, { count: 1, data: [row(1)] }],
    [{ count: 1 }, { count: 1, data: [row(1)] }, { count: 1 }, { count: 1, data: [{ ...row(1), user_id: null }] }],
    [{ count: null }],
    [{ count: 1 }, { error: { message: 'private details' } }],
  ])('fails closed on changing counts or invalid identity receipts %#', async (...responses) => {
    const db = database(responses); await expect(loadMonitoringSessions(db.client, opts)).rejects.toThrow('completely');
  });
  it.each(['', ' ', 'oops', true, -1, Infinity, '0x10', 100.01])('rejects malformed numeric metrics %j', async value => {
    const db = database([{ count: 1 }, { count: 1, data: [{ ...row(1), productivity_score: value }] }]);
    await expect(loadMonitoringSessions(db.client, opts)).rejects.toThrow('completely');
  });
  it.each([{ profileId: '' }, { organizationId: '' }, { start: '2026-02-30' }, { end: opts.start }])('validates scope before queries %j', async patch => {
    const db = database([]); await expect(loadMonitoringSessions(db.client, { ...opts, ...patch })).rejects.toThrow('Invalid'); expect(db.calls).toHaveLength(0);
  });
  it('discards stale responses before legacy queries or next page', async () => {
    let active = true; const db = database([{ count: 2 }, { count: 2, data: [row(1)] }], call => { if (!call.options.head) active = false; });
    expect(await loadMonitoringSessions(db.client, opts, () => active)).toBeNull(); expect(db.calls).toHaveLength(2);
  });
  it('does no work when stale', async () => { const db = database([]); expect(await loadMonitoringSessions(db.client, opts, () => false)).toBeNull(); expect(db.calls).toHaveLength(0); });
});
describe('session duration totals', () => {
  it('sums normalized numeric seconds', () => { expect(sumMonitoringSessionDuration([{ total_duration: 90 }, { total_duration: 30 }])).toBe(120); });
  it('uses zero only for an empty cohort', () => { expect(sumMonitoringSessionDuration([])).toBe(0); });
  it.each([null, undefined, NaN, Infinity, '90', -1])('keeps unknown/invalid totals unavailable %j', value => { expect(sumMonitoringSessionDuration([{ total_duration: value }])).toBeNull(); });
  it('rejects total overflow', () => { expect(sumMonitoringSessionDuration([{ total_duration: Number.MAX_VALUE }, { total_duration: Number.MAX_VALUE }])).toBeNull(); });
  it('supports active and idle metrics only', () => { expect(sumMonitoringSessionDuration([{ active_duration: 10 }], 'active_duration')).toBe(10); expect(sumMonitoringSessionDuration([], 'productivity_score')).toBeNull(); });
});
