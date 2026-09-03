/**
 * A week of one person's logged time.
 *
 * THE GAP THIS FILLS. Everything needed to track time per task already existed
 * and worked: `task_time_logs` (migration 017), start/stop/manual helpers in
 * pmData.js, and a partial unique index in the database that refuses a second
 * running timer for the same person. What was missing is that the only UI for
 * any of it — `TaskTimer` — is rendered inside `TaskDetailDrawer`, which is an
 * ADMIN component. Developers have no task drawer.
 *
 * So the people who do the work could not log time against it. Only an admin
 * could, on somebody else's behalf. That is why the table has no rows.
 *
 * ── SECONDS, NOT HOURS, ALL THE WAY THROUGH ────────────────────────────────
 *
 * `task_time_logs.seconds` is an integer and every function here keeps it that
 * way until the moment it is displayed. Rounding to hours during aggregation
 * loses a few minutes per row and the day total then disagrees with the sum of
 * the rows shown under it — which reads as a bug in the arithmetic rather than
 * in the rounding, and is the kind of thing nobody can reproduce.
 *
 * ── A RUNNING TIMER HAS NO `seconds` YET ───────────────────────────────────
 *
 * `seconds` is filled on stop. A row with `ended_at` null is still running, so
 * its elapsed time has to be computed against now. Treating null as zero would
 * make today's total sit at whatever it was when the timer started, which is
 * the number a person is most likely to be watching.
 */

/** yyyy-mm-dd for a Date or an ISO string, or null. */
export function ymd(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * The Monday of the week containing `date`.
 *
 * ISO weeks, so a week runs Monday to Sunday. `getDay()` calls Sunday 0, which
 * would otherwise put Sunday at the START of the following week — a whole day
 * landing in the wrong total, and only ever on Sundays, which is exactly the
 * sort of bug that survives a demo.
 */
export function weekStart(date = new Date()) {
  const d = date instanceof Date ? new Date(date) : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getDay();
  const shift = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + shift);
  return ymd(d);
}

/** The seven yyyy-mm-dd days of the week beginning `start`. */
export function weekDays(start) {
  if (!start) return [];
  const out = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    out.push(ymd(d));
  }
  return out;
}

/**
 * How long one log ran, in seconds.
 *
 * A finished log carries the number. A running one does not yet, so it is
 * measured against `now` — see the note at the top of this file.
 */
export function logSeconds(log, now = new Date()) {
  if (!log) return 0;
  if (log.ended_at) return Math.max(0, Number(log.seconds) || 0);
  const started = new Date(log.started_at);
  if (Number.isNaN(started.getTime())) return 0;
  const elapsed = Math.floor((now.getTime() - started.getTime()) / 1000);
  return Math.max(0, elapsed);
}

// FORMATTING LIVES IN pmData.js, not here. This module was about to grow its
// own `formatDuration` — a second copy of a function that already exists and is
// already used by TaskTimer, differing only in whether it says "30s" or "0m".
// Two of those drift, and the whole point of this phase has been removing
// second copies. The component imports the existing one; this file keeps only
// the logic that needs a test, which is also what keeps it pure enough to have
// one (pmData reaches for supabase and the session).

/**
 * Group a week of logs by day, and within each day by task.
 *
 * @param {Array} logs   task_time_logs rows, any order
 * @param {string} start yyyy-mm-dd, the Monday
 * @param {Date} now     for measuring a running timer
 * @returns {{days: Array, total: number, running: object|null}}
 */
export function buildWeek(logs, start, now = new Date()) {
  const days = weekDays(start);
  const byDay = new Map(days.map((d) => [d, new Map()]));
  let total = 0;
  let billable = 0;
  let running = null;

  for (const log of logs || []) {
    // Grouped by the day the work STARTED. A timer left running across
    // midnight would otherwise have to be split, and splitting invents a
    // boundary the person never marked — better that one long session belongs
    // to the day they began it, which is also how they remember it.
    const day = ymd(log?.started_at);
    if (!day || !byDay.has(day)) continue;

    const seconds = logSeconds(log, now);
    if (!log.ended_at) running = log;

    const tasks = byDay.get(day);
    const key = String(log.task_id || "none");
    const row = tasks.get(key) || {
      taskId: log.task_id || null,
      title: log.task?.task_title || "Untitled task",
      project: log.project?.name || null,
      seconds: 0,
      // Billable is tracked per ROW as well as summed per week, because the
      // toggle in the UI acts on a row and a row is several logs: one task on
      // one day may be three separate sittings.
      billableSeconds: 0,
      // The underlying log ids, so a row can be acted on at all. Without these
      // the screen can display a row and do nothing about it — every write has
      // to name the rows it changes.
      logIds: [],
      entries: 0,
      isRunning: false,
    };
    row.seconds += seconds;
    // `is_billable` defaults to true in the database (migration 077), and the
    // same reading is applied to a log loaded before that column existed:
    // undefined means billable, because that is what every row meant when the
    // table was described as billable time and had no flag.
    if (log.is_billable !== false) row.billableSeconds += seconds;
    if (log.id) row.logIds.push(log.id);
    row.entries += 1;
    if (!log.ended_at) row.isRunning = true;
    tasks.set(key, row);
    total += seconds;
    if (log.is_billable !== false) billable += seconds;
  }

  return {
    days: days.map((date) => {
      const rows = [...(byDay.get(date)?.values() || [])].sort((a, b) => b.seconds - a.seconds);
      return {
        date,
        rows,
        seconds: rows.reduce((sum, r) => sum + r.seconds, 0),
      };
    }),
    total,
    billable,
    running,
  };
}

/**
 * Seconds from a "1h 30m" / "90m" / "1.5h" / "45" style entry, or null.
 *
 * Manual entry is where people type whatever they think the box wants. Refusing
 * anything but one format means somebody logs nothing rather than logging
 * roughly; accepting several and returning null for genuine nonsense is the
 * balance. A bare number is read as MINUTES — "30" almost always means half an
 * hour, and reading it as seconds would silently record nothing.
 */
export function parseDuration(input) {
  if (typeof input !== "string" && typeof input !== "number") return null;
  const text = String(input).trim().toLowerCase();
  if (!text) return null;

  const hm = text.match(/^(\d+(?:\.\d+)?)\s*h(?:\s*(\d+(?:\.\d+)?)\s*m?)?$/);
  if (hm) {
    const hours = Number(hm[1]);
    const mins = hm[2] ? Number(hm[2]) : 0;
    return Math.round(hours * 3600 + mins * 60);
  }
  const mOnly = text.match(/^(\d+(?:\.\d+)?)\s*m$/);
  if (mOnly) return Math.round(Number(mOnly[1]) * 60);

  const bare = text.match(/^(\d+(?:\.\d+)?)$/);
  if (bare) return Math.round(Number(bare[1]) * 60);

  return null;
}
