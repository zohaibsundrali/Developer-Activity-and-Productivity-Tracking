import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  SOON_DAYS,
  WORK_BUCKETS,
  bucketMyWork,
  daysUntil,
  deadlineOf,
  ymd,
} from "@/utils/myWork";
import { staffNav } from "@/components/shell/navConfig";
import { sectionTitle } from "@/components/shell/sectionTitles";
import { roleCan } from "@/utils/permissionEngine";

/**
 * My Work — one person's tasks, across every project.
 *
 * THE SCREEN THAT WAS MISSING. A developer could see how many tasks they had
 * and which projects they were on, and nowhere at all what those tasks WERE.
 * Finding out meant opening each project in turn — the one question the product
 * exists to answer for them took the most clicks on the screen.
 */

const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const TODAY = "2026-08-18";
const day = (offset) => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

const task = (over = {}) => ({
  id: Math.random().toString(36).slice(2),
  task_title: "T",
  status: "pending",
  priority: "medium",
  ...over,
});

describe("the deadline column, which is not the obvious one", () => {
  it("falls back to end_date when due_date is empty", () => {
    /**
     * `developer_tasks` has BOTH. Every task in the live database sets
     * `end_date` and NONE sets `due_date` — checked against the real data, not
     * assumed. A screen written against `due_date` alone would show every task
     * as having no deadline, and "0 overdue" would look like good news.
     */
    expect(deadlineOf({ due_date: null, end_date: day(3) })).toBe(day(3));
    expect(deadlineOf({ due_date: day(1), end_date: day(9) })).toBe(day(1));
    expect(deadlineOf({})).toBeNull();
    expect(deadlineOf(null)).toBeNull();
  });

  it("does not read a missing date as the epoch", () => {
    // `new Date(null)` is 1970-01-01 — a valid date, which would render as
    // twenty thousand days late. Guarded, and this is the guard.
    expect(ymd(null)).toBeNull();
    expect(ymd("not a date")).toBeNull();
    expect(daysUntil({ end_date: null }, TODAY)).toBeNull();
  });

  it("counts whole days in both directions", () => {
    expect(daysUntil({ end_date: day(3) }, TODAY)).toBe(3);
    expect(daysUntil({ end_date: day(-3) }, TODAY)).toBe(-3);
    expect(daysUntil({ end_date: TODAY }, TODAY)).toBe(0);
  });
});

describe("one task lands in exactly one bucket", () => {
  it("never shows the same task twice", () => {
    /**
     * The admin Overview deliberately double-counts: it is measuring work, and
     * a task that is both overdue and in progress is genuinely both. This is a
     * personal to-do list, where the same task appearing twice is a bug — you
     * do it once.
     */
    const tasks = [
      task({ id: "a", status: "in_progress", end_date: day(-2) }),
      task({ id: "b", status: "rejected", end_date: day(-9) }),
      task({ id: "c", status: "pending", end_date: day(2) }),
      task({ id: "d", status: "awaiting_approval", end_date: day(-5) }),
      task({ id: "e", status: "pending", end_date: day(90) }),
    ];
    const { buckets } = bucketMyWork(tasks, TODAY);
    const seen = Object.values(buckets).flat().map((t) => t.id);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("puts sent-back work first, even when nothing about it is late", () => {
    // A rejected task carries no deadline pressure and looks ordinary in a
    // list. It is also entirely blocked on the person reading the screen,
    // which is why it outranks everything including overdue.
    const { buckets } = bucketMyWork(
      [task({ id: "r", status: "rejected", end_date: day(60) })],
      TODAY
    );
    expect(buckets.sent_back.map((t) => t.id)).toEqual(["r"]);
    expect(buckets.due_soon).toHaveLength(0);
    expect(WORK_BUCKETS[0].id).toBe("sent_back");
  });

  it("keeps a rejected task even though the work graph calls it settled", () => {
    // `isOpenTask` is about whether work is on somebody's plate org-wide.
    // Here the answer is unambiguous — it is this person's move — so the
    // rejected check runs BEFORE that test. Dropping it would hide the one
    // bucket they most need.
    const { buckets, total } = bucketMyWork([task({ status: "rejected" })], TODAY);
    expect(buckets.sent_back).toHaveLength(1);
    expect(total).toBe(1);
  });

  it("separates overdue from due soon at the boundary", () => {
    const { buckets } = bucketMyWork(
      [
        task({ id: "late", end_date: day(-1) }),
        task({ id: "today", end_date: TODAY }),
        task({ id: "edge", end_date: day(SOON_DAYS) }),
        task({ id: "beyond", end_date: day(SOON_DAYS + 1) }),
      ],
      TODAY
    );
    expect(buckets.overdue.map((t) => t.id)).toEqual(["late"]);
    expect(buckets.due_soon.map((t) => t.id)).toEqual(["today", "edge"]);
    expect(buckets.to_start.map((t) => t.id)).toEqual(["beyond"]);
  });

  it("drops finished work entirely", () => {
    const { buckets, total } = bucketMyWork(
      [task({ status: "completed", end_date: day(-30) })],
      TODAY
    );
    expect(Object.values(buckets).flat()).toHaveLength(0);
    expect(total).toBe(0);
  });
});

describe("the headline count means what it says", () => {
  it("excludes work that is waiting on somebody else", () => {
    /**
     * `in_review` is finished work sitting with a reviewer. Counting it as
     * outstanding makes the number say the opposite of what it means — the
     * person did their part and the screen tells them they still owe it.
     */
    const { total, counts } = bucketMyWork(
      [
        task({ status: "awaiting_approval" }),
        task({ status: "reviewed" }),
        task({ status: "pending", end_date: day(2) }),
      ],
      TODAY
    );
    expect(counts.in_review).toBe(2);
    expect(total).toBe(1);
  });

  it("is zero when there is genuinely nothing", () => {
    expect(bucketMyWork([], TODAY).total).toBe(0);
    expect(bucketMyWork(null, TODAY).total).toBe(0);
    expect(bucketMyWork(undefined, TODAY).total).toBe(0);
  });
});

describe("order inside a bucket is stable and useful", () => {
  it("sorts soonest first, then by priority, then by title", () => {
    const { buckets } = bucketMyWork(
      [
        task({ task_title: "zeta", end_date: day(2), priority: "low" }),
        task({ task_title: "alpha", end_date: day(1), priority: "low" }),
        task({ task_title: "beta", end_date: day(1), priority: "urgent" }),
      ],
      TODAY
    );
    expect(buckets.due_soon.map((t) => t.task_title)).toEqual(["beta", "alpha", "zeta"]);
  });

  it("puts dated work above undated work", () => {
    const { buckets } = bucketMyWork(
      [
        task({ id: "nodate", status: "in_progress" }),
        task({ id: "dated", status: "in_progress", end_date: day(40) }),
      ],
      TODAY
    );
    expect(buckets.in_progress.map((t) => t.id)).toEqual(["dated", "nodate"]);
  });

  it("does not reshuffle between identical loads", () => {
    // A list whose order changes between visits is one nobody trusts.
    const tasks = [
      task({ id: "1", task_title: "same", end_date: day(1) }),
      task({ id: "2", task_title: "same", end_date: day(1) }),
    ];
    const a = bucketMyWork(tasks, TODAY).buckets.due_soon.map((t) => t.id);
    const b = bucketMyWork(tasks, TODAY).buckets.due_soon.map((t) => t.id);
    expect(a).toEqual(b);
  });
});

describe("the screen is reachable and named", () => {
  it("is in every staff sidebar", () => {
    for (const role of ["developer", "designer", "devops", "employee", "manager", "team_lead", "hr"]) {
      expect(staffNav(role).map((i) => i.id), role).toContain("my-work");
    }
  });

  it("has a title, so the heading and the nav cannot disagree", () => {
    expect(sectionTitle("my-work", "developer")).toBe("My Work");
  });

  it("is rendered by the dashboard switch", () => {
    const page = read("src/app/developer/dashboard/page.jsx");
    expect(page).toMatch(/case "my-work":/);
    expect(page).toContain("<MyWork");
  });
});

describe("the last hand-typed role list on this dashboard", () => {
  it("asks the catalogue instead of naming five roles", () => {
    const page = read("src/app/developer/dashboard/page.jsx");
    expect(page).toContain('roleCan(effectiveRole, "hierarchy.view")');
    expect(page).not.toMatch(/\["manager", "team_lead", "hr", "admin", "owner"\]/);
  });

  it("admits exactly the roles the old array named", () => {
    for (const role of ["manager", "team_lead", "hr", "admin", "owner"]) {
      expect(roleCan(role, "hierarchy.view"), role).toBe(true);
    }
    for (const role of ["developer", "designer", "devops", "employee", "qa", "finance"]) {
      expect(roleCan(role, "hierarchy.view"), role).toBe(false);
    }
  });

  it("agrees with the sidebar about who sees Team", () => {
    // Three copies of one answer used to exist: this guard, staffNav, and the
    // catalogue. They agreed by coincidence.
    for (const role of ["manager", "team_lead", "hr"]) {
      expect(staffNav(role).map((i) => i.id), role).toContain("team");
      expect(roleCan(role, "hierarchy.view"), role).toBe(true);
    }
    for (const role of ["developer", "designer", "employee"]) {
      expect(staffNav(role).map((i) => i.id), role).not.toContain("team");
      expect(roleCan(role, "hierarchy.view"), role).toBe(false);
    }
  });
});

describe("the query names columns that exist", () => {
  it("uses task_title, not title", () => {
    // PostgREST rejects an entire request over one unknown column, so a single
    // wrong name blanks the screen with nothing in the console.
    const src = read("src/utils/myWork.js");
    expect(src).toContain("task_title");
    expect(src).not.toMatch(/select\([^)]*\btitle,/);
  });

  it("scopes by organization AND person", () => {
    const src = read("src/utils/myWork.js");
    expect(src).toContain('.eq("organization_id", orgId)');
    expect(src).toContain('.eq("developer_id", developerId)');
  });

  it("refuses to guess when the session is incomplete", () => {
    const src = read("src/utils/myWork.js");
    expect(src).toMatch(/if \(!orgId \|\| !developerId\)/);
  });
});
