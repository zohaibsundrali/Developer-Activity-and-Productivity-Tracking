import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { requireUnlocked } from "@/utils/entitlements";

export const dynamic = "force-dynamic";

/**
 * POST /api/proposals/[id]/decide — accept, reject, or ask for more.
 *
 * WHY THIS IS A SERVER ROUTE AND NOT FOUR BROWSER WRITES
 *
 * Accepting a proposal is not one write. It is: create the project, link the
 * client to it so they can see it, point the proposal at the project, record
 * the decision, assign a project manager, and tell the client. Done from the
 * browser those are five round trips, and the interesting question is what the
 * product looks like when the third one fails — a project exists, the client
 * cannot see it, and the proposal still says "submitted". Nobody would
 * reproduce that on purpose, and it would be blamed on the client's browser.
 *
 * PostgREST gives no multi-statement transaction, so this cannot be truly
 * atomic without a database function. What it can do, and does, is order the
 * writes so that a failure leaves a state somebody can act on, and undo the
 * project if the step that makes it visible fails. The proposal is flipped to
 * `accepted` LAST, so the row only ever claims success once the work behind it
 * is real — and the trigger in database/059 refuses an `accepted` row with no
 * project, which is the backstop for the case this ordering misses.
 */

const DECISIONS = ["accepted", "rejected", "needs_info", "in_review"];
const DECIDER_ROLES = ["owner", "admin", "manager"];

export async function POST(request, { params }) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (auth.userType === "client" || !DECIDER_ROLES.includes(auth.role)) {
      return NextResponse.json(
        { error: "Your role cannot decide proposals." },
        { status: 403 }
      );
    }

    const proposalId = params?.id;
    const body = await request.json().catch(() => ({}));
    const decision = String(body.decision || "");
    const reason = String(body.reason || "").trim();
    const managerId = body.managerId || null;

    if (!proposalId || !DECISIONS.includes(decision)) {
      return NextResponse.json({ error: "Unknown decision." }, { status: 400 });
    }
    // The database enforces this too (database/059's guard trigger). Checked
    // here as well so the person gets a sentence instead of a constraint name.
    if ((decision === "rejected" || decision === "needs_info") && !reason) {
      return NextResponse.json(
        { error: "Say why — the client will read this." },
        { status: 400 }
      );
    }

    const svc = serviceClient();

    const { data: proposal, error: readErr } = await svc
      .from("project_proposals")
      .select("*")
      .eq("id", proposalId)
      .eq("organization_id", auth.orgId)
      .maybeSingle();

    if (readErr) throw readErr;
    if (!proposal) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (proposal.status === "accepted") {
      return NextResponse.json(
        { error: "That proposal has already been accepted." },
        { status: 409 }
      );
    }

    /* ---------- the simple decisions ---------- */
    if (decision !== "accepted") {
      const { data, error } = await svc
        .from("project_proposals")
        .update({
          status: decision,
          decision_reason: reason || null,
          decided_by: auth.appUserId || null,
          decided_at: new Date().toISOString(),
        })
        .eq("id", proposalId)
        .eq("organization_id", auth.orgId)
        // Only move a proposal that is still where we think it is. Two admins
        // deciding at once should not both succeed.
        .neq("status", "accepted")
        .select()
        .single();
      if (error) throw error;

      await notifyClient(svc, auth.orgId, proposal, decision, reason);
      return NextResponse.json({ proposal: data });
    }

    /* ---------- accept ---------- */

    // Accepting creates a project, and a project is a metered resource. A
    // locked organization must not be able to take on new work through a side
    // door that skips the check every other create goes through.
    const locked = await requireUnlocked(svc, auth.orgId);
    if (locked) return NextResponse.json(locked, { status: locked.status || 402 });

    // A named manager must actually be one, and be in this organization.
    // Without this the field is a free-text uuid that lands in the project and
    // silently assigns work to nobody.
    if (managerId) {
      const { data: mgr } = await svc
        .from("memberships")
        .select("user_id, role, status")
        .eq("organization_id", auth.orgId)
        .eq("user_id", managerId)
        .eq("status", "active")
        .maybeSingle();
      if (!mgr || !["owner", "admin", "manager", "team_lead"].includes(mgr.role)) {
        return NextResponse.json(
          { error: "That person is not a project manager in your organization." },
          { status: 400 }
        );
      }
    }

    // 1) The project.
    const { data: project, error: projErr } = await svc
      .from("projects")
      .insert({
        organization_id: auth.orgId,
        name: proposal.title,
        description: proposal.description,
        status: "pending",
        budget: proposal.budget,
        deadline: proposal.desired_deadline,
        created_by: auth.appUserId || null,
        manager_id: managerId,
        proposal_id: proposal.id,
      })
      .select()
      .single();
    if (projErr) throw projErr;

    // 2) Link the client, so they can see the thing they asked for. If this
    //    fails the project is removed again: a project the client cannot see
    //    is worse than no project, because everyone believes it is visible.
    const { error: linkErr } = await svc
      .from("project_clients")
      .insert({
        organization_id: auth.orgId,
        project_id: project.id,
        client_id: proposal.client_id,
      });
    if (linkErr) {
      await svc.from("projects").delete().eq("id", project.id);
      throw linkErr;
    }

    // 3) Only now does the proposal claim success.
    const { data: updated, error: updErr } = await svc
      .from("project_proposals")
      .update({
        status: "accepted",
        project_id: project.id,
        assigned_manager_id: managerId,
        decision_reason: reason || null,
        decided_by: auth.appUserId || null,
        decided_at: new Date().toISOString(),
      })
      .eq("id", proposalId)
      .eq("organization_id", auth.orgId)
      .neq("status", "accepted")
      .select()
      .single();

    if (updErr) {
      // The project and link exist but the proposal did not move — most likely
      // because somebody else accepted it a moment ago. Undo ours rather than
      // leave a duplicate project behind.
      await svc.from("project_clients").delete().eq("project_id", project.id);
      await svc.from("projects").delete().eq("id", project.id);
      throw updErr;
    }

    await notifyClient(svc, auth.orgId, proposal, "accepted", reason, project);
    await notifyManager(svc, auth.orgId, managerId, project, proposal);

    return NextResponse.json({ proposal: updated, project });
  } catch (e) {
    console.error("[proposals decide]", e?.message || e);
    return NextResponse.json({ error: "Could not record that decision." }, { status: 503 });
  }
}

const CLIENT_COPY = {
  accepted: (p) => `Your proposal "${p.title}" has been accepted and a project has been created.`,
  rejected: (p) => `Your proposal "${p.title}" was not taken forward.`,
  needs_info: (p) => `We need a little more detail on "${p.title}".`,
  in_review: (p) => `Your proposal "${p.title}" is being reviewed.`,
};

/** Best-effort. A failed notification must never undo a recorded decision. */
async function notifyClient(svc, orgId, proposal, decision, reason, project) {
  if (decision === "in_review") return; // not worth interrupting anyone
  try {
    await svc.from("notifications").insert({
      organization_id: orgId,
      // The client portal reads notifications addressed to its own id.
      developer_id: null,
      admin_id: null,
      actor_id: proposal.client_id,
      type: `proposal_${decision}`,
      category: "project",
      title: "Project proposal update",
      message: reason
        ? `${CLIENT_COPY[decision](proposal)} — ${reason}`
        : CLIENT_COPY[decision](proposal),
      entity_type: "project_proposal",
      entity_id: proposal.id,
      project_id: project?.id || null,
      read: false,
    });
  } catch (e) {
    console.error("[proposals decide] client notify failed:", e?.message || e);
  }
}

/** Tell the project manager they have been handed something. */
async function notifyManager(svc, orgId, managerId, project, proposal) {
  if (!managerId) return;
  try {
    const { data: m } = await svc
      .from("memberships")
      .select("user_id, email, user_type")
      .eq("organization_id", orgId)
      .eq("user_id", managerId)
      .maybeSingle();
    if (!m) return;
    await svc.from("notifications").insert({
      organization_id: orgId,
      admin_id: m.user_type === "admin" ? m.user_id : null,
      developer_id: m.user_type === "developer" ? m.user_id : null,
      admin_email: m.email || null,
      type: "project_assigned",
      // The manager is being handed work — that is an assignment.
      category: "assignment",
      title: "A project has been assigned to you",
      message: `"${project.name}" came from a client proposal and is yours to plan.`,
      entity_type: "project",
      entity_id: project.id,
      project_id: project.id,
      read: false,
    });
  } catch (e) {
    console.error("[proposals decide] manager notify failed:", e?.message || e);
  }
}
