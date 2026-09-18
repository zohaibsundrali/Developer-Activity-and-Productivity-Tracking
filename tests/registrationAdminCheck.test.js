import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ service: vi.fn(), send: vi.fn() }));
vi.mock('@/utils/serverAuth', () => ({ serviceClient: mocks.service }));
vi.mock('@/utils/emailService', () => ({ sendEmail: mocks.send }));
import { POST } from '@/app/api/send-verification/route';
let serial = 0;
let from;
let admin;
let verification;
beforeEach(() => {
  vi.clearAllMocks();
  admin = { select: vi.fn().mockReturnThis(), filter: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ data: [], error: null }) };
  verification = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), gt: vi.fn().mockResolvedValue({ error: null }), insert: vi.fn().mockResolvedValue({ error: null }) };
  from = vi.fn((table) => {
    if (table === 'admin_users') return admin;
    if (table === 'email_verifications') return verification;
    throw new Error(`Unexpected table ${table}`);
  });
  mocks.service.mockReturnValue({ from });
  mocks.send.mockResolvedValue({ ok: true, messageId: 'mock' });
});
const request = (email) => new Request('http://localhost/api/send-verification', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-real-ip': `test-${++serial}` },
  body: JSON.stringify({ email, userName: 'Test', company: 'Example' }),
});
it('rejects an existing admin before retiring/storing codes or sending email', async () => {
  admin.limit.mockResolvedValue({ data: [{ id: 'admin-id' }], error: null });
  const response = await POST(request('  OWNER@Example.com  '));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ success: false, code: 'account_exists' });
  expect(admin.filter).toHaveBeenCalledWith('email', 'imatch', '^owner@example\\.com$');
  expect(from.mock.calls).toEqual([['admin_users']]);
  expect(mocks.send).not.toHaveBeenCalled();
});
it('fails closed when the admin lookup fails', async () => {
  admin.limit.mockResolvedValue({ data: null, error: { message: 'private database detail' } });
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
it.each(['A_B%Test@example.com', 'A*B+tag@example.com', 'Name.$test@example.com'])('matches email punctuation literally: %s', async (email) => {
  await POST(request(email));
  const [column, operator, pattern] = admin.filter.mock.calls[0];
  expect([column, operator]).toEqual(['email', 'imatch']);
  const matcher = new RegExp(pattern, 'i');
  expect(matcher.test(email)).toBe(true);
  expect(matcher.test('prefix' + email)).toBe(false);
  expect(matcher.test(email.replace(/[*+%_$]/g, 'x'))).toBe(false);
});
it('does not query the database for invalid addresses', async () => {
  expect((await POST(request('invalid'))).status).toBe(400);
  expect(from).not.toHaveBeenCalled();
});
