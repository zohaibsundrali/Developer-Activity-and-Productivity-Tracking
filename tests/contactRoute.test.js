import { beforeEach, expect, it, vi } from 'vitest';
const send = vi.hoisted(() => vi.fn());
vi.mock('@/utils/emailService', () => ({ sendEmail: send, isValidEmail: (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) }));
import { POST } from '@/app/api/contact/route';
import { resetRateLimits } from '@/utils/rateLimit';
const body = {name: '<Test>', email: 'visitor@example.com', company: 'Example', message: 'Show us the team workflow.'};
const request = (payload) => new Request('http://localhost/api/contact', { method: 'POST', body: JSON.stringify(payload) });
beforeEach(() => { resetRateLimits(); send.mockReset(); vi.stubEnv('SALES_CONTACT_EMAIL', 'sales@example.com'); });
it('delivers only to the configured mailbox and escapes visitor content', async () => {
  send.mockResolvedValue({ delivered: true });
  expect((await POST(request({...body, to:'attacker@example.com'}))).status).toBe(200);
  expect(send.mock.calls[0][0].to).toBe('sales@example.com');
  expect(send.mock.calls[0][0].html).toContain('&lt;Test&gt;');
});
it('does not report success for mock or failed delivery', async () => {
  send.mockResolvedValue({ ok: true, delivered: false });
  expect((await POST(request(body))).status).toBe(503);
});
it('rejects invalid input and limits repeated submissions', async () => {
  expect((await POST(request({...body, email:'invalid'}))).status).toBe(400);
  expect(send).not.toHaveBeenCalled();
  send.mockResolvedValue({ delivered: true });
  await POST(request(body)); await POST(request(body));
  expect((await POST(request(body))).status).toBe(429);
});
