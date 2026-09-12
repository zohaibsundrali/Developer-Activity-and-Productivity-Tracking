import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ auth: null, rpcResult: null, rpcCalls: [], reads: [], rows: [], cap: 1000, failRead: null }));
vi.mock('@/utils/serverAuth', () => ({
  getAuthedOrg: async () => state.auth,
  orgScopedClient: token => ({ rpc: async (name, args) => { state.rpcCalls.push({ token, name, args }); return state.rpcResult; } }),
  serviceClient: () => ({ from: table => {
    expect(table).toBe('attendance_records');
    const call = { filters: {}, from: null, to: null, after: null, limit: 0, orders: [] }; state.reads.push(call);
    const q = {
      select: () => q,
      eq: (key, value) => { call.filters[key] = value; return q; },
      gte: (key, value) => { expect(key).toBe('work_date'); call.from = value; return q; },
      lte: (key, value) => { expect(key).toBe('work_date'); call.to = value; return q; },
      order: (key, options) => { call.orders.push([key, options]); return q; },
      limit: value => { call.limit = value; return q; },
      or: value => { const m = /^work_date\.lt\.(\d{4}-\d{2}-\d{2}),and\(work_date\.eq\.\1,id\.lt\.([a-f0-9-]+)\)$/.exec(value); expect(m).toBeTruthy(); call.after = { date: m[1], id: m[2] }; return q; },
      then: resolve => {
        if (state.failRead === state.reads.length) return Promise.resolve({ data: null, error: { code: 'XX000', message: 'secret DB internals' } }).then(resolve);
        let data = state.rows.filter(row => Object.entries(call.filters).every(([key, value]) => row[key] === value)
          && (!call.from || row.work_date >= call.from) && (!call.to || row.work_date <= call.to));
        data.sort((a,b) => b.work_date.localeCompare(a.work_date) || b.id.localeCompare(a.id));
        if (call.after) data = data.filter(row => row.work_date < call.after.date || row.work_date === call.after.date && row.id < call.after.id);
        return Promise.resolve({ data: data.slice(0, Math.min(call.limit, state.cap)), error: null }).then(resolve);
      },
    }; return q;
  } }),
}));
import { GET, POST } from '@/app/api/attendance/route';
const ID = '10000000-0000-4000-8000-000000000001';
const USER = '20000000-0000-4000-8000-000000000001';
const OTHER = '30000000-0000-4000-8000-000000000001';
const DATE = '2026-09-12';
const row = patch => ({ id: ID, organization_id: 'org', user_id: USER, user_type: 'developer', work_date: DATE, status: 'present', source: 'self', check_in_at: `${DATE}T09:00:00Z`, check_out_at: null, ...patch });
const post = body => POST(new Request('http://localhost/api/attendance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
const get = query => GET(new Request(`http://localhost/api/attendance?${query || ''}`));
beforeEach(() => {
  state.auth = { orgId: 'org', appUserId: USER, userType: 'developer', role: 'developer', token: 'caller-token', overrides: {} };
  state.rpcResult = { data: { record: row(), unchanged: false }, error: null };
  state.rpcCalls = []; state.reads = []; state.rows = []; state.cap = 1000; state.failRead = null;
});
describe('transactional attendance writes', () => {
  it('uses only the authenticated caller RPC with typed defaults and no service writes', async () => {
    const res = await post({ workDate: DATE }); expect(res.status).toBe(200);
    expect(state.rpcCalls).toEqual([{ token: 'caller-token', name: 'record_attendance', args: { p_action: 'check_in', p_work_date: DATE, p_user_id: USER, p_user_type: 'developer', p_status: 'present', p_note: null } }]);
    expect(state.reads).toEqual([]); expect(res.headers.get('cache-control')).toContain('no-store');
  });
  it('returns an idempotent unchanged receipt and preserves check-out timestamps', async () => {
    state.rpcResult.data = { record: row({ check_out_at: `${DATE}T17:00:00Z` }), unchanged: true };
    const res = await post({ workDate: DATE, action: 'check_out' }); expect(res.status).toBe(200);
    expect((await res.json()).unchanged).toBe(true);
  });
  it.each([null, [], 'check_in', { workDate: DATE, extra: true }, { workDate: DATE, action: null }, { workDate: DATE, action: 'delete' }, { workDate: '2026-02-30' }, { workDate: '' }, { workDate: DATE, userType: 'client' }, { workDate: DATE, userType: null }, { workDate: DATE, userId: [USER] }, { workDate: DATE, status: 'late' }, { workDate: DATE, note: null }, { workDate: DATE, note: 1 }, { workDate: DATE, note: 'x'.repeat(501) }])('rejects malformed request %# before RPC', async body => {
    expect((await post(body)).status).toBe(400); expect(state.rpcCalls).toEqual([]);
  });
  it('rejects malformed JSON without changing attendance', async () => {
    const res = await POST(new Request('http://localhost/api/attendance', { method: 'POST', body: '{' })); expect(res.status).toBe(400); expect(state.rpcCalls).toEqual([]);
  });
  it('denies anonymous/client accounts, revoked self permission and unauthorized corrections', async () => {
    state.auth = null; expect((await post({ workDate: DATE })).status).toBe(401);
    state.auth = { orgId: 'org', appUserId: USER, userType: 'client', role: 'owner', overrides: {} }; expect((await post({ workDate: DATE })).status).toBe(403);
    state.auth.userType = 'developer'; state.auth.role = 'developer'; state.auth.overrides['attendance.log_own'] = false;
    expect((await post({ workDate: DATE })).status).toBe(403);
    state.auth.overrides = {}; expect((await post({ workDate: DATE, userId: OTHER, userType: 'developer' })).status).toBe(403);
    expect(state.rpcCalls).toEqual([]);
  });
  it.each(['absent', 'holiday'])('rejects self-service %s even for HR', async status => {
    state.auth.role = 'hr'; expect((await post({ workDate: DATE, status })).status).toBe(400); expect(state.rpcCalls).toEqual([]);
  });
  it('allows a manager override to correct a different typed profile sharing the same UUID', async () => {
    state.auth.overrides['attendance.manage'] = true;
    state.rpcResult.data.record = row({ user_type: 'admin', status: 'holiday', source: 'hr', check_in_at: null });
    expect((await post({ workDate: DATE, userId: USER, userType: 'admin', status: 'holiday', note: 'Office holiday' })).status).toBe(200);
    expect(state.rpcCalls[0].args).toMatchObject({ p_user_id: USER, p_user_type: 'admin', p_status: 'holiday', p_note: 'Office holiday' });
  });
  it('delegates omitted other-person type resolution to the transactional membership check', async () => {
    state.auth.role = 'hr'; state.rpcResult.data.record = row({ user_id: OTHER, source: 'hr' });
    expect((await post({ workDate: DATE, userId: OTHER })).status).toBe(200); expect(state.rpcCalls[0].args.p_user_type).toBeNull();
  });
  it.each([null, { record: row({ organization_id: 'other' }), unchanged: false }, { record: row({ user_id: OTHER }), unchanged: false }, { record: row({ user_type: 'admin' }), unchanged: false }, { record: row({ work_date: '2026-09-11' }), unchanged: false }, { record: row(), unchanged: 'true' }])('refuses missing or mismatched mutation receipt %#', async data => {
    state.rpcResult.data = data; expect((await post({ workDate: DATE })).status).toBe(503);
  });
  it.each([{ status: 'unrecognized' }, { status: 'remote' }, { source: 'hr' }])('refuses an unexpected new check-in state %j', async patch => {
    state.rpcResult.data.record = row(patch);
    expect((await post({ workDate: DATE })).status).toBe(503);
  });
  it('refuses a check-out receipt without a prior check-in and confirmed check-out', async () => {
    for (const patch of [{ check_in_at: null, check_out_at: 'now' }, { check_out_at: null }, { check_out_at: 'not-a-date' }, { check_out_at: `${DATE}T08:00:00Z` }]) {
      state.rpcResult.data.record = row(patch); expect((await post({ workDate: DATE, action: 'check_out' })).status).toBe(503);
    }
  });
  it.each([['P0001','BILLING_LOCKED: secret',402], ['42501','secret',403], ['P0002','secret',404], ['22023','secret',400], ['55000','secret',409], ['23505','secret',409], ['XX000','secret',503]])('sanitizes database %s failure', async (code,message,status) => {
    state.rpcResult = { data: null, error: { code, message } }; const res = await post({ workDate: DATE }); expect(res.status).toBe(status); expect(JSON.stringify(await res.json())).not.toContain('secret');
  });
});
describe('scoped complete attendance reads', () => {
  it('filters own data by organization, profile and user type', async () => {
    state.rows = [row(), row({ user_type: 'admin' }), row({ organization_id: 'foreign' })];
    const data = await (await get(`from=${DATE}&to=${DATE}`)).json(); expect(data.records).toHaveLength(1);
    expect(state.reads[0].filters).toEqual({ organization_id: 'org', user_id: USER, user_type: 'developer' });
    expect(data.hasMore).toBe(false); expect(data.nextCursor).toBeNull();
  });
  it('requires authority and rejects self-scope identity bypasses', async () => {
    expect((await get(`userId=${OTHER}`)).status).toBe(403);
    expect((await get(`userId=${USER}&userType=admin`)).status).toBe(403);
    state.auth.overrides = { 'attendance.view_own': false }; expect((await get()).status).toBe(403);
    state.auth = null; expect((await get()).status).toBe(401); expect(state.reads).toEqual([]);
  });
  it.each(['from=', 'from=bad', 'to=2026-02-30', 'from=2026-09-13&to=2026-09-12', 'userType=client', 'userType=admin', 'userId=bad', 'scope=other', 'limit=0', 'limit=501', 'limit=1.5', 'cursor=!'])('rejects invalid query %s without reading', async query => {
    expect((await get(query)).status).toBe(400); expect(state.reads).toEqual([]);
  });
  it('pages through a low provider cap without lost same-date rows', async () => {
    state.auth.role = 'hr'; state.cap = 2; state.rows = Array.from({ length: 7 }, (_, i) => row({ id: `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}` }));
    const ids = []; let cursor = null;
    do {
      const res = await get(`scope=all&limit=50${cursor ? `&cursor=${cursor}` : ''}`); expect(res.status).toBe(200);
      const body = await res.json(); ids.push(...body.records.map(r => r.id)); expect(body.hasMore).toBe(Boolean(body.nextCursor)); cursor = body.nextCursor;
    } while (cursor);
    expect(ids).toHaveLength(7); expect(new Set(ids).size).toBe(7);
    expect(state.reads.every(q => q.filters.organization_id === 'org')).toBe(true);
    expect(state.reads[0].orders).toEqual([['work_date', { ascending: false }], ['id', { ascending: false }]]);
  });
  it('binds cursor to selected date range, target and current typed identity', async () => {
    state.auth.role = 'hr'; state.rows = [row(), row({ id: OTHER })];
    const data = await (await get('scope=all&limit=1')).json(); expect(data.hasMore).toBe(true);
    for (const suffix of [`from=${DATE}`, `userId=${USER}`, 'scope=me']) expect((await get(`cursor=${data.nextCursor}&${suffix}`)).status).toBe(400);
    state.auth.userType = 'admin'; expect((await get(`cursor=${data.nextCursor}`)).status).toBe(400);
    state.auth.userType = 'developer'; state.auth.orgId = 'other'; expect((await get(`cursor=${data.nextCursor}`)).status).toBe(400);
  });
  it('does not return partial rows or false completeness when continuation probe fails', async () => {
    state.rows = [row()]; state.failRead = 2; const res = await get(); expect(res.status).toBe(503);
    const data = await res.json(); expect(data.records).toBeUndefined(); expect(data.error).not.toContain('secret');
  });
});
