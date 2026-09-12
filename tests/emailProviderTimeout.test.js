import { afterEach, expect, it, vi } from "vitest";
import { sendViaProvider, classifyFailure } from "@/utils/emailProvider";
import { deliverWithRetry } from "@/utils/emailService";

const smtp = vi.hoisted(() => ({ sendMail: vi.fn(), close: vi.fn(), createTransport: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: smtp.createTransport } }));
const message = { to: ["recipient@example.com"], bcc: [], subject: "Test", html: "Test" };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it.each(["AbortError", "TimeoutError"])("does not resend uncertain %s deliveries", async (name) => {
  const error = Object.assign(new Error("Timed out"), { name });
  expect(classifyFailure(error)).toBe("uncertain");
  const send = vi.fn().mockRejectedValue(error);
  const result = await deliverWithRetry({ send });
  expect(result).toMatchObject({ ok: false, attempts: 1, failureKind: "uncertain" });
  expect(send).toHaveBeenCalledTimes(1);
});

it("passes an abort signal through the real Resend SDK and retains uncertainty", async () => {
  vi.stubEnv("RESEND_API_KEY", "re_test_key_for_transport");
  vi.stubEnv("EMAIL_FROM", "sender@example.com");
  const controller = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    expect(ms).toBe(10_000);
    return controller.signal;
  });
  const fetch = vi.fn(async (_url, options) => {
    expect(options.signal).toBe(controller.signal);
    controller.abort();
    throw Object.assign(new Error("Aborted"), { name: "AbortError" });
  });
  vi.stubGlobal("fetch", fetch);
  const result = await deliverWithRetry({ send: () => sendViaProvider(message) });
  expect(result).toMatchObject({ ok: false, provider: "resend", attempts: 1, failureKind: "uncertain" });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("bounds SMTP phases, closes the transport, and does not retry ETIMEDOUT", async () => {
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("GMAIL_EMAIL", "sender@example.com");
  vi.stubEnv("GMAIL_APP_PASSWORD", "test-password");
  smtp.createTransport.mockReturnValue(smtp);
  smtp.sendMail.mockRejectedValue(Object.assign(new Error("socket timed out"), { code: "ETIMEDOUT" }));
  const result = await deliverWithRetry({ send: () => sendViaProvider(message) });
  expect(result).toMatchObject({ ok: false, provider: "smtp", attempts: 1, failureKind: "uncertain" });
  expect(smtp.createTransport).toHaveBeenCalledWith(expect.objectContaining({
    dnsTimeout: 10_000, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 10_000,
  }));
  expect(smtp.sendMail).toHaveBeenCalledTimes(1);
  expect(smtp.close).toHaveBeenCalledTimes(1);
});

it("bounds email log requests and tolerates their failed response", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-server-key");
  const controller = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    expect(ms).toBe(10_000);
    return controller.signal;
  });
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    expect(options.signal).toBeInstanceOf(AbortSignal);
    return new Response(JSON.stringify({ message: "timeout" }), { status: 504 });
  }));
  const { insertEmailLog, updateEmailLog } = await import("@/utils/emailProvider");
  expect(await insertEmailLog({ recipient: "recipient@example.com" })).toBeNull();
  expect(await updateEmailLog("entry-id", { status: "sent" })).toBe(false);
  expect(AbortSignal.timeout).toHaveBeenCalledTimes(2);
});

it('preserves a confirmed SMTP send when transport cleanup throws', async () => {
  vi.stubEnv('RESEND_API_KEY', '');
  vi.stubEnv('GMAIL_EMAIL', 'sender@example.com');
  vi.stubEnv('GMAIL_APP_PASSWORD', 'test-password');
  smtp.createTransport.mockReturnValue(smtp);
  smtp.sendMail.mockResolvedValue({ messageId: 'confirmed-message' });
  smtp.close.mockImplementation(() => { throw new Error('already closed'); });
  const result = await deliverWithRetry({ send: () => sendViaProvider(message) });
  expect(result).toMatchObject({ ok: true, attempts: 1, messageId: 'confirmed-message' });
});
