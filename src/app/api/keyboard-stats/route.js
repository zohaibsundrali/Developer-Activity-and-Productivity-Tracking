import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Use service role key to bypass RLS; fall back to anon key if not configured
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const isValidKey = serviceKey && serviceKey.startsWith("eyJ");
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  isValidKey ? serviceKey : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const developerId = searchParams.get("developerId");
    const email = searchParams.get("email");
    const start = searchParams.get("start");
    const end = searchParams.get("end");

    if (!developerId && !email) {
      return NextResponse.json({ error: "developerId or email required" }, { status: 400 });
    }

    const fields = "id, session_id, user_email, developer_id, total_time_minutes, active_time_minutes, idle_time_minutes, keyboard_activity_percentage, total_keys, unique_keys, words_per_minute, activity_score, per_minute_summary, tracked_at";

    // Primary query: match either developer_id or user_email with date filter
    const filters = [
      developerId && `developer_id.eq.${developerId}`,
      email && `user_email.eq.${email}`,
    ].filter(Boolean).join(",");

    let query = supabase
      .from("keyboard_stats")
      .select(fields)
      .or(filters)
      .order("tracked_at", { ascending: false });

    if (start && end) {
      query = query.gte("tracked_at", start).lte("tracked_at", end);
    }

    const { data, error } = await query;

    if (data?.length) {
      return NextResponse.json({ data, source: "primary" });
    }

    // Fallback 1: email only, no date filter
    if (email) {
      const { data: fb1, error: fb1Err } = await supabase
        .from("keyboard_stats")
        .select(fields)
        .eq("user_email", email)
        .order("tracked_at", { ascending: false })
        .limit(100);
      if (fb1?.length) {
        return NextResponse.json({ data: fb1, source: "fallback-email" });
      }
    }

    // Fallback 2: or() without date filter
    const { data: fb2, error: fb2Err } = await supabase
      .from("keyboard_stats")
      .select(fields)
      .or(filters)
      .order("tracked_at", { ascending: false })
      .limit(50);
    if (fb2?.length) {
      return NextResponse.json({ data: fb2, source: "fallback-or-nodate" });
    }

    // Diagnostic: unfiltered
    const { data: diag, error: diagErr } = await supabase
      .from("keyboard_stats")
      .select("id, user_email, developer_id, total_keys, tracked_at")
      .order("tracked_at", { ascending: false })
      .limit(5);
    if (diag?.length) {
      // Data exists but filters don't match - refetch with actual values
      const actualEmail = diag[0]?.user_email;
      const actualDevId = diag[0]?.developer_id;
      const fixFilters = [
        actualDevId && `developer_id.eq.${actualDevId}`,
        actualEmail && `user_email.eq.${actualEmail}`,
      ].filter(Boolean).join(",");

      const { data: fixed } = await supabase
        .from("keyboard_stats")
        .select(fields)
        .or(fixFilters)
        .order("tracked_at", { ascending: false })
        .limit(100);

      if (fixed?.length) {
        return NextResponse.json({
          data: fixed,
          source: "diagnostic-refetch",
          mismatch: {
            expected: { developerId, email },
            actual: { developer_id: actualDevId, user_email: actualEmail },
          },
        });
      }
    }

    return NextResponse.json({ data: [], source: "empty", error: error?.message || diagErr?.message });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
