import { NextResponse } from "next/server";
import {
  getAuthedClient,
  clientCanAccessProject,
  serviceClient,
} from "@/utils/serverAuth";
import { buildApproval } from "@/app/api/client/_lib/shapes";

export const dynamic = "force-dynamic";

// The four things a client can do to an approval item, and what each one means
// for the approvals row, for the audit trail, and for the task the item refers
// to.
//   status: null     -> a comment does not change the decision, it only records one
//   requiresNote     -> a decision the team cannot act on is not a decision
//   taskApproval     -> what the team's board is told; null leaves the task alone
const ACTIONS = {
  approve: {
    status: "approved",
    event: "approved",
    requiresNote: false,
    taskApproval: "approved",
  },
  request_changes: {
    status: "changes_requested",
    event: "changes_requested",
    requiresNote: true,
    taskApproval: "changes_requested",
  },
  reject: {
    status: "rejected",
    event: "rejected",
    requiresNote: true,
    taskApproval: "rejected",
  },
  comment: { status: null, event: "commented", requiresNote: false, taskApproval: null },
};

const APPROVAL_FIELDS = "id, project_id, item_type, title, description, status, created_at";

// Item types whose `item_ref` is meant to name a row in developer_tasks. An
// invoice or a milestone references an entirely different table, and a uuid
// from one of those must never be used as a task id. "deliverable" is included
// because it is the default type and the one the team uses when it asks for
// sign-off on a piece of work; what actually decides the question is the lookup
// below, which only ever matches when the reference really is a task.
const TASK_ITEM_TYPES = new Set(["task", "developer_task", "deliverable"]);

// Mirror the client's decision onto the task the approval points at, so the
// team reads it on their own board instead of only in the portal.
//
// The write goes through the service role because a client has no update policy
// on developer_tasks - being allowed to say "this is not what I asked for" is
// not the same as being allowed to edit the team's work item.
//
// `status` is deliberately never in the patch. The review pipeline belongs to
// the team, and letting a client decision move a task through it would drive
// straight past the transition guards migration 021 exists to enforce; the
// client's verdict lives in its own column and is read alongside the pipeline,
// not inside it.
async function stampTaskApproval({ svc, auth, approval, taskApproval, note, decidedAt }) {
  if (!taskApproval) return; // a comment records something, it decides nothing
  if (!TASK_ITEM_TYPES.has(String(approval?.item_type || "").toLowerCase())) return;

  const taskId = approval?.item_ref;
  if (!taskId) return;

  try {
    // Two conditions, neither of them taken from the request body. The approval
    // row names the task, but an approval row can be stale or wrong, so the task
    // must independently sit in the caller's organization AND in a project this
    // client is allow-listed for. Reading the task first is what makes both
    // checkable: without it the update would be a blind write against whatever
    // uuid `item_ref` happens to hold.
    const { data: task, error: taskError } = await svc
      .from("developer_tasks")
      .select("id, project_id")
      .eq("id", taskId)
      .eq("organization_id", auth.orgId)
      .maybeSingle();

    if (taskError || !task) return;
    if (!clientCanAccessProject(auth, task.project_id)) return;

    const { error: stampError } = await svc
      .from("developer_tasks")
      .update({
        client_approval_status: taskApproval,
        client_approval_note: note || null,
        client_approval_at: decidedAt,
      })
      .eq("id", task.id)
      .eq("organization_id", auth.orgId);

    if (stampError) {
      console.error("[client/approvals/:id] Task stamp error:", stampError);
    }
  } catch (err) {
    // The decision is already in `approvals` and in the audit trail by the time
    // this runs. Failing the response now would tell the client their decision
    // did not land while the record says it did, so the mirror is best-effort
    // and loud in the log rather than fatal to the request.
    console.error("[client/approvals/:id] Task stamp error:", err);
  }
}

// POST /api/client/approvals/[id]
// Body: { action: "approve" | "request_changes" | "reject" | "comment", note? }
// The client decides an approval item on one of their linked projects. Every
// call appends an approval_events row with the SERVICE ROLE: the client has no
// insert policy on that table, because an audit trail the audited party can
// write is not an audit trail.
export async function POST(request, { params }) {
  try {
    const auth = await getAuthedClient(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const approvalId = params?.id;
    if (!approvalId) {
      return NextResponse.json(
        { success: false, error: "Missing approval id" },
        { status: 400 }
      );
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      payload = {};
    }

    const action = ACTIONS[payload?.action];
    if (!action) {
      return NextResponse.json(
        {
          success: false,
          error: "action must be 'approve', 'request_changes', 'reject' or 'comment'",
        },
        { status: 400 }
      );
    }

    const note = typeof payload?.note === "string" ? payload.note.trim() : "";
    if (action.requiresNote && !note) {
      return NextResponse.json(
        { success: false, error: "A note is required for this action" },
        { status: 400 }
      );
    }

    const svc = serviceClient();
    const { data: approval, error: fetchError } = await svc
      .from("approvals")
      .select("id, project_id, item_type, item_ref")
      .eq("organization_id", auth.orgId)
      .eq("id", approvalId)
      .single();

    if (fetchError || !approval) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }

    if (!clientCanAccessProject(auth, approval.project_id)) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    // The actor name recorded in the trail comes from the client's own row, not
    // from the request body.
    const { data: client } = await svc
      .from("clients")
      .select("id, name")
      .eq("organization_id", auth.orgId)
      .eq("id", auth.clientId)
      .maybeSingle();

    const decidedAt = new Date().toISOString();

    // A comment leaves the decision exactly as it was; the other three actions
    // move it and stamp who decided and when.
    let decided = approval;
    if (action.status) {
      const { data: updated, error: updateError } = await svc
        .from("approvals")
        .update({
          status: action.status,
          decided_by: auth.clientId,
          decided_at: decidedAt,
          note: note || null,
        })
        .eq("id", approvalId)
        .eq("organization_id", auth.orgId)
        .select(APPROVAL_FIELDS)
        .single();

      if (updateError || !updated) {
        console.error("[client/approvals/:id] Update error:", updateError);
        return NextResponse.json(
          { success: false, error: "Failed to record decision" },
          { status: 500 }
        );
      }
      decided = updated;
    } else {
      const { data: current, error: currentError } = await svc
        .from("approvals")
        .select(APPROVAL_FIELDS)
        .eq("organization_id", auth.orgId)
        .eq("id", approvalId)
        .single();

      if (currentError || !current) {
        console.error("[client/approvals/:id] Reload error:", currentError);
        return NextResponse.json(
          { success: false, error: "Failed to record decision" },
          { status: 500 }
        );
      }
      decided = current;
    }

    const { error: eventError } = await svc.from("approval_events").insert({
      organization_id: auth.orgId,
      approval_id: approvalId,
      project_id: approval.project_id,
      actor_id: auth.clientId,
      actor_type: "client",
      actor_name: client?.name || "Client",
      action: action.event,
      note: note || null,
    });

    if (eventError) {
      console.error("[client/approvals/:id] Audit error:", eventError);
      return NextResponse.json(
        { success: false, error: "Failed to record decision" },
        { status: 500 }
      );
    }

    await stampTaskApproval({
      svc,
      auth,
      approval,
      taskApproval: action.taskApproval,
      note,
      decidedAt,
    });

    const { data: project, error: projectError } = await svc
      .from("projects")
      .select("id, name")
      .eq("organization_id", auth.orgId)
      .eq("id", approval.project_id)
      .maybeSingle();

    if (projectError) {
      console.error("[client/approvals/:id] Project error:", projectError);
      return NextResponse.json(
        { success: false, error: "Failed to record decision" },
        { status: 500 }
      );
    }

    // Return the approval in the same shape the list route uses, history
    // included, so the caller never has to refetch to show the new round.
    const { data: events, error: eventsError } = await svc
      .from("approval_events")
      .select("id, approval_id, action, note, actor_name, created_at")
      .eq("organization_id", auth.orgId)
      .eq("approval_id", approvalId)
      .order("created_at", { ascending: false });

    if (eventsError) {
      console.error("[client/approvals/:id] History error:", eventsError);
      return NextResponse.json(
        { success: false, error: "Failed to record decision" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      approval: buildApproval({
        approval: decided,
        projectName: project?.name,
        events: events || [],
      }),
    });
  } catch (err) {
    console.error("[client/approvals/:id] Error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
