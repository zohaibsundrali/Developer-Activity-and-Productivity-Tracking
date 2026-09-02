/**
 * Reusable transactional email templates.
 *
 * WHY THIS EXISTS
 *  Before this module every email in the product was a template literal built
 *  inline in the route that sent it (`api/invitations`, `api/send-verification`,
 *  `notifyEmailHtml` in mailer.js). Three consequences:
 *   - the branding drifted between them,
 *   - only one of the three escaped anything, so a task title, a project name
 *     or an org name containing markup was interpolated raw into the message,
 *   - adding a new kind of email meant copying 40 lines of table markup.
 *
 * RULES THIS MODULE ENFORCES
 *  1. EVERY interpolated value is HTML-escaped. There is no "trusted" caller.
 *     `escapeHtml` is the same routine already used by
 *     src/app/api/send-verification/route.js, lifted here so there is one copy.
 *  2. URLs go through `safeUrl`, which rejects anything that is not http(s).
 *     Escaping alone does not stop `javascript:` in an href.
 *  3. Subjects go through `sanitizeHeader`, which strips CR/LF. A newline in a
 *     header is header injection, and HTML-escaping a subject would only make
 *     `&amp;` show up in the recipient's inbox.
 *  4. Inline CSS only. Gmail, Outlook and Apple Mail all drop <style> blocks or
 *     external stylesheets, so a class-based layout renders unstyled.
 *
 * Every template returns { subject, html, text }. The text part is built from
 * the RAW values (text/plain must not carry HTML entities).
 */

import { BRAND_NAME } from "@/components/brand/brand";
// `escapeHtml` and `safeUrl` USED TO BE DEFINED HERE. They moved to
// utils/safeUrl.js unchanged, and are re-exported below so every existing
// caller — and tests/emailSystem.test.js — keeps importing them from this
// module.
//
// WHY THEY MOVED. The scheme check they perform is not an email concern; it is
// the check any sink that follows a user-supplied URL needs. The developer
// project-details screen had none, so a `?file_url=javascript:...` link reached
// `link.href = ...; link.click()` and ran in the page's own origin. That screen
// needs the SAME answer about which schemes are allowed, must not pull a
// template library into the client bundle to get it, and needs the URL
// UNESCAPED — `?a=1&b=2` must not reach fetch() as `?a=1&amp;b=2`.
// utils/safeUrl.js splits those two halves apart: `safeHref` decides, `safeUrl`
// escapes the survivor. `safeUrl` here is byte-for-byte the same function it
// always was.
import { escapeHtml, safeUrl } from "@/utils/safeUrl";

// ── Escaping / sanitising ────────────────────

export { escapeHtml, safeUrl };

/**
 * Sanitise a value destined for a mail header (subject, display name).
 * CR/LF are removed — a newline there lets a caller append headers of their
 * own. Not HTML-escaped: headers are not HTML.
 */
export function sanitizeHeader(value, maxLen = 200) {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, maxLen);
}

/** Strip markup for the text/plain alternative. */
function toText(value, maxLen = 2000) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s{3,}/g, "\n")
    .trim()
    .slice(0, maxLen);
}

// ── Shared layout ────────────────────────────────────────────────────

// The brand indigo, not the teal these templates shipped with. `--primary` in
// src/app/globals.css is `243 70% 56%`, which is exactly #4840DD; BRAND_DARK is
// the same hue at 44% lightness, used for the pressed edge under the CTA.
//
// Written as literal hex on purpose: email clients do not evaluate CSS custom
// properties, and Outlook does not support hsl() at all, so the token cannot be
// referenced here — it has to be resolved. If `--primary` ever changes, this
// pair changes with it. That is the whole coupling, and it is stated here so
// the next person finds it.
const BRAND = "#4840DD";
const BRAND_DARK = "#2A22BF";
const TEXT = "#1f2933";
const MUTED = "#6b7280";
const BORDER = "#e5e7eb";
// The product name comes from the brand module, never from a literal here.
// It used to be the string "Developer Activity Tracking System", which is the
// pre-rename name: every template footer and every text/plain signature was
// signing mail with a product that no longer exists.
const PRODUCT_NAME = BRAND_NAME;

/**
 * The one layout every template renders through: header bar, body, optional
 * CTA button, optional detail rows, footer.
 *
 * Everything passed in is escaped here, so a template body may hand this
 * function raw user data. The only fields that may contain markup are
 * `bodyHtml` (assembled by a template out of already-escaped pieces) and the
 * pre-escaped detail values.
 */
export function renderLayout({
  title,
  preheader = "",
  heading = "",
  bodyHtml = "",
  details = [],
  ctaLabel = "",
  ctaUrl = "",
  footerNote = "",
  orgName = "",
}) {
  const href = safeUrl(ctaUrl);
  const detailRows = (Array.isArray(details) ? details : [])
    .filter((d) => d && d.label && d.value !== undefined && d.value !== null && d.value !== "")
    .map(
      (d) =>
        `<tr><td style="padding:4px 12px 4px 0;color:${MUTED};font-size:13px;white-space:nowrap;">${escapeHtml(
          d.label,
          60
        )}</td><td style="padding:4px 0;color:${TEXT};font-size:13px;">${escapeHtml(d.value, 300)}</td></tr>`
    )
    .join("");

  return `<div style="background:#f5f6f8;padding:24px 0;font-family:Arial,Helvetica,sans-serif;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader, 160)}</span>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid ${BORDER};border-radius:10px;overflow:hidden;">
    <tr>
      <td style="background:${BRAND};padding:20px 28px;">
        <div style="color:#ffffff;font-size:18px;font-weight:bold;">${escapeHtml(title, 120) || PRODUCT_NAME}</div>
        ${orgName ? `<div style="color:#dedcfa;font-size:13px;margin-top:4px;">${escapeHtml(orgName, 120)}</div>` : ""}
      </td>
    </tr>
    <tr>
      <td style="padding:28px;">
        ${heading ? `<h2 style="margin:0 0 14px;color:${TEXT};font-size:19px;line-height:1.35;">${escapeHtml(heading, 200)}</h2>` : ""}
        <div style="color:#374151;font-size:14px;line-height:1.65;">${bodyHtml}</div>
        ${
          detailRows
            ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0;background:#f8fafc;border:1px solid ${BORDER};border-radius:8px;padding:12px;width:100%;"><tr><td style="padding:12px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0">${detailRows}</table></td></tr></table>`
            : ""
        }
        ${
          href && ctaLabel
            ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;"><tr><td style="background:${BRAND};border-radius:8px;"><a href="${href}" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;border:1px solid ${BRAND_DARK};border-radius:8px;">${escapeHtml(ctaLabel, 60)}</a></td></tr></table>
        <p style="margin:14px 0 0;font-size:12px;color:${MUTED};">If the button does not work, paste this into your browser:<br><span style="word-break:break-all;">${href}</span></p>`
            : ""
        }
      </td>
    </tr>
    <tr>
      <td style="padding:16px 28px;border-top:1px solid ${BORDER};background:#fafafa;">
        <p style="margin:0;color:${MUTED};font-size:12px;line-height:1.5;">${escapeHtml(footerNote, 300) || `Sent by ${PRODUCT_NAME}.`}</p>
      </td>
    </tr>
  </table>
</div>`;
}

/** Escape a run of paragraphs into the layout's body slot. */
function paragraphs(...lines) {
  return lines
    .filter((l) => l !== undefined && l !== null && String(l).trim() !== "")
    .map((l) => `<p style="margin:0 0 12px;">${escapeHtml(l, 1500)}</p>`)
    .join("");
}

function textBlock(lines, ctaLabel, ctaUrl) {
  const url = safeUrl(ctaUrl);
  const parts = lines.filter(Boolean).map((l) => toText(l));
  if (url) parts.push(`${ctaLabel || "Open"}: ${url.replace(/&amp;/g, "&")}`);
  parts.push(`— ${PRODUCT_NAME}`);
  return parts.join("\n\n");
}

function name(value, fallback = "there") {
  const v = sanitizeHeader(value, 80);
  return v || fallback;
}

// ── Templates ────────────────────────────────────────────────────────
//
// Each is (data) => { subject, html, text }. Unknown keys are ignored, missing
// keys degrade to a sensible default — a template must never throw, because it
// runs inside a best-effort send path.

export const TEMPLATES = {
  /**
   * Email-address confirmation, sent while an account is being set up.
   *
   * It replaces the inline markup that used to live in
   * src/app/api/send-verification/route.js, which called itself "Login
   * Verification" — the wrong claim twice over. Nobody is logging in (the
   * account does not exist yet) and the recipient may not have asked for
   * anything at all, so the copy has to say what the code is for, how long it
   * lasts, and what to do if it was not requested. There is deliberately no
   * CTA button: the code is typed into the tab the person already has open,
   * and a "confirm" link in a mail like this trains people to click links in
   * mail like this.
   *
   * `code` is filtered to alphanumerics and then escaped anyway — it is the
   * one value rendered outside `paragraphs()`.
   */
  email_verification(d = {}) {
    const who = name(d.userName || d.recipientName || d.fullName, "there");
    const code = String(d.code ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
    const minutes = Number(d.expiresInMinutes) > 0 ? Math.round(Number(d.expiresInMinutes)) : 10;
    const org = sanitizeHeader(d.orgName || d.company, 120);
    const address = sanitizeHeader(d.email, 254);

    const intro = [
      `Hello ${who},`,
      `Someone entered this email address while setting up a ${BRAND_NAME} account. Enter the code below on the page you started to confirm the address belongs to you. This confirms an email address only — it is not a sign-in, and on its own it gives nobody access to anything.`,
    ];
    const outro = [
      `The code expires ${minutes} minutes after this email was sent. After that it stops working and you can ask for a new one from the same page.`,
      `If you did not request this, you do not need to do anything: no account is created until the code is entered. Do not forward the code to anyone — ${BRAND_NAME} will never ask you for it.`,
    ];

    const codeHtml = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;"><tr><td style="background:#f8fafc;border:1px dashed ${BRAND};border-radius:10px;padding:18px 26px;text-align:center;">
      <div style="color:${MUTED};font-size:12px;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">Your confirmation code</div>
      <div style="color:${TEXT};font-family:'Courier New',Courier,monospace;font-size:30px;font-weight:bold;letter-spacing:8px;text-indent:8px;">${escapeHtml(code, 12)}</div>
    </td></tr></table>`;

    return {
      subject: sanitizeHeader(
        code
          ? `${code} is your ${BRAND_NAME} confirmation code`
          : `Confirm your email address for ${BRAND_NAME}`
      ),
      html: renderLayout({
        title: "Confirm your email address",
        orgName: org,
        preheader: `Your ${BRAND_NAME} confirmation code expires in ${minutes} minutes.`,
        heading: "Confirm your email address",
        bodyHtml: paragraphs(...intro) + codeHtml + paragraphs(...outro),
        details: [
          { label: "Address", value: address },
          { label: "Organization", value: org },
          { label: "Expires", value: `${minutes} minutes after sending` },
        ],
        footerNote: `Sent by ${BRAND_NAME} because this address was entered during account setup. If that was not you, ignore this email.`,
      }),
      text: textBlock([...intro, `Confirmation code: ${code}`, ...outro]),
    };
  },

  /**
   * Password reset link.
   *
   * WHY THIS TEMPLATE EXISTS AT ALL
   *  /forgot-password used to call `supabase.auth.resetPasswordForEmail()` from
   *  the browser, which makes SUPABASE send the mail: its default template, its
   *  sender, its wording. The recipient got a message that named a service they
   *  have never heard of, about an account they hold with us — which reads
   *  exactly like phishing, and is the one email in the product where looking
   *  untrustworthy is most expensive.
   *
   *  The token is still Supabase's. Nothing here invents a reset scheme: the
   *  route mints the recovery link with `auth.admin.generateLink()` and this
   *  template only carries it. What changed is who addresses the envelope.
   *
   * COPY RULES FOR THIS PARTICULAR MESSAGE
   *  It has to survive being read by someone who did NOT request it, because
   *  anyone can type anyone's address into the form. So it says plainly that
   *  ignoring it leaves the password untouched, and it never states or implies
   *  whether an account exists beyond the fact that this address received mail.
   *  It also never includes the password, old or new — there is none to include.
   */
  password_reset(d = {}) {
    const who = name(d.userName || d.recipientName || d.fullName, "there");
    const minutes = Number(d.expiresInMinutes) > 0 ? Math.round(Number(d.expiresInMinutes)) : 60;
    const address = sanitizeHeader(d.email, 254);
    const link = d.resetUrl || d.url;

    const intro = [
      `Hi ${who},`,
      `We received a request to reset the password for the ${BRAND_NAME} account that uses ${address || "this address"}. Choose a new password with the button below — it takes you straight to a page on our site where you set it and confirm it.`,
    ];
    const outro = [
      `The link works once and expires about ${minutes} minutes after this email was sent. If it has already expired, request a new one from the sign-in page.`,
      `If you did not ask for this, you can ignore this email — your password stays exactly as it is, and nothing changes until the link is opened. ${BRAND_NAME} will never email you asking for your password.`,
    ];

    return {
      subject: sanitizeHeader(`Reset your ${BRAND_NAME} password`),
      html: renderLayout({
        title: `Reset your ${BRAND_NAME} password`,
        preheader: `Set a new password for your ${BRAND_NAME} account. This link expires in ${minutes} minutes.`,
        heading: "Reset your password",
        // Both halves go in the body, above the button: renderLayout emits the
        // CTA last, so anything passed after it would be dropped entirely, and
        // the "you can ignore this" sentence is the one line in the message
        // that must reach a recipient who did not request the reset.
        bodyHtml: paragraphs(...intro, ...outro),
        details: [
          { label: "Account", value: address },
          { label: "Link expires", value: `${minutes} minutes after sending` },
          { label: "Uses", value: "Once" },
        ],
        ctaLabel: "Set a new password",
        ctaUrl: link,
        footerNote: `Sent by ${BRAND_NAME} because a password reset was requested for this address. If that was not you, no action is needed.`,
      }),
      text: textBlock([...intro, ...outro], "Set a new password", link),
    };
  },

  invitation(d = {}) {
    const org = sanitizeHeader(d.orgName, 120);
    const role = sanitizeHeader(d.roleLabel || d.role, 40) || "member";
    const days = Number(d.expiresInDays) > 0 ? Number(d.expiresInDays) : 7;
    const lines = [
      `You have been invited to join ${org || "the workspace"} as a ${role}.`,
      "Accept the invitation to set up your account and get access.",
    ];
    return {
      subject: sanitizeHeader(`You have been invited${org ? ` to ${org}` : ""}`),
      html: renderLayout({
        title: "You are invited",
        orgName: org,
        preheader: `Join ${org || "the workspace"} as a ${role}.`,
        heading: "You are invited",
        bodyHtml: paragraphs(...lines),
        details: [
          { label: "Organization", value: org || "—" },
          { label: "Role", value: role },
          { label: "Expires", value: `${days} day${days === 1 ? "" : "s"} from now` },
        ],
        ctaLabel: "Accept invitation",
        ctaUrl: d.inviteUrl || d.url,
        footerNote: `This invitation expires in ${days} day${days === 1 ? "" : "s"}. If you were not expecting it you can ignore this email.`,
      }),
      text: textBlock([...lines, `This invitation expires in ${days} days.`], "Accept invitation", d.inviteUrl || d.url),
    };
  },

  task_assigned(d = {}) {
    const task = sanitizeHeader(d.taskTitle, 160) || "Untitled task";
    const by = name(d.assignerName, "A teammate");
    const lines = [`${by} assigned a task to you.`, d.note];
    return {
      subject: sanitizeHeader(`Task assigned: ${task}`),
      html: renderLayout({
        title: "Task assigned",
        orgName: sanitizeHeader(d.orgName, 120),
        preheader: task,
        heading: task,
        bodyHtml: paragraphs(...lines),
        details: [
          { label: "Project", value: d.projectName },
          { label: "Assigned by", value: by },
          { label: "Priority", value: d.priority },
          { label: "Due", value: d.dueDate },
        ],
        ctaLabel: "Open task",
        ctaUrl: d.taskUrl || d.url,
        footerNote: "You are receiving this because you are the assignee.",
      }),
      text: textBlock([`${by} assigned "${task}" to you.`, d.note, d.dueDate ? `Due: ${d.dueDate}` : ""], "Open task", d.taskUrl || d.url),
    };
  },

  mention(d = {}) {
    const by = name(d.actorName, "Someone");
    const where = sanitizeHeader(d.contextTitle, 160) || "a discussion";
    const lines = [`${by} mentioned you in ${where}.`, d.excerpt];
    return {
      subject: sanitizeHeader(`${by} mentioned you in ${where}`),
      html: renderLayout({
        title: "You were mentioned",
        orgName: sanitizeHeader(d.orgName, 120),
        preheader: `${by} mentioned you.`,
        heading: `${by} mentioned you`,
        bodyHtml: paragraphs(...lines),
        details: [
          { label: "Where", value: where },
          { label: "Project", value: d.projectName },
        ],
        ctaLabel: "View comment",
        ctaUrl: d.url,
        footerNote: "You are receiving this because you were mentioned by name.",
      }),
      text: textBlock(lines, "View comment", d.url),
    };
  },

  review_requested(d = {}) {
    const task = sanitizeHeader(d.taskTitle, 160) || "a submission";
    const by = name(d.requesterName, "A teammate");
    const lines = [`${by} asked you to review ${task}.`, d.note];
    return {
      subject: sanitizeHeader(`Review requested: ${task}`),
      html: renderLayout({
        title: "Review requested",
        orgName: sanitizeHeader(d.orgName, 120),
        preheader: `${by} requested your review.`,
        heading: "Review requested",
        bodyHtml: paragraphs(...lines),
        details: [
          { label: "Item", value: task },
          { label: "Requested by", value: by },
          { label: "Project", value: d.projectName },
          { label: "Needed by", value: d.dueDate },
        ],
        ctaLabel: "Start review",
        ctaUrl: d.url || d.taskUrl,
        footerNote: "You are receiving this because you were named as a reviewer.",
      }),
      text: textBlock(lines, "Start review", d.url || d.taskUrl),
    };
  },

  approval(d = {}) {
    const item = sanitizeHeader(d.itemTitle || d.taskTitle, 160) || "Your submission";
    const by = name(d.approverName || d.reviewerName, "A reviewer");
    const lines = [`${item} was approved by ${by}.`, d.note];
    return {
      subject: sanitizeHeader(`Approved: ${item}`),
      html: renderLayout({
        title: "Approved",
        orgName: sanitizeHeader(d.orgName, 120),
        preheader: `${item} was approved.`,
        heading: "Approved",
        bodyHtml: paragraphs(...lines),
        details: [
          { label: "Item", value: item },
          { label: "Approved by", value: by },
          { label: "Project", value: d.projectName },
        ],
        ctaLabel: "View details",
        ctaUrl: d.url,
        footerNote: "No further action is needed.",
      }),
      text: textBlock(lines, "View details", d.url),
    };
  },

  rejection(d = {}) {
    const item = sanitizeHeader(d.itemTitle || d.taskTitle, 160) || "Your submission";
    const by = name(d.reviewerName || d.approverName, "A reviewer");
    const reason = d.reason || d.note;
    const lines = [`${item} was sent back by ${by}.`, reason ? `Reason: ${reason}` : "No reason was given."];
    return {
      subject: sanitizeHeader(`Changes requested: ${item}`),
      html: renderLayout({
        title: "Changes requested",
        orgName: sanitizeHeader(d.orgName, 120),
        preheader: `${item} needs changes.`,
        heading: "Changes requested",
        bodyHtml: paragraphs(...lines),
        details: [
          { label: "Item", value: item },
          { label: "Reviewed by", value: by },
          { label: "Project", value: d.projectName },
        ],
        ctaLabel: "Open and revise",
        ctaUrl: d.url,
        footerNote: "Reply to the reviewer in the app so the discussion stays on the item.",
      }),
      text: textBlock(lines, "Open and revise", d.url),
    };
  },

  deadline_reminder(d = {}) {
    const task = sanitizeHeader(d.taskTitle, 160) || "A task";
    const when = sanitizeHeader(d.dueDate, 60);
    const lines = [`${task} is due${when ? ` on ${when}` : " soon"}.`, d.note];
    return {
      subject: sanitizeHeader(`Due soon: ${task}`),
      html: renderLayout({
        title: "Deadline reminder",
        orgName: sanitizeHeader(d.orgName, 120),
        preheader: `${task} is due soon.`,
        heading: "Due soon",
        bodyHtml: paragraphs(...lines),
        details: [
          { label: "Task", value: task },
          { label: "Project", value: d.projectName },
          { label: "Due", value: when },
          { label: "Time left", value: d.timeRemaining },
        ],
        ctaLabel: "Open task",
        ctaUrl: d.url || d.taskUrl,
        footerNote: "Reminders can be turned off per category in your notification preferences.",
      }),
      text: textBlock(lines, "Open task", d.url || d.taskUrl),
    };
  },

  overdue_reminder(d = {}) {
    const task = sanitizeHeader(d.taskTitle, 160) || "A task";
    const when = sanitizeHeader(d.dueDate, 60);
    const late = sanitizeHeader(d.daysOverdue !== undefined ? `${d.daysOverdue} day(s)` : "", 40);
    const lines = [`${task} is past its due date${when ? ` of ${when}` : ""}${late ? ` — ${late} overdue` : ""}.`, d.note];
    return {
      subject: sanitizeHeader(`Overdue: ${task}`),
      html: renderLayout({
        title: "Overdue task",
        orgName: sanitizeHeader(d.orgName, 120),
        preheader: `${task} is overdue.`,
        heading: "This task is overdue",
        bodyHtml: paragraphs(...lines),
        details: [
          { label: "Task", value: task },
          { label: "Project", value: d.projectName },
          { label: "Was due", value: when },
          { label: "Overdue by", value: late },
        ],
        ctaLabel: "Open task",
        ctaUrl: d.url || d.taskUrl,
        footerNote: "Reminders can be turned off per category in your notification preferences.",
      }),
      text: textBlock(lines, "Open task", d.url || d.taskUrl),
    };
  },

  employee_onboarding(d = {}) {
    const who = name(d.employeeName, "there");
    const org = sanitizeHeader(d.orgName, 120);
    const lines = [
      `Hello ${who},`,
      `Your account for ${org || "the workspace"} is ready.`,
      "Sign in to complete your profile and see what is waiting for you.",
    ];
    const steps = Array.isArray(d.checklist) ? d.checklist.slice(0, 8) : [];
    const stepsHtml = steps.length
      ? `<ul style="margin:0 0 12px;padding-left:20px;color:#374151;font-size:14px;line-height:1.6;">${steps
          .map((s) => `<li>${escapeHtml(s, 200)}</li>`)
          .join("")}</ul>`
      : "";
    return {
      subject: sanitizeHeader(`Welcome${org ? ` to ${org}` : ""}, ${who}`),
      html: renderLayout({
        title: "Welcome aboard",
        orgName: org,
        preheader: `Your ${org || "workspace"} account is ready.`,
        heading: "Welcome aboard",
        bodyHtml: paragraphs(...lines) + stepsHtml,
        details: [
          { label: "Role", value: d.roleLabel || d.role },
          { label: "Team", value: d.teamName },
          { label: "Start date", value: d.startDate },
          { label: "Manager", value: d.managerName },
        ],
        ctaLabel: "Sign in",
        ctaUrl: d.url || d.loginUrl,
        footerNote: "If anything looks wrong, contact your HR or workspace administrator.",
      }),
      text: textBlock([...lines, ...steps.map((s) => `- ${s}`)], "Sign in", d.url || d.loginUrl),
    };
  },

  automation(d = {}) {
    const heading = sanitizeHeader(d.heading || d.subject, 160) || "Workflow automation";
    const message = d.message || "An automation rule ran on an item you follow.";
    return {
      subject: sanitizeHeader(d.subject || heading),
      html: renderLayout({
        title: "Automation",
        orgName: sanitizeHeader(d.orgName, 120),
        preheader: heading,
        heading,
        bodyHtml: paragraphs(message),
        details: [
          { label: "Rule", value: d.ruleName },
          { label: "Task", value: d.taskTitle },
          { label: "Project", value: d.projectName },
        ],
        ctaLabel: d.url ? "Open in app" : "",
        ctaUrl: d.url,
        footerNote: "Sent by an automation rule in your workspace.",
      }),
      text: textBlock([heading, message], "Open in app", d.url),
    };
  },
};

/** The template ids this module knows how to render. */
export const TEMPLATE_NAMES = Object.keys(TEMPLATES);

/**
 * Render a template by id.
 *
 * An unknown id falls back to `automation` (the most generic shape) rather
 * than throwing — a typo'd template name must not take down the send path.
 */
export function renderTemplate(templateName, data = {}) {
  const key = String(templateName || "").trim();
  const fn = TEMPLATES[key] || TEMPLATES.automation;
  const rendered = fn(data || {});
  return {
    template: TEMPLATES[key] ? key : "automation",
    subject: sanitizeHeader(data?.subjectOverride || rendered.subject),
    html: rendered.html,
    text: rendered.text,
  };
}

const emailTemplates = { TEMPLATES, TEMPLATE_NAMES, renderTemplate, renderLayout, escapeHtml, safeUrl, sanitizeHeader };

export default emailTemplates;
