import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ auth: null, gate: null, process: vi.fn(), caller: {}, service: {}, scoped: vi.fn() }));
vi.mock('@/utils/serverAuth', () => ({ getAuthedOrg: async () => state.auth, serviceClient: () => state.service, orgScopedClient: token => { state.scoped(token); return state.caller; } }));
vi.mock('@/utils/entitlements', () => ({ checkFeatureAccess: async () => state.gate }));
vi.mock('@/utils/automationProcessor', () => ({ processActorAutomations: state.process }));
import { POST } from '@/app/api/automation/process/route';
const request = body => new Request('https://example.test/api/automation/process', { method: 'POST', body: JSON.stringify(body) });
beforeEach(() => {
  state.auth = { orgId: 'verified-org', appUserId: 'verified-user', userType: 'developer', token: 'verified-token' };
  state.gate = null; state.process.mockReset().mockResolvedValue({ ran: 1, errors: [], pending: 0 }); state.scoped.mockClear();
});
it('uses verified actor and JWT, ignoring caller-supplied identities or actions', async () => {
  expect((await POST(request({ orgId: 'other', actor: 'other', actions: ['forged'], retryFailed: true }))).status).toBe(200);
  expect(state.process).toHaveBeenCalledWith({ auth: state.auth, svc: state.service, caller: state.caller, retryFailed: true });
  expect(state.scoped).toHaveBeenCalledWith('verified-token');
});
it('refuses anonymous and client processing', async () => {
  state.auth = null; expect((await POST(request({}))).status).toBe(401);
  state.auth = { userType: 'client' }; expect((await POST(request({}))).status).toBe(403);
  expect(state.process).not.toHaveBeenCalled();
});
it('enforces paid automation feature before claiming jobs', async () => {
  state.gate = { status: 403, error: 'Upgrade required' };
  expect((await POST(request({}))).status).toBe(403);
  expect(state.process).not.toHaveBeenCalled();
});
it('rejects malformed retry controls', async () => {
  expect((await POST(request({ retryFailed: 'yes' }))).status).toBe(400);
  expect(state.process).not.toHaveBeenCalled();
});
