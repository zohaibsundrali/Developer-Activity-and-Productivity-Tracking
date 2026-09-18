import { beforeEach, describe, expect, it, vi } from 'vitest';
import { meta as termsMeta } from '@/content/legal/terms';
const state = vi.hoisted(() => ({ prior: null, priorError: null, reserveError: null, finishError: null, rpc: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), from: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: state.from, rpc: state.rpc,
 auth: { admin: { getUserById: async () => ({ data: { user: state.prior }, error: state.priorError }), createUser: state.create, updateUserById: state.update, deleteUser: state.remove }, signInWithPassword: state.signIn, signOut: state.signOut },
}) }));
import { POST } from '@/app/api/auth/signup/route';
const body = { email: 'owner@example.test', password: 'original-password', fullName: 'Owner', company: 'Test', termsAccepted: true, verificationGrant: 'a'.repeat(64) };
const request = (extra = {}) => new Request('https://app.test/api/auth/signup', { method: 'POST', body: JSON.stringify({ ...body, ...extra }) });
const metadata = { signup_id: 'signup', app_user_id: 'profile', organization_id: 'org', role: 'owner', user_type: 'admin' };
beforeEach(() => {
 vi.clearAllMocks(); state.prior = null; state.priorError = { status: 404 }; state.reserveError = null; state.finishError = null; state.emailStatus = 'admin_exists';
 state.rpc.mockImplementation(async name => name === 'signup_email_status' ? { data: state.emailStatus, error: null } : name === 'claim_signup' ? { data: { id: 'signup', profile_id: 'profile', organization_id: 'org', auth_user_id: 'auth' }, error: state.reserveError } : name === 'finish_signup' ? { data: { success: true, organizationId: 'org', admin: { id: 'profile', organization_id: 'org', auth_user_id: 'auth' }, plan: { code: 'free', status: 'active', trialEndsAt: null } }, error: state.finishError } : {});
 state.create.mockResolvedValue({ data: { user: { id: 'auth' } } });
 state.signIn.mockResolvedValue({ data: { user: { id: 'auth' } }, error: null }); state.signOut.mockResolvedValue({});
});
describe('transactional signup orchestration', () => {
 it('reserves identity before Auth and only returns atomic finalization result', async () => {
  const response = await POST(request()); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ success: true, admin: { organization_id: 'org', auth_user_id: 'auth' } });
  expect(state.rpc.mock.calls.map(([name]) => name)).toEqual(['claim_signup','finish_signup','release_signup_claim']);
  expect(state.rpc.mock.invocationCallOrder[0]).toBeLessThan(state.create.mock.invocationCallOrder[0]);
  expect(state.create).toHaveBeenCalledWith({ id: 'auth', email: body.email, password: body.password, email_confirm: true, app_metadata: metadata });
  expect(state.from).not.toHaveBeenCalled();
 });
 it('passes only validated details, server terms and requested plan to database authority', async () => {
  await POST(request({ termsVersion: 'forged', organizationId: 'other', role: 'admin', planCode: 'enterprise', cardNumber: '4242424242424242', paymentMethodProvided: true }));
  const args = state.rpc.mock.calls[0][1];
  expect(args.p_terms).toBe(termsMeta.version || termsMeta.lastUpdated);
  expect(args.p_plan).toBe('enterprise');
  expect(JSON.stringify(args)).not.toContain(body.password);
  expect(JSON.stringify(args)).not.toContain(body.verificationGrant);
  expect(args.p_grant_hash).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(args)).not.toContain('4242');
  expect(args.p_details).not.toHaveProperty('role');
  expect(args.p_details).not.toHaveProperty('organizationId');
 });
 it.each([false, 'true', 1, null])('rejects non-consent %j before reservation', async termsAccepted => {
  expect((await POST(request({ termsAccepted }))).status).toBe(400);
  expect(state.rpc).not.toHaveBeenCalled(); expect(state.create).not.toHaveBeenCalled();
 });
 it.each([['SIGNUP_EMAIL_NOT_VERIFIED',403],['SIGNUP_BUSY',409],['SIGNUP_ACCOUNT_EXISTS',409],['database unavailable',503]])('classifies reservation failure %s', async (message,status) => {
  state.reserveError = { message }; expect((await POST(request())).status).toBe(status);
  expect(state.create).not.toHaveBeenCalled(); expect(state.remove).not.toHaveBeenCalled();
 });
 it.each([['admin_exists','account_exists'],['identity_exists','email_in_use']])('classifies a late %s conflict without creating or modifying accounts', async (emailStatus, code) => {
  state.emailStatus = emailStatus;
  state.reserveError = { message: 'SIGNUP_ACCOUNT_EXISTS' };
  const response = await POST(request());
  expect(response.status).toBe(409);
  expect((await response.json()).code).toBe(code);
  expect(state.create).not.toHaveBeenCalled();
  expect(state.update).not.toHaveBeenCalled();
  expect(state.remove).not.toHaveBeenCalled();
 });
 it.each([undefined, '', 'guessed', 'a'.repeat(63)])('requires an unguessable verification grant before reserving: %j', async verificationGrant => {
  expect((await POST(request({ verificationGrant }))).status).toBe(403);
  expect(state.rpc).not.toHaveBeenCalled(); expect(state.create).not.toHaveBeenCalled();
 });
 it('retains reservation and Auth on mandatory row failure rather than returning success', async () => {
  state.finishError = { message: 'mandatory terms insert failed' };
  const response = await POST(request()); expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: 'signup_setup_unconfirmed' });
  expect(state.remove).not.toHaveBeenCalled();
  expect(state.rpc).toHaveBeenLastCalledWith('release_signup_claim', expect.objectContaining({ p_id: 'signup' }));
 });
 it('does not delete a reserved Auth account when create outcome is unknown', async () => {
  state.create.mockRejectedValue(new Error('timeout after provider commit'));
  expect((await POST(request())).status).toBe(503); expect(state.remove).not.toHaveBeenCalled();
  expect(state.rpc.mock.calls.some(([name]) => name === 'finish_signup')).toBe(false);
 });
 it('verifies a matching existing reserved account without changing its password', async () => {
  state.prior = { id: 'auth', email: body.email, app_metadata: metadata }; state.priorError = null;
  expect((await POST(request())).status).toBe(200);
  expect(state.create).not.toHaveBeenCalled(); expect(state.update).not.toHaveBeenCalled();
  expect(state.signIn).toHaveBeenCalledWith({ email: body.email, password: body.password });
  expect(state.signOut).toHaveBeenCalledWith({ scope: 'local' });
 });
 it('requires original password on retry, without finalizing incorrect credentials', async () => {
  state.prior = { id: 'auth', email: body.email, app_metadata: metadata }; state.priorError = null;
  state.signIn.mockResolvedValue({ error: { code: 'invalid_credentials' } });
  const response = await POST(request()); expect(response.status).toBe(409);
  expect((await response.json()).error).toContain('first signup attempt');
  expect(state.rpc.mock.calls.some(([name]) => name === 'finish_signup')).toBe(false);
  expect(state.update).not.toHaveBeenCalled();
 });
 it('never relinks a mismatched reserved identity', async () => {
  state.prior = { id: 'auth', email: body.email, app_metadata: { ...metadata, organization_id: 'other' } }; state.priorError = null;
  expect((await POST(request())).status).toBe(409);
  expect(state.signIn).not.toHaveBeenCalled(); expect(state.update).not.toHaveBeenCalled(); expect(state.remove).not.toHaveBeenCalled();
 });
 it('refuses an empty successful Auth lookup as unconfirmed', async () => {
  state.priorError = null;
  expect((await POST(request())).status).toBe(503); expect(state.create).not.toHaveBeenCalled();
 });
});
