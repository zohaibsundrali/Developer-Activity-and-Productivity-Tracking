/**
 * The single outbound email path.
 *
 * WHAT THIS REPLACED
 *  This file used to be a browser-side EmailJS wrapper (`emailService.sendVerificationCode`)
 *  with no importers — the actual sending happened in three unrelated places:
 *  `src/utils/mailer.js`, `api/invitations/route.js` and
 *  `api/send-verification/route.js`, each constructing its own nodemailer Gmail
 *  transport. There was no delivery status, no bounce handling, no log, and no
 *  retry; a throttled Gmail send failed inside a try/catch and disappeared.
 *
 * WHAT IT IS NOW
 *  Every email goes through `sendEmail` / `sendTemplatedEmail`:
 *    pick template -> render (escaped) -> validate -> rate limit -> log 'queued'
 *    -> send via the provider seam -> retry transient failures -> log the final
 *    state ('sent' | 'failed' | 'mocked').
 *
 * RETRY POLICY
 *  Bounded at 3 attempts total with exponential backoff. Only TRANSIENT
 *  failures are retried (throttling, 5xx from the provider, connection resets).
 *  A permanent failure — an invalid or rejected recipient, a rejected API key,
 *  a malformed request — returns after the FIRST attempt. Retrying a hard
 *  bounce does not deliver the mail and does cost sender reputation with the
 *  receiving domain.
 *
 * NOTHING HERE THROWS. Email is best-effort everywhere it is called from, and
 * a throwing logger or a throwing renderer would take a user-visible action
 * down with it.
 */

import { renderTemplate, sanitizeHeader, TEMPLATE_NAMES } from "@/utils/emailTemplates";
import {
  sendViaProvider,
  emailMode,
  providerConfigured,
  providerStatus,
  classifyFailure,
  isValidEmail,
  redactSecrets,
  insertEmailLog,
  updateEmailLog,
  emailLogEnabled,
} from "@/utils/emailProvider";

export { TEMPLATE_NAMES, renderTemplate, emailMode, providerStatus, classifyFailure, isValidEmail };

/** Hard ceiling. `maxAttempts` may lower this; nothing may raise it. */
export const MAX_ATTEMPTS = 3;
/** First backoff step. Attempt n waits BASE * 2^(n-1): 400ms, then 800ms. */
export const BASE_BACKOFF_MS = 400;

const sleepReal = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Rate limiting ────────────────────────────────────────────────────
//
// In-process, same shape as the limiter in api/send-verification. Each
// serverless instance keeps its own counters, so this caps a runaway loop
// rather than enforcing a global quota — the point is that a retry storm or a
// buggy automation cannot burn the Gmail daily allowance in one request.
// A shared store would be needed for a hard guarantee.

const RECIPIENT_WINDOW_MS = 60 * 60 * 1000;
const GLOBAL_WINDOW_MS = 60 * 1000;

function limitPerRecipient() {
  const n = Number(process.env.EMAIL_MAX_PER_RECIPIENT_PER_HOUR);
  return Number.isFinite(n) && n > 0 ? n : 20;
}

function limitPerMinute() {
  const n = Number(process.env.EMAIL_MAX_PER_MINUTE);
  if (Number.isFinite(n) && n > 0) return n;
  // Gmail throttles well below this and does it silently; Resend does not.
  return emailMode() === "smtp" ? 30 : 120;
}

const buckets = { recipients: new Map(), global: [] };

/** Test seam: drop all counters. */
export function resetRateLimiter() {
  buckets.recipients.clear();
  buckets.global = [];
}

function rateLimit(recipients, now = Date.now()) {
  buckets.global = buckets.global.filter((t) => now - t < GLOBAL_WINDOW_MS);
  if (buckets.global.length >= limitPerMinute()) {
    return { limited: true, scope: "global" };
  }
  for (const address of recipients) {
    const key = address.toLowerCase();
    const hits = (buckets.recipients.get(key) || []).filter((t) => now - t < RECIPIENT_WINDOW_MS);
    buckets.recipients.set(key, hits);
    if (hits.length >= limitPerRecipient()) return { limited: true, scope: "recipient" };
  }
  // Crude memory bound — this map is per-instance and never pruned otherwise.
  if (buckets.recipients.size > 5000) buckets.recipients.clear();
  buckets.global.push(now);
  for (const address of recipients) {
    const key = address.toLowerCase();
    buckets.recipients.set(key, [...(buckets.recipients.get(key) || []), now]);
  }
  return { limited: false };
}

// ── Retry ────────────────────────────────────────────────────────────

/**
 * The retry decision, isolated so it can be asserted directly.
 *
 * @param failureKind "permanent" | "transient" | null
 * @param attempt     attempts already made (1 after the first)
 * @param maxAttempts ceiling, clamped to MAX_ATTEMPTS
 */
export function shouldRetry(failureKind, attempt, maxAttempts = MAX_ATTEMPTS) {
  if (failureKind === "permanent") return false;
  if (!failureKind) return false; // success, or nothing to retry
  const cap = Math.max(1, Math.min(Number(maxAttempts) || MAX_ATTEMPTS, MAX_ATTEMPTS));
  return attempt < cap;
}

/** Delay before attempt n+1. Deterministic so tests do not need a clock. */
export function backoffFor(attempt, baseDelayMs = BASE_BACKOFF_MS) {
  return baseDelayMs * Math.pow(2, Math.max(0, attempt - 1));
}

/**
 * Run `send` until it succeeds, hits a permanent failure, or exhausts the
 * attempt cap. `send` must resolve to the sendViaProvider result shape.
 *
 * Exposed (and injectable) because the retry/no-retry decision is the part of
 * this module most worth testing and least worth mocking a network for.
 */
export async function deliverWithRetry({ send, maxAttempts = MAX_ATTEMPTS, baseDelayMs = BASE_BACKOFF_MS, sleep = sleepReal } = {}) {
  const cap = Math.max(1, Math.min(Number(maxAttempts) || MAX_ATTEMPTS, MAX_ATTEMPTS));
  let attempts = 0;
  let last = null;

  while (attempts < cap) {
    attempts += 1;
    try {
      last = await send(attempts);
    } catch (e) {
      // sendViaProvider does not throw, but an injected sender might.
      last = {
        ok: false,
        provider: emailMode(),
        messageId: null,
        error: redactSecrets(e?.message || "send failed"),
        failureKind: classifyFailure(e),
      };
    }

    if (last?.ok) return { ...last, attempts };
    const kind = last?.failureKind || "transient";
    if (!shouldRetry(kind, attempts, cap)) return { ...last, failureKind: kind, attempts };
    await sleep(backoffFor(attempts, baseDelayMs));
  }

  return { ...(last || { ok: false, error: "send failed" }), attempts };
}

// ── Send ─────────────────────────────────────────────────────────────

function toList(value) {
  if (Array.isArray(value)) return value.map((v) => String(v || "").trim()).filter(Boolean);
  if (!value) return [];
  return String(value)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * Send one message. Returns — never throws:
 *
 *   { ok, mode, provider, messageId, attempts, error, permanent,
 *     rateLimited, invalid, delivered, logId, skipped, recipients }
 *
 * `ok` means the send path completed without error. `delivered` is the
 * stricter claim: ok AND a real provider handled it. In mock mode `ok` is true
 * and `delivered` is false, which is what lets a caller report honestly.
 */
export async function sendEmail({
  to,
  bcc,
  subject,
  html,
  text,
  template = null,
  organizationId = null,
  replyTo = "",
  maxAttempts = MAX_ATTEMPTS,
  baseDelayMs = BASE_BACKOFF_MS,
  sleep = sleepReal,
} = {}) {
  const mode = emailMode();
  const cleanSubject = sanitizeHeader(subject, 300) || "(no subject)";

  const requestedTo = toList(to);
  const requestedBcc = toList(bcc);
  const validTo = requestedTo.filter(isValidEmail);
  const validBcc = requestedBcc.filter(isValidEmail);
  const rejected = [...requestedTo, ...requestedBcc].filter((a) => !isValidEmail(a));
  const recipients = [...validTo, ...validBcc];
  const recipientLabel = [...requestedTo, ...requestedBcc].join(", ").slice(0, 320) || "(none)";

  const baseLog = {
    organizationId,
    recipient: recipientLabel,
    template,
    subject: cleanSubject,
    provider: mode,
  };

  // ── Permanent, pre-flight: nothing left to send to ──
  // An address that does not parse will never parse. This is the retry
  // policy's clearest case and it is settled before a provider is touched.
  if (recipients.length === 0) {
    const error = requestedTo.length || requestedBcc.length ? "invalid recipient address" : "no recipient";
    await insertEmailLog({ ...baseLog, status: "failed", error, attempts: 1 });
    return {
      ok: false,
      delivered: false,
      mode,
      provider: mode,
      messageId: null,
      attempts: 1,
      error,
      permanent: true,
      invalid: rejected,
      recipients: 0,
    };
  }

  // ── Rate limit ──
  const limit = rateLimit(recipients);
  if (limit.limited) {
    const error = `rate limit exceeded (${limit.scope})`;
    await insertEmailLog({ ...baseLog, status: "failed", error, attempts: 0 });
    return {
      ok: false,
      delivered: false,
      mode,
      provider: mode,
      messageId: null,
      attempts: 0,
      error,
      permanent: false,
      rateLimited: true,
      invalid: rejected,
      recipients: recipients.length,
    };
  }

  // ── Log the intent before the attempt ──
  // If the process dies mid-send the row survives as 'queued', which is the
  // difference between "we do not know" and "we never tried".
  const logId = await insertEmailLog({ ...baseLog, status: "queued", attempts: 0 });

  const message = { to: validTo, bcc: validBcc, subject: cleanSubject, html, text, replyTo };
  const result = await deliverWithRetry({
    send: () => sendViaProvider(message, { template, organizationId, recordMock: false }),
    maxAttempts,
    baseDelayMs,
    sleep,
  });

  // The provider that actually ran is authoritative — `mode` is only the
  // fallback for a result that did not name one.
  const mocked = result.ok && (result.provider || mode) === "mock";
  const status = result.ok ? (mocked ? "mocked" : "sent") : "failed";
  const permanent = !result.ok && result.failureKind === "permanent";

  const finalEntry = {
    ...baseLog,
    status,
    provider: result.provider || mode,
    messageId: result.messageId,
    error: result.ok ? null : result.error || "send failed",
    attempts: result.attempts,
    sentAt: result.ok ? new Date().toISOString() : null,
  };
  if (logId) await updateEmailLog(logId, finalEntry);
  else await insertEmailLog(finalEntry);

  return {
    ok: Boolean(result.ok),
    delivered: Boolean(result.ok) && !mocked,
    mode,
    provider: result.provider || mode,
    messageId: result.messageId || null,
    attempts: result.attempts,
    error: result.ok ? null : redactSecrets(result.error || "send failed"),
    permanent,
    rateLimited: false,
    invalid: rejected,
    recipients: recipients.length,
    logId,
    ...(mocked ? { skipped: true, reason: "no email provider configured; recorded in email_log" } : {}),
  };
}

/**
 * Render one of the templates in emailTemplates.js and send it.
 * `data` is untrusted — every value is escaped by the renderer.
 */
export async function sendTemplatedEmail({ template, to, bcc, data = {}, organizationId = null, subject, ...rest } = {}) {
  const rendered = renderTemplate(template, data);
  return sendEmail({
    to,
    bcc,
    subject: subject || rendered.subject,
    html: rendered.html,
    text: rendered.text,
    template: rendered.template,
    organizationId,
    ...rest,
  });
}

/** Safe-to-display status for a health page. Contains no key material. */
export function emailServiceStatus() {
  return {
    ...providerStatus(),
    templates: TEMPLATE_NAMES,
    maxAttempts: MAX_ATTEMPTS,
    perMinuteLimit: limitPerMinute(),
    perRecipientHourlyLimit: limitPerRecipient(),
    logTable: emailLogEnabled() ? "email_log" : null,
  };
}

export const emailService = {
  send: sendEmail,
  sendTemplate: sendTemplatedEmail,
  mode: emailMode,
  configured: providerConfigured,
  status: emailServiceStatus,
  templates: TEMPLATE_NAMES,
};

export default emailService;
