import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { authCan, requirePermission } from "@/utils/serverPermissions";
import { requireUnlocked } from "@/utils/entitlements";

export const dynamic = "force-dynamic";

/**
 * /api/timesheets — agreeing a week's hours.
 *
 *   GET    your own weeks, or the organization's for `timesheet.view_all`.
 *   POST   submit a week. Always your own; always from 'draft'.
 *   PATCH  approve, reject or reopen (`timesheet.approve`).
 *
 * THE TOTALS ARE COMPUTED HERE, NOT ACCEPTED. A submission that took
 * `totalSeconds` from the body would let the browser claim any number it liked
 * and have an approver sign it. The route sums `task_time_logs` for the week
 * with the service role and writes what it found; the body carries the week and
 * nothing else that matters.
 *
 * THE LOCK IS NOT IN THIS FILE. `task_time_logs` is written straight from the
 * browser through PostgREST — there is no route in front of it — so "you cannot
 * edit an approved week" is a trigger in migration 077. This route decides who
 * may change a timesheet's STATUS; the database decides what that status then
 * prevents. Neither is a restatement of the other.
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

const weekEndExclusive = (monday) =>
  new Date(Date.parse(`${monday}T00:00:00Z`) + 7 * 86400000).toISOString();

export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    // Wide key first, narrow second.
    const canReadAnyone = authCan(auth, "timesheet.view_all");
    if (!canReadAnyone && !authCan(auth, "timesheet.view_own")) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const svc = serviceClient();

    let query = svc
      .from("timesheets")
      .select("*")
      .eq("organization_id", auth.orgId)
      .order("week_start", { ascending: false })
      .limit(300);

    if (!canReadAnyone || searchParams.get("scope") === "me") {
      query = query.eq("user_id", auth.appUserId);
    }

    const status = searchParams.get("status");
    if (status && ["draft", "submitted", "approved", "rejected"].includes(status)) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, timesheets: data || [] });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e?.message || "Could not load timesheets" },
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

    const svc = serviceClient();

    const { data: existing } = await svc
      .from("timesheets")
      .select("*")
      .eq("organization_id", auth.orgId)
      .eq("user_id", auth.appUserId)
      .eq("week_start", weekStart)
      .maybeSingle();

    if (existing && existing.status !== "draft" && existing.status !== "rejected") {
      // A rejected week may be resubmitted — that is the point of rejecting it
      // rather than deleting it. A submitted or approved one may not.
      return NextResponse.json(
        { success: false, error: `That week is already ${existing.status}` },
        { status: 409 }
      );
    }

    // COMPUTED, NEVER ACCEPTED. See the note at the top of this file.
    const { data: logs, error: logErr } = await svc
      .from("task_time_logs")
      .select("seconds, is_billable")
      .eq("organization_id", auth.orgId)
      .eq("developer_id", auth.appUserId)
      .gte("started_at", `${weekStart}T00:00:00.000Z`)
      .lt("started_at", weekEndExclusive(weekStart));

    if (logErr) {
      return NextResponse.json({ success: false, error: logErr.message }, { status: 500 });
    }

    let total = 0;
    let billable = 0;
    for (const l of logs || []) {
      const s = Math.max(0, Number(l.seconds) || 0);
      total += s;
      if (l.is_billable) billable += s;
    }

    if (total === 0) {
      // Submitting an empty week is almost always a misclick, and an approver's
      // queue full of empty weeks is a queue nobody reads.
      return NextResponse.json(
        { success: false, error: "There are no hours logged in that week" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const row = {
      organization_id: auth.orgId,
      user_id: auth.appUserId,
      user_type: auth.userType === "admin" ? "admin" : "developer",
      week_start: weekStart,
      status: "submitted",
      total_seconds: total,
      billable_seconds: billable,
      submitted_at: now,
      // A resubmission clears the previous verdict — leaving it would show
      // "rejected by X" beside a week now waiting on somebody.
      decided_by: null,
      decided_at: null,
      decision_note: null,
      updated_at: now,
    };

    const { data, error } = await svc
      .from("timesheets")
      .upsert(row, { onConflict: "organization_id,user_id,week_start" })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, timesheet: data });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e?.message || "Could not submit the week" },
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
    const { timesheetId, decision, note } = body || {};

    if (!UUID_RE.test(String(timesheetId || ""))) {
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

    const svc = serviceClient();
    const { data: existing } = await svc
      .from("timesheets")
      .select("*")
      .eq("organization_id", auth.orgId)
      .eq("id", timesheetId)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }

    // SELF-APPROVAL. A manager and a team lead book hours like everyone else, so
    // without this the person reviewing the week is allowed to be its author.
    // The same rule /api/leave and /api/task-plan/review already enforce.
    if (String(existing.user_id) === String(auth.appUserId)) {
      return NextResponse.json(
        { success: false, error: "You cannot decide your own timesheet" },
        { status: 403 }
      );
    }

    if (decision === "reopen") {
      if (existing.status === "draft") {
        return NextResponse.json(
          { success: false, error: "That week is already open" },
          { status: 409 }
        );
      }
    } else if (existing.status !== "submitted") {
      return NextResponse.json(
        { success: false, error: `That week is ${existing.status}, not awaiting a decision` },
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

    const now = new Date().toISOString();
    const patch =
      decision === "reopen"
        ? {
            status: "draft",
            decided_by: auth.appUserId,
            decided_at: now,
            decision_note: typeof note === "string" ? note.slice(0, 2000) : "Reopened for correction",
            updated_at: now,
          }
        : {
            status: decision,
            decided_by: auth.appUserId,
            decided_at: now,
            decision_note: typeof note === "string" ? note.slice(0, 2000) : null,
            updated_at: now,
          };

    const { data, error } = await svc
      .from("timesheets")
      .update(patch)
      .eq("id", timesheetId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, timesheet: data });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e?.message || "Could not update the timesheet" },
      { status: 500 }
    );
  }
}
