import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient, orgScopedClient } from "@/utils/serverAuth";
import { authCan, requirePermission } from "@/utils/serverPermissions";

export const dynamic = "force-dynamic";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SELF_STATUS = ["present", "remote"];
const MANAGED_STATUS = [...SELF_STATUS, "absent", "holiday"];
function normaliseDate(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : null;
}
function reply(body, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Authorization, Cookie" } });
}
function fail(error, status = 400) { return reply({ success: false, error }, status); }
function databaseFailure(error) {
  const token = String(error?.message || "").split(":")[0];
  const status = token === "BILLING_LOCKED" ? 402 : error?.code === "42501" ? 403
    : error?.code === "P0002" ? 404 : error?.code === "22023" ? 400
    : ["55000", "23514", "23505", "40001"].includes(error?.code) ? 409 : 503;
  return fail(status === 402 ? "Your subscription requires attention before attendance can change."
    : status === 403 ? "You do not have permission for this attendance action."
    : status === 404 ? "That active staff member was not found."
    : status === 409 ? "Attendance could not change. Reload the day and check that it has a check-in."
    : status === 400 ? "Invalid attendance request. Check the date, action and status."
    : "Attendance is temporarily unavailable. Please retry.", status);
}

export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return fail("Unauthorized", 401);
    if (!["admin", "developer"].includes(auth.userType)) return fail("Forbidden", 403);
    const canReadAnyone = authCan(auth, "attendance.view_all");
    if (!canReadAnyone && !authCan(auth, "attendance.view_own")) return fail("Forbidden", 403);
    const q = new URL(request.url).searchParams;
    const from = q.get("from"), to = q.get("to");
    if ((from !== null && !normaliseDate(from)) || (to !== null && !normaliseDate(to)) || (from && to && from > to)) return fail("Invalid attendance date range");
    const requestedId = q.get("userId"), requestedType = q.get("userType");
    if (requestedId !== null && !UUID_RE.test(requestedId)) return fail("Invalid userId");
    if (requestedType !== null && !["admin", "developer"].includes(requestedType)) return fail("Invalid userType");
    if (requestedType && !requestedId) return fail("userType requires userId");
    const scope = q.get("scope");
    if (scope !== null && !["me", "all"].includes(scope)) return fail("Invalid scope");
    const self = !canReadAnyone || scope === "me";
    if (self && ((requestedId && requestedId.toLowerCase() !== auth.appUserId) || (requestedType && requestedType !== auth.userType))) return fail("Forbidden", 403);
    const targetId = self ? auth.appUserId : requestedId?.toLowerCase() || null;
    const targetType = self ? auth.userType : requestedType || (targetId === auth.appUserId ? auth.userType : null);
    const rawLimit = q.get("limit"), limit = rawLimit === null ? 100 : Number(rawLimit);
    if (rawLimit !== null && (!/^[1-9]\d{0,2}$/.test(rawLimit) || limit > 500)) return fail("limit must be from 1 to 500");
    const binding = { org: auth.orgId, caller: auth.appUserId, type: auth.userType, targetId, targetType, from, to };
    let cursor = null;
    if (q.has("cursor")) {
      try {
        const raw = q.get("cursor");
        if (!raw || raw.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
        cursor = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
        if (!normaliseDate(cursor?.date) || !UUID_RE.test(cursor?.id || "") || Object.entries(binding).some(([k,v]) => cursor[k] !== v)) throw new Error();
      } catch { return fail("Invalid attendance cursor. Reload the list."); }
    }
    const svc = serviceClient();
    const build = (after, count, columns = "*") => {
      let query = svc.from("attendance_records").select(columns).eq("organization_id", auth.orgId)
        .order("work_date", { ascending: false }).order("id", { ascending: false }).limit(count);
      if (targetId) query = query.eq("user_id", targetId);
      if (targetType) query = query.eq("user_type", targetType);
      if (from) query = query.gte("work_date", from);
      if (to) query = query.lte("work_date", to);
      if (after) query = query.or(`work_date.lt.${after.date},and(work_date.eq.${after.date},id.lt.${after.id})`);
      return query;
    };
    const { data, error } = await build(cursor, limit);
    if (error || !Array.isArray(data)) return databaseFailure(error);
    let nextCursor = null;
    if (data.length) {
      const last = data[data.length - 1];
      if (!normaliseDate(last.work_date) || !UUID_RE.test(last.id || "")) return databaseFailure(null);
      const after = { date: last.work_date, id: last.id };
      const probe = await build(after, 1, "id");
      if (probe.error || !Array.isArray(probe.data)) return databaseFailure(probe.error);
      if (probe.data.length) nextCursor = Buffer.from(JSON.stringify({ ...binding, ...after })).toString("base64url");
    }
    return reply({ success: true, records: data, hasMore: nextCursor !== null, nextCursor });
  } catch { return databaseFailure(null); }
}

export async function POST(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return fail("Unauthorized", 401);
    if (!["admin", "developer"].includes(auth.userType)) return fail("Forbidden", 403);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail("Invalid attendance request");
    if (Object.keys(body).some(k => !["action", "workDate", "userId", "userType", "status", "note"].includes(k))) return fail("Unexpected attendance field");
    const action = body.action === undefined ? "check_in" : body.action;
    if (!["check_in", "check_out"].includes(action)) return fail("Invalid attendance action");
    const workDate = normaliseDate(body.workDate);
    if (!workDate) return fail("workDate must be YYYY-MM-DD");
    const targetId = body.userId === undefined ? auth.appUserId : body.userId;
    if (typeof targetId !== "string" || !UUID_RE.test(String(targetId))) return fail("Invalid userId");
    const explicitType = body.userType;
    if (explicitType !== undefined && !["admin", "developer"].includes(explicitType)) return fail("Invalid userType");
    const userId = targetId.toLowerCase();
    const userType = explicitType || (userId === auth.appUserId ? auth.userType : null);
    const forSomeoneElse = userId !== auth.appUserId || userType !== auth.userType;
    if (forSomeoneElse) {
      const denied = requirePermission(auth, "attendance.manage");
      if (denied) return denied;
    } else {
      const denied = requirePermission(auth, "attendance.log_own");
      if (denied) return denied;
    }
    const status = body.status === undefined ? "present" : body.status;
    if (!(forSomeoneElse ? MANAGED_STATUS : SELF_STATUS).includes(status)) return fail("Invalid attendance status");
    if (body.note !== undefined && (typeof body.note !== "string" || body.note.length > 500)) return fail("note must be text up to 500 characters");
    // Caller RPC rechecks active typed membership, permissions and billing
    // inside the same lock/transaction as the idempotent clock transition.
    const { data, error } = await orgScopedClient(auth.token).rpc("record_attendance", {
      p_action: action, p_work_date: workDate, p_user_id: userId, p_user_type: userType,
      p_status: status, p_note: body.note ?? null,
    });
    if (error) return databaseFailure(error);
    const row = data?.record;
    if (!row || !UUID_RE.test(row.id || "") || row.organization_id !== auth.orgId || row.user_id !== userId
      || !["admin", "developer"].includes(row.user_type) || (userType && row.user_type !== userType)
      || row.work_date !== workDate || typeof data.unchanged !== "boolean"
      || ![...MANAGED_STATUS, "on_leave"].includes(row.status)
      || (!data.unchanged && action === "check_in" && (row.status !== status || row.source !== (forSomeoneElse ? "hr" : "self")))
      || (action === "check_out" && (!Number.isFinite(Date.parse(row.check_in_at)) || !Number.isFinite(Date.parse(row.check_out_at))
        || Date.parse(row.check_out_at) < Date.parse(row.check_in_at)))) return databaseFailure(null);
    return reply({ success: true, record: row, unchanged: data.unchanged });
  } catch { return databaseFailure(null); }
}
