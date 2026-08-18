import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { requirePermission } from "@/utils/serverPermissions";
import { sendMail, notifyEmailHtml } from "@/utils/mailer";

export const dynamic = "force-dynamic";

// Only staff (never a client) may trigger client notifications.

const SUBJECTS = {
  announcement: "New announcement",
  invoice: "New invoice",
  approval: "Approval requested",
  update: "Project update",
};

// POST /api/notify/client
// Body: { kind, title, message, projectId?, clientId? }
//  - clientId  → email that one client
//  - projectId → email every client linked to that project
//  - neither   → email every active client in the org (e.g. org-wide announcement)
// Recipients are BCC'd (hidden from each other). Best-effort: email failures
// never block the underlying admin action.
export async function POST(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // Permission, not a role list. See utils/permissionCatalogue.js — the
    // hand-typed array this replaces was one of fifteen, and roles added to the
    // product reached some of them and not others.
    const denied = requirePermission(auth, "client.notify");
    if (denied) return denied;

    const { kind, title, message, projectId, clientId } = await request.json().catch(() => ({}));
    const svc = serviceClient();

    // Resolve recipient client emails — always scoped to the caller's org.
    let emails = [];
    if (clientId) {
      const { data } = await svc
        .from("clients")
        .select("email")
        .eq("organization_id", auth.orgId)
        .eq("id", clientId);
      emails = (data || []).map((c) => c.email);
    } else if (projectId) {
      const { data: links } = await svc
        .from("project_clients")
        .select("client_id")
        .eq("organization_id", auth.orgId)
        .eq("project_id", projectId);
      const ids = (links || []).map((l) => l.client_id).filter(Boolean);
      if (ids.length) {
        const { data } = await svc
          .from("clients")
          .select("email")
          .eq("organization_id", auth.orgId)
          .in("id", ids);
        emails = (data || []).map((c) => c.email);
      }
    } else {
      const { data } = await svc
        .from("clients")
        .select("email")
        .eq("organization_id", auth.orgId)
        .eq("status", "active");
      emails = (data || []).map((c) => c.email);
    }

    emails = [...new Set(emails.filter(Boolean))];

    if (emails.length === 0) {
      return NextResponse.json({ ok: true, sent: 0 });
    }

    const { data: org } = await svc
      .from("organizations")
      .select("name")
      .eq("id", auth.orgId)
      .maybeSingle();
    const orgName = org?.name || "Your project";

    const subject = `${SUBJECTS[kind] || SUBJECTS.update}${orgName ? ` — ${orgName}` : ""}`;
    const base = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "";
    const html = notifyEmailHtml({
      orgName,
      heading: title || subject,
      body: message || "",
      ctaLabel: "Open client portal",
      ctaUrl: base ? `${base.replace(/\/$/, "")}/login` : "",
    });

    // No "mailer not configured" early return any more. With no provider the
    // send falls through to the mock, which records the message in email_log —
    // an unconfigured deploy now leaves a trace instead of silently dropping.
    // `delivered` (not `ok`) is what makes `sent` an honest count.
    const r = await sendMail({ bcc: emails, subject, html, organizationId: auth.orgId, template: `client_${kind || "update"}` });
    return NextResponse.json({
      ok: r.ok,
      sent: r.delivered ? emails.length : 0,
      recipients: emails.length,
      mode: r.mode,
      ...(r.skipped ? { skipped: true, reason: r.reason } : {}),
      error: r.error,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "notify failed" }, { status: 500 });
  }
}
