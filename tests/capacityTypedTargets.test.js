import { beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
const state = vi.hoisted(() => ({ auth: null, types: [], rows: {}, writes: [], error: null, missingWrite: false, locked: null }));
vi.mock('@/utils/serverAuth', () => ({ getAuthedOrg: async () => state.auth, serviceClient: () => ({ from(table) {
 const filters = {}; let patch;
 const result = () => {
  if (state.error) return { error: { message: 'private database information' } };
  if (table === 'memberships') return { data: state.types.filter(type => !filters.user_type || filters.user_type === type).map(user_type => ({ user_type })) };
  const row = state.rows[`${table}:${filters.user_type}`];
  if (patch) { state.writes.push({ table, filters, patch }); return { data: state.missingWrite ? null : row ? { ...row, ...patch } : null }; }
  return { data: row || null };
 };
 const q = { select: () => q, eq: (key,value) => { filters[key] = value; return q; }, in: () => q, limit: () => q,
 update: value => { patch = value; return q; }, maybeSingle: async () => result(), single: async () => result(), then: resolve => Promise.resolve(result()).then(resolve) };
 return q;
} }) }));
vi.mock('@/utils/entitlements', () => ({ requireUnlocked: async () => state.locked }));
import { PATCH } from '../src/app/api/capacity/route';
const userId = '10000000-0000-0000-0000-000000000001';
const projectId = '10000000-0000-0000-0000-000000000002';
const call = body => PATCH(new Request('http://localhost/api/capacity', { method: 'PATCH', body: JSON.stringify({ userId, ...body }) }));
beforeEach(() => {
 state.auth = { orgId: 'org', userType: 'admin', appUserId: 'owner', role: 'owner', overrides: {} };
 state.types = ['admin','developer']; state.rows = {}; state.error = null; state.writes = []; state.missingWrite = false; state.locked = null;
 for (const type of state.types) for (const table of ['employee_profiles','project_members']) state.rows[`${table}:${type}`] = { id: `${type}-row`, user_id: userId, user_type: type };
});
it.each(['admin','developer'])('updates only the explicit %s contracted-hours profile', async userType => {
 const res = await call({ userType, weeklyHours: 24 }); expect(res.status).toBe(200);
 expect(state.writes).toEqual([{ table: 'employee_profiles', filters: { organization_id: 'org', user_id: userId, user_type: userType, id: `${userType}-row` }, patch: { weekly_hours: 24, updated_at: expect.any(String) } }]);
});
it.each(['admin','developer'])('updates only the explicit %s allocation membership', async userType => {
 expect((await call({ userType, projectId, allocationPct: 40 })).status).toBe(200);
 expect(state.writes[0].filters).toEqual({ id: `${userType}-row`, organization_id: 'org', project_id: projectId, user_id: userId, user_type: userType });
});
it.each([{ weeklyHours: 24 },{ projectId, allocationPct: 40 }])('refuses ambiguous legacy UUID target %j', async body => {
 expect((await call(body)).status).toBe(400); expect(state.writes).toEqual([]);
});
it('keeps unique legacy callers and explicit null clearing working', async () => {
 state.types = ['developer']; expect((await call({ weeklyHours: null })).status).toBe(200);
 expect(state.writes[0].filters.user_type).toBe('developer'); expect(state.writes[0].patch.weekly_hours).toBeNull();
});
it('does not use the other profile when the selected profile is absent', async () => {
 delete state.rows['employee_profiles:admin']; expect((await call({ userType: 'admin', weeklyHours: 24 })).status).toBe(404); expect(state.writes).toEqual([]);
});
it('rejects foreign and invalid target types', async () => {
 expect((await call({ userType: 'client', weeklyHours: 24 })).status).toBe(400);
 state.types = []; expect((await call({ userType: 'admin', weeklyHours: 24 })).status).toBe(404); expect(state.writes).toEqual([]);
});
it('refuses missing affected rows instead of reporting saved', async () => {
 state.missingWrite = true; expect((await call({ userType: 'admin', weeklyHours: 24 })).status).toBe(503);
});
it('sanitizes lookup errors', async () => {
 state.error = true; const res = await call({ userType: 'admin', weeklyHours: 24 }); expect(res.status).toBe(503); expect(JSON.stringify(await res.json())).not.toContain('private');
});
it('honors explicit permission denial and billing lock', async () => {
 state.auth.overrides = { 'employment.set_hours': false }; expect((await call({ userType: 'admin', weeklyHours: 24 })).status).toBe(403);
 state.auth.overrides = {}; state.locked = { status: 402, error: 'Locked' }; expect((await call({ userType: 'admin', weeklyHours: 24 })).status).toBe(402); expect(state.writes).toEqual([]);
});
it('keys and resolves capacity people by identity type', () => {
 const source = readFileSync(new URL('../src/components/admin/CapacityPlan.jsx', import.meta.url), 'utf8');
 expect(source).toContain('x.userType === userType'); expect(source).toContain('nameOf(r.user_id, r.user_type)'); expect(source).toContain('`${r.user_type}:${r.user_id}-${r.week_start}`');
});

it.each([true, false, [], [24], {}, "", "   "])("refuses nonnumeric JSON hours %j", async weeklyHours => {
 expect((await call({ userType: 'admin', weeklyHours })).status).toBe(400); expect(state.writes).toEqual([]);
});
it.each([true, false, [], [40], {}, "", "   "])("refuses nonnumeric JSON allocation %j", async allocationPct => {
 expect((await call({ userType: 'admin', projectId, allocationPct })).status).toBe(400); expect(state.writes).toEqual([]);
});
it('preserves decimal hours, zero allocation and explicit clearing', async () => {
 expect((await call({ userType: 'admin', weeklyHours: '24.5' })).status).toBe(200);
 expect((await call({ userType: 'admin', projectId, allocationPct: 0 })).status).toBe(200);
 expect((await call({ userType: 'admin', projectId, allocationPct: null })).status).toBe(200);
 expect(state.writes.map(w => w.patch.weekly_hours ?? w.patch.allocation_pct)).toEqual([24.5, 0, null]);
});

it.each([24.555, 0.001])('rejects hours precision that the database would round: %s', async weeklyHours => {
 expect((await call({ userType: 'admin', weeklyHours })).status).toBe(400); expect(state.writes).toEqual([]);
});
