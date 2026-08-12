import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  SETTLED_STATUSES,
  OFF_PLATE_STATUSES,
  isSettled,
  isUnsettled,
  isOnSomeonesPlate,
  settledFilter,
} from "@/utils/taskState";
import { isOpenBug } from "@/utils/bugs";
import { isOpenTask } from "@/utils/orgWorkGraph";

/**
 * Two questions about a task, told apart.
 *
 * WHAT WAS WRONG: three modules each had their own idea of "open", each right
 * for its own question, and all three used the same word.
 *
 *   utils/bugs.isOpenBug            `reviewed` OPEN
 *   utils/orgWorkGraph.isOpenTask   `reviewed` CLOSED
 *   the project-closure gate        `reviewed` OPEN
 *
 * A project manager saw Capacity call a developer "Free" while the Bug queue
 * showed three of their bugs open. Both were true; neither said which question
 * it was answering.
 *
 * They now share one module. The tests below pin the ONE status they disagree
 * about, because that disagreement is the point and a future "tidy-up" that
 * collapses them would silently change what closing a project means.
 */

const root = path.resolve(__dirname, "..");
const code = (p) =>
  readFileSync(path.join(root, p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");

const t = (status) => ({ status });

describe("isSettled — finished for good", () => {
  it("is completed and nothing else", () => {
    expect(isSettled(t("completed"))).toBe(true);
    for (const s of ["pending", "in_progress", "awaiting_approval", "reviewed", "rejected"]) {
      expect(isSettled(t(s)), s).toBe(false);
    }
  });

  it("does not count work that merely left somebody's inbox", () => {
    // `reviewed` means QA has it. "Can we close the project?" must not be
    // satisfied by that.
    expect(isSettled(t("reviewed"))).toBe(false);
  });

  it("treats a missing or unknown status as unsettled", () => {
    // Whatever it is, it is not finished. Assuming otherwise would let an
    // unrecognised status close a project.
    expect(isUnsettled(t(null))).toBe(true);
    expect(isUnsettled(t(undefined))).toBe(true);
    expect(isUnsettled(t("who_knows"))).toBe(true);
    expect(isUnsettled({})).toBe(true);
    expect(isUnsettled(null)).toBe(true);
  });
});

describe("isOnSomeonesPlate — the assignee is still holding it", () => {
  it("excludes completed AND reviewed", () => {
    expect(isOnSomeonesPlate(t("completed"))).toBe(false);
    expect(isOnSomeonesPlate(t("reviewed"))).toBe(false);
  });

  it("includes rejected — work sent back is back with them", () => {
    // A capacity view that forgets this reports somebody as free while they
    // are fixing something.
    expect(isOnSomeonesPlate(t("rejected"))).toBe(true);
  });

  it("includes everything still in flight", () => {
    for (const s of ["pending", "in_progress", "awaiting_approval"]) {
      expect(isOnSomeonesPlate(t(s)), s).toBe(true);
    }
  });
});

describe("the one status they disagree about", () => {
  it("is `reviewed`, and the disagreement is deliberate", () => {
    // Settled? No — QA still has it, so the project cannot close.
    // On their plate? Also no — the developer cannot be given less because of it.
    expect(isSettled(t("reviewed"))).toBe(false);
    expect(isOnSomeonesPlate(t("reviewed"))).toBe(false);
  });

  it("is the ONLY status they disagree about", () => {
    const statuses = ["pending", "in_progress", "awaiting_approval", "reviewed", "completed", "rejected"];
    const differ = statuses.filter((s) => isUnsettled(t(s)) !== isOnSomeonesPlate(t(s)));
    expect(differ).toEqual(["reviewed"]);
  });
});

describe("the three call sites now agree with themselves", () => {
  it("bugs asks the settled question", () => {
    expect(isOpenBug(t("reviewed"))).toBe(true); // a bug with QA is still a bug
    expect(isOpenBug(t("rejected"))).toBe(true);
    expect(isOpenBug(t("completed"))).toBe(false);
    expect(code("src/utils/bugs.js")).toContain("isUnsettled(bug)");
  });

  it("capacity asks the plate question", () => {
    expect(isOpenTask(t("reviewed"))).toBe(false);
    expect(isOpenTask(t("rejected"))).toBe(true);
    expect(code("src/utils/orgWorkGraph.js")).toContain("isOpenTask = isOnSomeonesPlate");
  });

  it("neither redefines the sets locally any more", () => {
    expect(code("src/utils/orgWorkGraph.js")).not.toMatch(/new Set\(\["completed", "reviewed"\]\)/);
    expect(code("src/utils/bugs.js")).not.toMatch(/\["completed"\]\.includes/);
  });
});

describe("settledFilter — the SQL half of the same rule", () => {
  it("renders the PostgREST value", () => {
    // Verified live: `status=not.in.(completed)` returned the same 9 rows as
    // `status=neq.completed`, `status=not.in.(pending)` returned 0 — proving
    // it discriminates rather than passing everything — and a malformed
    // filter 400s rather than silently matching.
    expect(settledFilter()).toBe("(completed)");
  });

  it("is built from the set, not typed out", () => {
    // Adding a settled status otherwise leaves every SQL filter asking the old
    // question while the JS predicate quietly moves on.
    expect(code("src/utils/taskState.js")).toMatch(/\[\.\.\.SETTLED_STATUSES\]\.join/);
  });

  it("is what the closure gate actually sends", () => {
    const route = code("src/app/api/projects/[id]/closure/route.js");
    expect(route).toContain('.not("status", "in", settledFilter())');
    expect(route).not.toContain('.neq("status", "completed")');
  });
});

describe("why there is no separate `rework` status", () => {
  it("`rejected` is already unsettled AND back on their plate", () => {
    // That is what rework means. A second name for a state the pipeline
    // already has is how two screens start disagreeing about the same row.
    expect(isUnsettled(t("rejected"))).toBe(true);
    expect(isOnSomeonesPlate(t("rejected"))).toBe(true);
  });

  it("and the pipeline already routes it back to work", () => {
    const pm = code("src/utils/pmData.js");
    expect(pm).toMatch(/rejected: \["in_progress"\]/);
  });

  it("carries a reason to the person who has to redo it", () => {
    const review = code("src/app/api/admin-review/route.js");
    expect(review).toMatch(/rejectionReason/);
  });
});

describe("the sets themselves", () => {
  it("keep settled a strict subset of off-plate", () => {
    // Anything finished is necessarily off somebody's plate. The reverse is
    // not true, and that asymmetry is the whole module.
    for (const s of SETTLED_STATUSES) {
      expect(OFF_PLATE_STATUSES.has(s), `${s} settled but on a plate`).toBe(true);
    }
    expect(OFF_PLATE_STATUSES.size).toBeGreaterThan(SETTLED_STATUSES.size);
  });
});
