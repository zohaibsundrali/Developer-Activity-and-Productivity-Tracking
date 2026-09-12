import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ generateLink: vi.fn(), send: vi.fn(), fallback: vi.fn(), from: vi.fn(() => { throw new Error('Reserved account has no profile or membership'); }) }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: state.from, auth: { admin: { generateLink: state.generateLink }, resetPasswordForEmail: state.fallback } }) }));
vi.mock('@/utils/emailService', () => ({ sendEmail: state.send }));
import { POST } from '@/app/api/auth/forgot-password/route';
afterEach(() => vi.unstubAllEnvs());
it('issues recovery for a reserved Auth account without reading application profiles or membership', async () => {
 vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
 vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://auth.test');
 vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.test');
 state.generateLink.mockResolvedValue({ data: { user: { id: 'reserved-auth', app_metadata: { invitation_id: 'invite' } }, properties: { action_link: 'https://auth.test/recovery?token=private' } }, error: null });
 state.send.mockResolvedValue({ ok: true, delivered: true });
 const response = await POST(new Request('https://app.test/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: 'reserved@example.test' }) }));
 expect(response.status).toBe(200);
 expect(await response.json()).toEqual({ ok: true, message: 'If an account exists for that address, a link to set a new password is on its way.' });
 expect(state.from).not.toHaveBeenCalled();
 expect(state.generateLink).toHaveBeenCalledWith({ type: 'recovery', email: 'reserved@example.test', options: { redirectTo: 'https://app.test/reset-password' } });
 expect(state.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'reserved@example.test', template: 'password_reset' }));
});

it.each(['', 'http://insecure.test', 'javascript:alert(1)', 'https://user:secret@app.test'])('production refuses untrusted origin %j without contacting Auth', async origin => {
 vi.stubEnv('NODE_ENV', 'production');
 vi.stubEnv('NEXT_PUBLIC_APP_URL', origin);
 state.generateLink.mockClear(); state.send.mockClear();
 const log = vi.spyOn(console, 'error').mockImplementation(() => {});
 try {
  const response = await POST(new Request('https://attacker.test/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: 'member@example.test' }) }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true });
  expect(state.generateLink).not.toHaveBeenCalled();
  expect(state.send).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledWith('[forgot-password] recovery_request_failed');
 } finally { log.mockRestore(); }
});

it.each(['throw', 'returned-error', 'email-throw'])('does not log provider credentials in %s failures', async failure => {
 vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
 vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://auth.test');
 vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.test');
 const secret = 'smtp://user:SUPER_SECRET_CREDENTIAL@example.test';
 state.generateLink.mockReset(); state.send.mockReset();
 if (failure === 'throw') state.generateLink.mockRejectedValue(new Error(secret));
 if (failure === 'returned-error') state.generateLink.mockResolvedValue({ error: { message: secret } });
 if (failure === 'email-throw') {
  state.generateLink.mockResolvedValue({ data: { properties: { action_link: 'https://auth.test/recovery' } } });
  state.send.mockRejectedValue(new Error(secret));
 }
 const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
 const warnLog = vi.spyOn(console, 'warn').mockImplementation(() => {});
 try {
  const response = await POST(new Request('https://app.test/api/auth/forgot-password', { method: 'POST', headers: { 'x-real-ip': failure }, body: JSON.stringify({ email: `${failure}@example.test` }) }));
  expect(response.status).toBe(200);
  expect(JSON.stringify([...errorLog.mock.calls, ...warnLog.mock.calls])).not.toContain(secret);
  expect(errorLog.mock.calls.length + warnLog.mock.calls.length).toBeGreaterThan(0);
 } finally { errorLog.mockRestore(); warnLog.mockRestore(); }
});

it('does not invoke fallback after uncertain delivery', async () => {
 vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
 vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://auth.test');
 vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.test');
 state.generateLink.mockResolvedValue({ data: { properties: { action_link: 'https://auth.test/recovery' } } });
 state.send.mockResolvedValue({ ok: false, delivered: false, deliveryUncertain: true });
 state.fallback.mockClear();
 const response = await POST(new Request('https://app.test/api/auth/forgot-password', { method: 'POST', headers: { 'x-real-ip': 'uncertain-case' }, body: JSON.stringify({ email: 'uncertain@example.test' }) }));
 expect(response.status).toBe(200);
 expect(state.fallback).not.toHaveBeenCalled();
});
