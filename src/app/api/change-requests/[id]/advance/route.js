import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";

export const dynamic = "force-dynamic";

/**
 * POST /api/change-requests/[id]/advance — move one along its chain.
 *
 * One route for every step because the steps share one invariant: who may take
 * it depends on WHERE it is, not just on the caller's role. A client may
 * approve, but only at `awaiting_client`. An admin may approve, but only after
 * a PM has priced it. Spread across four endpoints, that ordering would live in
 * four places and drift.
 *
 * Actions:
 *   estimate       PM prices it            -> awaiting_admin
 *   admin_approve  the company will sell   -> awaiting_client
 *   client_approve the client will buy     -> approved  (and the project moves)
 *   implement      built                   -> implemented
 *   reject         either side declines    -> rejected
 *   withdraw       the raiser pulls it     -> withdrawn
 *
 * THE PROJECT ACTUALLY MOVES ON APPROVAL. That is the difference between this
 * and a comment saying "we agreed +5k". The previous budget and deadline are
 * written onto the change request first, so the trail reads forwards and can be
 * unwound.
 */

const STAFF_DECIDERS = ["owner", "admin", "manager"];

export async function POST(request, { params }) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = params?.id;
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "");
    const reason = String(body.reason || "").trim();

    const svc = serviceClient();
    const { data: cr, error: readErr } = await svc
      .from("change_requests")
      .select("*")
      .eq("id", id)
      .eq("organization_id", auth.orgId)
      .maybeSingle();

    if (readErr) throw readErr;
    if (!cr) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const isClient = auth.userType === "client";
    const isStaffDecider = !isClient && STAFF_DECIDERS.includes(auth.role);

    // A client may only act on a change request for a project it is on.
    if (isClient) {
      const { data: link } = await svc
        .from("project_clients")
        .select("project_id")
        .eq("organization_id", auth.orgId)
        .eq("client_id", auth.appUserId)
        .eq("project_id", cr.project_id)
        .maybeSingle();
      if (!link) return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    const now = new Date().toISOString();
    let patch = null;

    switch (action) {
      case "estimate": {
        if (!isStaffDecider) return forbidden();
        const cost = numberOrNull(body.estimatedCost);
        const hours = numberOrNull(body.estimatedHours);
        const days = numberOrNull(body.timelineImpactDays);
        if (cost === null && hours === null) {
          return NextResponse.json(
            { error: "Give a cost or an hours figure — that is the point of this step." },
            { status: 400 }
          );
        }
        patch = {
          status: "awaiting_admin",
          estimated_cost: cost,
          estimated_hours: hours,
          timeline_impact_days: days === null ? null : Math.round(days),
          currency: String(body.currency || cr.currency || "USD").slice(0, 8),
          pm_notes: typeof body.pmNotes === "string" ? body.pmNotes.slice(0, 5000) : cr.pm_notes,
        };
        break;
      }

      case "admin_approve": {
        // Deliberately owner/admin only, narrower than `estimate`. A manager
        // who priced the work should not also be the one who agrees to sell it
        // at that price — that is the whole reason there are two steps.
        if (isClient || !["owner", "admin"].includes(auth.role)) return forbidden();
        if (cr.status !== "awaiting_admin") return wrongStage(cr.status);
        patch = {
          status: "awaiting_client",
          admin_decided_by: auth.appUserId || null,
          admin_decided_at: now,
        };
        break;
      }

      case "client_approve": {
        // Only the client agrees to pay. Staff cannot tick this on their
        // behalf — the row would then say the customer agreed to a bill they
        // never saw.
        if (!isClient) {
          return NextResponse.json(
            { error: "Only the client can approve a change request." },
            { status: 403 }
          );
        }
        if (cr.status !== "awaiting_client") return wrongStage(cr.status);
        patch = { status: "approved", client_decided_at: now };
        break;
      }

      case "implement": {
        if (!isStaffDecider) return forbidden();
        if (cr.status !== "approved") return wrongStage(cr.status);
        patch = { status: "implemented" };
        break;
      }

      case "reject": {
        if (!reason) {
          return NextResponse.json(
            { error: "Say why — the other side will read this." },
            { status: 400 }
          );
        }
        // Either side may decline, but a client only while it is theirs to
        // decline.
        if (isClient && cr.status !== "awaiting_client") return wrongStage(cr.status);
        if (!isClient && !isStaffDecider) return forbidden();
        patch = {
          status: "rejected",
          decision_reason: reason,
          ...(isClient
            ? { client_decided_at: now }
            : { admin_decided_by: auth.appUserId || null, admin_decided_at: now }),
        };
        break;
      }

      case "withdraw": {
        const mine =
          (isClient && cr.requested_by === auth.appUserId) ||
          (!isClient && isStaffDecider);
        if (!mine) return forbidden();
        if (["implemented", "approved"].includes(cr.status)) {
          return NextResponse.json(
            { error: "This has already been agreed — raise a new request to change it." },
            { status: 409 }
          );
        }
        patch = { status: "withdrawn", decision_reason: reason || "Withdrawn by the requester." };
        break;
      }

      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }

    // Applying the impact happens BEFORE the status moves, so a failure leaves
    // the request still awaiting the client rather than approved-but-unapplied.
    // The trigger in 060 does not know about the project, so this ordering is
    // the only thing protecting that pair.
    if (action === "client_approve") {
      const applied = await applyImpact(svc, auth.orgId, cr);
      if (applied.error) {
        console.error("[change-requests advance] apply failed:", applied.error);
        return NextResponse.json(
          { error: "Could not update the project's budget. Nothing was changed." },
          { status: 503 }
        );
      }
      patch = { ...patch, ...applied.patch };
    }

    const { data, error } = await svc
      .from("change_requests")
      .update(patch)
      .eq("id", id)
      .eq("organization_id", auth.orgId)
      // Do not move something somebody else just moved.
      .eq("status", cr.status)
      .select()
      .single();

    if (error) throw error;

    await notify(svc, auth, cr, action, data);

    return NextResponse.json({
      changeRequest: isClient ? stripNotes(data) : data,
    });
  } catch (e) {
    console.error("[change-requests advance]", e?.message || e);
    return NextResponse.json({ error: "Could not update that change request." }, { status: 503 });
  }
}

function forbidden() {
  return NextResponse.json({ error: "Your role cannot do that." }, { status: 403 });
}

function wrongStage(status) {
  return NextResponse.json(
    { error: `This change request is at "${status}" — that step does not apply.` },
    { status: 409 }
  );
}

function stripNotes(row) {
  const { pm_notes, ...rest } = row || {};
  return rest;
}

function numberOrNull(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Move the project's budget and deadline, recording what they were.
 *
 * The previous values go onto the change request, not into a log table: they
 * belong to this decision, and a reader looking at the request should not have
 * to go and find them somewhere else.
 */
async function applyImpact(svc, orgId, cr) {
  const { data: project, error } = await svc
    .from("projects")
    .select("id, budget, deadline")
    .eq("id", cr.project_id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error || !project) return { error: error || new Error("Project not found") };

  const addCost = Number(cr.estimated_cost) || 0;
  const addDays = Number(cr.timeline_impact_days) || 0;

  const update = {};
  if (addCost) update.budget = (Number(project.budget) || 0) + addCost;
  if (addDays && project.deadline) {
    const d = new Date(project.deadline);
    if (!Number.isNaN(d.getTime())) {
      d.setDate(d.getDate() + addDays);
      update.deadline = d.toISOString().slice(0, 10);
    }
  }

  // Nothing to move is not a failure: a change request can be agreed at no
  // cost and no delay, and that is still worth recording as agreed.
  if (Object.keys(update).length === 0) {
    return { patch: { applied_at: new Date().toISOString() } };
  }

  const { error: updErr } = await svc
    .from("projects")
    .update(update)
    .eq("id", project.id)
    .eq("organization_id", orgId);
  if (updErr) return { error: updErr };

  return {
    patch: {
      applied_at: new Date().toISOString(),
      previous_budget: project.budget,
      previous_deadline: project.deadline,
    },
  };
}

const COPY = {
  estimate: (cr) => `"${cr.title}" has been costed and needs approval.`,
  admin_approve: (cr) => `"${cr.title}" is approved by us and waiting on the client.`,
  client_approve: (cr) => `The client approved "${cr.title}" — the project budget has moved.`,
  implement: (cr) => `"${cr.title}" has been implemented.`,
  reject: (cr) => `"${cr.title}" was declined.`,
  withdraw: (cr) => `"${cr.title}" was withdrawn.`,
};

/** Best-effort. A failed notification must never undo a recorded decision. */
async function notify(svc, auth, cr, action, updated) {
  try {
    const { data: staff } = await svc
      .from("memberships")
      .select("user_id, email, user_type, role")
      .eq("organization_id", auth.orgId)
      .eq("status", "active")
      .in("role", STAFF_DECIDERS);

    const rows = (staff || []).map((m) => ({
      organization_id: auth.orgId,
      admin_id: m.user_type === "admin" ? m.user_id : null,
      developer_id: m.user_type === "developer" ? m.user_id : null,
      admin_email: m.email || null,
      type: `change_request_${action}`,
      category: "project",
      title: "Change request update",
      message: COPY[action]?.(cr) || `"${cr.title}" was updated.`,
      entity_type: "change_request",
      entity_id: cr.id,
      project_id: cr.project_id,
      read: false,
    }));
    if (rows.length) await svc.from("notifications").insert(rows);
  } catch (e) {
    console.error("[change-requests advance] notify failed:", e?.message || e);
  }
}
