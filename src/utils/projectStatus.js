/**
 * THE project status vocabulary. One definition, imported by everything.
 *
 * WHY THIS FILE EXISTS
 *
 * `projects.status` had no constraint at all — any string was accepted,
 * verified by inserting `'zzz_not_a_status'` into the live table, which
 * succeeded. Four places wrote to it and four places read it, and the readers
 * had grown their OWN maps that did not agree with each other:
 *
 *   developer/MyProjects       active, in_progress, completed, done, pending,
 *                              assigned
 *   developer/DashboardOverview completed, in_progress, "in progress", active,
 *                              on_hold, "on hold", cancelled, canceled
 *   developer/Timesheet        pending, in_progress, completed
 *   client/ClientShared        anything, humanised
 *
 * Eleven spellings for six states. A project written as `done` by one screen
 * rendered as "Unknown" on another, and nobody would connect the two.
 *
 * WHAT THE WRITERS ACTUALLY WRITE — surveyed before choosing, not guessed:
 *
 *   AllProjects (create)          'active'
 *   /api/proposals/[id]/decide    'pending'
 *   pmData.cloneProject           'pending'
 *   /api/projects/[id]/closure    'completed', 'closed', 'active'
 *
 * So five values, all of them below. The other six spellings were only ever
 * READ — they are legacy shapes this module folds, not states anything makes.
 *
 * ONE NAME PER STATE. `in_progress` and `active` meant the same thing and that
 * duplication was the whole problem, so `active` wins: it is what the create
 * path has always written. `in_progress` still READS correctly forever, via
 * LEGACY_SPELLINGS — old rows and old links must not break — but nothing new
 * writes it, and migration 065's CHECK now refuses it.
 *
 * Adding a status means: this file, and the CHECK constraint in 065.
 * tests/projectStatus.test.js holds the two against each other.
 */

/**
 * Every status, in the order a project moves through them.
 *
 * `tone` is the StatusPill shape-and-colour name, not a colour — the pill
 * encodes shape as well, so two statuses stay distinguishable without colour
 * vision.
 */
export const PROJECT_STATUSES = [
  {
    id: "pending",
    label: "Pending",
    tone: "pending",
    hint: "Agreed, not started.",
  },
  {
    id: "active",
    label: "Active",
    tone: "active",
    hint: "Being worked on.",
  },
  {
    id: "on_hold",
    label: "On Hold",
    tone: "warning",
    hint: "Paused, and expected to resume.",
  },
  {
    id: "completed",
    label: "Completed",
    tone: "success",
    hint: "The team says the work is done.",
  },
  {
    id: "closed",
    label: "Closed",
    tone: "success",
    hint: "The file is shut.",
  },
  {
    id: "cancelled",
    label: "Cancelled",
    tone: "error",
    hint: "Abandoned before it finished.",
  },
];

export const PROJECT_STATUS_IDS = PROJECT_STATUSES.map((s) => s.id);

/**
 * `PROJECT_STATUS.completed` — for the places that WRITE a status.
 *
 * Derived from the table above rather than typed out, so it cannot list a
 * status the table does not have. A bare string literal at a write site is how
 * `in_progress` survived in the closure route after the vocabulary dropped it;
 * a wrong property here is a crash on the line that wrote it, which is the
 * failure you want.
 */
export const PROJECT_STATUS = Object.freeze(
  Object.fromEntries(PROJECT_STATUSES.map((s) => [s.id, s.id]))
);

const BY_ID = new Map(PROJECT_STATUSES.map((s) => [s.id, s]));

/**
 * Old spellings → the canonical one.
 *
 * Read-only. Nothing writes these any more and 065 refuses them, but rows
 * written before the constraint, and any import or hand-fix that goes around
 * the app, still say them. Folding here is what stops that showing as
 * "Unknown".
 *
 * `assigned` folds to `pending`, not `active`: a project handed to somebody who
 * has not started it is not in progress, and MyProjects had it on the pending
 * tone already.
 */
export const LEGACY_SPELLINGS = {
  in_progress: "active",
  "in progress": "active",
  inprogress: "active",
  assigned: "pending",
  done: "completed",
  complete: "completed",
  "on hold": "on_hold",
  onhold: "on_hold",
  paused: "on_hold",
  canceled: "cancelled",
  archived: "closed",
};

/**
 * Fold any stored value to a canonical id, or null if it is not a status at
 * all.
 *
 * Returns NULL rather than a default. A value this module has never seen is
 * not "pending" — it is unknown, and callers show it verbatim so whoever
 * wrote it can be found. Quietly relabelling it as a real status is how a
 * typo becomes a project that looks fine and is not.
 */
export function normalizeProjectStatus(value) {
  if (value === null || value === undefined) return null;
  const key = String(value).trim().toLowerCase();
  if (!key) return null;
  if (BY_ID.has(key)) return key;
  const folded = LEGACY_SPELLINGS[key];
  return folded && BY_ID.has(folded) ? folded : null;
}

/** True for a value the database will now accept. */
export function isProjectStatus(value) {
  return BY_ID.has(String(value ?? "").trim().toLowerCase());
}

// Only used for the unknown case; canonical labels come from the table above.
const humanize = (value) =>
  String(value ?? "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * The one place a status becomes something to render.
 *
 * Always returns a usable object, so no caller needs its own `|| {}` fallback —
 * that fallback is where the four maps came from. An unrecognised value keeps
 * its own text and gets the neutral tone: shown, not hidden, and not dressed up
 * as a state it is not.
 */
export function projectStatusMeta(value) {
  const id = normalizeProjectStatus(value);
  if (id) return BY_ID.get(id);
  const text = String(value ?? "").trim();
  return {
    id: "unknown",
    label: text ? humanize(text) : "Unknown",
    tone: "unknown",
    hint: "",
    unknown: true,
  };
}

/** Shorthand for the two questions screens actually ask. */
export const isProjectFinished = (value) => {
  const id = normalizeProjectStatus(value);
  return id === "completed" || id === "closed";
};

export const isProjectOpen = (value) => {
  const id = normalizeProjectStatus(value);
  // An unknown status counts as open. Whatever it is, it is not finished, and
  // treating it as finished would silently drop it out of every "what is left"
  // list — the one place somebody might have noticed the bad value.
  return id !== "completed" && id !== "closed" && id !== "cancelled";
};
