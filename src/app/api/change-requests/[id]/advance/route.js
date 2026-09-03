import { NextResponse } from "next/server";
import { defaultRolesFor } from "@/utils/permissionCatalogue";
import { authCan } from "@/utils/serverPermissions";
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

/**
 * Who decides a change request, read from the catalogue rather than typed here.
 *
 * This was `["owner", "admin", "manager"]` — the same three roles
 * `change_request.decide` already grants, written down a second time. The
 * proposals route had the identical pattern and it was replaced for the same
 * reason: two copies of one answer drift, and the one nobody is looking at
 * drifts first.
 *
 * Still an ARRAY because it is used twice over: once as a guard, and once as a
 * PostgREST `.in("role", …)` filter to find who to notify.
 */
const STAFF_DECIDERS = defaultRolesFor("change_request.decide");

/**
 * WHERE EACH STEP MAY BE TAKEN FROM.
 *
 * `admin_approve`, `client_approve` and `implement` each carried their own
 * stage check from the start. `estimate` and the staff half of `reject` did
 * not — they checked the caller's ROLE and nothing else — and the gap in
 * `estimate` was not cosmetic:
 *
 *   database/060 refuses reopening from `implemented`, `rejected` and
 *   `withdrawn`. It does NOT refuse it from `approved`. So an approved change
 *   request — one whose cost has already been added to `projects.budget` —
 *   could be re-estimated back to `awaiting_admin`, walked forward through
 *   admin_approve and client_approve again, and `applyImpact` would add the
 *   same cost to the same budget a SECOND time. Worse, the second pass
 *   overwrites `previous_budget` with the already-inflated figure, so the trail
 *   that exists to unwind the change now points at the wrong number and the
 *   inflation is permanent.
 *
 * Re-pricing is legitimate right up to the moment the client agrees, including
 * while it sits with them — "we underquoted, here is the real number" sends it
 * back for internal approval, which is exactly what `estimate` does. It stops
 * being legitimate the moment money has moved. After that the answer is a new
 * change request, which is also what the database says about the other three
 * settled states.
 */
const ESTIMATABLE = ["submitted", "estimating", "awaiting_admin", "awaiting_client"];

/**
 * Staff may decline a change request until it has been agreed.
 *
 * A client could only ever reject at `awaiting_client`; staff could reject from
 * anywhere, including `approved` and `implemented`. Rejecting an approved one
 * is the same double-accounting hazard from the other side: the budget has
 * already moved and nothing in a rejection moves it back, so the project keeps
 * the money for work the record now says was declined. (The database refuses
 * the `implemented` case with an exception, which arrived here as a generic
 * 503 — a wrong answer to a wrong request.)
 */
const STAFF_REJECTABLE = ["submitted", "estimating", "awaiting_admin", "awaiting_client"];

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
    // The GUARD asks the key — that is what honours a per-person override. The
    // array above is still right for the notification query, which is asking
    // "which roles should hear about this", not "may this caller act".
    const isStaffDecider = !isClient && authCan(auth, "change_request.decide");

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
        // The check this step never had. See ESTIMATABLE — without it an
        // already-applied change request can be walked round the chain again
        // and charged to the project twice.
        if (!ESTIMATABLE.includes(cr.status)) return wrongStage(cr.status);
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
        // BELT AND BRACES ON THE DOUBLE-CHARGE. `applied_at` is set the first
        // time the impact reaches the project and is never cleared, so a
        // request carrying one has already moved the budget once. With the
        // stage check on `estimate` above there is no path back to
        // `awaiting_client` that keeps it — which is the point: if this ever
        // fires, a route has grown a new way round and the answer is a refusal,
        // not a second charge.
        if (cr.applied_at) {
          return NextResponse.json(
            { error: "This change request has already been applied to the project." },
            { status: 409 }
          );
        }
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
        // Staff had no stage check here at all. See STAFF_REJECTABLE.
        if (!isClient && !STAFF_REJECTABLE.includes(cr.status)) return wrongStage(cr.status);
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

    // ── THE TRANSITION IS WON FIRST, THEN THE MONEY MOVES ────────────────────
    //
    // This used to run the other way round: `applyImpact` mutated
    // `projects.budget` and `projects.deadline` and only THEN did the
    // compare-and-swap below run. The lock was real and it was in the wrong
    // place — it protected the change request's status and nothing else. A
    // client double-clicking Approve sent two requests that both read
    // `awaiting_client`, both added the cost to the budget, and then one of
    // them lost the CAS and answered 503. The budget had gone up twice and the
    // record of it existed once.
    //
    // The compare-and-swap is now the thing that decides who is allowed to act.
    // Exactly one request can move the row out of `cr.status`; the loser stops
    // here having written nothing, and gets 409 — a conflict, not a fault. The
    // old 503 said "the server broke" for the one case where everything worked
    // exactly as designed, and the client retries a 503.
    const { data: moved, error } = await svc
      .from("change_requests")
      .update(patch)
      .eq("id", id)
      .eq("organization_id", auth.orgId)
      // Do not move something somebody else just moved.
      .eq("status", cr.status)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!moved) {
      // Zero rows matched: the status moved between our read and our write.
      return NextResponse.json(
        { error: "Somebody else moved this change request while you were deciding it." },
        { status: 409 }
      );
    }

    // The row as it now stands. The audit write below refreshes it when there
    // is an impact to record.
    let data = moved;

    if (action === "client_approve") {
      // Reached only by the winner, so this runs at most once per approval.
      const applied = await applyImpact(svc, auth.orgId, cr);

      if (applied.error) {
        // COMPENSATE. The trade-off of moving the lock first is that a failure
        // here leaves a request that says `approved` with nothing behind it —
        // the state the old ordering was written to avoid. So it is put back,
        // CAS'd on the status WE wrote so this can only ever undo our own
        // transition and never somebody else's.
        console.error("[change-requests advance] apply failed:", applied.error);
        const { error: undoErr } = await svc
          .from("change_requests")
          .update({ status: cr.status, client_decided_at: cr.client_decided_at ?? null })
          .eq("id", id)
          .eq("organization_id", auth.orgId)
          .eq("status", patch.status);
        if (undoErr) {
          // Both writes failed. Say so loudly: the row now claims an approval
          // the project has not been given, and only a human can reconcile it.
          console.error(
            "[change-requests advance] COULD NOT UNDO approval",
            id,
            undoErr?.message || undoErr
          );
        }
        return NextResponse.json(
          { error: "Could not update the project's budget. Nothing was changed." },
          { status: 503 }
        );
      }

      // The audit columns — applied_at, and what the budget and deadline WERE.
      // A second write because the first one had to happen before the money
      // moved and these values do not exist until after it has.
      const { data: recorded, error: recordErr } = await svc
        .from("change_requests")
        .update(applied.patch)
        .eq("id", id)
        .eq("organization_id", auth.orgId)
        .select()
        .maybeSingle();
      if (recordErr || !recorded) {
        // The decision and the budget are both committed; only the trail is
        // missing, and unwinding a client's approved change request because a
        // bookkeeping write failed would be the worse of the two. Logged with
        // the figures so it can be repaired by hand.
        console.error(
          "[change-requests advance] impact applied but not recorded",
          id,
          applied.patch,
          recordErr?.message || "no row returned"
        );
      } else {
        data = recorded;
      }
    }

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
