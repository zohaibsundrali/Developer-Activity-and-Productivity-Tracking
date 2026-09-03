import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { authCan, requirePermission } from "@/utils/serverPermissions";
import { requireUnlocked } from "@/utils/entitlements";

export const dynamic = "force-dynamic";

/**
 * /api/attendance — who was at work, and when.
 *
 *   GET   the caller's own days, or the organization's for anyone holding
 *         `attendance.view_all`.
 *   POST  check in / check out / correct a day.
 *
 * THE IDENTITY IS NEVER TAKEN FROM THE BODY. `userId` in a request payload is
 * read only when the caller holds `attendance.manage`, and even then it is
 * checked against the organization before anything is written. Everyone else
 * writes as themselves, full stop — an attendance system where a person can
 * check somebody else in records nothing worth having.
 *
 * RLS (database/075) enforces the same rules one layer down. These routes exist
 * so the browser gets a 403 and a clear message instead of an empty result set,
 * and so the check-in idempotency below happens in one place.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Statuses a person may put on their own day. */
const SELF_STATUS = ["present", "remote"];
/** Everything `attendance.manage` may additionally write. */
const MANAGED_STATUS = ["present", "remote", "absent", "holiday"];

/**
 * Today, in the caller's own reckoning.
 *
 * Taken from the client as a plain `YYYY-MM-DD` rather than computed from the
 * server clock, because the server is in UTC and an organization in Karachi
 * checking in at 09:00 PKT is still on the previous UTC day for five hours
 * every morning. Validated hard below: it decides which row is written.
 */
function normaliseDate(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // A date the calendar rejects (2026-02-30) parses to a different day.
  if (d.toISOString().slice(0, 10) !== value) return null;
  return value;
}

export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const from = normaliseDate(searchParams.get("from"));
    const to = normaliseDate(searchParams.get("to"));
    const requestedUserId = searchParams.get("userId");

    // Wide key first, then the narrow one. Asking `attendance.view_own` first
    // would self-scope hr and manager, which is the exact fault the *_own
    // family was introduced to stop repeating.
    const canReadAnyone = authCan(auth, "attendance.view_all");
    if (!canReadAnyone && !authCan(auth, "attendance.view_own")) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const wantsSomeoneElse =
      requestedUserId && String(requestedUserId) !== String(auth.appUserId);
    if (wantsSomeoneElse && !canReadAnyone) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const svc = serviceClient();
    let query = svc
      .from("attendance_records")
      .select("*")
      .eq("organization_id", auth.orgId)
      .order("work_date", { ascending: false })
      .limit(500);

    if (wantsSomeoneElse) {
      if (!UUID_RE.test(String(requestedUserId))) {
        return NextResponse.json({ success: false, error: "Invalid userId" }, { status: 400 });
      }
      query = query.eq("user_id", requestedUserId);
    } else if (!canReadAnyone || searchParams.get("scope") === "me") {
      query = query.eq("user_id", auth.appUserId);
    }

    if (from) query = query.gte("work_date", from);
    if (to) query = query.lte("work_date", to);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, records: data || [] });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e?.message || "Could not load attendance" },
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

    const body = await request.json().catch(() => ({}));
    const action = body?.action === "check_out" ? "check_out" : "check_in";
    const workDate = normaliseDate(body?.workDate);
    if (!workDate) {
      return NextResponse.json(
        { success: false, error: "workDate must be YYYY-MM-DD" },
        { status: 400 }
      );
    }

    // Writing somebody else's day is a different permission from writing your
    // own, so the two are decided separately and before anything else.
    const targetId = body?.userId;
    const forSomeoneElse = targetId && String(targetId) !== String(auth.appUserId);

    if (forSomeoneElse) {
      const denied = requirePermission(auth, "attendance.manage");
      if (denied) return denied;
      if (!UUID_RE.test(String(targetId))) {
        return NextResponse.json({ success: false, error: "Invalid userId" }, { status: 400 });
      }
    } else {
      const denied = requirePermission(auth, "attendance.log_own");
      if (denied) return denied;
    }

    const billingBlocked = await requireUnlocked(serviceClient(), auth.orgId);
    if (billingBlocked) {
      return NextResponse.json(
        { success: false, ...billingBlocked },
        { status: billingBlocked.status }
      );
    }

    const svc = serviceClient();
    const userId = forSomeoneElse ? targetId : auth.appUserId;
    // Which profile table this person's row lives in. A STORAGE fact, and the
    // membership is the only place that answers it for somebody else — guessing
    // 'developer' would file an owner's day under the wrong type.
    let targetUserType = auth.userType === "admin" ? "admin" : "developer";

    if (forSomeoneElse) {
      // The target must be in this organization. Without this an HR lead could
      // write a row against any uuid in the world and it would sit in their own
      // org's table looking legitimate.
      const { data: member } = await svc
        .from("memberships")
        .select("user_id, user_type")
        .eq("organization_id", auth.orgId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!member) {
        return NextResponse.json(
          { success: false, error: "That person is not in this organization" },
          { status: 404 }
        );
      }
      targetUserType = member.user_type === "admin" ? "admin" : "developer";
    }

    const allowed = forSomeoneElse ? MANAGED_STATUS : SELF_STATUS;
    const status = allowed.includes(body?.status) ? body.status : allowed[0];

    const { data: existing } = await svc
      .from("attendance_records")
      .select("*")
      .eq("organization_id", auth.orgId)
      .eq("user_id", userId)
      .eq("work_date", workDate)
      .maybeSingle();

    const now = new Date().toISOString();

    if (action === "check_out") {
      if (!existing) {
        return NextResponse.json(
          { success: false, error: "There is no check-in on that day to close" },
          { status: 409 }
        );
      }
      if (existing.check_out_at) {
        // Idempotent rather than an error: a double-tapped button should not
        // read as a failure, and re-closing a closed day changes nothing.
        return NextResponse.json({ success: true, record: existing, unchanged: true });
      }
      const { data, error } = await svc
        .from("attendance_records")
        .update({ check_out_at: now, updated_at: now })
        .eq("id", existing.id)
        .select()
        .single();
      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true, record: data });
    }

    // check_in — idempotent for the same reason. The unique constraint in 075
    // is the floor under this; the read above is what makes the answer useful
    // instead of a constraint violation.
    if (existing) {
      return NextResponse.json({ success: true, record: existing, unchanged: true });
    }

    const { data, error } = await svc
      .from("attendance_records")
      .insert({
        organization_id: auth.orgId,
        user_id: userId,
        user_type: targetUserType,
        work_date: workDate,
        check_in_at: status === "absent" || status === "holiday" ? null : now,
        status,
        source: forSomeoneElse ? "hr" : "self",
        note: typeof body?.note === "string" ? body.note.slice(0, 500) : null,
        recorded_by: auth.appUserId,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, record: data });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e?.message || "Could not record attendance" },
      { status: 500 }
    );
  }
}
