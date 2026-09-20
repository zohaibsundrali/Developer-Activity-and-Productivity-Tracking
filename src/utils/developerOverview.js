import { bucketMyWork, deadlineOf } from "@/utils/myWork";
import {
  loadMonitoringSessions,
  sumMonitoringSessionDuration,
} from "@/utils/monitoringSessions";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Calendar boundaries in the workspace timezone, including 23/25-hour DST days. */
export function overviewDay(now = new Date(), zone = "UTC") {
  let timezone = zone || "UTC",
    formatter;
  try {
    formatter = new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    timezone = "UTC";
    formatter = new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }
  const dayAt = (value) => {
    const p = Object.fromEntries(
      formatter.formatToParts(new Date(value)).map((x) => [x.type, x.value]),
    );
    return `${p.year}-${p.month}-${p.day}`;
  };
  const day = dayAt(now),
    next = new Date(Date.parse(day) + 86400000).toISOString().slice(0, 10);
  const boundary = (target) => {
    const base = Date.parse(target);
    let low = base - 36 * 3600000,
      high = base + 36 * 3600000;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (dayAt(mid) < target) low = mid + 1;
      else high = mid;
    }
    return new Date(low).toISOString();
  };
  return { day, timezone, start: boundary(day), end: boundary(next) };
}
export function overviewWork(tasks, today) {
  const work = bucketMyWork(tasks, today);
  const dueToday = work.buckets.due_soon.filter((t) => deadlineOf(t) === today);
  const attention = [
    ...work.buckets.sent_back.map((task) => ({
      task,
      label: "Sent back",
      tone: "error",
    })),
    ...work.buckets.overdue.map((task) => ({
      task,
      label: "Overdue",
      tone: "error",
    })),
    ...dueToday.map((task) => ({ task, label: "Due today", tone: "warning" })),
  ];
  return {
    ...work,
    dueToday: dueToday.length,
    attention,
    completed: tasks.filter((t) => ["completed", "approved"].includes(t.status))
      .length,
  };
}
export function overviewDuration(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0)
    return "—";
  const n = Math.floor(seconds);
  return [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");
}
export async function loadOverviewTasks(
  client,
  { organizationId, profileId },
  current = () => true,
) {
  if (!UUID.test(organizationId || "") || !UUID.test(profileId || ""))
    throw new Error("Your workspace session is incomplete. Sign in again.");
  const rows = [],
    seen = new Set();
  let total = null;
  while (current()) {
    const result = await client
      .from("developer_tasks")
      .select(
        "id,organization_id,developer_id,task_title,status,priority,project_id,due_date,end_date,updated_at",
        { count: "exact" },
      )
      .eq("organization_id", organizationId)
      .eq("developer_id", profileId)
      .order("id")
      .range(rows.length, rows.length + 499);
    if (!current()) return null;
    if (
      result.error ||
      !Array.isArray(result.data) ||
      !Number.isSafeInteger(result.count) ||
      result.count < 0 ||
      (total !== null && total !== result.count)
    )
      throw new Error(
        "Your tasks could not be loaded completely. Please refresh.",
      );
    total = result.count;
    for (const row of result.data) {
      if (
        !row.id ||
        seen.has(row.id) ||
        row.organization_id !== organizationId ||
        row.developer_id !== profileId
      )
        throw new Error("Your task list changed. Please refresh.");
      seen.add(row.id);
      rows.push(row);
    }
    if (rows.length === total) return rows;
    if (!result.data.length || rows.length > total)
      throw new Error("Your task list changed. Please refresh.");
  }
  return null;
}
export async function loadOverviewTime(
  client,
  identity,
  day,
  current = () => true,
) {
  const sessions = await loadMonitoringSessions(
    client,
    { ...identity, start: day.start, end: day.end },
    current,
  );
  if (sessions === null) return null;
  const seconds = sumMonitoringSessionDuration(sessions);
  if (seconds === null)
    throw new Error(
      "Tracker duration is unavailable. Please retry after the tracker syncs.",
    );
  return {
    seconds,
    sessions: sessions.length,
    checkedAt: new Date().toISOString(),
    day: day.day,
  };
}
