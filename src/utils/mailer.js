import nodemailer from "nodemailer";

// Server-only email helper. Mirrors the Gmail transport used by the
// invitations route so notifications share one code path/config.
// Env: GMAIL_EMAIL, GMAIL_APP_PASSWORD. If either is missing, sends are
// skipped gracefully (callers treat email as best-effort).

export function mailerConfigured() {
  return !!(process.env.GMAIL_EMAIL && process.env.GMAIL_APP_PASSWORD);
}

/**
 * Send an email. Recipients in `bcc` are hidden from each other (privacy).
 * Returns { ok, skipped?, error? } — never throws.
 */
export async function sendMail({ to, bcc, subject, html, text }) {
  if (!mailerConfigured()) return { ok: false, skipped: true, error: "mailer not configured" };
  const bccList = Array.isArray(bcc) ? bcc.filter(Boolean) : bcc ? [bcc] : [];
  if (!to && bccList.length === 0) return { ok: false, error: "no recipient" };
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.GMAIL_EMAIL, pass: process.env.GMAIL_APP_PASSWORD },
    });
    await transporter.sendMail({
      from: { name: "Developer Activity Tracking System", address: process.env.GMAIL_EMAIL },
      to: to || process.env.GMAIL_EMAIL, // a `to` is required; default to self when using bcc
      bcc: bccList.length ? bccList.join(", ") : undefined,
      subject,
      html,
      text: text || undefined,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || "send failed" };
  }
}

/** Minimal branded HTML template for client notifications. */
export function notifyEmailHtml({ orgName, heading, body, ctaLabel, ctaUrl }) {
  const safe = (s) => String(s || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background: #009578; color: #fff; padding: 20px; text-align: center; border-radius: 10px 10px 0 0;">
      <h2 style="margin:0;">${safe(orgName) || "Project update"}</h2>
    </div>
    <div style="padding: 28px; background: #fff; border: 1px solid #eee; border-top: none;">
      <h3 style="margin-top:0; color:#111;">${safe(heading)}</h3>
      ${body ? `<p style="color:#444; line-height:1.6;">${safe(body)}</p>` : ""}
      ${
        ctaUrl
          ? `<p style="margin-top:24px;"><a href="${ctaUrl}" style="background:#009578;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block;">${safe(ctaLabel) || "Open portal"}</a></p>`
          : ""
      }
      <p style="color:#999; font-size:12px; margin-top:28px;">You're receiving this because you have a client account in ${safe(orgName) || "the workspace"}.</p>
    </div>
  </div>`;
}
