import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ auth: null, rows: [], cap: 1000, calls: [], failAt: null }));
vi.mock('@/utils/serverAuth', () => ({
  getAuthedOrg: async () => state.auth,
  serviceClient: () => { throw new Error('No service-role reads allowed'); },
  orgScopedClient: token => {
    expect(token).toBe('caller-token');
    return { from(table) {
      expect(table).toBe('timesheets');
      const call = { filters: {}, orders: [], limit: null, after: null };
      state.calls.push(call);
      const q = {
        select: columns => { call.columns = columns; return q; },
        eq: (key, value) => { call.filters[key] = value; return q; },
        order: (key, options) => { call.orders.push([key, options]); return q; },
        limit: value => { call.limit = value; return q; },
        or: value => {
          const match = /^week_start\.lt\.(\d{4}-\d{2}-\d{2}),and\(week_start\.eq\.\1,id\.lt\.([a-f0-9-]+)\)$/.exec(value);
          expect(match).toBeTruthy(); call.after = { week: match[1], id: match[2] }; return q;
        },
        then: resolve => {
          if (state.failAt === state.calls.length) return Promise.resolve({ data: null, error: { code: 'XX000', message: 'secret detail' } }).then(resolve);
          let rows = state.rows.filter(row => Object.entries(call.filters).every(([key, value]) => row[key] === value));
          rows.sort((a, b) => b.week_start.localeCompare(a.week_start) || b.id.localeCompare(a.id));
          if (call.after) rows = rows.filter(row => row.week_start < call.after.week || row.week_start === call.after.week && row.id < call.after.id);
          return Promise.resolve({ data: rows.slice(0, Math.min(call.limit, state.cap)), error: null }).then(resolve);
        },
      };
      return q;
    } };
  },
}));
vi.mock('@/utils/entitlements', () => ({ requireUnlocked: vi.fn() }));
import { GET } from '../src/app/api/timesheets/route';
const row = (n, updates = {}) => ({ id: `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`, week_start: '2026-09-07', organization_id: 'org', user_id: 'staff', user_type: 'developer', status: 'submitted', ...updates });
const request = params => GET(new Request(`http://localhost/api/timesheets?${params}`));
beforeEach(() => {
  state.auth = { orgId: 'org', appUserId: 'staff', userType: 'developer', role: 'manager', overrides: {}, token: 'caller-token' };
  state.rows = []; state.cap = 1000; state.calls = []; state.failAt = null;
});
describe('complete cursor-paged timesheet reads', () => {
  it('walks beyond 300 rows with deterministic ordering and no duplicate or lost same-week rows', async () => {
    state.rows = Array.from({ length: 321 }, (_, i) => row(i + 1, { week_start: i < 110 ? '2026-08-31' : '2026-09-07' }));
    const ids = []; let cursor = null;
    do {
      const res = await request(`status=submitted&limit=50${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      const page = await res.json(); ids.push(...page.timesheets.map(item => item.id));
      expect(page.hasMore).toBe(Boolean(page.nextCursor)); cursor = page.nextCursor;
    } while (cursor);
    expect(ids).toHaveLength(321); expect(new Set(ids).size).toBe(321);
    expect(ids[0]).toBe(row(321).id); expect(ids.at(-1)).toBe(row(1).id);
    expect(state.calls.every(call => call.orders[0][0] === 'week_start' && call.orders[1][0] === 'id')).toBe(true);
  });
  it('probes even a short hosted-capped page and ends correctly at the boundary', async () => {
    state.rows = [row(1), row(2), row(3), row(4)]; state.cap = 2;
    const first = await (await request('limit=50')).json();
    expect(first.timesheets).toHaveLength(2); expect(first.hasMore).toBe(true);
    const second = await (await request(`limit=50&cursor=${first.nextCursor}`)).json();
    expect(second.timesheets).toHaveLength(2); expect(second.hasMore).toBe(false); expect(second.nextCursor).toBeNull();
  });
  it('retains the default 300-row contract and explicit own-week typed filters', async () => {
    state.rows = [row(1), row(2, { user_type: 'admin' }), row(3, { user_id: 'other' }), row(4, { organization_id: 'foreign' })];
    const data = await (await request('scope=me&weekStart=2026-09-07')).json();
    expect(data.timesheets.map(item => item.id)).toEqual([row(1).id]);
    expect(data.hasMore).toBe(false); expect(state.calls[0].limit).toBe(300);
    expect(state.calls.every(call => call.filters.organization_id === 'org' && call.filters.user_type === 'developer' && call.filters.user_id === 'staff')).toBe(true);
  });
  it.each(['0', '-1', '301', '1.5', '', 'abc', '01'])('rejects invalid page size %s without a read', async limit => {
    expect((await request(`limit=${limit}`)).status).toBe(400); expect(state.calls).toHaveLength(0);
  });
  it.each(['', '!', 'e30', Buffer.from(JSON.stringify({ weekStart: '2026-09-07', id: "x),id.gt.0" })).toString('base64url')])('rejects invalid cursors before querying', async cursor => {
    expect((await request(`cursor=${cursor}`)).status).toBe(400); expect(state.calls).toHaveLength(0);
  });
  it('binds cursors to filters and current typed identity', async () => {
    state.rows = [row(1), row(2)];
    const page = await (await request('limit=1&status=submitted')).json();
    for (const suffix of ['status=approved', 'status=submitted&scope=me', 'status=submitted&weekStart=2026-09-07']) {
      expect((await request(`cursor=${page.nextCursor}&${suffix}`)).status).toBe(400);
    }
    state.auth.orgId = 'another';
    expect((await request(`cursor=${page.nextCursor}&status=submitted`)).status).toBe(400);
    state.auth.orgId = 'org'; state.auth.userType = 'admin';
    expect((await request(`cursor=${page.nextCursor}&status=submitted`)).status).toBe(400);
  });
  it('does not claim completeness when the continuation probe fails', async () => {
    state.rows = [row(1)]; state.failAt = 2;
    const response = await request('limit=50'); expect(response.status).toBe(503);
    const data = await response.json(); expect(data.success).toBe(false); expect(data.timesheets).toBeUndefined(); expect(data.error).not.toContain('secret');
  });
  it('reports an empty list without extra probes', async () => {
    expect(await (await request('')).json()).toEqual({ success: true, timesheets: [], hasMore: false, nextCursor: null });
    expect(state.calls).toHaveLength(1);
  });
});
