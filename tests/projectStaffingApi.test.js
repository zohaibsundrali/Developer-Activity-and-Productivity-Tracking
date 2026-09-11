import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ auth: null, writes: [], billing: null, previous: null }));
vi.mock('@/utils/serverAuth', () => ({
  getAuthedOrg: async () => state.auth,
  serviceClient: () => ({ from(table) {
    const q = {
      select: () => q, eq: () => q, order: () => q,
      maybeSingle: async () => ({ data: table === 'projects' ? { id: 'project', organization_id: 'org' } : table === 'project_members' ? state.previous : { user_id: 'target', user_type: 'developer', status: 'active' } }),
      upsert: async row => { state.writes.push(row); return { error: null }; },
      then: resolve => Promise.resolve({ data: [] }).then(resolve),
    }; return q;
  } }),
}));
vi.mock('@/utils/projectAccess', async original => ({ ...await original(), withProjectRoles: async auth => auth }));
vi.mock('@/utils/entitlements', () => ({ requireUnlocked: async () => state.billing }));
import { POST } from '@/app/api/projects/[id]/members/route';
const request = body => new Request('https://app.test/api/projects/project/members', { method: 'POST', body: JSON.stringify({ userId: 'target', projectRole: 'developer', ...body }) });
beforeEach(() => { state.auth = { orgId: 'org', role: 'manager', userType: 'developer', appUserId: 'actor', projectRoles: { project: 'manager' }, overrides: {} }; state.writes = []; state.billing = null; state.previous = null; });
describe('project staffing API distinct permissions', () => {
  it('does not erase an existing allocation when no allocation was submitted', async () => {
    expect((await POST(request({}), { params: Promise.resolve({ id: 'project' }) })).status).toBe(200);
    expect(state.writes[0]).not.toHaveProperty('allocation_pct');
  });
  it('honors capacity deny even when team management is allowed', async () => {
    state.auth.overrides['capacity.allocate'] = false;
    expect((await POST(request({ allocationPct: 50 }), { params: { id: 'project' } })).status).toBe(403);
    expect(state.writes).toEqual([]);
  });
  it('allows a staffing-only change despite a capacity deny', async () => {
    state.auth.overrides['capacity.allocate'] = false;
    expect((await POST(request({}), { params: { id: 'project' } })).status).toBe(200);
  });
  it('treats clearing allocation as a capacity change', async () => {
    state.auth.overrides['capacity.allocate'] = false;
    expect((await POST(request({ allocationPct: null }), { params: { id: 'project' } })).status).toBe(403);
    expect(state.writes).toEqual([]);
  });
  it('refuses an unassigned organization manager', async () => {
    state.auth.projectRoles = {};
    expect((await POST(request({}), { params: { id: 'project' } })).status).toBe(404);
    expect(state.writes).toEqual([]);
  });
  it('requires manager reassignment instead of demoting the synchronized role row', async () => {
    state.previous = { project_role: 'manager' };
    expect((await POST(request({}), { params: { id: 'project' } })).status).toBe(409);
    expect(state.writes).toEqual([]);
  });
  it('checks a locked subscription before the privileged write', async () => {
    state.billing = { status: 402, error: 'Subscription locked' };
    expect((await POST(request({}), { params: { id: 'project' } })).status).toBe(402);
    expect(state.writes).toEqual([]);
  });
});
