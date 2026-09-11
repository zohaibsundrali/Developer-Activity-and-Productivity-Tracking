import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ auth: null, rpc: vi.fn(), pages: [], ranges: [] }));
vi.mock('@/utils/serverAuth', () => ({ getAuthedOrg: async () => state.auth, serviceClient: () => ({ rpc: state.rpc }) }));
import { GET } from '../src/app/api/capacity/route';
const call = query => GET(new Request(`http://localhost/api/capacity${query || ''}`));
beforeEach(() => {
 state.auth = { orgId: 'verified-org', userType: 'developer', appUserId: 'actor', role: 'manager', overrides: {} };
 state.pages = [{ data: [] }]; state.ranges = [];
 state.rpc.mockReset().mockImplementation(() => { const q = { order: () => q, range: async (...range) => { state.ranges.push(range); return state.pages.shift(); } }; return q; });
});
afterEach(() => vi.useRealTimers());
it.each(['','2026-09-15','2026-02-30','2026-13-01','2026-9-14','invalid'])('rejects invalid supplied week %s without querying history', async week => {
 expect((await call(`?week=${week}`)).status).toBe(400); expect(state.rpc).not.toHaveBeenCalled();
});
it('defaults an omitted week to the current UTC Monday', async () => {
 vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-13T23:59:59Z'));
 const res = await call(); expect(res.status).toBe(200); expect((await res.json()).week).toBe('2026-09-07');
 expect(state.rpc).toHaveBeenCalledWith('capacity_for_week', { p_org: 'verified-org', p_week: '2026-09-07' });
});
it('returns selected future-week staff including zero activity and typed collisions', async () => {
 const rows = [{ user_id: 'same', user_type: 'admin', logged_hours: 0, weekly_hours: null }, { user_id: 'same', user_type: 'developer', logged_hours: 0, weekly_hours: 40 }];
 state.pages = [{ data: rows }]; const res = await call('?week=2027-01-04&organizationId=forged');
 expect(await res.json()).toEqual({ success: true, rows, week: '2027-01-04' });
 expect(state.rpc).toHaveBeenCalledExactlyOnceWith('capacity_for_week', { p_org: 'verified-org', p_week: '2027-01-04' });
});
it('pages beyond one API response without silently dropping staff', async () => {
 state.pages = [{ data: Array.from({ length: 500 }, (_, user_id) => ({ user_id })) }, { data: [{ user_id: 500 }] }];
 const res = await call('?week=2026-09-14'); expect((await res.json()).rows).toHaveLength(501); expect(state.ranges).toEqual([[0,499],[500,999]]);
});
it('fails the whole read if a later page fails instead of returning partial capacity', async () => {
 state.pages = [{ data: Array(500).fill({ user_id: 'x' }) }, { error: { message: 'private schema detail' } }];
 const res = await call('?week=2026-09-14'); expect(res.status).toBe(503); expect(JSON.stringify(await res.json())).not.toContain('private');
});
it('requires authenticated staff and effective view permission', async () => {
 state.auth = null; expect((await call()).status).toBe(401);
 state.auth = { orgId: 'org', userType: 'client', role: 'owner', overrides: { 'capacity.view': true } }; expect((await call()).status).toBe(403);
 state.auth.userType = 'admin'; state.auth.overrides['capacity.view'] = false; expect((await call()).status).toBe(403); expect(state.rpc).not.toHaveBeenCalled();
});
it('sanitizes thrown service errors', async () => {
 state.rpc.mockImplementation(() => { throw new Error('private exception'); }); const res = await call('?week=2026-09-14'); expect(res.status).toBe(503); expect(JSON.stringify(await res.json())).not.toContain('private');
});
