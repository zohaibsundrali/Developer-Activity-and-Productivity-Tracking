import { supabase } from "@/utils/supabaseClient";
import { getOrgId } from "@/utils/orgContext";
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
 *     total worked time, but carries NO project_id/task_id, so it can only be
 *     rolled up PER DEVELOPER PER DAY, never per task or per project.
 *
 * Also note: the desktop writers insert with the service role and do NOT set
 * organization_id, so tracking rows cannot be filtered by org. We therefore
 * scope them by the org's developer ids / emails instead.
 *
 * `productivity_sessions.total_duration` is treated as SECONDS, matching the
 * existing readers (DashboardOverview, DeveloperActivity).
 */

const DONE = new Set(["completed", "reviewed"]);
export const TRACKING_CAVEAT =
  "Desktop tracked hours are per developer per day — the tracker records no task or project link, so they are not attributed to individual tasks.";

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
 * tasks and projects are loaded whole so status totals stay meaningful).
 */
export async function loadReportData(range) {
  const orgId = getOrgId();
  if (!orgId) return emptyBundle();

  const { from, to } = range || defaultRange();
  const fromIso = from ? new Date(`${from}T00:00:00`).toISOString() : null;
  const toIso = to ? new Date(`${to}T23:59:59`).toISOString() : null;

  // Projects + tasks + explicit time logs are all org-scoped and RLS-safe.
  const [projRes, taskRes, logRes, empRes] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, status, progress, deadline, start_date, end_date, archived, created_at")
      .eq("organization_id", orgId),
    supabase
      .from("developer_tasks")
      .select(
        "id, project_id, developer_id, task_title, status, priority, task_type, story_points, due_date, start_date, end_date, actual_completion_date, is_on_time, productivity_points, reviewed_at, created_at, updated_at"
      )
      .eq("organization_id", orgId),
    supabase
      .from("task_time_logs")
      .select("id, task_id, project_id, developer_id, started_at, ended_at, seconds, source")
      .eq("organization_id", orgId)
      .gte("started_at", fromIso || "1970-01-01T00:00:00Z")
      .lte("started_at", toIso || new Date().toISOString()),
    loadEmployees(orgId),
  ]);

  const projects = projRes.data || [];
  const tasks = taskRes.data || [];
  const timeLogs = logRes.data || [];
  const employees = empRes?.employees || [];

  const sessions = await loadDesktopSessions(employees, fromIso, toIso);

  return { projects, tasks, timeLogs, employees, sessions, range: { from, to }, orgId };
}

function emptyBundle() {
  return {
    projects: [],
    tasks: [],
    timeLogs: [],
    employees: [],
    sessions: [],
    range: defaultRange(),
    orgId: null,
  };
}

/**
 * Desktop sessions for this org's people. Tracking tables have an unpopulated
 * organization_id, so we match on developer_id AND user_email and merge.
 * Degrades to [] if the table is unavailable — reports still render.
 */
async function loadDesktopSessions(employees, fromIso, toIso) {
  const ids = (employees || []).map((e) => e.userId).filter(Boolean);
  const emails = (employees || []).map((e) => e.email).filter(Boolean);
  if (!ids.length && !emails.length) return [];

  const cols = "session_id, developer_id, user_email, start_time, end_time, status, total_duration, productivity_score, created_at";
  const base = () => {
    let q = supabase.from("productivity_sessions").select(cols);
    if (fromIso) q = q.gte("start_time", fromIso);
    if (toIso) q = q.lte("start_time", toIso);
    return q;
  };

  const queries = [];
  if (ids.length) queries.push(base().in("developer_id", ids));
  if (emails.length) queries.push(base().in("user_email", emails));

  let rows = [];
  try {
    const results = await Promise.all(queries);
    results.forEach((r) => {
      if (!r.error && r.data) rows = rows.concat(r.data);
    });
  } catch {
    return [];
  }

  // Dedupe: a session can match on both id and email.
  const seen = new Set();
  return rows.filter((r) => {
    const key = r.session_id || `${r.developer_id || r.user_email}-${r.start_time}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  // Desktop time rolls up by developer identity (id or email).
  const byId = new Map();
  const byEmail = new Map();
  (sessions || []).forEach((s) => {
    const secs = Number(s.total_duration) || 0; // treated as seconds (see file header)
    if (s.developer_id) byId.set(s.developer_id, (byId.get(s.developer_id) || 0) + secs);
    else if (s.user_email) byEmail.set(s.user_email, (byEmail.get(s.user_email) || 0) + secs);
  });
  const scoreById = new Map();
  (sessions || []).forEach((s) => {
    const key = s.developer_id || s.user_email;
    if (!key) return;
    const cur = scoreById.get(key) || { sum: 0, n: 0 };
    if (s.productivity_score != null) {
      cur.sum += Number(s.productivity_score) || 0;
      cur.n += 1;
    }
    scoreById.set(key, cur);
  });

  return (employees || []).map((e) => {
    const list = (tasks || []).filter((t) => t.developer_id === e.userId);
    const total = list.length;
    const done = list.filter((t) => DONE.has(t.status)).length;
    const rated = list.filter((t) => DONE.has(t.status) && t.is_on_time !== null && t.is_on_time !== undefined);
    const onTime = rated.filter((t) => t.is_on_time).length;
    const points = list.reduce((s, t) => s + (Number(t.productivity_points) || 0), 0);
    const loggedSeconds = sumSeconds((timeLogs || []).filter((l) => l.developer_id === e.userId));
    const trackedSeconds = (byId.get(e.userId) || 0) + (byEmail.get(e.email) || 0);
    const sc = scoreById.get(e.userId) || scoreById.get(e.email) || { sum: 0, n: 0 };
    return {
      userId: e.userId,
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
  const empById = new Map((employees || []).map((e) => [e.userId, e]));
  return (timeLogs || [])
    .filter((l) => l.ended_at) // only completed intervals
    .map((l) => ({
      date: ymd(l.started_at),
      developer: empById.get(l.developer_id)?.name || "Unknown",
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
  const empById = new Map((employees || []).map((e) => [e.userId, e]));
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
  const { tasks, timeLogs, sessions, projects } = bundle;
  const dist = statusDistribution(tasks);
  const total = (tasks || []).length;
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
