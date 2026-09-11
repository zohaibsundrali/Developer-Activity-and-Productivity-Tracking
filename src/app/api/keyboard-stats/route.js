import { NextResponse } from "next/server";
import { getAuthedOrg, orgScopedClient } from "@/utils/serverAuth";
import { authCan } from "@/utils/serverPermissions";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@(),"\\]+@[^\s@(),"\\]+\.[^\s@(),"\\]+$/;
const identityValue = value => !value || ['undefined', 'null'].includes(value) ? null : value;

export async function GET(request) {
  try {
    // Authenticate the caller; reads run through an org-scoped client so RLS
    // limits results to the caller's organization.
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!['admin', 'developer'].includes(auth.userType)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (auth.overridesUnavailable) return NextResponse.json({ error: 'Permissions unavailable. Please retry.' }, { status: 503 });
    const supabase = orgScopedClient(auth.token);

    const { searchParams } = new URL(request.url);
    let developerId = searchParams.get("developerId");
    let userId = searchParams.get("userId");
    let email = searchParams.get("email");
    const start = searchParams.get("start");
    const end = searchParams.get("end");

    if (!authCan(auth, "monitoring.view")) {
      if (auth.userType !== 'developer' || !authCan(auth, 'monitoring.view_own')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      developerId = auth.appUserId;
      userId = null;
      email = auth.email;
    }
    developerId = identityValue(developerId);
    userId = identityValue(userId);
    email = identityValue(email);
    if (!developerId && !userId && !email && auth.userType === 'developer') {
      developerId = auth.appUserId;
      email = auth.email || null;
    }
    if ((developerId && !UUID.test(developerId)) || (userId && !UUID.test(userId)) || (email && !EMAIL.test(email))) {
      return NextResponse.json({ error: 'Invalid monitoring identity' }, { status: 400 });
    }

    if (!developerId && !email && !userId) {
      return NextResponse.json(
        { error: "developerId, userId, or email required" },
        { status: 400 }
      );
    }

    if (!start || !end) {
      return NextResponse.json(
        { error: "start and end required" },
        { status: 400 }
      );
    }

    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid start or end timestamp" },
        { status: 400 }
      );
    }
    if (endDate.getTime() <= startDate.getTime()) {
      return NextResponse.json(
        { error: "end must be after start" },
        { status: 400 }
      );
    }

    const fields = [
      "id", "session_id", "user_email", "developer_id",
      "total_time_minutes", "active_time_minutes", "idle_time_minutes",
      "keyboard_activity_percentage", "total_keys", "unique_keys",
      "words_per_minute", "activity_score", "per_minute_summary", "tracked_at"
    ].join(",");

    // UUIDs are validated; quoted email values cannot introduce OR syntax.
    const filterParts = [];
    if (developerId) filterParts.push(`developer_id.eq.${developerId}`);
    if (userId) filterParts.push(`developer_id.eq.${userId}`);
    if (email) filterParts.push(`user_email.eq.${JSON.stringify(email)}`);
    const orFilter = filterParts.join(",");

    // Query strictly within the requested date range
    const query = supabase
      .from("keyboard_stats")
      .select(fields)
      .eq("organization_id", auth.orgId)
      .or(orFilter)
      .gte("tracked_at", startDate.toISOString())
      .lte("tracked_at", endDate.toISOString())
      .order("tracked_at", { ascending: false });

    const { data, error } = await query;

    if (error) {
      console.error("[keyboard-stats] Query error:", error);
      return NextResponse.json({ data: [], error: "Could not load keyboard activity" }, { status: 500 });
    }

    const count = data?.length || 0;
    return NextResponse.json({
      data: data || [],
      source: "primary-date-filtered",
      dateRange: { start: startDate.toISOString(), end: endDate.toISOString() },
      count,
      ...(count === 0 ? { message: "No data for selected date range" } : {}),
    });

  } catch (err) {
    console.error("[keyboard-stats] Error:", err);
    return NextResponse.json({ error: "Could not load keyboard activity" }, { status: 500 });
  }
}