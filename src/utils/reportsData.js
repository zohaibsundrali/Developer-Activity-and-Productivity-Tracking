import { supabase } from "@/utils/supabaseClient";
import { getOrgId } from "@/utils/orgContext";
import { authFetch } from "@/utils/authFetch";
import { loadEmployees } from "@/utils/employeesData";
import { normalizeStatus, sumSeconds } from "@/utils/pmData";

/**
 * Reporting data layer.
 *
 * Two independent time sources are combined here, and the distinction matters:
 *
 *  1. `task_time_logs` (017) — EXACT per-task time from the in-app timer.
 *     Task-attributable. Only exists for work someone explicitly timed.
 *
 *  2. `productivity_sessions` + friends — the DESKTOP tracker. Accurate for
 *     total tracked time. New desktop sessions may carry project/task links;
 *     this report still aggregates desktop time per developer/day separately
 *     from task_time_logs to avoid counting the same work twice.
 *
 * Current device writers provide organization_id under authenticated RLS.
 * This reader also scopes historical rows by the organization's developer
 * identities; historical records may lack newer attribution columns.
 *
 * `productivity_sessions.total_duration` is treated as SECONDS, matching the
 * existing readers (DashboardOverview, DeveloperActivity).
 */

const DONE = new Set(["completed", "reviewed"]);
export const TRACKING_CAVEAT =
  "This report groups desktop time per developer per day. Project/task selections appear in session history; they do not automatically create task time logs or billable entries.";

/**
 * PostgREST caps a single response at 1000 rows, so the previous unpaged
 * `.select()` silently truncated every report on a busy organization. We now
 * walk explicit ranges, and stop at a hard ceiling so one large tenant cannot
 * exhaust the browser's memory. `truncated` tells the caller we hit the wall.
 */
const PAGE_SIZE = 1000;
const MAX_PROJECT_ROWS = 5000;
const MAX_TASK_ROWS = 20000;
const MAX_TIME_LOG_ROWS = 20000;
const MAX_SESSION_ROWS = 10000;

// A very long `in.(…)` list becomes a URL longer than the gateway accepts, so
// identity filters are issued in chunks.
const IN_CHUNK = 100;

// Status groups mirroring normalizeStatus()/STATUS_ALIAS in pmData.js. They let
// the donut + KPI counts be answered by four HEAD requests instead of shipping
// every task row to the browser just to bucket it.
const IN_PROGRESS_STATUSES = ["in_progress", "doing"];
const IN_REVIEW_STATUSES = ["awaiting_approval", "reviewed", "in_review"];
const COMPLETED_STATUSES = ["completed", "done", "approved"];

function chunked(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Page through `buildQuery()` until it runs dry or `maxRows` is reached.
 * `buildQuery` must apply a deterministic `.order()`, otherwise pages can
 * overlap or skip rows.
 */
async function fetchPaged(buildQuery, maxRows) {
  const rows = [];
  for (let offset = 0; offset < maxRows; offset += PAGE_SIZE) {
    const size = Math.min(PAGE_SIZE, maxRows - offset);
    const { data, error } = await buildQuery().range(offset, offset + size - 1);
    if (error || !Array.isArray(data)) throw new Error("Report data lookup failed");
    rows.push(...data);
    if (data.length < size) return { rows, truncated: false, error: null };
  }
  return { rows, truncated: true, error: null };
}

function ymd(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  const d1 = new Date(a);
  const d2 = new Date(b);
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return 0;
  return Math.round((d2.getTime() - d1.getTime()) / 86400000);
}

/** Default range: last 30 days (inclusive), as ISO date strings. */
export function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 86400000);
  return { from: ymd(from), to: ymd(to) };
}

/**
 * Load everything the reports need in one pass.
 * range = { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' } (applied to time/session data;
 * tasks and projects are loaded whole so status totals stay meaningful — up to
 * the row ceilings above, past which the headline status totals come from the
 * database rather than from the rows we managed to fetch).
 */
export async function loadReportData(range = defaultRange()) {
  const query = new URLSearchParams({ from: range.from, to: range.to });
  const response = await authFetch(`/api/reports?${query}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.detail || body.error || "Reports unavailable");
  return body;
}

export async function loadReportDataForClient(range, client = supabase, orgId = getOrgId()) {
  if (!orgId) return emptyBundle();

  const { from, to } = range || defaultRange();
  const fromIso = from ? new Date(`${from}T00:00:00`).toISOString() : null;
  const toIso = to ? new Date(`${to}T23:59:59`).toISOString() : null;

  const logFrom = fromIso || "1970-01-01T00:00:00Z";
  const logTo = toIso || new Date().toISOString();

  // Projects + tasks + explicit time logs are all org-scoped and RLS-safe.
  const [projRes, taskRes, logRes, empRes, statusCounts] = await Promise.all([
    fetchPaged(
      () =>
        client
          .from("projects")
          .select("id, name, status, progress, deadline, start_date, end_date, archived, created_at")
          .eq("organization_id", orgId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: true }),
      MAX_PROJECT_ROWS
    ),
    fetchPaged(
      () =>
        client
          .from("developer_tasks")
          .select(
            "id, project_id, developer_id, task_title, status, priority, task_type, story_points, due_date, start_date, end_date, actual_completion_date, is_on_time, productivity_points, reviewed_at, created_at, updated_at"
          )
          .eq("organization_id", orgId)
          .order("id", { ascending: true }),
      MAX_TASK_ROWS
    ),
    fetchPaged(
      () =>
        client
          .from("task_time_logs")
          .select("id, task_id, project_id, developer_id, user_type, started_at, ended_at, seconds, source")
          .eq("organization_id", orgId)
          .gte("started_at", logFrom)
          .lte("started_at", logTo)
          .order("started_at", { ascending: true })
          .order("id", { ascending: true }),
      MAX_TIME_LOG_ROWS
    ),
    loadEmployees(orgId, client),
    loadStatusCounts(orgId, client),
  ]);

  const projects = projRes.rows;
  const tasks = taskRes.rows;
  const timeLogs = logRes.rows;
  const employees = empRes?.employees || [];

  const sessionRes = await loadDesktopSessions(employees, fromIso, toIso, client);

  return {
    projects,
    tasks,
    timeLogs,
    employees,
    sessions: sessionRes.rows,
    statusCounts,
    truncated: {
      projects: projRes.truncated,
      tasks: taskRes.truncated,
      timeLogs: logRes.truncated,
      sessions: sessionRes.truncated,
    },
    range: { from, to },
    orgId,
  };
}

function emptyBundle() {
  return {
    projects: [],
    tasks: [],
    timeLogs: [],
    employees: [],
    sessions: [],
    statusCounts: null,
    truncated: { projects: false, tasks: false, timeLogs: false, sessions: false },
    range: defaultRange(),
    orgId: null,
  };
}

/**
 * Task status totals answered by the database. Four HEAD requests carry no row
 * payload at all, and — unlike counting a truncated page of tasks — they stay
 * correct for organizations larger than MAX_TASK_ROWS.
 * Returns null if the counts are unavailable, so callers can fall back to
 * bucketing the rows they already hold.
 */
async function loadStatusCounts(orgId, client) {
  const base = () =>
    client.from("developer_tasks").select("id", { count: "exact", head: true }).eq("organization_id", orgId);
  // These counts are an optimization, never a hard dependency — a failure here
  // must not take the whole report down with it.
  const countOf = async (query) => {
    try {
      const { count, error } = await query;
      return error ? null : count || 0;
    } catch {
      return null;
    }
  };

  const [total, inProgress, inReview, completed] = await Promise.all([
    countOf(base()),
    countOf(base().in("status", IN_PROGRESS_STATUSES)),
    countOf(base().in("status", IN_REVIEW_STATUSES)),
    countOf(base().in("status", COMPLETED_STATUSES)),
  ]);
  if (total === null || inProgress === null || inReview === null || completed === null) return null;

  return {
    // Everything else (pending, rejected, todo, open, null…) normalizes to "To Do".
    pending: Math.max(0, total - inProgress - inReview - completed),
    in_progress: inProgress,
    awaiting_approval: inReview,
    completed,
    total,
  };
}

/**
 * Desktop sessions for this org's people. Tracking tables have an unpopulated
 * organization_id, so we match on user_id AND user_email and merge. There is no
 * developer_id column on this table - the desktop writer identifies a session by
 * user_id / user_email only.
 * Lookup failures reject the report rather than displaying misleading zero hours.
 */
async function loadDesktopSessions(employees, fromIso, toIso, client) {
  const desktopEmployees = (employees || []).filter((e) => e.userType === "developer");
  const ids = desktopEmployees.map((e) => e.userId).filter(Boolean);
  const emails = desktopEmployees.map((e) => e.email).filter(Boolean);
  if (!ids.length && !emails.length) return { rows: [], truncated: false };

  const cols = "session_id, user_id, user_email, start_time, end_time, status, total_duration, productivity_score, created_at";
  const base = () => {
    let q = client.from("productivity_sessions").select(cols);
    if (fromIso) q = q.gte("start_time", fromIso);
    if (toIso) q = q.lte("start_time", toIso);
    return q.order("start_time", { ascending: false });
  };

  // Split the budget across the identity chunks so a large team cannot make
  // one chunk consume the whole allowance.
  const idChunks = chunked(ids, IN_CHUNK);
  const emailChunks = chunked(emails, IN_CHUNK);
  const chunkCount = idChunks.length + emailChunks.length;
  const perChunk = Math.max(PAGE_SIZE, Math.floor(MAX_SESSION_ROWS / chunkCount));

  const queries = [
    ...idChunks.map((c) => () => fetchPaged(() => base().in("user_id", c), perChunk)),
    ...emailChunks.map((c) => () => fetchPaged(() => base().in("user_email", c), perChunk)),
  ];

  let rows = [];
  let truncated = false;
  const results = await Promise.all(queries.map((run) => run()));
  results.forEach((r) => {
    rows = rows.concat(r.rows);
    truncated = truncated || r.truncated;
  });

  // Dedupe: a session can match on both id and email.
  const seen = new Set();
  const deduped = rows.filter((r) => {
    const key = r.session_id || `${r.user_id || r.user_email}-${r.start_time}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { rows: deduped, truncated };
}

/* ------------------------------------------------------------------ */
/*  Derived report tables (pure functions over the bundle)             */
/* ------------------------------------------------------------------ */

/** 1. Project performance — one row per project. */
export function projectPerformance({ projects, tasks, timeLogs }) {
  const today = ymd(new Date());
  return (projects || []).map((p) => {
    const list = (tasks || []).filter((t) => t.project_id === p.id);
    const total = list.length;
    const done = list.filter((t) => DONE.has(t.status)).length;
    const inProgress = list.filter((t) => t.status === "in_progress").length;
    const pending = total - done - inProgress;
    const overdue = list.filter(
      (t) => !DONE.has(t.status) && (t.due_date || t.end_date) && ymd(t.due_date || t.end_date) < today
    ).length;
    const rated = list.filter((t) => DONE.has(t.status) && t.is_on_time !== null && t.is_on_time !== undefined);
    const onTime = rated.filter((t) => t.is_on_time).length;
    const seconds = sumSeconds((timeLogs || []).filter((l) => l.project_id === p.id));
    const deadline = p.end_date || p.deadline || null;
    return {
      projectId: p.id,
      project: p.name || "Untitled",
      status: p.status || "—",
      total,
      done,
      inProgress,
      pending: Math.max(0, pending),
      overdue,
      progress: total ? Math.round((done / total) * 100) : Number(p.progress) || 0,
      onTimeRate: rated.length ? Math.round((onTime / rated.length) * 100) : null,
      loggedHours: +(seconds / 3600).toFixed(2),
      deadline: deadline ? ymd(deadline) : null,
      daysLate: deadline && ymd(deadline) < today && total > done ? daysBetween(deadline, new Date()) : 0,
    };
  });
}

/** 2. Team productivity — one row per employee. */
export function teamProductivity({ employees, tasks, timeLogs, sessions }) {
  // Desktop time rolls up by user identity (id or email). productivity_sessions
  // has NO developer_id column (loadDesktopSessions selects user_id), and the
  // consumer below keys by e.userId — so `s.developer_id` was always undefined,
  // the byId map stayed empty, and every session with a user_id but no matching
  // user_email was dropped from tracked hours. Key by s.user_id.
  const byId = new Map();
  const byEmail = new Map();
  (sessions || []).forEach((s) => {
    const secs = Number(s.total_duration) || 0; // treated as seconds (see file header)
    if (s.user_id) byId.set(s.user_id, (byId.get(s.user_id) || 0) + secs);
    else if (s.user_email) byEmail.set(s.user_email, (byEmail.get(s.user_email) || 0) + secs);
  });
  const scoreById = new Map();
  (sessions || []).forEach((s) => {
    const key = s.user_id || s.user_email;
    if (!key) return;
    const cur = scoreById.get(key) || { sum: 0, n: 0 };
    if (s.productivity_score != null) {
      cur.sum += Number(s.productivity_score) || 0;
      cur.n += 1;
    }
    scoreById.set(key, cur);
  });

  return (employees || []).map((e) => {
    const isDeveloper = e.userType === "developer";
    const list = isDeveloper ? (tasks || []).filter((t) => t.developer_id === e.userId) : [];
    const total = list.length;
    const done = list.filter((t) => DONE.has(t.status)).length;
    const rated = list.filter((t) => DONE.has(t.status) && t.is_on_time !== null && t.is_on_time !== undefined);
    const onTime = rated.filter((t) => t.is_on_time).length;
    const points = list.reduce((s, t) => s + (Number(t.productivity_points) || 0), 0);
    const loggedSeconds = sumSeconds((timeLogs || []).filter((l) =>
      ["admin", "developer"].includes(e.userType) && l.user_type === e.userType && l.developer_id === e.userId));
    const trackedSeconds = isDeveloper ? (byId.get(e.userId) || 0) + (byEmail.get(e.email) || 0) : 0;
    const sc = (isDeveloper && (scoreById.get(e.userId) || scoreById.get(e.email))) || { sum: 0, n: 0 };
    return {
      userId: e.userId,
      userType: e.userType,
      name: e.name,
      role: e.role,
      total,
      done,
      pending: Math.max(0, total - done),
      completionRate: total ? Math.round((done / total) * 100) : 0,
      onTimeRate: rated.length ? Math.round((onTime / rated.length) * 100) : null,
      points,
      loggedHours: +(loggedSeconds / 3600).toFixed(2),
      trackedHours: +(trackedSeconds / 3600).toFixed(2),
      avgProductivity: sc.n ? Math.round((sc.sum / sc.n) * 10) / 10 : null,
    };
  });
}

/** 3. Status distribution across the whole org (or a filtered task list). */
export function statusDistribution(tasks) {
  const buckets = { pending: 0, in_progress: 0, awaiting_approval: 0, completed: 0 };
  (tasks || []).forEach((t) => {
    buckets[normalizeStatus(t.status)] += 1;
  });
  return buckets;
}

/** 4. Time-tracking rows — one per time log, resolved to task/project/person. */
export function timeTrackingRows({ timeLogs, tasks, projects, employees }) {
  const taskById = new Map((tasks || []).map((t) => [t.id, t]));
  const projById = new Map((projects || []).map((p) => [p.id, p]));
  const empById = new Map((employees || []).filter((e) => ["admin", "developer"].includes(e.userType))
    .map((e) => [`${e.userType}:${e.userId}`, e]));
  return (timeLogs || [])
    .filter((l) => l.ended_at) // only completed intervals
    .map((l) => ({
      date: ymd(l.started_at),
      developer: ["admin", "developer"].includes(l.user_type)
        ? empById.get(`${l.user_type}:${l.developer_id}`)?.name || "Unknown"
        : "Unknown (identity unresolved)",
      project: projById.get(l.project_id)?.name || "—",
      task: taskById.get(l.task_id)?.task_title || "—",
      hours: +((Number(l.seconds) || 0) / 3600).toFixed(2),
      source: l.source || "web_timer",
    }));
}

/** 5. Deadline delays — overdue or late-completed tasks. */
export function deadlineDelays({ tasks, projects, employees }) {
  const today = ymd(new Date());
  const projById = new Map((projects || []).map((p) => [p.id, p]));
  const empById = new Map((employees || []).filter((e) => e.userType === "developer")
    .map((e) => [e.userId, e]));
  const rows = [];
  (tasks || []).forEach((t) => {
    const due = t.due_date || t.end_date;
    if (!due) return;
    const dueYmd = ymd(due);
    if (!dueYmd) return;
    const isDone = DONE.has(t.status);
    const completedOn = t.actual_completion_date || t.reviewed_at || t.updated_at;
    if (isDone) {
      const compYmd = completedOn ? ymd(completedOn) : null;
      if (compYmd && compYmd > dueYmd) {
        rows.push({
          task: t.task_title || "Untitled",
          project: projById.get(t.project_id)?.name || "—",
          assignee: empById.get(t.developer_id)?.name || "Unassigned",
          due: dueYmd,
          state: "Completed late",
          daysLate: daysBetween(dueYmd, compYmd),
        });
      }
    } else if (dueYmd < today) {
      rows.push({
        task: t.task_title || "Untitled",
        project: projById.get(t.project_id)?.name || "—",
        assignee: empById.get(t.developer_id)?.name || "Unassigned",
        due: dueYmd,
        state: "Overdue",
        daysLate: daysBetween(dueYmd, new Date()),
      });
    }
  });
  return rows.sort((a, b) => b.daysLate - a.daysLate);
}

/** 6. Daily trend — completed tasks and logged hours per day across the range. */
export function dailyTrend({ tasks, timeLogs, sessions, range }) {
  const { from, to } = range || defaultRange();
  const days = [];
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) days.push(ymd(d));

  const completedBy = new Map();
  (tasks || []).forEach((t) => {
    if (!DONE.has(t.status)) return;
    const key = ymd(t.actual_completion_date || t.reviewed_at || t.updated_at);
    if (key) completedBy.set(key, (completedBy.get(key) || 0) + 1);
  });
  const loggedBy = new Map();
  (timeLogs || []).forEach((l) => {
    const key = ymd(l.started_at);
    if (key) loggedBy.set(key, (loggedBy.get(key) || 0) + (Number(l.seconds) || 0));
  });
  const trackedBy = new Map();
  (sessions || []).forEach((s) => {
    const key = ymd(s.start_time);
    if (key) trackedBy.set(key, (trackedBy.get(key) || 0) + (Number(s.total_duration) || 0));
  });

  return {
    days,
    completed: days.map((d) => completedBy.get(d) || 0),
    loggedHours: days.map((d) => +((loggedBy.get(d) || 0) / 3600).toFixed(2)),
    trackedHours: days.map((d) => +((trackedBy.get(d) || 0) / 3600).toFixed(2)),
  };
}

/** Headline numbers for the reports landing strip. */
export function summaryKpis(bundle) {
  const { tasks, timeLogs, sessions, projects, statusCounts } = bundle;
  // Prefer the database's own totals — they stay right past MAX_TASK_ROWS.
  const dist = statusCounts || statusDistribution(tasks);
  const total = statusCounts ? statusCounts.total : (tasks || []).length;
  const done = dist.completed;
  const loggedHours = +(sumSeconds(timeLogs) / 3600).toFixed(1);
  const trackedHours = +(
    (sessions || []).reduce((s, x) => s + (Number(x.total_duration) || 0), 0) / 3600
  ).toFixed(1);
  const overdue = deadlineDelays(bundle).filter((r) => r.state === "Overdue").length;
  return {
    projects: (projects || []).length,
    tasks: total,
    done,
    completionRate: total ? Math.round((done / total) * 100) : 0,
    loggedHours,
    trackedHours,
    overdue,
  };
}
