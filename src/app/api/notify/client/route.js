import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { requirePermission } from "@/utils/serverPermissions";
import { checkFeatureAccess } from "@/utils/entitlements";
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

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid notification" }, { status: 400 });
    }
    const { kind = "update", title, message, projectId, clientId } = body;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof kind !== "string" || !Object.hasOwn(SUBJECTS, kind) ||
        [title, message].some((value) => value != null && typeof value !== "string") ||
        (title?.length || 0) > 500 || (message?.length || 0) > 20000 ||
        [projectId, clientId].some((id) => id != null && (typeof id !== "string" || !uuid.test(id))) ||
        (kind === "invoice" && !clientId)) {
      return NextResponse.json({ error: "Invalid notification fields; invoices require a client" }, { status: 400 });
    }
    const svc = serviceClient();
    const gate = await checkFeatureAccess(svc, auth.orgId, "client_portal", "Client portal");
    if (gate) return NextResponse.json(gate, { status: gate.status });
    const unavailable = () => NextResponse.json({ error: "Notification recipients unavailable" }, { status: 503 });

    let linkedIds = null;
    if (projectId) {
      const project = await svc.from("projects").select("id")
        .eq("organization_id", auth.orgId).eq("id", projectId).maybeSingle();
      if (project.error) return unavailable();
      if (!project.data) return NextResponse.json({ error: "Project not found" }, { status: 404 });
      // Invoices belong to their named client; other project messages belong
      // only to linked clients. Never broadcast an invoice to a project/org.
      if (kind !== "invoice") {
        const links = await svc.from("project_clients").select("client_id")
          .eq("organization_id", auth.orgId).eq("project_id", projectId);
        if (links.error) return unavailable();
        linkedIds = (links.data || []).map((link) => link.client_id);
        if (clientId && !linkedIds.includes(clientId)) {
          return NextResponse.json({ error: "Client is not linked to this project" }, { status: 403 });
        }
        if (!linkedIds.length) return NextResponse.json({ ok: true, sent: 0 });
      }
    }
    let query = svc.from("clients").select("id, email")
      .eq("organization_id", auth.orgId).eq("status", "active");
    if (clientId) query = query.eq("id", clientId);
    else if (linkedIds) query = query.in("id", linkedIds);
    const clients = await query;
    if (clients.error) return unavailable();
    let emails = [];
    if (clients.data?.length) {
      const members = await svc.from("memberships").select("user_id")
        .eq("organization_id", auth.orgId).eq("user_type", "client")
        .eq("status", "active").in("user_id", clients.data.map((client) => client.id));
      if (members.error) return unavailable();
      const active = new Set((members.data || []).map((member) => member.user_id));
      emails = [...new Set(clients.data.filter((client) => active.has(client.id))
        .map((client) => client.email?.trim().toLowerCase()).filter(Boolean))];
    }
    if (!emails.length) return NextResponse.json({ ok: true, sent: 0 });

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
