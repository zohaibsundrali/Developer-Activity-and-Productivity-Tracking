import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { sendMail, notifyEmailHtml, mailerConfigured } from "@/utils/mailer";

export const dynamic = "force-dynamic";

// Only staff (never a client) may trigger client notifications.
const STAFF_ROLES = ["owner", "admin", "manager"];

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
    if (auth.userType === "client" || auth.role === "client" || !STAFF_ROLES.includes(auth.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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

    if (!mailerConfigured()) {
      return NextResponse.json({ ok: false, skipped: true, reason: "mailer not configured", recipients: emails.length });
    }
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

    const r = await sendMail({ bcc: emails, subject, html });
    return NextResponse.json({ ok: r.ok, sent: r.ok ? emails.length : 0, error: r.error });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "notify failed" }, { status: 500 });
  }
}
