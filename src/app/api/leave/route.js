import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { authCan, requirePermission } from "@/utils/serverPermissions";
import { requireUnlocked } from "@/utils/entitlements";

export const dynamic = "force-dynamic";

/**
 * /api/leave — asking for time off, and answering.
 *
 *   GET    the caller's own requests, or the organization's for anyone holding
 *          `leave.view_all`. `?types=1` returns the leave types instead.
 *   POST   raise a request. Always as yourself; always 'pending'.
 *   PATCH  decide one (`leave.approve`), or cancel your own.
 *
 * WHY CREATE AND DECIDE ARE DIFFERENT VERBS HERE. They are different acts by
 * different people with different permissions, and folding them into one
 * endpoint that branches on `status` in the body is how a request ends up
 * approving itself: the caller supplies the field the check reads. POST cannot
 * write any status but 'pending', and it does not read one from the body at
 * all. PATCH is where a decision is made, and it refuses to let anyone decide
 * their own — see SELF_APPROVAL below.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_REASON = 2000;
/** A single request longer than this is a leave of absence, not a leave day. */
const MAX_SPAN_DAYS = 365;

const isDate = (v) => typeof v === "string" && DATE_RE.test(v);

/** Whole days, inclusive of both ends. Half days arrive as `days` from the UI. */
function spanDays(start, end) {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / 86400000) + 1;
}

export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const svc = serviceClient();

    // Leave TYPES are readable by every staff member: you cannot ask for a kind
    // of leave you cannot see exists. Guarded on the narrow key all the same,
    // so a per-person deny of `leave.request_own` hides the whole feature.
    if (searchParams.get("types")) {
      if (!authCan(auth, "leave.request_own") && !authCan(auth, "leave.manage_types")) {
        return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
      }
      const { data, error } = await svc
        .from("leave_types")
        .select("*")
        .eq("organization_id", auth.orgId)
        .eq("active", true)
        .order("name");
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true, types: data || [] });
    }

    // Wide key first, narrow second — the ordering the *_own family exists for.
    const canReadAnyone = authCan(auth, "leave.view_all");
    if (!canReadAnyone && !authCan(auth, "leave.view_own")) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    let query = svc
      .from("leave_requests")
      .select("*, leave_types(code, name, is_paid)")
      .eq("organization_id", auth.orgId)
      .order("start_date", { ascending: false })
      .limit(500);

    const scope = searchParams.get("scope");
    if (!canReadAnyone || scope === "me") {
      query = query.eq("user_id", auth.appUserId);
    }

    const status = searchParams.get("status");
    if (status && ["pending", "approved", "rejected", "cancelled"].includes(status)) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, requests: data || [] });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e?.message || "Could not load leave" },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const denied = requirePermission(auth, "leave.request_own");
    if (denied) return denied;

    const billingBlocked = await requireUnlocked(serviceClient(), auth.orgId);
    if (billingBlocked) {
      return NextResponse.json(
        { success: false, ...billingBlocked },
        { status: billingBlocked.status }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { leaveTypeId, startDate, endDate, reason } = body || {};

    if (!UUID_RE.test(String(leaveTypeId || ""))) {
      return NextResponse.json(
        { success: false, error: "Choose a leave type" },
        { status: 400 }
      );
    }
    if (!isDate(startDate) || !isDate(endDate)) {
      return NextResponse.json(
        { success: false, error: "Dates must be YYYY-MM-DD" },
        { status: 400 }
      );
    }

    const span = spanDays(startDate, endDate);
    if (span === null) {
      return NextResponse.json(
        { success: false, error: "The end date cannot be before the start date" },
        { status: 400 }
      );
    }
    if (span > MAX_SPAN_DAYS) {
      return NextResponse.json(
        { success: false, error: "That span is too long for a single request" },
        { status: 400 }
      );
    }

    // `days` is what the balance is spent from, so it is bounded by the span
    // rather than trusted. A request for 1 day across a 1-day span may be 0.5
    // (a half day); it may not be 40.
    const requested = Number(body?.days);
    const days =
      Number.isFinite(requested) && requested > 0 && requested <= span
        ? Math.round(requested * 2) / 2
        : span;

    const svc = serviceClient();

    // The leave type must belong to THIS organization. Without this check a
    // caller could name any leave_types.id in the world and attach their
    // request to another tenant's configuration.
    const { data: type } = await svc
      .from("leave_types")
      .select("id, active")
      .eq("organization_id", auth.orgId)
      .eq("id", leaveTypeId)
      .maybeSingle();
    if (!type || !type.active) {
      return NextResponse.json(
        { success: false, error: "That leave type is not available" },
        { status: 400 }
      );
    }

    const { data, error } = await svc
      .from("leave_requests")
      .insert({
        organization_id: auth.orgId,
        user_id: auth.appUserId,
        user_type: auth.userType === "admin" ? "admin" : "developer",
        leave_type_id: leaveTypeId,
        start_date: startDate,
        end_date: endDate,
        days,
        reason: typeof reason === "string" ? reason.slice(0, MAX_REASON) : null,
        // NOT read from the body. See the note at the top of this file.
        status: "pending",
      })
      .select()
      .single();

    if (error) {
      // The overlap trigger in 075 raises unique_violation. Say what actually
      // happened rather than "could not save".
      const overlapping = /overlapping leave/i.test(error.message || "");
      return NextResponse.json(
        {
          success: false,
          error: overlapping
            ? "You already have a pending or approved request covering those dates"
            : error.message,
        },
        { status: overlapping ? 409 : 500 }
      );
    }

    return NextResponse.json({ success: true, request: data });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e?.message || "Could not raise the request" },
      { status: 500 }
    );
  }
}

export async function PATCH(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { requestId, decision, note } = body || {};

    if (!UUID_RE.test(String(requestId || ""))) {
      return NextResponse.json({ success: false, error: "Invalid requestId" }, { status: 400 });
    }
    if (!["approved", "rejected", "cancelled"].includes(decision)) {
      return NextResponse.json({ success: false, error: "Invalid decision" }, { status: 400 });
    }

    const svc = serviceClient();
    const { data: existing } = await svc
      .from("leave_requests")
      .select("*")
      .eq("organization_id", auth.orgId)
      .eq("id", requestId)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }

    const isMine = String(existing.user_id) === String(auth.appUserId);

    if (decision === "cancelled") {
      // Withdrawing your own request is not a decision, it is a retraction, and
      // it needs no approval permission. Somebody else's is still a decision.
      if (!isMine) {
        const deniedOther = requirePermission(auth, "leave.approve");
        if (deniedOther) return deniedOther;
      } else if (!authCan(auth, "leave.request_own")) {
        return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
      }
    } else {
      const deniedDecide = requirePermission(auth, "leave.approve");
      if (deniedDecide) return deniedDecide;

      // SELF_APPROVAL. An HR lead or a manager holds `leave.approve` and also
      // takes holidays, so without this the one person who most obviously
      // should not sign off their own leave is exactly the person who can.
      // The same rule /api/task-plan/review already enforces for task plans.
      if (isMine) {
        return NextResponse.json(
          { success: false, error: "You cannot decide your own leave request" },
          { status: 403 }
        );
      }
    }

    if (existing.status !== "pending") {
      return NextResponse.json(
        { success: false, error: `That request is already ${existing.status}` },
        { status: 409 }
      );
    }

    const billingBlocked = await requireUnlocked(svc, auth.orgId);
    if (billingBlocked) {
      return NextResponse.json(
        { success: false, ...billingBlocked },
        { status: billingBlocked.status }
      );
    }

    const { data, error } = await svc
      .from("leave_requests")
      .update({
        status: decision,
        decided_by: auth.appUserId,
        decided_at: new Date().toISOString(),
        decision_note: typeof note === "string" ? note.slice(0, MAX_REASON) : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, request: data });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e?.message || "Could not update the request" },
      { status: 500 }
    );
  }
}
