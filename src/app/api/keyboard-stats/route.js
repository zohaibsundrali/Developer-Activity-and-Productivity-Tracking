// Replace the entire keyboard_stats/route.js with this:
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
export const dynamic = "force-dynamic";
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const developerId = searchParams.get("developerId");
    const userId = searchParams.get("userId");
    const email = searchParams.get("email");
    const start = searchParams.get("start");
    const end = searchParams.get("end");


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