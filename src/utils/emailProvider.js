/**
 * Email provider seam.
 *
 * WHY
 *  Every email in the product went straight to nodemailer + a Gmail account
 *  (GMAIL_EMAIL / GMAIL_APP_PASSWORD). That works, and it is also the whole
 *  problem: Gmail silently throttles, returns no per-message id worth keeping,
 *  and when the two env vars are missing the send is skipped with no trace at
 *  all. This module puts one interface in front of three implementations so the
 *  send path never has to know which one is live.
 *
 * SELECTION (first match wins)
 *   RESEND_API_KEY set ................... "resend"  — real API, real message id
 *   GMAIL_EMAIL + GMAIL_APP_PASSWORD ..... "smtp"    — the existing nodemailer path
 *   neither .............................. "mock"    — console + email_log row
 *
 *  The mock is the DEFAULT, deliberately. An unconfigured deploy previously
 *  dropped mail on the floor; now it produces a console line and a row in
 *  email_log with status 'mocked', so "was it sent?" has an answer in every
 *  environment.
 *
 * SECRETS
 *  No function here returns, logs, or embeds key material. Provider errors are
 *  passed through `redactSecrets` before they leave the module, because SMTP
 *  and HTTP clients both like to echo credentials back inside error strings.
 *
 * Both `resend` and `nodemailer` are imported dynamically, inside the branch
 * that needs them. A static import would pull a server-only package into any
 * bundle that touches this file.
 */

import { createClient } from "@supabase/supabase-js";
import { sanitizeHeader } from "@/utils/emailTemplates";

// ── Mode ─────────────────────────────────────────────────────────────

/** Which provider a send would use right now: "resend" | "smtp" | "mock". */
export function emailMode() {
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.GMAIL_EMAIL && process.env.GMAIL_APP_PASSWORD) return "smtp";
  return "mock";
}

/** True when a real delivery provider is configured (i.e. not the mock). */
export function providerConfigured() {
  return emailMode() !== "mock";
}

/**
 * Safe-to-display status for a health page. Contains no secret: the `from`
 * address is already on the outside of every message this app sends.
 */
export function providerStatus() {
  const mode = emailMode();
  return {
    mode,
    configured: mode !== "mock",
    from: fromAddress(),
    // Presence flags only — never the values.
    hasResendKey: Boolean(process.env.RESEND_API_KEY),
    hasSmtpCredentials: Boolean(process.env.GMAIL_EMAIL && process.env.GMAIL_APP_PASSWORD),
    logging: emailLogEnabled(),
  };
}

const DEFAULT_FROM_NAME = "Developer Activity Tracking System";

/** The From address for the active mode. */
export function fromAddress() {
  const mode = emailMode();
  if (mode === "smtp") return process.env.GMAIL_EMAIL || "";
  return process.env.EMAIL_FROM || process.env.RESEND_FROM || "onboarding@resend.dev";
}

function fromHeader() {
  const address = fromAddress();
  if (!address) return "";
  const name = sanitizeHeader(process.env.EMAIL_FROM_NAME || DEFAULT_FROM_NAME, 80);
  return address.includes("<") ? address : `${name} <${address}>`;
}

// ── Secret redaction ─────────────────────────────────────────────────

/**
 * Remove anything credential-shaped from a string before it is logged, stored
 * in email_log, or returned to a caller.
 *
 * Order matters: exact env values first (the only certain match), then the
 * shapes those values take when a client re-emits them.
 */
export function redactSecrets(value) {
  let out = String(value ?? "");
  for (const key of ["RESEND_API_KEY", "GMAIL_APP_PASSWORD", "SUPABASE_SERVICE_ROLE_KEY", "GMAIL_EMAIL"]) {
    const secret = process.env[key];
    if (secret && secret.length >= 6) out = out.split(secret).join("[redacted]");
  }
  return out
    .replace(/re_[A-Za-z0-9_-]{6,}/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer [redacted]")
    .replace(/(pass(word)?|api[_-]?key|authorization)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .slice(0, 500);
}

// ── Failure classification ───────────────────────────────────────────

/**
 * Errors that will never succeed on a retry. Retrying these wastes the
 * caller's request budget and, for a hard bounce, actively damages sender
 * reputation with the receiving domain.
 *
 * Permanent:
 *   - a syntactically invalid or rejected recipient (SMTP 5xx, Resend 422),
 *   - a rejected credential (401/403/535) — the key is wrong, not busy,
 *   - a malformed request (400/404/422).
 * Transient (retry):
 *   - rate limiting (429, SMTP 421/450/452),
 *   - any 5xx from the provider's own infrastructure,
 *   - connection/DNS/timeout errors, which are the common case.
 */
export function classifyFailure(error) {
  if (!error) return "transient";
  if (error.permanent === true) return "permanent";
  if (error.permanent === false) return "transient";

  const status = Number(error.statusCode ?? error.status ?? error.responseCode ?? 0);
  const code = String(error.code || "").toUpperCase();
  const name = String(error.name || "").toLowerCase();
  const message = String(error.message || error || "").toLowerCase();

  // Network-level: always worth another attempt.
  const TRANSIENT_CODES = [
    "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ESOCKET", "ECONNECTION",
    "EAI_AGAIN", "ENOTFOUND", "EPIPE", "ETIMEOUT", "EDNS", "ERR_NETWORK",
  ];
  if (TRANSIENT_CODES.includes(code)) return "transient";

  if (status === 429) return "transient";
  if (status >= 500 && status < 600) {
    // SMTP is the exception: its 5xx codes are permanent rejections, not
    // server faults. `responseCode` is only ever set by nodemailer.
    if (error.responseCode !== undefined) return "permanent";
    return "transient";
  }
  if (status === 421 || status === 450 || status === 451 || status === 452) return "transient";
  if (status >= 400 && status < 500) return "permanent";

  const PERMANENT_HINTS = [
    "invalid recipient", "invalid email", "invalid_parameter", "validation_error",
    "no recipient", "recipient rejected", "user unknown", "mailbox unavailable",
    "does not exist", "address rejected", "unrouteable", "no such user",
    "5.1.1", "5.1.3", "5.7.1", "not a valid email", "missing_required_field",
    "restricted", "unauthorized", "forbidden", "api key is invalid",
  ];
  if (PERMANENT_HINTS.some((h) => message.includes(h) || name.includes(h))) return "permanent";

  const TRANSIENT_HINTS = ["timeout", "timed out", "temporar", "try again", "rate limit", "too many", "throttl", "socket", "network"];
  if (TRANSIENT_HINTS.some((h) => message.includes(h))) return "transient";

  // Unknown failures are treated as transient: one extra attempt is cheaper
  // than a dropped notification, and the attempt cap bounds the cost.
  return "transient";
}

/** RFC-shaped enough to catch the typos that cause hard bounces. */
export function isValidEmail(address) {
  const value = String(address ?? "").trim();
  if (!value || value.length > 254) return false;
  if (/[\r\n\s,;]/.test(value)) return false;
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value);
}

// ── email_log writer ─────────────────────────────────────────────────
//
// Lives here rather than in emailService so the mock provider can record its
// own "delivery" when it is driven directly, and so there is exactly one place
// that knows the table's shape.

/**
 * The log needs the service role: migration 036 gives the browser SELECT only
 * and no write policy at all, so an anon-key insert is refused by RLS. Without
 * the key we degrade to console logging rather than making a doomed round trip.
 */
export function emailLogEnabled() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function logClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function logRow(entry) {
  return {
    organization_id: entry.organizationId || null,
    recipient: String(entry.recipient || "").slice(0, 320),
    template: entry.template ? String(entry.template).slice(0, 64) : null,
    subject: entry.subject ? sanitizeHeader(entry.subject, 300) : null,
    status: entry.status || "queued",
    provider: entry.provider || emailMode(),
    provider_message_id: entry.messageId ? String(entry.messageId).slice(0, 200) : null,
    error: entry.error ? redactSecrets(entry.error) : null,
    attempts: Number.isFinite(entry.attempts) ? entry.attempts : 0,
    ...(entry.sentAt !== undefined ? { sent_at: entry.sentAt } : {}),
  };
}

/**
 * Insert an email_log row. Returns the new row id, or null.
 * Never throws — logging must not be able to fail a send.
 */
export async function insertEmailLog(entry) {
  if (!emailLogEnabled()) return null;
  try {
    const { data, error } = await logClient().from("email_log").insert(logRow(entry)).select("id").single();
    if (error) return null;
    return data?.id || null;
  } catch {
    return null;
  }
}

/** Update an existing email_log row with the final outcome. Never throws. */
export async function updateEmailLog(id, entry) {
  if (!id || !emailLogEnabled()) return false;
  try {
    const row = logRow(entry);
    delete row.organization_id;
    delete row.recipient;
    const { error } = await logClient().from("email_log").update(row).eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

// ── Providers ────────────────────────────────────────────────────────

function normalizeRecipients(value) {
  if (Array.isArray(value)) return value.map((v) => String(v || "").trim()).filter(Boolean);
  if (!value) return [];
  return [String(value).trim()].filter(Boolean);
}

async function sendViaResend(message) {
  const { Resend } = await import("resend");
  const client = new Resend(process.env.RESEND_API_KEY);
  const payload = {
    from: fromHeader(),
    to: message.to.length ? message.to : [fromAddress()],
    subject: message.subject,
    html: message.html,
  };
  if (message.text) payload.text = message.text;
  if (message.bcc.length) payload.bcc = message.bcc;
  if (message.replyTo) payload.replyTo = message.replyTo;

  const { data, error } = await client.emails.send(payload);
  if (error) {
    const err = new Error(redactSecrets(error.message || error.name || "resend send failed"));
    err.name = error.name || "ResendError";
    err.statusCode = error.statusCode || error.status;
    throw err;
  }
  return { messageId: data?.id || null };
}

async function sendViaSmtp(message) {
  const nodemailer = (await import("nodemailer")).default;
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_EMAIL, pass: process.env.GMAIL_APP_PASSWORD },
  });
  const info = await transporter.sendMail({
    from: { name: sanitizeHeader(process.env.EMAIL_FROM_NAME || DEFAULT_FROM_NAME, 80), address: process.env.GMAIL_EMAIL },
    // A `to` is always required; BCC-only fan-outs address the sender so the
    // recipients stay hidden from one another. This mirrors the old mailer.
    to: message.to.length ? message.to.join(", ") : process.env.GMAIL_EMAIL,
    bcc: message.bcc.length ? message.bcc.join(", ") : undefined,
    subject: message.subject,
    html: message.html,
    text: message.text || undefined,
    replyTo: message.replyTo || undefined,
  });
  return { messageId: info?.messageId || null };
}

async function sendViaMock(message, options) {
  const recipients = [...message.to, ...message.bcc.map((b) => `bcc:${b}`)];
  // eslint-disable-next-line no-console
  console.info(
    "[email:mock] no provider configured — not delivered.",
    JSON.stringify({
      to: recipients,
      subject: message.subject,
      template: options?.template || null,
      bytes: (message.html || "").length,
    })
  );
  // Direct callers get the database half of the mock too. emailService passes
  // recordMock:false because it writes its own row through the same table and
  // two rows for one send would make the log lie about volume.
  if (options?.recordMock !== false) {
    await insertEmailLog({
      organizationId: options?.organizationId || null,
      recipient: recipients.join(", "),
      template: options?.template || null,
      subject: message.subject,
      status: "mocked",
      provider: "mock",
      attempts: 1,
      sentAt: new Date().toISOString(),
    });
  }
  return { messageId: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` };
}

/**
 * Send one message through the active provider.
 *
 * Returns { ok, provider, messageId, error, failureKind } and never throws:
 * the retry loop in emailService decides what to do with `failureKind`, and a
 * thrown error there would bypass logging.
 */
export async function sendViaProvider(message = {}, options = {}) {
  const provider = emailMode();
  const normalized = {
    to: normalizeRecipients(message.to),
    bcc: normalizeRecipients(message.bcc),
    subject: sanitizeHeader(message.subject, 300) || "(no subject)",
    html: String(message.html || ""),
    text: message.text ? String(message.text) : "",
    replyTo: message.replyTo ? sanitizeHeader(message.replyTo, 254) : "",
  };

  if (!normalized.to.length && !normalized.bcc.length) {
    return { ok: false, provider, messageId: null, error: "no recipient", failureKind: "permanent" };
  }

  try {
    let result;
    if (provider === "resend") result = await sendViaResend(normalized);
    else if (provider === "smtp") result = await sendViaSmtp(normalized);
    else result = await sendViaMock(normalized, options);

    return { ok: true, provider, messageId: result?.messageId || null, error: null, failureKind: null };
  } catch (e) {
    return {
      ok: false,
      provider,
      messageId: null,
      error: redactSecrets(e?.message || "send failed"),
      failureKind: classifyFailure(e),
    };
  }
}

const emailProvider = {
  emailMode,
  providerConfigured,
  providerStatus,
  fromAddress,
  sendViaProvider,
  classifyFailure,
  isValidEmail,
  redactSecrets,
  insertEmailLog,
  updateEmailLog,
  emailLogEnabled,
};

export default emailProvider;
