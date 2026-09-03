import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { defaultRolesFor } from "@/utils/permissionCatalogue";

/**
 * Capacity, measured rather than guessed — migration 088.
 *
 * WHAT THE PRODUCT ALREADY SAID ABOUT ITSELF. `src/utils/orgWorkGraph.js`:
 *
 *     THE THRESHOLDS ARE A CONVENTION, NOT A MEASUREMENT. Nothing in this
 *     product records how long a task takes.
 *
 * Four things existed and none of them were joined: `estimated_hours` (016),
 * `project_members.allocation_pct` (071 — added for exactly this and never
 * populated by anything), approved leave (075) and logged time (017). 088
 * joins them.
 *
 * THE ONE RULE THESE TESTS EXIST FOR: nothing is invented where the data is
 * absent. `weekly_hours` is nullable with no default, and every number derived
 * from it is NULL rather than a guess. Writing 40 would be the most tempting
 * invention in this whole series and the most damaging — every part-timer,
 * contractor and intern planned as full-time, the table looking complete, and
 * nobody going looking.
 */

const root = path.resolve(__dirname, "..");
const raw = (p) => readFileSync(path.join(root, p), "utf8");
const read = (p) =>
  raw(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const readSql = (p) => raw(p).replace(/^\s*--.*$/gm, "");

const MIGRATION = "database/088_capacity_planning.sql";
const ROUTE = "src/app/api/capacity/route.js";
const SCREEN = "src/components/admin/CapacityPlan.jsx";

describe("nothing is invented where the data is absent", () => {
  const sql = readSql(MIGRATION);

  it("adds weekly_hours nullable with no default", () => {
    expect(sql).toMatch(/add column if not exists weekly_hours numeric\(5,2\)/);
    expect(sql).not.toMatch(/weekly_hours numeric\(5,2\)[^;]*default/i);
  });

  it("returns NULL, not a number, when nobody has set the hours", () => {
    expect(sql).toMatch(/when ep\.weekly_hours is null then null/);
    // and there is no fallback constant anywhere in the view
    const view = sql.slice(sql.indexOf("create or replace view public.capacity_week_v"));
    expect(view).not.toMatch(/coalesce\(ep\.weekly_hours,\s*\d/);
  });

  it("passes the nulls through the route untouched", () => {
    const route = read(ROUTE);
    expect(route).not.toMatch(/\|\|\s*40/);
    expect(route).not.toMatch(/weeklyHours \|\| \d/);
  });

  it("renders them as 'not set' rather than as a figure", () => {
    const screen = read(SCREEN);
    expect(screen).toMatch(/not set/);
    expect(screen).toMatch(/r\.available_hours == null \? "—"/);
  });

  it("says how much of the estimate is missing", () => {
    // An estimate covering half the open tasks is worth less than one covering
    // all of them, and the reader cannot tell unless told.
    expect(sql).toMatch(/unestimated_open_tasks/);
    expect(read(SCREEN)).toMatch(/unestimated/);
  });
});

describe("the view is arithmetically honest", () => {
  const sql = readSql(MIGRATION);
  const view = sql.slice(sql.indexOf("create or replace view public.capacity_week_v"));

  it("counts only the leave days that fall inside the week", () => {
    // A two-week holiday must not subtract ten days from each of the two weeks.
    expect(view).toMatch(/least\(r\.end_date, w\.week_start \+ 6\)/);
    expect(view).toMatch(/greatest\(r\.start_date, w\.week_start\)/);
  });

  it("counts only approved leave, in BOTH places it asks", () => {
    // Mutation testing caught this: the view filters leave status TWICE — once
    // in `weeks`, to decide which (person, week) rows exist at all, and once in
    // `leave_days`, to count the days. Asserting the string once passed on the
    // second while the first had been widened to include 'pending', which would
    // have planned around holidays nobody had approved.
    // Anchored on the `r.` alias, which is leave_requests in both CTEs — an
    // unanchored `status` also matches the project and task status filters and
    // the count stops meaning anything.
    const filters = view.match(/r\.status\s*(?:=\s*'[a-z]+'|in \([^)]*\))/g) || [];
    expect(filters.length, "leave status is filtered in two CTEs").toBe(2);
    for (const f of filters) expect(f.replace(/\s+/g, " ")).toBe("r.status = 'approved'");
    // and nothing anywhere treats an undecided request as real
    expect(view).not.toMatch(/'pending'/);
  });

  it("cannot divide by zero when somebody is on leave all week", () => {
    expect(view).toMatch(/nullif\(greatest\(0, ep\.weekly_hours/);
  });

  it("cannot double-count somebody holding two employee profiles", () => {
    // employee_profiles is unique on (organization_id, user_id, USER_TYPE), so
    // a developer promoted to admin has two rows. 079 shipped exactly this bug
    // against this same table; a plain join here would double every number on
    // the screen.
    expect(view).toMatch(/left join lateral/);
    expect(view).toMatch(/limit 1\s*\)\s*ep on true/);
    expect(view).not.toMatch(/left join public\.employee_profiles/);
  });

  it("excludes finished projects from the allocation total", () => {
    expect(view).toMatch(/not in \('completed','cancelled','closed'\)/);
  });

  it("reads as the caller", () => {
    // The whole reason 087 exists. A view without this reads its base tables as
    // its owner and every RLS policy underneath is skipped.
    expect(view).toMatch(/with \(security_invoker = true\)/);
  });
});

describe("over-allocation is shown, not refused", () => {
  it("puts no ceiling on the summed allocation", () => {
    const sql = readSql(MIGRATION);
    expect(sql).not.toMatch(/allocation_pct.*<=\s*100/);
  });

  it("caps a SINGLE project at 100 in the route", () => {
    // 0..100 per project; a person may still total more across several, which
    // is the state the screen exists to surface.
    const route = read(ROUTE);
    expect(route).toMatch(/pct < 0 \|\| pct > 100/);
  });

  it("marks it on screen", () => {
    expect(read(SCREEN)).toMatch(/Number\(r\.allocation_pct\) > 100/);
  });
});

describe("two different writes behind two different keys", () => {
  const route = read(ROUTE);

  it("matches the allocation key to 071's existing write policy", () => {
    // The key and the RLS must not come to disagree about who may staff a
    // project, so they are asserted against each other.
    expect([...defaultRolesFor("capacity.allocate")].sort()).toEqual(
      ["owner", "admin", "manager"].sort()
    );
    const policy = readSql("database/071_project_members.sql");
    expect(policy).toMatch(/in \('owner','admin','manager'\)/);
  });

  it("keeps contracted hours with HR", () => {
    // A manager who could quietly raise a report's weekly hours could make
    // their own plan come out right.
    expect([...defaultRolesFor("employment.set_hours")].sort()).toEqual(
      ["owner", "admin", "hr"].sort()
    );
    expect(defaultRolesFor("employment.set_hours")).not.toContain("manager");
  });

  it("checks the right key for each write", () => {
    expect(route).toMatch(/requirePermission\(auth, "employment\.set_hours"\)/);
    expect(route).toMatch(/requirePermission\(auth, "capacity\.allocate"\)/);
    // hours branch is decided before the allocation branch's key is asked
    expect(route.indexOf('"employment.set_hours"')).toBeLessThan(
      route.indexOf('"capacity.allocate"')
    );
  });

  it("gates the read on capacity.view", () => {
    expect(route).toMatch(/requirePermission\(auth, "capacity\.view"\)/);
  });

  it("creates neither a membership nor a profile as a side effect", () => {
    // Allocation describes somebody already on the project; contracted hours
    // describe a profile that already exists. Creating either from a number
    // would make a half-formed record out of a typo.
    expect(route).toMatch(/That person is not on that project/);
    expect(route).toMatch(/That person has no employee profile yet/);
    expect(route).not.toMatch(/from\("project_members"\)\s*\.insert/);
    expect(route).not.toMatch(/from\("employee_profiles"\)\s*\.insert/);
  });

  it("lets a figure be cleared back to unset", () => {
    // null is a real answer — "we do not know" — and must stay reachable, or
    // a mistyped 40 can never be taken back.
    expect(route).toMatch(/body\.weeklyHours === null \? null/);
    expect(route).toMatch(/body\?\.allocationPct === null \? null/);
  });
});

describe("the measured panel sits beside the counted one, not on top of it", () => {
  const screen = read("src/components/admin/TeamCapacity.jsx");

  it("renders CapacityPlan inside the existing Capacity screen", () => {
    expect(screen).toMatch(/import CapacityPlan from "@\/components\/admin\/CapacityPlan"/);
    expect(screen).toMatch(/<CapacityPlan people=/);
  });

  it("leaves the task-count model in place", () => {
    // The counts still work on the day nobody has set an hour, which is most
    // organizations on day one. A screen that went blank the moment a better
    // number existed would be a downgrade dressed as an upgrade.
    expect(screen).toMatch(/personLoad/);
    expect(screen).toMatch(/loadLevel/);
  });

  it("adds no second Capacity section to the sidebar", () => {
    const nav = read("src/components/shell/navConfig.js");
    const ids = [...nav.matchAll(/id: "([a-z-]+)"/g)].map((m) => m[1]);
    expect(ids.filter((id) => id.includes("capacity"))).toEqual(["capacity"]);
  });
});
