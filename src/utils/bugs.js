import { isUnsettled } from "@/utils/taskState";

/**
 * Bugs.
 *
 * A bug is a `developer_tasks` row with `task_type = 'bug'`. There is no bug
 * table and no second status pipeline — the existing one already expresses the
 * whole lifecycle, so this module is a VOCABULARY over it rather than a
 * parallel machine.
 *
 * That distinction is the point. Two pipelines would mean two sets of legal
 * transitions, two boards, two rollups into productivity_metrics, and two
 * places for "is this closed?" to disagree — and the one that disagreed would
 * be the one nobody was looking at.
 */

/**
 * The bug lifecycle, and the task status each stage IS.
 *
 * Read this as a translation table, not a mapping to be applied: nothing
 * converts between the two. A bug's `status` column holds the right-hand value
 * and always has; this file only decides what to call it on screen.
 */
export const BUG_STAGES = [
  {
    id: "open",
    status: "pending",
    label: "Open",
    hint: "Reported, nobody on it yet.",
    tone: "muted",
  },
  {
    id: "in_progress",
    status: "in_progress",
    label: "In Progress",
    hint: "Someone is fixing it.",
    tone: "info",
  },
  {
    id: "fixed",
    status: "awaiting_approval",
    label: "Fixed",
    hint: "The developer says it is done — waiting on a retest.",
    tone: "warning",
  },
  {
    id: "retest",
    status: "reviewed",
    label: "Retesting",
    hint: "QA has picked it up.",
    tone: "warning",
  },
  {
    id: "closed",
    status: "completed",
    label: "Closed",
    hint: "Verified fixed.",
    tone: "success",
  },
  {
    id: "reopened",
    status: "rejected",
    label: "Reopened",
    hint: "The retest failed. Back to the developer.",
    tone: "destructive",
  },
];

const BY_STATUS = Object.fromEntries(BUG_STAGES.map((s) => [s.status, s]));

/** What to call a bug that is at this task status. */
export function bugStage(status) {
  return (
    BY_STATUS[status] || {
      id: "unknown",
      status,
      label: status || "Unknown",
      hint: "",
      tone: "muted",
    }
  );
}

/**
 * Severity, worst first.
 *
 * A closed vocabulary, because the only job this field has is ordering the
 * queue and "Critical", "critical!!" and "P1" do not sort together.
 *
 * `weight` is what sorts. It is deliberately NOT the array index: inserting a
 * severity between two others would silently renumber every bug's position in
 * the queue if the index were load-bearing.
 */
export const SEVERITIES = [
  { id: "critical", label: "Critical", hint: "Broken in production, or losing data.", weight: 400, tone: "destructive" },
  { id: "major", label: "Major", hint: "A main path does not work.", weight: 300, tone: "warning" },
  { id: "minor", label: "Minor", hint: "Wrong, but there is a way round it.", weight: 200, tone: "info" },
  { id: "trivial", label: "Trivial", hint: "Cosmetic.", weight: 100, tone: "muted" },
];

const SEVERITY_BY_ID = Object.fromEntries(SEVERITIES.map((s) => [s.id, s]));

export function severityMeta(id) {
  return (
    SEVERITY_BY_ID[id] || {
      id: id || "unset",
      label: "Unrated",
      hint: "",
      // Unrated sorts BELOW trivial rather than above critical. An unrated bug
      // is one nobody has assessed, and letting it jump the queue would mean
      // the fastest way to the top of a QA list is to leave the field blank.
      weight: 0,
      tone: "muted",
    }
  );
}

/** Is this bug still somebody's problem? */
export function isOpenBug(bug) {
  // "Open" here means NOT SETTLED — a bug with QA is still a bug. That is a
  // different question from "is it on the developer's plate", which Capacity
  // asks; utils/taskState.js holds both and explains why they differ.
  return isUnsettled(bug);
}

/**
 * Worst first, then oldest first.
 *
 * Age breaks the tie rather than the due date: a bug that has sat unfixed for
 * three weeks is a worse sign than one due tomorrow, and bugs frequently have
 * no due date at all.
 */
export function sortBugs(bugs) {
  return [...(bugs || [])].sort((a, b) => {
    const sw = severityMeta(b.severity).weight - severityMeta(a.severity).weight;
    if (sw !== 0) return sw;
    return String(a.created_at || "").localeCompare(String(b.created_at || ""));
  });
}

/**
 * Counts per stage, for the queue header.
 *
 * Every stage is present in the result even at zero, so the header does not
 * change shape as bugs move — a row of numbers that gains and loses columns is
 * harder to read at a glance than one with zeroes in it.
 */
export function bugCounts(bugs) {
  const counts = Object.fromEntries(BUG_STAGES.map((s) => [s.id, 0]));
  for (const b of bugs || []) {
    const stage = bugStage(b.status);
    if (stage.id in counts) counts[stage.id] += 1;
  }
  return counts;
}
