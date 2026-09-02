import { NextResponse } from "next/server";
import { getAuthedOrg, orgScopedClient } from "@/utils/serverAuth";
import { authCan } from "@/utils/serverPermissions";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    // Authenticate the caller; reads run through an org-scoped client so RLS
    // limits results to the caller's organization.
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const supabase = orgScopedClient(auth.token);

    const { searchParams } = new URL(request.url);
    let developerId = searchParams.get("developerId");
    let userId = searchParams.get("userId");
    let email = searchParams.get("email");
    const start = searchParams.get("start");
    const end = searchParams.get("end");

    // Anyone without the monitoring key reads only their own keystroke data —
    // the identity filters are forced to the JWT identity regardless of query
    // params.
    //
    // Behaviour is UNCHANGED by this rewrite and that is the point: userType
    // "admin" is exactly owner+admin, and `monitoring.view` is ADMINS. The
    // check now says what it means, so widening it later is an edit to the
    // catalogue instead of a search for every route that spells the rule out
    // in terms of which table a profile row lives in.
    if (!authCan(auth, "monitoring.view")) {
      developerId = auth.appUserId;
      userId = null;
      email = auth.email;
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

    // Build OR filters
    const filterParts = [];
    if (developerId && developerId !== "undefined" && developerId !== "null") filterParts.push(`developer_id.eq.${developerId}`);
    if (userId && userId !== "undefined" && userId !== "null") filterParts.push(`developer_id.eq.${userId}`);
    if (email && email !== "undefined" && email !== "null") filterParts.push(`user_email.eq.${email}`);
    const orFilter = filterParts.join(",");

    // Query strictly within the requested date range
    const query = supabase
      .from("keyboard_stats")
      .select(fields)
      .or(orFilter)
      .gte("tracked_at", startDate.toISOString())
      .lte("tracked_at", endDate.toISOString())
      .order("tracked_at", { ascending: false });

    const { data, error } = await query;

    if (error) {
      console.error("[keyboard-stats] Query error:", error);
      return NextResponse.json({ data: [], error: error.message }, { status: 500 });
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
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}