import { createHash } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { hashCode } from '@/utils/verificationCodes';
const state = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/utils/serverAuth', () => ({ serviceClient: () => ({ rpc: state.rpc }) }));
import { POST } from '@/app/api/auth/verify-code/route';
const request = code => new Request('https://app.test/api/auth/verify-code', { method: 'POST', body: JSON.stringify({ email: 'Owner@Example.Test', code }) });
beforeEach(() => state.rpc.mockReset().mockResolvedValue({ data: { verified: true } }));
it('returns an unpredictable proof but stores only its hash', async () => {
 const response = await POST(request('123456'));
 expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toContain('no-store');
 const first = await response.json();
 expect(first.verificationGrant).toMatch(/^[a-f0-9]{64}$/);
 expect(state.rpc).toHaveBeenCalledWith('verify_signup_code', { p_email: 'owner@example.test', p_code_hash: hashCode('owner@example.test','123456'), p_grant_hash: createHash('sha256').update(first.verificationGrant).digest('hex') });
 expect(JSON.stringify(state.rpc.mock.calls)).not.toContain(first.verificationGrant);
 const second = await (await POST(request('123456'))).json();
 expect(second.verificationGrant).not.toBe(first.verificationGrant);
});
it('does not return a grant for failed proof even if verification was previously recorded', async () => {
 state.rpc.mockResolvedValue({ data: { verified: false, attemptsRemaining: 3 } });
 const response = await POST(request('999999')); expect(response.status).toBe(400);
 expect(await response.json()).toEqual({ error: 'Invalid or expired code.', attemptsRemaining: 3 });
});
it.each([{ error: { message: 'private provider details' } }, { data: null }])('fails closed for unavailable/empty proof response %j', async result => {
 state.rpc.mockResolvedValue(result);
 const response = await POST(request('123456'));
 expect(response.status).toBe(result.error ? 503 : 400);
 expect(await response.json()).not.toHaveProperty('verificationGrant');
});
it('rejects malformed code before the database', async () => {
 expect((await POST(request('x'))).status).toBe(400); expect(state.rpc).not.toHaveBeenCalled();
});
