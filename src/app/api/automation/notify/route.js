import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { checkFeatureAccess } from "@/utils/entitlements";
import { sendTemplatedEmail, emailMode } from "@/utils/emailService";

export const dynamic = "force-dynamic";

/**
 * Automation notification / email fan-out.
 *
 * POST { userIds: string[], taskId?, subject?, message?, sendEmail?: boolean }
 *
 * Security: the caller must be an authenticated org member, and every recipient
 * is re-checked against `memberships` for the SAME organization before anything
 * is written or emailed. That keeps this from being an open relay — a caller can
 * only notify people inside their own org.
 */
export async function POST(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Clients must never drive internal automations.
    if (auth.userType === "client") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const userIds = Array.isArray(body.userIds) ? body.userIds.filter(Boolean).slice(0, 50) : [];
    const { taskId = null, subject = "Task update", message = "", sendEmail = false } = body;

    if (!userIds.length) {
      return NextResponse.json({ error: "userIds required" }, { status: 400 });
    }

    const svc = serviceClient();

    // Automation is a paid capability. Without this the plan cards advertise a
    // restriction that does not exist — a free organization could drive the
    // whole automation engine and only the struck-through text in the billing
    // page would say otherwise.
    const gate = await checkFeatureAccess(svc, auth.orgId, "automation", "Automation");
    if (gate) {
      return NextResponse.json(gate, { status: gate.status });
    }

    // ── Recipients must belong to the caller's organization ──
    const { data: members, error: memErr } = await svc
      .from("memberships")
      .select("user_id, user_type, email, role")
      .eq("organization_id", auth.orgId)
      .in("user_id", userIds);
    if (memErr) {
      return NextResponse.json({ error: memErr.message }, { status: 500 });
    }
    const allowed = members || [];
    if (!allowed.length) {
      return NextResponse.json({ error: "No valid recipients in your organization" }, { status: 400 });
    }

    // ── Resolve task + org context for the message ──
    let task = null;
    if (taskId) {
      const { data } = await svc
        .from("developer_tasks")
        .select("id, task_title, project_id, organization_id")
        .eq("id", taskId)
        .eq("organization_id", auth.orgId)
        .maybeSingle();
      task = data || null;
    }
    const { data: org } = await svc
      .from("organizations")
      .select("name")
      .eq("id", auth.orgId)
      .maybeSingle();

    // ── Insert in-app notifications ──
    const rows = allowed.map((m) => ({
      organization_id: auth.orgId,
      developer_id: m.user_id,
      type: "automation",
      title: subject,
      message: message || `Task "${task?.task_title || "Untitled"}" was updated.`,
      project_id: task?.project_id || null,
      task_id: task?.id || null,
    }));
    const { error: notifErr } = await svc.from("notifications").insert(rows);
    if (notifErr) {
      return NextResponse.json({ error: notifErr.message }, { status: 500 });
    }

    // ── Optional email (best-effort; never fails the request) ──
    let emailed = 0;
    let emailSkipped = null;
    let mode = null;
    if (sendEmail) {
      // No provider check up front: with none configured the send falls
      // through to the mock, which records every message in email_log. That is
      // the difference between "we skipped it" and "we have no idea".
      mode = emailMode();
      if (mode === "mock") {
        emailSkipped = "No email provider configured (RESEND_API_KEY / GMAIL_* unset) — recorded in email_log";
      }

      // Resolve real addresses: membership.email, else the developers/admin_users row.
      const missing = allowed.filter((m) => !m.email);
      const emailById = new Map(allowed.filter((m) => m.email).map((m) => [m.user_id, m.email]));
      if (missing.length) {
        const devIds = missing.filter((m) => m.user_type !== "admin").map((m) => m.user_id);
        const adminIds = missing.filter((m) => m.user_type === "admin").map((m) => m.user_id);
        if (devIds.length) {
          const { data } = await svc.from("developers").select("id, email").in("id", devIds);
          (data || []).forEach((d) => d.email && emailById.set(d.id, d.email));
        }
        if (adminIds.length) {
          const { data } = await svc.from("admin_users").select("id, email").in("id", adminIds);
          (data || []).forEach((a) => a.email && emailById.set(a.id, a.email));
        }
      }

      for (const to of emailById.values()) {
        try {
          const res = await sendTemplatedEmail({
            template: "automation",
            to,
            organizationId: auth.orgId,
            subject,
            data: {
              orgName: org?.name || "Your workspace",
              subject,
              heading: subject,
              message: message || `Task "${task?.task_title || "Untitled"}" was updated.`,
              taskTitle: task?.task_title || "",
            },
          });
          if (res?.delivered) emailed += 1;
        } catch {
          /* per-recipient failure is non-fatal */
        }
      }
    }

    return NextResponse.json({
      ok: true,
      notified: rows.length,
      emailed,
      ...(mode ? { emailMode: mode } : {}),
      ...(emailSkipped ? { emailSkipped } : {}),
    });
  } catch (err) {
    return NextResponse.json({ error: err?.message || "Unexpected error" }, { status: 500 });
  }
}
