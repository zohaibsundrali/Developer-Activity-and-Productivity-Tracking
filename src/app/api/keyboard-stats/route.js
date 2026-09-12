import { NextResponse } from "next/server";
import { getAuthedOrg, orgScopedClient } from "@/utils/serverAuth";
import { authCan } from "@/utils/serverPermissions";
import { validReportDate } from "@/utils/reportDates";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@(),"\\]+@[^\s@(),"\\]+\.[^\s@(),"\\]+$/;
const identityValue = value => !value || ['undefined', 'null'].includes(value) ? null : value;

const privateJson = (body, options = {}) => NextResponse.json(body, { ...options, headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization, Cookie' } });
function parseTimestamp(value) {
  if (typeof value !== 'string' || !validReportDate(value.slice(0, 10))) return null;
  if (value.length !== 10 && !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export async function GET(request) {
  try {
    // Authenticate the caller; reads run through an org-scoped client so RLS
    // limits results to the caller's organization.
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return privateJson({ error: "Unauthorized" }, { status: 401 });
    }
    if (!['admin', 'developer'].includes(auth.userType)) return privateJson({ error: 'Forbidden' }, { status: 403 });
    if (auth.overridesUnavailable) return privateJson({ error: 'Permissions unavailable. Please retry.' }, { status: 503 });
    const supabase = orgScopedClient(auth.token);

    const { searchParams } = new URL(request.url);
    let developerId = searchParams.get("developerId");
    let userId = searchParams.get("userId");
    let email = searchParams.get("email");
    const start = searchParams.get("start");
    const end = searchParams.get("end");

    if (!authCan(auth, "monitoring.view")) {
      if (auth.userType !== 'developer' || !authCan(auth, 'monitoring.view_own')) {
        return privateJson({ error: 'Forbidden' }, { status: 403 });
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
      return privateJson({ error: 'Invalid monitoring identity' }, { status: 400 });
    }

    if (!developerId && !email && !userId) {
      return privateJson(
        { error: "developerId, userId, or email required" },
        { status: 400 }
      );
    }

    if (!start || !end) {
      return privateJson(
        { error: "start and end required" },
        { status: 400 }
      );
    }

    const startDate = parseTimestamp(start);
    const endDate = parseTimestamp(end);
    if (!startDate || !endDate) {
      return privateJson(
        { error: "Invalid start or end timestamp" },
        { status: 400 }
      );
    }
    if (endDate.getTime() <= startDate.getTime()) {
      return privateJson(
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
    if (email) filterParts.push(developerId || userId
      ? `and(developer_id.is.null,user_email.eq.${JSON.stringify(email)})`
      : `user_email.eq.${JSON.stringify(email)}`);
    const orFilter = filterParts.join(",");

    // Bound report size while paging past the provider's per-request row cap.
    // Advance by returned rows: deployments may cap responses below 500.
    const data = [];
    let availableCount = null;
    const seen = new Set();
    let truncated = true;
    for (let page = 0; page < 20 && data.length < 10000; page += 1) {
      const { data: batch, count: total, error } = await supabase
        .from("keyboard_stats")
        .select(fields, { count: "exact" })
        .eq("organization_id", auth.orgId)
        .or(orFilter)
        .gte("tracked_at", startDate.toISOString())
        .lt("tracked_at", endDate.toISOString())
        .order("tracked_at", { ascending: false })
        .order("id", { ascending: false })
        .range(data.length, Math.min(data.length + 499, 9999));
      const limit = Math.min(500, 10000 - data.length);
      if (error || !Array.isArray(batch) || !Number.isSafeInteger(total) || total < 0
        || (availableCount !== null && total !== availableCount) || batch.length > limit
        || data.length + batch.length > total || (!batch.length && data.length !== total)) {
        return privateJson({ data: [], error: "Could not load keyboard activity" }, { status: 500 });
      }
      availableCount = total;
      for (const row of batch) {
        const id = row?.id;
        if ((typeof id !== 'string' || !id.trim()) && (typeof id !== 'number' || !Number.isSafeInteger(id))) {
          return privateJson({ data: [], error: "Could not load keyboard activity" }, { status: 500 });
        }
        const key = String(id);
        if (seen.has(key)) return privateJson({ data: [], error: "Could not load keyboard activity" }, { status: 500 });
        seen.add(key);
      }
      data.push(...batch);
      if (data.length >= total) {
        truncated = false;
        break;
      }
    }
    const count = data.length;
    return privateJson({
      data: data || [],
      source: "primary-date-filtered",
      dateRange: { start: startDate.toISOString(), end: endDate.toISOString() },
      count,
      availableCount,
      truncated,
      ...(count === 0 && !truncated ? { message: "No data for selected date range" } : {}),
    });

  } catch {
    return privateJson({ error: "Could not load keyboard activity" }, { status: 500 });
  }
}