import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ auth: null, result: null, rpc: vi.fn(), queries: [], read: null }));
vi.mock('@/utils/serverAuth', () => ({ getAuthedOrg: async () => h.auth, orgScopedClient: token => ({
  rpc: (name, args) => { h.rpc(token, name, args); return Promise.resolve(h.result); },
  from: table => {
    const call = { table, filters: [] }; h.queries.push(call);
    const q = { select: (fields, options) => { call.fields = fields; call.options = options; return q; }, eq: (...args) => { call.filters.push(args); return q; },
      lt: (...args) => { call.filters.push(['lt', ...args]); return q; }, gt: (...args) => { call.filters.push(['gt', ...args]); return q; },
      order: () => q, limit: () => q, or: value => { call.cursorFilter = value; return q; }, then: resolve => Promise.resolve(h.read).then(resolve) };
    return q;
  },
}) }));
const { GET, POST } = await import('@/app/api/shifts/route');
const ORG = '99100000-0000-0000-0000-000000000001', PERSON = '99100000-0000-0000-0000-000000000011', ID = 'b1000000-0000-0000-0000-000000000001';
const input = { id: ID, version: 0, userId: PERSON, userType: 'developer', start: '2026-10-12T09:00:00Z', end: '2026-10-12T17:00:00Z', timezone: 'UTC', title: 'Shift', status: 'published', note: '' };
const shift = () => ({ id: ID, organization_id: ORG, user_id: PERSON, user_type: 'developer', assignee_name: 'Staff', start_at: input.start, end_at: input.end, timezone: 'UTC', title: 'Shift', status: 'published', note: '', version: 1 });
const post = (body = input) => POST(new Request('https://app.test/api/shifts', { method: 'POST', body: JSON.stringify(body) }));
const get = (q = 'from=2026-10-12&to=2026-10-18') => GET(new Request('https://app.test/api/shifts?' + q));
beforeEach(() => { h.auth = { token: 'caller-token', orgId: ORG, appUserId: PERSON, userType: 'developer', role: 'developer', overrides: {}, overridesLoaded: true }; h.result = { data: { shift: shift(), unchanged: false }, error: null }; h.read = { data: [shift()], count: 1, error: null }; h.rpc.mockClear(); h.queries = []; });
it('requires authentication and management permissions before mutations', async () => {
  h.auth = null; expect((await post()).status).toBe(401);
  h.auth = { userType: 'client' }; expect((await post()).status).toBe(403);
  expect(h.rpc).not.toHaveBeenCalled();
});
it('ordinary staff can read only their typed schedule', async () => {
  const response = await get(); expect(response.status).toBe(200);
  expect(h.queries[0].filters).toContainEqual(['organization_id', ORG]);
  expect(h.queries[0].filters).toContainEqual(['user_id', PERSON]);
  expect(h.queries[0].filters).toContainEqual(['user_type', 'developer']);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect((await get('from=2026-10-12&to=2026-10-18&scope=all')).status).toBe(403);
  expect((await get('view=staff')).status).toBe(403);
  expect((await post()).status).toBe(403);
});
it('respects an explicit own-view denial', async () => {
  h.auth.overrides['attendance.view_own'] = false;
  expect((await get()).status).toBe(403); expect(h.queries).toHaveLength(0);
});
it('preserves caller credentials and validates committed receipts', async () => {
  h.auth.role = 'owner'; h.auth.userType = 'admin';
  expect((await post()).status).toBe(200);
  expect(h.rpc).toHaveBeenCalledWith('caller-token', 'save_work_shift', expect.objectContaining({ p_id: ID, p_version: 0, p_user_id: PERSON, p_user_type: 'developer', p_start: '2026-10-12T09:00:00.000Z' }));
  h.result.data.shift.organization_id = 'foreign'; expect((await post()).status).toBe(503);
});
it.each(['version', 'user_id', 'user_type', 'status', 'start_at', 'title'])('rejects mismatched mutation %s', async field => {
  h.auth.role = 'owner'; h.auth.userType = 'admin'; h.result.data.shift[field] = field === 'version' ? 99 : 'wrong';
  expect((await post()).status).toBe(503);
});
it.each([['23P01', 409], ['PT409',409], ['40001', 409], ['42501', 403], ['P0002', 404], ['22023', 400], ['XX000', 503]])('maps database %s without leaking internals', async (code, status) => {
  h.auth.role = 'owner'; h.auth.userType = 'admin'; h.result = { error: { code, message: 'private-database-context' } };
  const response = await post(); expect(response.status).toBe(status); expect(await response.text()).not.toContain('private-database-context');
});
it('rejects invalid range/cursor before reading data', async () => {
  expect((await get('from=2026-02-30&to=2026-03-03')).status).toBe(400);
  expect((await get('from=2026-10-12&to=2026-10-18&cursor=bad')).status).toBe(400);
  expect(h.queries).toHaveLength(0);
});
it('continues when provider returns fewer than 50 rows and binds cursors to the caller and range', async () => {
  h.read.count = 2;
  const first = await (await get()).json(); expect(first.nextCursor).toBeTruthy();
  h.read = { data: [{ ...shift(), id: 'b1000000-0000-0000-0000-000000000002' }], count: 1, error: null };
  expect((await get('from=2026-10-12&to=2026-10-18&cursor=' + first.nextCursor)).status).toBe(200);
  expect(h.queries.at(-1).cursorFilter).toContain('start_at.gt.2026-10-12T09:00:00.000Z');
  expect((await get('from=2026-10-13&to=2026-10-18&cursor=' + first.nextCursor)).status).toBe(400);
});
it.each([{ organization_id: 'foreign' }, { user_type: 'admin' }, { user_id: '99100000-0000-0000-0000-000000000099' }])('refuses a foreign typed list receipt %j', async patch => {
  h.read.data = [{ ...shift(), ...patch }]; expect((await get()).status).toBe(503);
});

it('rejects a page that repeats its cursor instead of advancing', async () => {
  h.read.count = 2;
  const first = await (await get()).json();
  expect((await get('from=2026-10-12&to=2026-10-18&cursor=' + first.nextCursor)).status).toBe(503);
});
it('fails closed when mutation permissions cannot load', async () => {
  h.auth.role = 'owner'; h.auth.overridesLoaded = false;
  expect((await post()).status).toBe(503); expect(h.rpc).not.toHaveBeenCalled();
});
