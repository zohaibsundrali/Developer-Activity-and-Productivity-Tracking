const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function attendanceIdentity(context) {
  return context?.organizationId && context?.userId && context?.userType
    ? `${context.organizationId}:${context.userType}:${context.userId}` : null;
}

export async function loadAttendanceRange(fetcher, { from, to, context, current = () => true }) {
  const records = [];
  const ids = new Set();
  const cursors = new Set();
  const days = new Set();
  let cursor = null;
  do {
    if (!current()) return null;
    const params = new URLSearchParams({ scope: "me", from, to, limit: "100" });
    if (cursor) params.set("cursor", cursor);
    const response = await fetcher(`/api/attendance?${params}`);
    const json = await response.json().catch(() => ({}));
    if (!current()) return null;
    if (!response.ok || !json.success || !Array.isArray(json.records)) {
      throw new Error(json.error || "Could not load your attendance.");
    }
    for (const row of json.records) {
      if (!UUID.test(row?.id || "") || ids.has(row.id) || days.has(row.work_date)
        || !/^\d{4}-\d{2}-\d{2}$/.test(row.work_date || "") || !Number.isFinite(Date.parse(row.work_date))
        || new Date(row.work_date).toISOString().slice(0, 10) !== row.work_date
        || row.work_date < from || row.work_date > to
        || !context || row.organization_id !== context.organizationId || row.user_id !== context.userId || row.user_type !== context.userType) {
        throw new Error("Attendance changed while loading. Please retry.");
      }
      ids.add(row.id);
      days.add(row.work_date);
      records.push(row);
    }
    cursor = json.nextCursor ?? null;
    if ((typeof json.hasMore !== "boolean" || json.hasMore !== (cursor !== null)) || (cursor !== null && (typeof cursor !== "string" || !cursor.trim() || cursors.has(cursor) || !json.records.length)) || records.length > 10000) {
      throw new Error("Could not load complete attendance. Please retry.");
    }
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return records;
}

export function validateAttendanceReceipt(json, context, workDate, action) {
  const row = json?.record;
  if (!json?.success || typeof json.unchanged !== "boolean" || !UUID.test(row?.id || "")
    || row.organization_id !== context.organizationId || row.user_id !== context.userId
    || row.user_type !== context.userType || row.work_date !== workDate
    || (!json.unchanged && (!row.check_in_at || (action === "check_out" && !row.check_out_at)))) {
    throw new Error("Could not confirm attendance. Refresh before trying again.");
  }
  return row;
}
