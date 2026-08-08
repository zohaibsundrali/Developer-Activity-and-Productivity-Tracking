/**
 * Server-only email helper — now a thin adapter over the single send path.
 *
 * The signatures (`mailerConfigured`, `sendMail`, `notifyEmailHtml`) are
 * unchanged so the routes that already import them keep working untouched.
 * What changed is what happens underneath: instead of constructing its own
 * nodemailer Gmail transport, this delegates to `emailService`, which picks a
 * provider (Resend / SMTP / mock), escapes, rate-limits, retries transient
 * failures and writes an `email_log` row for every outcome.
 *
 * `notifyEmailHtml` now renders through the shared layout in emailTemplates.js,
 * so its output matches every other email in the product — and its escaping is
 * the full one (the old local `safe()` handled only `<` and `>`, which left
 * quotes and `&` to be interpolated raw, and it did not check the CTA scheme at
 * all).
 */

import { sendEmail } from "@/utils/emailService";
import { renderLayout } from "@/utils/emailTemplates";
import { emailMode, providerConfigured } from "@/utils/emailProvider";

/**
 * True when a REAL delivery provider is configured (Resend or Gmail SMTP).
 * False means the mock is active: sends still succeed and are still recorded
 * in email_log, but nothing leaves the process.
 */
export function mailerConfigured() {
  return providerConfigured();
}

/** "resend" | "smtp" | "mock" — safe to surface on a health page. */
export function mailerMode() {
  return emailMode();
}

/**
 * Send an email. Recipients in `bcc` are hidden from each other (privacy).
 * Returns { ok, skipped?, error?, mode, messageId, attempts } — never throws.
 */
export async function sendMail({ to, bcc, subject, html, text, organizationId = null, template = null }) {
  const result = await sendEmail({ to, bcc, subject, html, text, organizationId, template });
  return {
    ok: result.ok,
    delivered: result.delivered,
    mode: result.mode,
    messageId: result.messageId,
    attempts: result.attempts,
    ...(result.skipped ? { skipped: true, reason: result.reason } : {}),
    ...(result.error ? { error: result.error } : {}),
  };
}

/** Minimal branded HTML template for client notifications. */
export function notifyEmailHtml({ orgName, heading, body, ctaLabel, ctaUrl }) {
  return renderLayout({
    title: orgName || "Project update",
    orgName: "",
    preheader: heading || "",
    heading: heading || "",
    bodyHtml: body ? `<p style="margin:0 0 12px;">${escapeForBody(body)}</p>` : "",
    ctaLabel: ctaLabel || "Open portal",
    ctaUrl: ctaUrl || "",
    footerNote: `You are receiving this because you have an account in ${orgName || "the workspace"}.`,
  });
}

// Local alias so this file does not re-export the escaper under a second name.
function escapeForBody(value) {
  return String(value ?? "")
    .slice(0, 1500)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
