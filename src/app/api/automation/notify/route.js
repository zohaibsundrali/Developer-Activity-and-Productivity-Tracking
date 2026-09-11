import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { requirePermission } from "@/utils/serverPermissions";
import { loadOverrides } from "@/utils/permissionOverrides";
import { canReceiveTaskNotification } from "@/utils/taskNotificationAccess";
import { checkFeatureAccess } from "@/utils/entitlements";
import { sendTemplatedEmail, emailMode } from "@/utils/emailService";

export const dynamic = "force-dynamic";

/**
 * Automation notification / email fan-out.
 *
 * POST { userIds: string[], taskId?, subject?, message?, sendEmail?: boolean }
 *
 * Security: the caller must hold `automation.manage`, and every recipient is
 * re-checked against `memberships` for the SAME organization before anything is
 * written or emailed. That keeps this from being an open relay — a caller can
 * only notify people inside their own org.
 *
 * THE PERMISSION USED TO BE MISSING. The whole gate was "authenticated, and not
 * a client", so every developer, designer and QA in the organization could POST
 * fifty colleague ids with `sendEmail: true` and fan out in-app notifications
 * AND email from the company's own sending domain. `automation.manage` existed
 * and was enforced in exactly one place — the sidebar map in
 * components/shell/sectionAccess.js — so the screen that drives this route was
 * hidden from them while the route itself answered 200. Hiding a menu entry has
 * never been security; the gate belongs here, where the send happens.
 */
export async function POST(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Clients must never drive internal automations. requirePermission refuses
    // them too; this stays because it says so at the top of the file rather
    // than as a consequence of a role list.
    if (auth.userType === "client") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // Sending on behalf of the organization is an owner/admin capability.
    // Permission, not a role list — see utils/permissionCatalogue.js.
    const denied = requirePermission(auth, "automation.manage");
    if (denied) return denied;

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid notification" }, { status: 400 });
    }
    const userIds = Array.isArray(body.userIds) ? [...new Set(body.userIds)] : [];
    const { taskId = null, subject = "Task update", message = "", sendEmail = false } = body;

    if (!userIds.length || body.userIds.length > 50 ||
        userIds.some((id) => typeof id !== "string" || !id.trim()) ||
        (taskId !== null && (typeof taskId !== "string" || !taskId.trim())) ||
        typeof subject !== "string" || !subject.trim() || subject.length > 500 ||
        typeof message !== "string" || message.length > 20000 || typeof sendEmail !== "boolean") {
      return NextResponse.json({ error: "Invalid notification fields" }, { status: 400 });
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
      .select("user_id, user_type, email, role, status")
      .eq("organization_id", auth.orgId)
      .eq("status", "active")
      .in("user_type", ["admin", "developer"])
      .in("user_id", userIds);
    if (memErr) {
      return NextResponse.json({ error: "Notification recipients unavailable" }, { status: 500 });
    }
    let allowed = (members || []).filter((member) =>
      member.status === "active" && ["admin", "developer"].includes(member.user_type));
    if (!allowed.length) {
      return NextResponse.json({ error: "No valid recipients in your organization" }, { status: 400 });
    }

    // ── Resolve task + org context for the message ──
    let task = null;
    if (taskId) {
      const { data, error } = await svc
        .from("developer_tasks")
        .select("id, task_title, project_id, organization_id, developer_id")
        .eq("id", taskId)
        .eq("organization_id", auth.orgId)
        .maybeSingle();
      if (error) return NextResponse.json({ error: "Task lookup unavailable" }, { status: 503 });
      if (!data) return NextResponse.json({ error: "Task not found" }, { status: 404 });
      task = data;
      if (!canReceiveTaskNotification(auth, task)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      try {
        const eligible = await Promise.all(allowed.map(async (member) => {
          const subject = { orgId: auth.orgId, appUserId: member.user_id,
            userType: member.user_type, role: member.role };
          subject.overrides = await loadOverrides(svc, subject);
          return canReceiveTaskNotification(subject, task) ? member : null;
        }));
        allowed = eligible.filter(Boolean);
      } catch {
        return NextResponse.json({ error: "Recipient permissions unavailable" }, { status: 503 });
      }
      if (!allowed.length) {
        return NextResponse.json({ error: "No recipients can access this task" }, { status: 403 });
      }
    }
    const { data: org } = await svc
      .from("organizations")
      .select("name")
      .eq("id", auth.orgId)
      .maybeSingle();

    // ── Insert in-app notifications ──
    const rows = allowed.map((m) => ({
      organization_id: auth.orgId,
      ...(m.user_type === "admin" ? { admin_id: m.user_id, admin_recipient_type: "admin" } : { developer_id: m.user_id }),
      type: "automation",
      title: subject,
      message: message || `Task "${task?.task_title || "Untitled"}" was updated.`,
      project_id: task?.project_id || null,
      task_id: task?.id || null,
    }));
    const { data: inserted, error: notifErr } = await svc.from("notifications").insert(rows).select("id");
    if (notifErr) {
      return NextResponse.json({ error: "Could not create notifications" }, { status: 500 });
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
      const emailById = new Map(allowed.filter((m) => m.email).map((m) => [`${m.user_type}:${m.user_id}`, m.email]));
      if (missing.length) {
        const devIds = missing.filter((m) => m.user_type !== "admin").map((m) => m.user_id);
        const adminIds = missing.filter((m) => m.user_type === "admin").map((m) => m.user_id);
        if (devIds.length) {
          const { data, error } = await svc.from("developers").select("id, email").eq("organization_id", auth.orgId).in("id", devIds);
          if (error) emailSkipped = "Some recipient email addresses could not be resolved";
          (error ? [] : data || []).forEach((d) => d.email && emailById.set(`developer:${d.id}`, d.email));
        }
        if (adminIds.length) {
          const { data, error } = await svc.from("admin_users").select("id, email").eq("organization_id", auth.orgId).in("id", adminIds);
          if (error) emailSkipped = "Some recipient email addresses could not be resolved";
          (error ? [] : data || []).forEach((a) => a.email && emailById.set(`admin:${a.id}`, a.email));
        }
      }

      for (const to of new Set(emailById.values())) {
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
      notified: inserted?.length || 0,
      emailed,
      ...(mode ? { emailMode: mode } : {}),
      ...(emailSkipped ? { emailSkipped } : {}),
    });
  } catch (err) {
    return NextResponse.json({ error: "Notification failed" }, { status: 500 });
  }
}
