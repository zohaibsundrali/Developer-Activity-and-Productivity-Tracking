import { NextResponse } from "next/server";
import {
  getAuthedClient,
  clientCanAccessProject,
  serviceClient,
} from "@/utils/serverAuth";

export const dynamic = "force-dynamic";

const VALID_DECISIONS = new Set(["approved", "rejected"]);

/**
 * Tell the staff side that the client has decided.
 *
 * A decision that nobody is told about is a decision that does not happen: the
 * author is the person who has been waiting on the answer, and when the
 * approval points at a task, its assignee is the person who has to act on a
 * rejection — usually not the same person.
 *
 * Notifications are written directly here rather than through utils/notifications,
 * which reads the signed-in org context out of sessionStorage and so resolves to
 * nothing on the server; the review and cron routes insert the same way.
 */
async function notifyApprovalDecision(svc, { orgId, approval, clientId }) {
  const approved = approval.status === "approved";

  const [{ data: task }, { data: client }] = await Promise.all([
    // item_ref is a bare uuid that may point at a task, a submission or an
    // invoice. Looking it up as a task and finding nothing is the answer to
    // "does this approval name a task", and costs one read either way.
    approval.item_ref
      ? svc
          .from("developer_tasks")
          .select("id, task_title, developer_id, project_id")
          .eq("organization_id", orgId)
          .eq("id", approval.item_ref)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    svc.from("clients").select("id, name, email").eq("organization_id", orgId).eq("id", clientId).maybeSingle(),
  ]);

  // The notifications table addresses admins by id and email and developers by
  // id, and only the membership row says which of the two an id is — one read
  // covers the author and the assignee together.
  const staffIds = [...new Set([approval.created_by, task?.developer_id].filter(Boolean).map(String))];
  if (!staffIds.length) return;

  const { data: members } = await svc
    .from("memberships")
    .select("user_id, user_type, email")
    .eq("organization_id", orgId)
    .neq("user_type", "client")
    .in("user_id", staffIds);
  if (!members?.length) return;

  const clientName = client?.name || client?.email || "The client";
  const subject = approval.title || "an approval";
  // The note is the whole point of a rejection — a request for changes with the
  // reason stripped out sends someone back to ask what was wrong.
  const note = approval.note ? String(approval.note).replace(/\s+/g, " ").trim() : null;
  const metadata = {
    approvalId: approval.id,
    approvalTitle: approval.title || null,
    itemType: approval.item_type || null,
    decision: approval.status,
    decidedAt: approval.decided_at || null,
    clientId: client?.id || clientId || null,
    clientName: client?.name || null,
    note,
    taskId: task?.id || null,
    taskTitle: task?.task_title || null,
  };

  const rows = members.map((m) => {
    const isAdmin = m.user_type === "admin";
    const row = {
      organization_id: orgId,
      category: "review",
      type: approved ? "client_approved" : "client_changes_requested",
      title: approved ? "Client approved" : "Client requested changes",
      message: approved
        ? `${clientName} approved "${subject}".`
        : `${clientName} requested changes to "${subject}".${note ? ` Reason: ${note}` : ""}`,
      project_id: approval.project_id || null,
      task_id: task?.id || null,
      entity_type: "approval",
      entity_id: approval.id,
      metadata,
      // actor_id is deliberately left unset. Migration 034's mute trigger
      // resolves an admin-addressed row's recipient as
      // coalesce(developer_id, assigned_developer_id, actor_id), so naming the
      // client here would apply the CLIENT's notification preferences to a
      // staff member's row and silently drop it. Who decided is in the message
      // and in metadata, which is where the UI reads it from anyway.
      dedupe_key: `approval_${approval.status}:${approval.id}:${m.user_id}`,
      read: false,
    };
    if (isAdmin) {
      row.admin_id = String(m.user_id);
      row.admin_email = m.email || null;
    } else {
      row.developer_id = m.user_id;
      row.assigned_developer_id = m.user_id;
    }
    return row;
  });

  // A client may revisit a decision, so some of these keys can already exist —
  // and one duplicate in a batched insert rejects the whole batch, which would
  // lose the notifications that were new. One lookup for the set, not one per
  // recipient.
  const { data: existing } = await svc
    .from("notifications")
    .select("dedupe_key")
    .in("dedupe_key", rows.map((r) => r.dedupe_key));
  const already = new Set((existing || []).map((r) => r.dedupe_key));
  const fresh = rows.filter((r) => !already.has(r.dedupe_key));
  if (!fresh.length) return;

  const { error } = await svc.from("notifications").insert(fresh);
  if (error) console.error("[client/approvals/:id] Notification insert error:", error);
}

// POST /api/client/approvals/[id]
// The client decides an approval item (approve / reject) for one of their
// linked projects. Clients may only write here and to support.
export async function POST(request, { params }) {
  try {
    const auth = await getAuthedClient(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const approvalId = params?.id;
    if (!approvalId) {
      return NextResponse.json({ error: "Missing approval id" }, { status: 400 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const decision = body?.decision;
    const note = typeof body?.note === "string" ? body.note : null;

    if (!VALID_DECISIONS.has(decision)) {
      return NextResponse.json(
        { error: "decision must be 'approved' or 'rejected'" },
        { status: 400 }
      );
    }

    const svc = serviceClient();
    const { data: approval, error: fetchError } = await svc
      .from("approvals")
      // created_by is read here, on the row that stays server side, rather than
      // added to the updated row returned below — that response goes to the
      // client, who has no business knowing which staff member raised the
      // request.
      .select("id, project_id, created_by")
      .eq("organization_id", auth.orgId)
      .eq("id", approvalId)
      .single();

    if (fetchError || !approval) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (!clientCanAccessProject(auth, approval.project_id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: updated, error: updateError } = await svc
      .from("approvals")
      .update({
        status: decision,
        decided_by: auth.clientId,
        decided_at: new Date().toISOString(),
        note,
      })
      .eq("id", approvalId)
      .eq("organization_id", auth.orgId)
      .select(
        "id, project_id, item_type, item_ref, title, description, status, decided_by, decided_at, note, created_at"
      )
      .single();

    if (updateError || !updated) {
      console.error("[client/approvals/:id] Update error:", updateError);
      return NextResponse.json({ error: "Failed to record decision" }, { status: 500 });
    }

    // The decision is recorded. Failing to announce it must not turn a
    // successful decision into a 500 for the client who just made it.
    try {
      await notifyApprovalDecision(svc, {
        orgId: auth.orgId,
        approval: { ...updated, created_by: approval.created_by },
        clientId: auth.clientId,
      });
    } catch (notifyError) {
      console.error("[client/approvals/:id] Notification error:", notifyError);
    }

    return NextResponse.json({ approval: updated });
  } catch (err) {
    console.error("[client/approvals/:id] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
