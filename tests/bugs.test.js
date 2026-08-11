import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  BUG_STAGES,
  bugStage,
  SEVERITIES,
  severityMeta,
  isOpenBug,
  sortBugs,
  bugCounts,
} from "@/utils/bugs";

const root = path.resolve(__dirname, "..");
const read = (p) =>
  readFileSync(path.join(root, p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*--.*$/gm, "");

describe("the bug lifecycle is the task pipeline, not a second one", () => {
  const pmData = read("src/utils/pmData.js");

  it("every stage names a status the pipeline actually has", () => {
    const m = pmData.match(/export const STATUS_TRANSITIONS = \{([\s\S]*?)\n\};/);
    const known = new Set([...m[1].matchAll(/^\s*(\w+):/gm)].map((x) => x[1]));
    for (const stage of BUG_STAGES) {
      expect(known.has(stage.status), `${stage.id} -> ${stage.status}`).toBe(true);
    }
  });

  it("the moves the lifecycle needs are all legal transitions", () => {
    const m = pmData.match(/export const STATUS_TRANSITIONS = \{([\s\S]*?)\n\};/)[1];
    const allowed = {};
    for (const line of m.matchAll(/^\s*(\w+):\s*\[([^\]]*)\]/gm)) {
      allowed[line[1]] = [...line[2].matchAll(/"(\w+)"/g)].map((x) => x[1]);
    }
    // Open -> In Progress -> Fixed -> Retest, and Reopened -> In Progress.
    expect(allowed.pending).toContain("in_progress");
    expect(allowed.in_progress).toContain("awaiting_approval");
    expect(allowed.awaiting_approval).toContain("reviewed");
    expect(allowed.rejected, "a reopened bug must be able to go back").toContain("in_progress");
  });

  it("closing is left to the review route, like every other task", () => {
    // `completed` has no exits and is reachable only through review — which is
    // what carries the productivity record. A bug screen that set it directly
    // would produce a closed bug with none of that.
    expect(pmData).toMatch(/completed:\s*\[\]/);
    expect(pmData).toMatch(/REVIEW_ONLY_STATUSES = new Set\(\["completed", "rejected"\]\)/);
  });

  it("QA can actually do the retest", () => {
    expect(read("src/app/api/admin-review/route.js")).toContain("'qa'");
  });
});

describe("bugStage", () => {
  it("translates each pipeline status", () => {
    expect(bugStage("pending").label).toBe("Open");
    expect(bugStage("awaiting_approval").label).toBe("Fixed");
    expect(bugStage("reviewed").label).toBe("Retesting");
    expect(bugStage("completed").label).toBe("Closed");
    expect(bugStage("rejected").label).toBe("Reopened");
  });

  it("survives a status it has never seen", () => {
    const s = bugStage("something_new");
    expect(s.label).toBe("something_new");
    expect(s.id).toBe("unknown");
  });

  it("survives null", () => {
    expect(() => bugStage(null)).not.toThrow();
    expect(bugStage(null).label).toBe("Unknown");
  });
});

describe("severity", () => {
  it("orders worst first", () => {
    const w = (id) => severityMeta(id).weight;
    expect(w("critical")).toBeGreaterThan(w("major"));
    expect(w("major")).toBeGreaterThan(w("minor"));
    expect(w("minor")).toBeGreaterThan(w("trivial"));
  });

  it("sorts an UNRATED bug below trivial, not above critical", () => {
    // Otherwise the fastest route to the top of a QA queue is to leave the
    // field blank.
    expect(severityMeta(null).weight).toBeLessThan(severityMeta("trivial").weight);
    expect(severityMeta("nonsense").weight).toBeLessThan(severityMeta("trivial").weight);
  });

  it("does not use the array index as the weight", () => {
    // Inserting a severity between two others would otherwise renumber every
    // bug's queue position.
    const weights = SEVERITIES.map((s) => s.weight);
    expect(new Set(weights).size).toBe(SEVERITIES.length);
    expect(weights.every((w) => w > 10)).toBe(true);
  });

  it("matches the vocabulary the database enforces", () => {
    const migration = read("database/061_bug_fields.sql");
    for (const s of SEVERITIES) {
      expect(migration, `${s.id} missing from the CHECK`).toContain(`'${s.id}'`);
    }
  });
});

describe("sortBugs", () => {
  const bugs = [
    { id: "a", severity: "minor", created_at: "2026-01-01" },
    { id: "b", severity: "critical", created_at: "2026-03-01" },
    { id: "c", severity: null, created_at: "2026-01-01" },
    { id: "d", severity: "critical", created_at: "2026-01-01" },
  ];

  it("puts the worst first", () => {
    expect(sortBugs(bugs)[0].severity).toBe("critical");
  });

  it("breaks ties on age, oldest first", () => {
    const criticals = sortBugs(bugs).filter((b) => b.severity === "critical");
    expect(criticals.map((b) => b.id)).toEqual(["d", "b"]);
  });

  it("leaves unrated at the bottom", () => {
    expect(sortBugs(bugs).at(-1).id).toBe("c");
  });

  it("does not mutate its input", () => {
    const before = bugs.map((b) => b.id);
    sortBugs(bugs);
    expect(bugs.map((b) => b.id)).toEqual(before);
  });

  it("survives null and undefined", () => {
    expect(sortBugs(null)).toEqual([]);
    expect(sortBugs(undefined)).toEqual([]);
  });
});

describe("isOpenBug", () => {
  it("counts everything except closed", () => {
    expect(isOpenBug({ status: "pending" })).toBe(true);
    expect(isOpenBug({ status: "rejected" })).toBe(true); // reopened is open
    expect(isOpenBug({ status: "completed" })).toBe(false);
  });
});

describe("bugCounts", () => {
  it("reports every stage even at zero, so the header keeps its shape", () => {
    const counts = bugCounts([{ status: "pending" }]);
    expect(Object.keys(counts).sort()).toEqual(BUG_STAGES.map((s) => s.id).sort());
    expect(counts.open).toBe(1);
    expect(counts.closed).toBe(0);
  });

  it("ignores a status it does not recognise rather than throwing", () => {
    expect(() => bugCounts([{ status: "who_knows" }])).not.toThrow();
  });

  it("survives an empty list", () => {
    expect(bugCounts([]).open).toBe(0);
    expect(bugCounts(null).open).toBe(0);
  });
});

describe("the migration adds fields without breaking tasks", () => {
  const migration = read("database/061_bug_fields.sql");

  it("makes every new column nullable", () => {
    // A NOT NULL would fail every ordinary task insert in the product.
    expect(migration).not.toMatch(/add column if not exists \w+ \w+ not null/i);
  });

  it("does not add a second status pipeline", () => {
    expect(migration).not.toMatch(/bug_status/);
    expect(migration).not.toMatch(/create table/i);
  });

  it("indexes the bugs queue rather than scanning for task_type", () => {
    expect(migration).toMatch(/where task_type = 'bug'/);
  });
});

describe("the bug queue reuses the task machinery rather than writing rows", () => {
  const UI = read("src/components/admin/BugQueue.jsx");

  it("creates bugs through createTask, so automations and defaults still run", () => {
    expect(UI).toContain("createTask(");
    expect(UI).not.toMatch(/\.from\("developer_tasks"\)[\s\S]{0,80}\.insert\(/);
  });

  it("moves them through changeTaskStatus, so the activity log still records it", () => {
    expect(UI).toContain("changeTaskStatus(");
    expect(UI).not.toMatch(/\.from\("developer_tasks"\)[\s\S]{0,80}\.update\(/);
  });

  it("asks the shared rule before moving, not just its own table", () => {
    // If the pipeline changes, this refuses rather than writing something the
    // transition guard would reject anyway.
    expect(UI).toContain("allowedTransitions(bug.status).includes(next.status)");
  });

  it("offers no Close button — closing belongs to review", () => {
    // `completed` carries is_on_time, productivity points, the admin_reviews
    // row and the developer's notification. Setting it here would produce a
    // closed bug with none of that, and Reports would stop matching this
    // screen.
    expect(UI).not.toMatch(/"completed"[^)]*\)\s*=>\s*move/);
    const moves = UI.match(/const NEXT_MOVE = \{([\s\S]*?)\n\};/);
    expect(moves?.[1]).not.toContain("completed");
  });

  it("says where closing happens instead of leaving someone hunting", () => {
    expect(UI).toMatch(/Task Reviews/);
  });

  it("does not set priority as well as severity", () => {
    // Two columns claiming the same thing can disagree, and then nobody knows
    // which one the queue is sorted by.
    const call = UI.match(/createTask\([\s\S]*?\}\)/);
    expect(call?.[0]).not.toMatch(/\bpriority:/);
  });

  it("counts Reopened as still open", () => {
    // A bug that failed its retest is emphatically not closed.
    expect(UI).toMatch(/b\.status !== "completed"/);
  });
});
