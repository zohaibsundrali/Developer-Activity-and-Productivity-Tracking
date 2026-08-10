/**
 * Signals — the part of the product that NOTICES.
 *
 * WHY THIS EXISTS
 *  Every screen in this application reports. None of them notices. A team lead
 *  does not want a chart of last week; they want to be told that someone's
 *  active hours halved, that a sprint is going to miss, that a submission has
 *  been waiting four days for a review that nobody is doing. The data and the
 *  notification system to deliver it were both already here. What was missing
 *  was anything that looked at the numbers and formed an opinion.
 *
 * EVERY DETECTOR IN THIS FILE IS PURE
 *  They take plain arrays and a `now`, and return signal objects. No database
 *  client, no clock of their own, no I/O. That is deliberate: a rule that says
 *  "this person's work has dropped by half" is a claim about a human being, and
 *  it needs to be testable to the day without waiting five weeks for data to
 *  accumulate. src/app/api/signals/route.js does the fetching and the writing;
 *  this file only decides.
 *
 * THE BAR FOR RAISING ONE
 *  A signal interrupts somebody. Three rules keep that honest:
 *
 *   1. Compare a person to THEMSELVES, never to each other. A league table of
 *      keystrokes is what makes this category of product hated, and it is also
 *      simply wrong — a senior engineer in code review and a junior writing
 *      boilerplate produce incomparable numbers. Every threshold here is
 *      relative to that person's own recent baseline.
 *   2. Require a baseline worth comparing against. Someone who tracked 40
 *      minutes last month has no meaningful trend, and "activity dropped 100%"
 *      about a rounding error is noise that teaches people to ignore the rest.
 *   3. Say what would clear it. A signal that names no action is an anxiety
 *      generator, so every message ends in something a person can do.
 *
 * WHAT THIS IS NOT
 *  Not a productivity score, not a ranking, not an input to anybody's review.
 *  It reports CHANGE and it reports BLOCKAGE. A drop in tracked activity is a
 *  prompt to ask a question — illness, leave, a broken agent, a week of
 *  meetings are all likelier than the explanation people jump to.
 */

const HOUR = 3600;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Task statuses that mean the work is finished. Matches DONE in /api/cron. */
export const DONE_STATUSES = ["completed", "reviewed"];

/**
 * Every threshold in one place, so tuning does not mean hunting through
 * functions — and so a deployment that finds these too noisy can say so in one
 * object rather than in seven.
 */
export const DEFAULTS = {
  // Activity drop
  windowDays: 7,
  baselineWeeks: 4,
  /** Below this share of their own baseline, raise. 0.5 = "halved". */
  dropRatio: 0.5,
  /** …and below this, it is critical rather than a warning. */
  severeDropRatio: 0.25,
  /** No baseline under this many tracked seconds per week is worth comparing. */
  minBaselineSeconds: 5 * HOUR,

  // Tracking silence
  /** WORKING days (Mon–Fri) of silence before this raises. */
  silentDays: 3,
  /** Only for people who were actually tracking recently — see the detector. */
  activeWithinDays: 30,
  /** …and on at least this many distinct days, or they were not "regular". */
  minTrackingDays: 5,

  // Review backlog
  reviewWaitDays: 3,
  reviewWaitCriticalDays: 7,

  // Stalled work
  stalledDays: 7,

  // Overdue
  overdueMin: 3,
  overdueCritical: 10,

  // Sprints
  sprintWarnDays: 3,
  /** Remaining share of a sprint's tasks above which it is at risk. */
  sprintRemainingRatio: 0.3,

  // Plan usage
  planWarnRatio: 0.8,
  planCriticalRatio: 0.95,
};

// ── helpers ──────────────────────────────────────────────────────────

const toTime = (value) => {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
};

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** Hours, to one decimal, for a seconds value. */
export function hours(seconds) {
  return Math.round((num(seconds) / HOUR) * 10) / 10;
}

/** "3 days" / "1 day", so no message ever reads "1 days". */
export function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * A signal.
 *
 * `dedupeKey` carries the calendar day, so the same condition raises at most
 * one notification per day and the run is safe to repeat — a cron that fires
 * twice because a deploy overlapped must not send the same warning twice.
 */
function signal({ kind, severity, title, message, subject, metric = null, day }) {
  return {
    kind,
    severity,
    title,
    message,
    subject,
    metric,
    dedupeKey: `signal:${kind}:${subject?.id || "org"}:${day}`,
  };
}

/** yyyy-mm-dd in UTC — the unit the dedupe key counts in. */
export function dayKey(now) {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * ONE person, ONE key.
 *
 * `productivity_sessions.user_id` is nullable and is not reliably the same
 * identifier from row to row — migration 050 records that of 458 orphan rows,
 * every `user_id` it carried was in fact an email address. Keying on
 * `user_id || user_email` therefore splits a single person into two buckets the
 * moment their rows disagree, and the failure is silent and specific:
 *
 *   28 baseline days carrying a uuid + 7 current days carrying only the email
 *   → "tracked time down 100%", critical, naming somebody who worked a normal
 *     week, delivered to their owner, admin and HR.
 *
 * The email is the identifier every row actually carries and the one the rest
 * of the app matches on, so it wins whenever it is present. Lower-cased,
 * because addresses are case-insensitive and `Sara@x` and `sara@x` are the same
 * human being.
 */
export function personKey(row) {
  const email = String(row?.user_email || "").trim().toLowerCase();
  if (email) return email;
  const id = String(row?.user_id || "").trim();
  return id || null;
}

/**
 * A display name for a person, from whichever identifier the lookup has.
 *
 * `collect()` registers names under both the profile id and the email, but a
 * caller holding only one of them must still get a name rather than a raw
 * address in a sentence somebody's manager reads.
 */
export function personName(people = {}, entry = {}) {
  return (
    people[entry.id] ||
    people[entry.rawId] ||
    people[entry.email] ||
    entry.email ||
    "A team member"
  );
}

/**
 * Compare two dates by CALENDAR DAY, not by instant.
 *
 * `due_date`, `end_date` and `sprints.end_date` are `date` columns. Parsing one
 * gives midnight UTC, which is already in the past by the time a nightly job
 * runs — so a plain `due < now` counts everything due TODAY as overdue, and
 * `end_date < now` makes a sprint stop warning on its final day, which is the
 * one day the warning matters. /api/cron job 1 gets this right by comparing
 * yyyy-mm-dd strings; this is the same comparison.
 */
export function isBeforeDay(value, now) {
  const t = toTime(value);
  if (t === null) return false;
  return new Date(t).toISOString().slice(0, 10) < dayKey(now);
}

/** True when `value` falls on or after today. */
export function isTodayOrLater(value, now) {
  const t = toTime(value);
  if (t === null) return false;
  return new Date(t).toISOString().slice(0, 10) >= dayKey(now);
}

/** Whole days between two instants, counting only Mon–Fri. */
export function workingDaysBetween(fromMs, toMs) {
  let count = 0;
  const cursor = new Date(fromMs);
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date(toMs);
  end.setUTCHours(0, 0, 0, 0);
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

// ── 1. Activity drop ─────────────────────────────────────────────────

/**
 * Someone's tracked activity has fallen well below their own recent normal.
 *
 * @param sessions  productivity_sessions rows: { user_id, user_email, start_time, active_duration }
 * @param people    Map or object of user_id → display name (optional)
 */
export function detectActivityDrop(sessions = [], people = {}, now = new Date(), opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const day = dayKey(now);
  const end = now.getTime();
  const windowStart = end - o.windowDays * DAY_MS;
  const baselineStart = windowStart - o.baselineWeeks * o.windowDays * DAY_MS;

  const byUser = new Map();
  for (const s of sessions) {
    const started = toTime(s.start_time);
    if (started === null || started > end || started < baselineStart) continue;
    const id = personKey(s);
    if (!id) continue;

    let entry = byUser.get(id);
    if (!entry) {
      entry = { id, rawId: s.user_id || null, email: s.user_email || null, current: 0, baseline: 0, firstSeen: started };
      byUser.set(id, entry);
    }
    if (started < entry.firstSeen) entry.firstSeen = started;
    if (started >= windowStart) entry.current += num(s.active_duration);
    else entry.baseline += num(s.active_duration);
  }

  const out = [];
  for (const entry of byUser.values()) {
    // Their own normal week — averaged over the weeks they were actually HERE,
    // not over a fixed four.
    //
    // Dividing by 4 regardless of tenure is wrong in both directions, and the
    // gate on `minBaselineSeconds` catches neither:
    //
    //   joined 14 days ago at 40h/wk, then a genuinely awful 8h week
    //     → fixed divisor says the baseline is 10h, ratio 0.8, no signal.
    //       An 80% collapse, silently called normal.
    //
    //   back from a month's leave
    //     → baseline is depressed by the empty weeks, and the message quotes
    //       "a recent average of 10h" — a figure they have never worked.
    //
    // Counting only observed weeks fixes both. Fractional, and floored at one,
    // so somebody with nine days of history is divided by 1.29 rather than by 4.
    const observedMs = Math.max(0, windowStart - entry.firstSeen);
    const observedWeeks = Math.max(1, observedMs / (o.windowDays * DAY_MS));
    const baselineWeekly = entry.baseline / observedWeeks;
    if (baselineWeekly < o.minBaselineSeconds) continue; // rule 2

    const ratio = baselineWeekly === 0 ? 1 : entry.current / baselineWeekly;
    if (ratio >= o.dropRatio) continue;

    const name = personName(people, entry);
    const pct = Math.round((1 - ratio) * 100);

    out.push(
      signal({
        kind: "activity_drop",
        severity: ratio < o.severeDropRatio ? "critical" : "warning",
        title: `${name}: tracked time down ${pct}%`,
        message:
          `${name} tracked ${hours(entry.current)}h in the last ${plural(o.windowDays, "day")}, ` +
          `against a recent average of ${hours(baselineWeekly)}h. ` +
          `Worth a conversation before it becomes a pattern — leave, illness, a week of meetings ` +
          `and a stopped tracker all look identical from here.`,
        subject: { type: "person", id: entry.id, label: name },
        metric: { value: hours(entry.current), baseline: hours(baselineWeekly), unit: "h" },
        day,
      })
    );
  }
  return out;
}

// ── 2. Tracking has gone quiet ───────────────────────────────────────

/**
 * Someone who WAS tracking has sent nothing for days. Usually a broken desktop
 * agent, which is worth knowing about long before it becomes a gap in the data
 * that somebody mistakes for a gap in the work.
 */
export function detectTrackingSilence(sessions = [], people = {}, now = new Date(), opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const day = dayKey(now);
  const end = now.getTime();
  const activeSince = end - o.activeWithinDays * DAY_MS;
  const silentSince = end - o.silentDays * DAY_MS;

  const last = new Map();
  for (const s of sessions) {
    const started = toTime(s.start_time);
    if (started === null || started > end || started < activeSince) continue;
    const id = personKey(s);
    if (!id) continue;
    let seen = last.get(id);
    if (!seen) {
      seen = { id, rawId: s.user_id || null, at: started, email: s.user_email || null, days: new Set() };
      last.set(id, seen);
    }
    if (started > seen.at) seen.at = started;
    // Distinct calendar days with any session — the evidence that this person
    // was tracking REGULARLY rather than once, a month ago.
    seen.days.add(new Date(started).toISOString().slice(0, 10));
  }

  const out = [];
  for (const [id, seen] of last) {
    // Only for people who were genuinely tracking. Without this, a contractor
    // with a single session 29 days ago generates a daily signal for four
    // weeks, escalating to critical, asserting "after tracking regularly" —
    // which is simply false.
    if (seen.days.size < o.minTrackingDays) continue;

    // WORKING days, not calendar days. Somebody on a Monday-to-Thursday week
    // is three calendar days silent every single Monday, for ever; a team that
    // does not work weekends is silent every Monday morning. Counting Mon-Fri
    // only is what stops this firing on the shape of the week rather than on
    // anything having changed.
    const workingSilent = workingDaysBetween(seen.at, end);
    if (workingSilent < o.silentDays) continue;

    const days = Math.floor((end - seen.at) / DAY_MS);
    const name = personName(people, seen);

    out.push(
      signal({
        kind: "tracking_silent",
        severity: workingSilent >= o.silentDays * 3 ? "critical" : "warning",
        title: `${name}: no tracking for ${plural(workingSilent, "working day")}`,
        message:
          `The last session from ${name} was ${plural(days, "day")} ago. ` +
          `Check the desktop agent is running and signed in, and whether they are on leave, ` +
          `before treating this as anything else.`,
        subject: { type: "person", id, label: name },
        metric: { value: workingSilent, calendarDays: days, unit: "working days" },
        day,
      })
    );
  }
  return out;
}

// ── 3. Reviews nobody is doing ───────────────────────────────────────

/**
 * Submitted work waiting on a reviewer. This is the signal most likely to be
 * acted on the same day, because the person blocked by it is not the person
 * who can unblock it — which is exactly the situation nothing else in the
 * product surfaces.
 */
export function detectReviewBacklog(submissions = [], now = new Date(), opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const day = dayKey(now);
  const end = now.getTime();

  const waiting = submissions
    .filter((s) => !s.is_reviewed)
    .map((s) => ({ ...s, waited: (end - (toTime(s.submitted_at) ?? end)) / DAY_MS }))
    .filter((s) => s.waited >= o.reviewWaitDays);

  if (waiting.length === 0) return [];

  const oldest = Math.floor(Math.max(...waiting.map((s) => s.waited)));

  return [
    signal({
      kind: "review_backlog",
      severity: oldest >= o.reviewWaitCriticalDays ? "critical" : "warning",
      title:
        waiting.length === 1
          ? `A submission has waited ${plural(oldest, "day")} for review`
          : `${waiting.length} submissions are waiting for review`,
      message:
        `${plural(waiting.length, "submission")} ${waiting.length === 1 ? "has" : "have"} been waiting ` +
        `${o.reviewWaitDays}+ days; the oldest is ${plural(oldest, "day")} old. ` +
        `Nobody blocked by this can clear it themselves.`,
      subject: { type: "organization", id: "review-backlog", label: "Review queue" },
      metric: { value: waiting.length, oldestDays: oldest, unit: "submissions" },
      day,
    }),
  ];
}

// ── 4. Work that has stopped moving ──────────────────────────────────

export function detectStalledTasks(tasks = [], now = new Date(), opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const day = dayKey(now);
  const end = now.getTime();
  const cutoff = end - o.stalledDays * DAY_MS;

  const stalled = tasks.filter((t) => {
    if (DONE_STATUSES.includes(t.status)) return false;
    if (!t.developer_id) return false; // unassigned is a different problem
    const touched = toTime(t.updated_at) ?? toTime(t.created_at);
    return touched !== null && touched < cutoff;
  });

  if (stalled.length === 0) return [];

  return [
    signal({
      kind: "tasks_stalled",
      severity: "info",
      title: `${stalled.length} assigned ${stalled.length === 1 ? "task has" : "tasks have"} not moved in ${plural(o.stalledDays, "day")}`,
      message:
        `${plural(stalled.length, "task")} assigned to someone ${stalled.length === 1 ? "has" : "have"} had no update for over ` +
        `${plural(o.stalledDays, "day")}. Either they are blocked, or the board no longer reflects reality — ` +
        `both are worth ten minutes.`,
      subject: { type: "organization", id: "stalled", label: "Board" },
      metric: { value: stalled.length, unit: "tasks" },
      day,
    }),
  ];
}

// ── 5. Overdue work piling up on one project ─────────────────────────

export function detectOverdue(tasks = [], projects = {}, now = new Date(), opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const day = dayKey(now);
  const end = now.getTime();

  const byProject = new Map();
  for (const t of tasks) {
    if (DONE_STATUSES.includes(t.status)) continue;
    // Compared by CALENDAR DAY. `due_date` and `end_date` are date columns, so
    // a task due today parses to midnight UTC and a plain `due < now` calls it
    // overdue from 00:00 — meaning a nightly run reports the entire day's work
    // as late before anybody has started it. `end_date` is NOT NULL on every
    // row, so the fallback guarantees a date for the whole backlog and nothing
    // would ever be exempt.
    const due = t.due_date ?? t.end_date;
    if (!isBeforeDay(due, now)) continue;
    const key = t.project_id || "unassigned";
    byProject.set(key, (byProject.get(key) || 0) + 1);
  }

  const out = [];
  for (const [projectId, count] of byProject) {
    if (count < o.overdueMin) continue;
    const label = projects[projectId] || "an unnamed project";
    out.push(
      signal({
        kind: "overdue_pileup",
        severity: count >= o.overdueCritical ? "critical" : "warning",
        title: `${count} overdue tasks on ${label}`,
        message:
          `${label} has ${plural(count, "task")} past ${count === 1 ? "its" : "their"} due date and still open. ` +
          `Re-plan the dates or re-scope the work — a board full of dates nobody believes stops being a plan.`,
        subject: { type: "project", id: projectId, label },
        metric: { value: count, unit: "tasks" },
        day,
      })
    );
  }
  return out;
}

// ── 6. A sprint that is not going to land ────────────────────────────

export function detectSprintRisk(sprints = [], tasks = [], now = new Date(), opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const day = dayKey(now);
  const end = now.getTime();

  const bySprint = new Map();
  for (const t of tasks) {
    if (!t.sprint_id) continue;
    let entry = bySprint.get(t.sprint_id);
    if (!entry) {
      entry = { total: 0, remaining: 0 };
      bySprint.set(t.sprint_id, entry);
    }
    entry.total += 1;
    if (!DONE_STATUSES.includes(t.status)) entry.remaining += 1;
  }

  const out = [];
  for (const sprint of sprints) {
    if (sprint.status !== "active") continue;
    // Includes the final day. `end_date` is a date column, so `ends < now` went
    // false at midnight on the last day of the sprint — the warning fell silent
    // on the one day it matters most.
    if (!isTodayOrLater(sprint.end_date, now)) continue;
    const ends = toTime(sprint.end_date);

    const daysLeft = Math.max(0, Math.ceil((ends - end) / DAY_MS));
    if (daysLeft > o.sprintWarnDays) continue;

    const counts = bySprint.get(sprint.id);
    if (!counts || counts.total === 0) continue;

    const remainingRatio = counts.remaining / counts.total;
    if (remainingRatio <= o.sprintRemainingRatio) continue;

    const label = sprint.name || "The current sprint";
    out.push(
      signal({
        kind: "sprint_at_risk",
        severity: daysLeft <= 1 ? "critical" : "warning",
        title: `${label} will miss: ${counts.remaining} of ${counts.total} still open`,
        message:
          `${label} ends ${daysLeft === 0 ? "today" : `in ${plural(daysLeft, "day")}`} with ${counts.remaining} of ${counts.total} tasks ` +
          `still open (${Math.round(remainingRatio * 100)}%). Decide now what moves to the next sprint, ` +
          `rather than discovering it at the review.`,
        subject: { type: "sprint", id: sprint.id, label },
        metric: { value: counts.remaining, total: counts.total, daysLeft, unit: "tasks" },
        day,
      })
    );
  }
  return out;
}

// ── 7. Running out of plan ───────────────────────────────────────────

/**
 * `usage` is the object getUsage() in entitlements.js already returns:
 * { developers: { label, used, limit, unlimited, … }, … }
 *
 * Worth a signal rather than only a bar on the billing page, because the person
 * who hits the limit is rarely the person who reads that page — and the failure
 * mode is somebody being unable to add a colleague on their first morning.
 */
export function detectPlanPressure(usage = {}, now = new Date(), opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const day = dayKey(now);
  const out = [];

  for (const [key, meter] of Object.entries(usage)) {
    if (!meter || meter.unlimited || !meter.limit) continue;
    const ratio = meter.used / meter.limit;
    if (ratio < o.planWarnRatio) continue;

    const label = meter.label || key;
    const full = meter.used >= meter.limit;

    out.push(
      signal({
        kind: "plan_pressure",
        severity: ratio >= o.planCriticalRatio ? "critical" : "warning",
        title: full
          ? `${label}: plan limit reached`
          : `${label}: ${Math.round(ratio * 100)}% of your plan used`,
        message: full
          ? `You are using all ${meter.limit} ${label.toLowerCase()} your plan allows. The next one will be refused — upgrade before somebody hits it mid-task.`
          : `${meter.used} of ${meter.limit} ${label.toLowerCase()} used. Worth upgrading before it stops somebody.`,
        subject: { type: "plan", id: key, label },
        metric: { value: meter.used, limit: meter.limit, unit: label.toLowerCase() },
        day,
      })
    );
  }
  return out;
}

// ── The run ──────────────────────────────────────────────────────────

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };

/** Roles that may be told about any person in the organization. */
export const ALL_PEOPLE_ROLES = ["owner", "admin", "hr"];
/** Roles that may be told about the bill. */
export const BILLING_ROLES = ["owner", "admin"];
/** Every role that receives signals at all. */
export const SIGNAL_ROLES = [...ALL_PEOPLE_ROLES, "manager", "team_lead"];

/**
 * Which of these signals a given viewer is allowed to see.
 *
 * PURE, AND EXPORTED, ON PURPOSE. This rule is implemented in two places — the
 * API route that draws the panel and the nightly job that sends the
 * notifications — and the review of the first version found that the source
 * assertions covering it could not detect that it was broken, because they
 * matched the text of the filter rather than running it. Both callers now call
 * this, and the tests exercise it with real inputs.
 *
 * `visiblePeople` is the set of identifiers the viewer manages, lower-cased,
 * registered under BOTH the membership id and the email — a signal's subject id
 * is whichever of the two the session rows carried. See `personKey`.
 */
export function filterForViewer(signals = [], { role, visiblePeople = new Set() } = {}) {
  if (!SIGNAL_ROLES.includes(role)) return [];

  const seesAllPeople = ALL_PEOPLE_ROLES.includes(role);
  const seesBilling = BILLING_ROLES.includes(role);

  return signals.filter((s) => {
    if (s.kind === "plan_pressure" && !seesBilling) return false;
    if (s.subject?.type !== "person") return true;
    if (seesAllPeople) return true;
    return visiblePeople.has(String(s.subject.id).trim().toLowerCase());
  });
}

/**
 * Every detector, over one organization's data, sorted worst first.
 *
 * Takes an already-fetched bundle rather than a database client — see the note
 * at the top of the file. `people` and `projects` are id → label lookups used
 * only to write readable messages.
 */
export function runDetectors(
  { sessions = [], submissions = [], tasks = [], sprints = [], usage = {}, people = {}, projects = {} } = {},
  now = new Date(),
  opts = {}
) {
  const found = [
    ...detectActivityDrop(sessions, people, now, opts),
    ...detectTrackingSilence(sessions, people, now, opts),
    ...detectReviewBacklog(submissions, now, opts),
    ...detectStalledTasks(tasks, now, opts),
    ...detectOverdue(tasks, projects, now, opts),
    ...detectSprintRisk(sprints, tasks, now, opts),
    ...detectPlanPressure(usage, now, opts),
  ];

  return found.sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
      a.kind.localeCompare(b.kind) ||
      String(a.subject?.label).localeCompare(String(b.subject?.label))
  );
}
