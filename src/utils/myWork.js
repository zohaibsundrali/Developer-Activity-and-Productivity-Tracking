import { supabase } from "@/utils/supabaseClient";
import { isOpenTask, isOverdue } from "@/utils/orgWorkGraph";

/**
 * One person's own work, across every project they are on.
 *
 * WHAT THIS FIXES. A developer opening the product could see four numbers and a
 * list of projects. To find out what they were actually supposed to do they had
 * to pick a project, open it, and read its task list — then repeat for every
 * other project they were on. The one question the app exists to answer for
 * them ("what am I working on today") took the most clicks of anything on the
 * screen.
 *
 * ── ONE TASK, ONE BUCKET ───────────────────────────────────────────────────
 *
 * The admin Overview deliberately lets a task appear in several buckets at
 * once: it is counting work, and a task that is both overdue and in progress is
 * genuinely both. This is a personal to-do list, where the same task appearing
 * twice is a bug — you do it once. So every task lands in exactly ONE bucket,
 * chosen by what most needs the person's attention:
 *
 *   1. sent back      somebody rejected it. Blocked on YOU, and easiest to
 *                     miss, because nothing about it looks urgent in a list
 *                     sorted by date.
 *   2. overdue        past its deadline and still open.
 *   3. due soon       inside the next week.
 *   4. in progress    started, not yet due.
 *   5. to start       assigned, untouched.
 *   6. in review      submitted; waiting on somebody else. Shown last because
 *                     it is not their move — but shown, because "I finished
 *                     that days ago and nobody looked" is a real complaint.
 *
 * ── THE DEADLINE COLUMN, WHICH IS NOT THE ONE YOU WOULD GUESS ──────────────
 *
 * `developer_tasks` has BOTH `due_date` and `end_date`. Every task in the live
 * database sets `end_date` and NONE sets `due_date` — checked, not assumed. A
 * screen written against `due_date` alone would show every task as having no
 * deadline, and "0 overdue" would look like good news.
 *
 * `isOverdue` in orgWorkGraph already reads `due_date || end_date`, so this
 * module reuses it rather than writing a second opinion about what late means.
 */

/** yyyy-mm-dd, or null. Local to this module; the graph's copy is not exported. */
export function ymd(value = new Date()) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * The date a task is actually judged against. See the note above.
 *
 * GUARDS BEFORE CALLING `ymd`, and that is not defensive noise. `ymd` defaults
 * its argument to "now" so `ymd()` can mean today — and a default parameter
 * fires on `undefined`. A task with neither date passed `undefined` straight
 * into it and came back with TODAY, so every undated task rendered as "due
 * today" and landed in the wrong bucket. Same shape as the `ymd(null)` bug that
 * once printed "20678d late": a missing value quietly becoming a valid one.
 */
export function deadlineOf(task) {
  const raw = task?.due_date || task?.end_date;
  return raw ? ymd(raw) : null;
}

/** Whole days from today until the deadline; negative is late, null unknown. */
export function daysUntil(task, today = ymd()) {
  const due = deadlineOf(task);
  if (!due || !today) return null;
  return Math.round((new Date(due) - new Date(today)) / 86_400_000);
}

/** Inside this many days counts as "due soon". */
export const SOON_DAYS = 7;

/**
 * The buckets, in the order they are shown. `tone` drives the visual weight so
 * a screen cannot decide that "sent back" is a calm colour.
 */
export const WORK_BUCKETS = Object.freeze([
  {
    id: "sent_back",
    label: "Sent back to you",
    tone: "destructive",
    blurb: "Reviewed and returned. This one is waiting on you.",
  },
  { id: "overdue", label: "Overdue", tone: "destructive", blurb: "Past the date agreed for it." },
  { id: "due_soon", label: "Due soon", tone: "warning", blurb: "Inside the next week." },
  { id: "in_progress", label: "In progress", tone: "info", blurb: "Started, not yet due." },
  { id: "to_start", label: "To start", tone: "muted", blurb: "Assigned and not yet begun." },
  {
    id: "in_review",
    label: "With a reviewer",
    tone: "muted",
    blurb: "Submitted. Waiting on somebody else, not on you.",
  },
]);

/** Statuses that mean "submitted, somebody else's move". */
const IN_REVIEW = new Set(["awaiting_approval", "reviewed"]);

/**
 * Sort inside a bucket: soonest deadline first, then by priority, then by
 * title so the order is stable across reloads. A list that reshuffles between
 * visits is one nobody trusts.
 */
const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 };
function compare(a, b) {
  const da = deadlineOf(a);
  const db = deadlineOf(b);
  if (da && db && da !== db) return da < db ? -1 : 1;
  if (da && !db) return -1;
  if (!da && db) return 1;
  const pa = PRIORITY_RANK[a?.priority] ?? 9;
  const pb = PRIORITY_RANK[b?.priority] ?? 9;
  if (pa !== pb) return pa - pb;
  return String(a?.task_title || "").localeCompare(String(b?.task_title || ""));
}

/**
 * Split one person's tasks into the buckets above.
 *
 * @param {Array} tasks   developer_tasks rows for ONE person
 * @param {string} today  yyyy-mm-dd
 * @returns {{buckets: Record<string, Array>, counts: Record<string, number>, total: number}}
 */
export function bucketMyWork(tasks, today = ymd()) {
  const buckets = Object.fromEntries(WORK_BUCKETS.map((b) => [b.id, []]));

  for (const task of tasks || []) {
    // `rejected` is checked BEFORE the open-task test on purpose. Whether a
    // rejected task counts as "on someone's plate" is a question for the work
    // graph; here it is unambiguously the person's move, and dropping it would
    // hide the one bucket they most need to see.
    if (task?.status === "rejected") {
      buckets.sent_back.push(task);
      continue;
    }
    // ALSO BEFORE the open-task test, and for the same reason as `rejected`
    // above. `reviewed` sits in OFF_PLATE_STATUSES — correct for the work
    // graph, which asks whether the ORGANIZATION still owes the work — but
    // this screen is answering "where did my task get to", and silently
    // dropping something the person submitted is how "I finished that days ago
    // and nobody looked" becomes a complaint nobody can check.
    if (IN_REVIEW.has(task?.status)) {
      buckets.in_review.push(task);
      continue;
    }
    if (!isOpenTask(task)) continue;
    if (isOverdue(task, today)) {
      buckets.overdue.push(task);
      continue;
    }
    const left = daysUntil(task, today);
    if (left != null && left >= 0 && left <= SOON_DAYS) {
      buckets.due_soon.push(task);
      continue;
    }
    if (task.status === "in_progress") {
      buckets.in_progress.push(task);
      continue;
    }
    buckets.to_start.push(task);
  }

  for (const list of Object.values(buckets)) list.sort(compare);

  const counts = Object.fromEntries(
    Object.entries(buckets).map(([id, list]) => [id, list.length])
  );
  return {
    buckets,
    counts,
    // What is actually on this person's plate. `in_review` is excluded: it is
    // finished work waiting on somebody else, and counting it as outstanding
    // makes the number say the opposite of what it means.
    total: Object.entries(counts)
      .filter(([id]) => id !== "in_review")
      .reduce((sum, [, n]) => sum + n, 0),
  };
}

/**
 * Load one person's tasks with the project each belongs to.
 *
 * TWO QUERIES, NOT A JOIN AND NOT N+1. The tasks come back in one request; the
 * projects they name come back in a second, keyed by id. Embedding
 * `projects(name)` would work, but it makes the whole request fail if the
 * relationship is not in PostgREST's schema cache — and a task list that blanks
 * because of a cache miss is worse than one with a project name missing.
 *
 * EVERY COLUMN BELOW WAS VERIFIED AGAINST THE LIVE DATABASE. The title column
 * is `task_title`, not `title`; PostgREST rejects an entire request over one
 * unknown column, so a single wrong name blanks the screen with nothing in the
 * console.
 */
export async function loadMyWork(orgId, developerId) {
  if (!orgId || !developerId) {
    throw new Error("Your session is incomplete. Sign in again.");
  }

  const { data: tasks, error } = await supabase
    .from("developer_tasks")
    .select(
      "id, task_title, task_description, status, priority, task_type, project_id, " +
        "due_date, end_date, start_date, estimated_hours, actual_hours, story_points, " +
        "sprint_id, rejection_reason, admin_comments, submitted_at, updated_at"
    )
    .eq("organization_id", orgId)
    .eq("developer_id", developerId)
    .order("updated_at", { ascending: false })
    .limit(500);

  if (error) throw new Error(error.message || "Could not load your tasks.");

  const projectIds = [...new Set((tasks || []).map((t) => t.project_id).filter(Boolean))];
  let projectsById = new Map();
  if (projectIds.length) {
    const { data: projects } = await supabase
      .from("projects")
      .select("id, name, status")
      .in("id", projectIds);
    projectsById = new Map((projects || []).map((p) => [String(p.id), p]));
  }

  return (tasks || []).map((t) => ({
    ...t,
    project: projectsById.get(String(t.project_id)) || null,
  }));
}
