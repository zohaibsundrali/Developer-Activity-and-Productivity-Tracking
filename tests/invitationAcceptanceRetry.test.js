import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ prior: null, verified: null, rpc: vi.fn(), create: vi.fn(), update: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
 from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { id: 'invite', organization_id: 'org', email: 'member@example.test', role: 'developer', status: 'pending', expires_at: new Date(Date.now()+60000).toISOString() } }) }; return q; },
 rpc: state.rpc,
 auth: { admin: { getUserById: async () => ({ data: { user: state.prior } }), createUser: state.create, updateUserById: state.update }, signInWithPassword: state.signIn, signOut: state.signOut },
}) }));
vi.mock('@/utils/entitlements', () => ({ checkSeatLimitForRole: async () => null, checkFeatureAccess: async () => null }));
import { POST } from '@/app/api/invitations/accept/route';
const request = () => new Request('https://app.test/api/invitations/accept', { method: 'POST', body: JSON.stringify({ token: 'token', password: 'original-password', termsAccepted: true }) });
beforeEach(() => {
 vi.clearAllMocks();
 state.prior = { id: 'auth', email: 'member@example.test', app_metadata: { invitation_id: 'invite', organization_id: 'org', app_user_id: 'profile', role: 'developer', user_type: 'developer' } };
 state.rpc.mockImplementation(async name => ({ data: name === 'claim_invitation' ? { auth_user_id: 'auth', profile_id: 'profile' } : { success: true } }));
 state.signIn.mockResolvedValue({ data: { user: { id: 'auth' }, session: { access_token: 'secret-token' } }, error: null });
 state.signOut.mockResolvedValue({ error: null });
});
describe('invitation acceptance credential recovery', () => {
 it('reuses an existing account without changing its password or returning session tokens', async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true, role: 'developer', userType: 'developer' });
  expect(state.update).not.toHaveBeenCalled(); expect(state.create).not.toHaveBeenCalled();
  expect(state.signIn).toHaveBeenCalledWith({ email: 'member@example.test', password: 'original-password' });
  expect(state.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(state.rpc.mock.calls.some(([name]) => name === 'finish_invitation')).toBe(true);
 });
 it('refuses a different password without finalizing or mutating the reserved account', async () => {
  state.signIn.mockResolvedValue({ data: null, error: { code: 'invalid_credentials' } });
  const response = await POST(request());
  expect(response.status).toBe(409);
  expect((await response.json()).error).toContain('same password');
  expect(state.update).not.toHaveBeenCalled();
  expect(state.rpc.mock.calls.some(([name]) => name === 'finish_invitation')).toBe(false);
  expect(state.rpc).toHaveBeenLastCalledWith('release_invitation_claim', expect.any(Object));
 });
 it.each([{ data: { user: { id: 'other' } } }, { error: { code: 'request_timeout' } }])('refuses uncertain/mismatched verification %j', async result => {
  state.signIn.mockResolvedValue(result);
  expect((await POST(request())).status).toBe(503);
  expect(state.update).not.toHaveBeenCalled();
  expect(state.rpc.mock.calls.some(([name]) => name === 'finish_invitation')).toBe(false);
 });
 it.each([{ role: 'admin' }, { user_type: 'admin' }])('requires current typed identity before verification: %j', async metadata => {
  Object.assign(state.prior.app_metadata, metadata);
  const response = await POST(request());
  expect(response.status).toBe(409);
  expect((await response.json()).error).toContain('reconcile');
  expect(state.signIn).not.toHaveBeenCalled();
  expect(state.update).not.toHaveBeenCalled();
  expect(state.rpc.mock.calls.some(([name]) => name === 'finish_invitation')).toBe(false);
 });
 it('always revokes only the temporary session after a thrown Auth call', async () => {
  state.signIn.mockRejectedValue(new Error('network failure'));
  expect((await POST(request())).status).toBe(503);
  expect(state.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(state.update).not.toHaveBeenCalled();
 });
});
