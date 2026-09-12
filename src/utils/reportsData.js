import { reportDay as ymd, reportDaysBetween as daysBetween, reportDefaultRange, reportRangeDays } from "@/utils/reportDates";
import { normalizeStatus, sumSeconds } from "@/utils/pmData";

// Pure report calculations retained for compatibility/parity checks. Production
// reporting uses caller-scoped database aggregates via reportApiData.js.
const taskIsCompleted = task => normalizeStatus(task.status) === "completed";
export const TRACKING_CAVEAT = "This report groups desktop time per developer per day. Project/task selections appear in session history; they do not automatically create task time logs or billable entries.";
export function defaultRange() { return reportDefaultRange(); }

/* ------------------------------------------------------------------ */
/*  Derived report tables (pure functions over the bundle)             */
/* ------------------------------------------------------------------ */

/** 1. Project performance — one row per project. */
export function projectPerformance({ projects, tasks, timeLogs }) {
  const today = ymd(new Date());
  return (projects || []).map((p) => {
    const list = (tasks || []).filter((t) => t.project_id === p.id);
    const total = list.length;
    const done = list.filter((t) => taskIsCompleted(t)).length;
    const inProgress = list.filter((t) => normalizeStatus(t.status) === "in_progress").length;
    const pending = total - done - inProgress;
    const overdue = list.filter(
      (t) => !taskIsCompleted(t) && (t.due_date || t.end_date) && ymd(t.due_date || t.end_date) < today
    ).length;
    const rated = list.filter((t) => taskIsCompleted(t) && t.is_on_time !== null && t.is_on_time !== undefined);
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
    const done = list.filter((t) => taskIsCompleted(t)).length;
    const rated = list.filter((t) => taskIsCompleted(t) && t.is_on_time !== null && t.is_on_time !== undefined);
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
  const buckets = { pending: 0, in_progress: 0, awaiting_approval: 0, completed: 0, rejected: 0 };
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
    const isDone = taskIsCompleted(t);
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
  const days = reportRangeDays({ from, to });

  const completedBy = new Map();
  (tasks || []).forEach((t) => {
    if (!taskIsCompleted(t)) return;
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
  // Status totals share the exact task rows used by every report table.
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
