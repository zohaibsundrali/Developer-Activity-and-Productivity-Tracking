import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient, orgScopedClient } from "@/utils/serverAuth";
import { authCan, requirePermission } from "@/utils/serverPermissions";
import { requireUnlocked } from "@/utils/entitlements";

export const dynamic = "force-dynamic";

/**
 * Typed timesheet reads and transactional submission/decisions. The database
 * computes full totals and serializes status transitions with time-log writes.
 * RPCs execute as the caller; direct database requests enforce the same rules.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The ISO Monday of a week, validated.
 *
 * Must agree with `timesheet_week_of()` in 077 and with `weekStart()` in
 * src/utils/timesheet.js. Three definitions of "which week is this" is how two
 * rows appear for one week and both look right, so the day-of-week is checked
 * rather than assumed: a caller sending a Wednesday is refused, not silently
 * rounded to a Monday it did not choose.
 */
function isoMonday(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  if (d.toISOString().slice(0, 10) !== value) return null;
  // getUTCDay: 0=Sunday, 1=Monday.
  if (d.getUTCDay() !== 1) return null;
  return value;
}

const DATABASE_MESSAGES = {
  TIMESHEET_FORBIDDEN: "You do not have permission to perform this timesheet action.",
  TIMESHEET_SELF_DECISION: "You cannot decide your own timesheet",
  TIMESHEET_UNSUPPORTED_IDENTITY: "This account cannot use timesheets.",
  TIMESHEET_NOT_FOUND: "Timesheet not found.",
  TIMESHEET_IDENTITY_REVIEW_REQUIRED: "Some legacy time logs have unresolved ownership. An administrator must review their identity before this week can change.",
  TIMESHEET_WEEK_LOCKED: "That week is submitted or approved. An approver must reopen it before its hours can change.",
  TIMESHEET_STATE_CONFLICT: "That week has already changed. Reload it before trying again.",
  TIMESHEET_WEEK_INVALID: "weekStart must be a Monday, as YYYY-MM-DD",
  TIMESHEET_EMPTY: "There are no hours logged in that week",
  TIMESHEET_OPEN_LOGS: "Stop running timers for that week before submitting it.",
  TIMESHEET_LOG_INVALID: "Some time logs need correction before this week can be submitted.",
  TIMESHEET_DECISION_INVALID: "Invalid decision",
  BILLING_LOCKED: "Your subscription requires attention before timesheets can change.",
};

function databaseFailure(error) {
  const code = error?.code;
  const token = String(error?.message || "").split(":")[0];
  const status = token === "BILLING_LOCKED" ? 402
    : code === "42501" ? 403 : code === "P0002" ? 404
    : code === "22023" ? 400
    : ["23514", "23505", "40001", "55000"].includes(code) ? 409 : 503;
  const message = DATABASE_MESSAGES[token] || (status === 503
    ? "Timesheets are temporarily unavailable. Please retry."
    : "The timesheet could not be changed. Reload it and check your access.");
  return NextResponse.json({ success: false, error: message }, { status });
}

function validSheet(data, auth, expected = {}) {
  return data && typeof data === "object" && !Array.isArray(data)
    && UUID_RE.test(String(data.id || "")) && data.organization_id === auth.orgId
    && ["admin", "developer"].includes(data.user_type)
    && Object.entries(expected).every(([key, value]) => data[key] === value);
}

export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    if (!["admin", "developer"].includes(auth.userType)) return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });

    // Wide key first, narrow second.
    const canReadAnyone = authCan(auth, "timesheet.view_all");
    if (!canReadAnyone && !authCan(auth, "timesheet.view_own")) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const requestedWeek = searchParams.get("weekStart");
    if (requestedWeek !== null && !isoMonday(requestedWeek)) {
      return NextResponse.json({ success: false, error: "weekStart must be a Monday, as YYYY-MM-DD" }, { status: 400 });
    }
    const rawLimit = searchParams.get("limit");
    const limit = rawLimit === null ? 300 : Number(rawLimit);
    if (rawLimit !== null && (!/^[1-9]\d{0,2}$/.test(rawLimit) || limit > 300)) {
      return NextResponse.json({ success: false, error: "limit must be an integer from 1 to 300" }, { status: 400 });
    }
    const requestedStatus = searchParams.get("status");
    const status = ["draft", "submitted", "approved", "rejected"].includes(requestedStatus) ? requestedStatus : null;
    const scope = !canReadAnyone || searchParams.get("scope") === "me" ? "me" : "all";
    const binding = { scope, status, weekFilter: requestedWeek, organizationId: auth.orgId, userId: auth.appUserId, userType: auth.userType };
    let cursor = null;
    const rawCursor = searchParams.get("cursor");
    if (rawCursor !== null) {
      try {
        if (!rawCursor || rawCursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(rawCursor)) throw new Error("Invalid cursor");
        cursor = JSON.parse(Buffer.from(rawCursor, "base64url").toString("utf8"));
        if (!cursor || !isoMonday(cursor.weekStart) || (typeof cursor.id !== "string" || !UUID_RE.test(cursor.id)) || Object.entries(binding).some(([key, value]) => cursor[key] !== value)) throw new Error("Invalid cursor");
      } catch {
        return NextResponse.json({ success: false, error: "Invalid timesheet cursor. Reload the list." }, { status: 400 });
      }
    }
    const svc = orgScopedClient(auth.token);
    const buildQuery = (after, pageLimit, columns = "*") => {
      let query = svc.from("timesheets").select(columns)
        .eq("organization_id", auth.orgId)
        .order("week_start", { ascending: false }).order("id", { ascending: false }).limit(pageLimit);
      if (scope === "me") query = query.eq("user_id", auth.appUserId).eq("user_type", auth.userType);
      if (requestedWeek !== null) query = query.eq("week_start", requestedWeek);
      if (status !== null) query = query.eq("status", status);
      // Both interpolated values are constrained to safe date/UUID alphabets.
      if (after) query = query.or(`week_start.lt.${after.weekStart},and(week_start.eq.${after.weekStart},id.lt.${after.id})`);
      return query;
    };
    const { data, error } = await buildQuery(cursor, limit);
    if (error) return databaseFailure(error);
    if (!Array.isArray(data)) return databaseFailure({ code: "XX000" });
    let hasMore = false;
    let nextCursor = null;
    if (data.length) {
      const last = data[data.length - 1];
      if (!isoMonday(last.week_start) || !UUID_RE.test(last.id)) return databaseFailure({ code: "XX000" });
      const after = { weekStart: last.week_start, id: last.id };
      // A hosted row cap can be smaller than limit. Probe explicitly rather
      // than treating every short page as a complete result.
      const probe = await buildQuery(after, 1, "id");
      if (probe.error) return databaseFailure(probe.error);
      if (!Array.isArray(probe.data)) return databaseFailure({ code: "XX000" });
      hasMore = probe.data.length > 0;
      if (hasMore) nextCursor = Buffer.from(JSON.stringify({ ...after, ...binding })).toString("base64url");
    }
    return NextResponse.json({ success: true, timesheets: data, hasMore, nextCursor });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: "Timesheets are temporarily unavailable. Please retry." },
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

    if (!["admin", "developer"].includes(auth.userType)) return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });

    const denied = requirePermission(auth, "timesheet.submit_own");
    if (denied) return denied;

    const billingBlocked = await requireUnlocked(serviceClient(), auth.orgId);
    if (billingBlocked) {
      return NextResponse.json(
        { success: false, ...billingBlocked },
        { status: billingBlocked.status }
      );
    }

    const body = await request.json().catch(() => ({}));
    const weekStart = isoMonday(body?.weekStart);
    if (!weekStart) {
      return NextResponse.json(
        { success: false, error: "weekStart must be a Monday, as YYYY-MM-DD" },
        { status: 400 }
      );
    }

    const { data, error } = await orgScopedClient(auth.token)
      .rpc("submit_timesheet_week", { p_week_start: weekStart });
    if (error) return databaseFailure(error);
    if (!validSheet(data, auth, { user_id: auth.appUserId, user_type: auth.userType,
      week_start: weekStart, status: "submitted" })) {
      return NextResponse.json({ success: false, error: "Submission was not confirmed. Reload the week before retrying." }, { status: 503 });
    }
    return NextResponse.json({ success: true, timesheet: data });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: "Submission was not confirmed. Reload the week before retrying." },
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

    if (!["admin", "developer"].includes(auth.userType)) return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const { timesheetId: requestedId, decision, note } = body || {};
    const timesheetId = typeof requestedId === "string" ? requestedId.toLowerCase() : null;

    if (!timesheetId || !UUID_RE.test(timesheetId)) {
      return NextResponse.json({ success: false, error: "Invalid timesheetId" }, { status: 400 });
    }
    // 'reopen' returns an approved or rejected week to draft so the hours can be
    // corrected. It is the escape hatch the lock in 077 is built around, and it
    // is an approver's act, not the author's.
    if (!["approved", "rejected", "reopen"].includes(decision)) {
      return NextResponse.json({ success: false, error: "Invalid decision" }, { status: 400 });
    }

    const deniedDecide = requirePermission(auth, "timesheet.approve");
    if (deniedDecide) return deniedDecide;

    const billingBlocked = await requireUnlocked(serviceClient(), auth.orgId);
    if (billingBlocked) {
      return NextResponse.json({ success: false, ...billingBlocked }, { status: billingBlocked.status });
    }

    const { data, error } = await orgScopedClient(auth.token).rpc("decide_timesheet", {
      p_timesheet_id: timesheetId,
      p_decision: decision,
      p_note: typeof note === "string" ? note.slice(0, 2000) : null,
    });
    if (error) return databaseFailure(error);
    if (!validSheet(data, auth, { id: timesheetId, status: decision === "reopen" ? "draft" : decision })
      || (data.user_id === auth.appUserId && data.user_type === auth.userType)) {
      return NextResponse.json({ success: false, error: "Decision was not confirmed. Reload the week before retrying." }, { status: 503 });
    }
    return NextResponse.json({ success: true, timesheet: data });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: "Decision was not confirmed. Reload the week before retrying." },
      { status: 500 }
    );
  }
}
