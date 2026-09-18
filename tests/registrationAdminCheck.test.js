import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ service: vi.fn(), send: vi.fn() }));
vi.mock('@/utils/serverAuth', () => ({ serviceClient: mocks.service }));
vi.mock('@/utils/emailService', () => ({ sendEmail: mocks.send }));
import { POST } from '@/app/api/send-verification/route';
let serial = 0;
let from;
let rpc;
let verification;
beforeEach(() => {
  vi.clearAllMocks();
  rpc = vi.fn().mockResolvedValue({ data: 'available', error: null });
  verification = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), gt: vi.fn().mockResolvedValue({ error: null }), insert: vi.fn().mockResolvedValue({ error: null }) };
  from = vi.fn((table) => {
    if (table === 'email_verifications') return verification;
    throw new Error(`Unexpected table ${table}`);
  });
  mocks.service.mockReturnValue({ from, rpc });
  mocks.send.mockResolvedValue({ ok: true, messageId: 'mock' });
});
const request = (email) => new Request('http://localhost/api/send-verification', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-real-ip': `test-${++serial}` },
  body: JSON.stringify({ email, userName: 'Test', company: 'Example' }),
});
it('rejects an existing admin before retiring/storing codes or sending email', async () => {
  rpc.mockResolvedValue({ data: 'admin_exists', error: null });
  const response = await POST(request('  OWNER@Example.com  '));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ success: false, code: 'account_exists' });
  expect(rpc).toHaveBeenCalledWith('signup_email_status', { p_email: 'owner@example.com' });
  expect(from).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});
it('fails closed when the admin lookup fails', async () => {
  rpc.mockResolvedValue({ data: null, error: { message: 'private database detail' } });
  const response = await POST(request('lookup@example.com'));
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain('private database detail');
  expect(verification.insert).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});
it('sends verification for a new admin without querying developers', async () => {
  const response = await POST(request('new-admin@example.com'));
  expect(response.status).toBe(200);
  expect(verification.insert).toHaveBeenCalledWith(expect.objectContaining({ email: 'new-admin@example.com' }));
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(from).not.toHaveBeenCalledWith('developers');
});
it('rejects an Auth/profile collision early without calling it an admin registration', async () => {
  rpc.mockResolvedValue({ data: 'identity_exists', error: null });
  const response = await POST(request('existing-login@example.com'));
  expect(response.status).toBe(409);
  const result = await response.json();
  expect(result.code).toBe('email_in_use');
  expect(result.error).not.toContain('admin account');
  expect(from).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});
it('allows verification to resume an incomplete signup with its own Auth identity', async () => {
  rpc.mockResolvedValue({ data: 'resumable', error: null });
  expect((await POST(request('resume@example.com'))).status).toBe(200);
  expect(mocks.send).toHaveBeenCalledTimes(1);
});
it('fails closed on missing or unknown database status', async () => {
  rpc.mockResolvedValue({ data: null, error: null });
  expect((await POST(request('unknown@example.com'))).status).toBe(503);
  expect(mocks.send).not.toHaveBeenCalled();
});
it('does not query the database for invalid addresses', async () => {
  expect((await POST(request('invalid'))).status).toBe(400);
  expect(from).not.toHaveBeenCalled();
});
