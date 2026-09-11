import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { requirePermission } from "@/utils/serverPermissions";
import { requireUnlocked } from "@/utils/entitlements";

export const dynamic = "force-dynamic";

/**
 * /api/capacity — supply, leave, commitment and what actually happened.
 *
 *   GET    ?week=YYYY-MM-DD   one week of capacity for the whole organization
 *   PATCH  set a project allocation, or somebody's contracted weekly hours
 *
 * TWO DIFFERENT WRITES BEHIND TWO DIFFERENT KEYS. Setting a project allocation
 * is a staffing decision (`capacity.allocate`, owner/admin/manager — the same
 * roles 071's project_members policy already allows). Setting contracted hours
 * is an employment fact about a person (`employment.set_hours`, owner/admin/hr).
 * A manager who could quietly raise a report's weekly hours could make their own
 * plan come out right.
 *
 * NOTHING IS INVENTED WHERE THE DATA IS ABSENT. `capacity_week_v` returns NULL
 * for available_hours and utilisation when nobody has said how many hours a
 * person works, and this route passes that through untouched. A default of 40
 * would plan every part-timer, contractor and intern as full-time and the
 * numbers would look complete.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const numericInput = value =>
  typeof value === "number" || (typeof value === "string" && value.trim() !== "");

/** Must be the ISO Monday, so this agrees with timesheet_week_of() in 077. */
function isoMonday(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  if (d.toISOString().slice(0, 10) !== value) return null;
  if (d.getUTCDay() !== 1) return null;
  return value;
}

// Legacy callers may omit type only when the organization's complete membership
// history resolves the UUID uniquely. Never choose the first colliding profile.
async function capacityTarget(svc, orgId, userId, userType) {
  if (userType !== undefined && !['admin', 'developer'].includes(userType)) {
    return { error: 'Invalid userType', status: 400 };
  }
  let query = svc.from('memberships').select('user_type')
    .eq('organization_id', orgId).eq('user_id', userId).in('user_type', ['admin', 'developer']);
  if (userType) query = query.eq('user_type', userType);
  const { data, error } = await query.limit(3);
  if (error) return { error: 'Could not verify that person', status: 503 };
  const types = [...new Set((data || []).map(row => row.user_type))];
  if (!types.length) return { error: 'That person is not in this organization', status: 404 };
  if (types.length !== 1) return { error: 'Specify userType for this person', status: 400 };
  return { userType: types[0] };
}

export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    if (!["admin", "developer"].includes(auth.userType)) return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    const denied = requirePermission(auth, "capacity.view");
    if (denied) return denied;

    const { searchParams } = new URL(request.url);
    const suppliedWeek = searchParams.get("week");
    let week;
    if (suppliedWeek === null) {
      const today = new Date();
      today.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7));
      week = today.toISOString().slice(0, 10);
    } else {
      week = isoMonday(suppliedWeek);
      if (!week) return NextResponse.json({ success: false, error: "Week must be a valid ISO Monday (YYYY-MM-DD)" }, { status: 400 });
    }
    const svc = serviceClient();
    const rows = [];
    // Page the selected week explicitly, including zero-activity staff. Do not
    // silently truncate the organization at the Data API's response row cap.
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await svc.rpc("capacity_for_week", { p_org: auth.orgId, p_week: week })
        .order("user_type").order("user_id").range(offset, offset + 499);
      if (error || !Array.isArray(data)) {
        return NextResponse.json({ success: false, error: "Could not load capacity" }, { status: 503 });
      }
      rows.push(...data);
      if (data.length < 500) break;
    }
    return NextResponse.json({ success: true, rows, week });
  } catch {
    return NextResponse.json({ success: false, error: "Could not load capacity" }, { status: 503 });
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
    const svc = serviceClient();

    // ── Contracted hours: an employment fact, so HR's key ──────────────────
    if (body?.weeklyHours !== undefined) {
      const denied = requirePermission(auth, "employment.set_hours");
      if (denied) return denied;
      if (!UUID_RE.test(String(body?.userId || ""))) {
        return NextResponse.json({ success: false, error: "Invalid userId" }, { status: 400 });
      }

      const hours = body.weeklyHours === null ? null : Number(body.weeklyHours);
      // null is a real answer — it clears the figure back to "not set" — but a
      // nonsense number is not.
      if (hours !== null && (!numericInput(body.weeklyHours) || !Number.isFinite(hours) || hours <= 0 || hours > 168 || Math.abs(hours * 100 - Math.round(hours * 100)) > 1e-8)) {
        return NextResponse.json(
          { success: false, error: "Weekly hours must be greater than 0 and at most 168, with up to two decimal places, or blank" },
          { status: 400 }
        );
      }

      const blocked = await requireUnlocked(svc, auth.orgId);
      if (blocked) return NextResponse.json({ success: false, ...blocked }, { status: blocked.status });

      const target = await capacityTarget(svc, auth.orgId, body.userId, body.userType);
      if (target.error) return NextResponse.json({ success: false, error: target.error }, { status: target.status });

      // The profile must already exist and be in this organization. Creating
      // one here would make a half-formed employee record out of a typo.
      const { data: profile, error: profileError } = await svc
        .from("employee_profiles")
        .select("id, user_type")
        .eq("organization_id", auth.orgId)
        .eq("user_id", body.userId)
        .eq("user_type", target.userType)
        .maybeSingle();
      if (profileError) return NextResponse.json({ success: false, error: "Could not verify the employee profile" }, { status: 503 });
      if (!profile) {
        return NextResponse.json(
          { success: false, error: "That person has no employee profile yet" },
          { status: 404 }
        );
      }

      const { data, error } = await svc
        .from("employee_profiles")
        .update({ weekly_hours: hours, updated_at: new Date().toISOString() })
        .eq("id", profile.id)
        .eq("organization_id", auth.orgId).eq("user_id", body.userId).eq("user_type", target.userType)
        .select("id, user_id, user_type, weekly_hours")
        .single();
      if (error || !data?.id) {
        return NextResponse.json({ success: false, error: "Could not confirm the hours update" }, { status: 503 });
      }
      return NextResponse.json({ success: true, profile: data });
    }

    // ── Project allocation: a staffing decision ────────────────────────────
    const denied = requirePermission(auth, "capacity.allocate");
    if (denied) return denied;

    const { projectId, userId } = body || {};
    if (!UUID_RE.test(String(projectId || "")) || !UUID_RE.test(String(userId || ""))) {
      return NextResponse.json({ success: false, error: "Invalid ids" }, { status: 400 });
    }

    const pct = body?.allocationPct === null ? null : Number(body?.allocationPct);
    if (pct !== null && (!numericInput(body?.allocationPct) || !Number.isInteger(pct) || pct < 0 || pct > 100)) {
      // 0..100 per PROJECT. A person may still total more than 100 across
      // several — that is the over-allocation the screen exists to show, and it
      // is not refused here.
      return NextResponse.json(
        { success: false, error: "Allocation must be a whole number from 0 to 100, or blank" },
        { status: 400 }
      );
    }

    const blocked = await requireUnlocked(svc, auth.orgId);
    if (blocked) return NextResponse.json({ success: false, ...blocked }, { status: blocked.status });

    const target = await capacityTarget(svc, auth.orgId, userId, body.userType);
    if (target.error) return NextResponse.json({ success: false, error: target.error }, { status: target.status });

    // The membership row must already exist: allocation describes somebody who
    // is ON the project, and creating the membership here would put them on it
    // as a side effect of a number.
    const { data: member, error: memberError } = await svc
      .from("project_members")
      .select("id")
      .eq("organization_id", auth.orgId)
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .eq("user_type", target.userType)
      .maybeSingle();
    if (memberError) return NextResponse.json({ success: false, error: "Could not verify project membership" }, { status: 503 });
    if (!member) {
      return NextResponse.json(
        { success: false, error: "That person is not on that project" },
        { status: 404 }
      );
    }

    const { data, error } = await svc
      .from("project_members")
      .update({ allocation_pct: pct, updated_at: new Date().toISOString() })
      .eq("id", member.id)
      .eq("organization_id", auth.orgId).eq("project_id", projectId).eq("user_id", userId).eq("user_type", target.userType)
      .select()
      .single();
    if (error || !data?.id) {
      return NextResponse.json({ success: false, error: "Could not confirm the allocation update" }, { status: 503 });
    }
    return NextResponse.json({ success: true, member: data });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: "Could not update capacity" },
      { status: 500 }
    );
  }
}
