import { NextResponse } from "next/server";
import {
  getAuthedClient,
  clientCanAccessProject,
  serviceClient,
} from "@/utils/serverAuth";
import { buildApproval } from "@/app/api/client/_lib/shapes";

export const dynamic = "force-dynamic";

// The four things a client can do to an approval item, and what each one means
// for the approvals row and for the audit trail.
//   status: null  -> a comment does not change the decision, it only records one
//   requiresNote  -> a decision the team cannot act on is not a decision
const ACTIONS = {
  approve: { status: "approved", event: "approved", requiresNote: false },
  request_changes: { status: "changes_requested", event: "changes_requested", requiresNote: true },
  reject: { status: "rejected", event: "rejected", requiresNote: true },
  comment: { status: null, event: "commented", requiresNote: false },
};

const APPROVAL_FIELDS = "id, project_id, item_type, title, description, status, created_at";

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
      .select("id, project_id")
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
