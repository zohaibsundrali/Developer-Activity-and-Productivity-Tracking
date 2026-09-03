import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  SECTION_PERMISSIONS,
  NON_WIDENING_SECTIONS,
  ADMIN_AREA_ROLES,
  canAccessAdminSection,
  canEnterAdminArea,
} from "@/components/shell/sectionAccess";
import { adminNavFor } from "@/components/shell/navConfig";
import { SECTION_TITLES } from "@/components/shell/sectionTitles";
import { defaultRolesFor, permissionsForRole } from "@/utils/permissionCatalogue";

/**
 * Test cases, test runs, and the defect link — migration 081.
 *
 * THE CONSTRAINT THIS MODULE INHERITED. 061 refused to add a bug table or a bug
 * status pipeline, on the grounds that a bug IS a `developer_tasks` row with
 * `task_type = 'bug'` and a second pipeline would mean two places for "is this
 * done?" to disagree. That still holds, so the tests below check that a defect
 * raised from a failed test is that same row and nothing else.
 *
 * WHAT 061 LEFT OPEN. It also said it was not a test-case manager — a statement
 * about scope, not a prohibition. A test case is not a task: a task is done
 * once, a test case is a question you ask again of every build, and its history
 * is the answer changing over time.
 *
 * THE TRAP THIS MODULE WALKED INTO, recorded because the fix is load-bearing.
 * The first draft made `test_case.view` a wide "delivery" set including
 * developer, designer and devops. Those three cannot enter /admin — so the key
 * would have had no screen, and because `ADMIN_AREA_ROLES` is derived by
 * flattening every gated section's roles, gating the Quality section on it
 * opened the admin FRONT DOOR to all three. roleDashboards caught it.
 */

const root = path.resolve(__dirname, "..");
const raw = (p) => readFileSync(path.join(root, p), "utf8");
const read = (p) =>
  raw(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const readSql = (p) => raw(p).replace(/^\s*--.*$/gm, "");

const MIGRATION = "database/081_qa_test_management.sql";
const ROUTE = "src/app/api/quality/route.js";
const SCREEN = "src/components/admin/Quality.jsx";
const REVIEWERS = ["owner", "admin", "manager", "team_lead", "qa"];
const CONTRIBUTORS = ["developer", "designer", "devops", "employee"];

describe("the keys the module introduced", () => {
  it("is the reviewer set today, all four of them", () => {
    for (const key of [
      "test_case.view",
      "test_case.manage",
      "test_run.manage",
      "test_run.execute",
    ]) {
      expect([...defaultRolesFor(key)].sort(), key).toEqual([...REVIEWERS].sort());
    }
  });

  it("holds the widening back until there is a screen to widen onto", () => {
    // The design wants view and execute wider than manage — a developer should
    // see what will be checked. It is not done here because those three roles
    // cannot enter /admin: the key would have no surface, and gating a section
    // on it would open the front door. Asserted so the widening has to arrive
    // WITH a staff-shell screen rather than on its own.
    for (const role of ["developer", "designer", "devops"]) {
      expect(defaultRolesFor("test_case.view"), role).not.toContain(role);
      expect(defaultRolesFor("test_run.execute"), role).not.toContain(role);
      expect(canEnterAdminArea(role), role).toBe(false);
    }
  });

  it("keeps the people who are not on a project out of it", () => {
    for (const key of ["test_case.view", "test_run.execute"]) {
      for (const role of ["hr", "finance", "employee"]) {
        expect(defaultRolesFor(key), `${key}/${role}`).not.toContain(role);
      }
    }
    expect(permissionsForRole("client")).toEqual([]);
  });

  it("gives qa a module of its own at last", () => {
    // qa held task.review and bug.triage and nothing else it owned.
    const qa = permissionsForRole("qa");
    for (const key of ["test_case.manage", "test_run.manage"]) {
      expect(qa, key).toContain(key);
    }
  });
});

describe("a defect is still a bug in the bug queue", () => {
  const route = read(ROUTE);

  it("writes a developer_tasks row with task_type bug", () => {
    // 061 refused a second pipeline. This keeps that.
    expect(route).toMatch(/from\("developer_tasks"\)/);
    expect(route).toMatch(/task_type: "bug"/);
  });

  it("supplies the columns the base schema requires", () => {
    // developer_tasks.start_date and end_date are NOT NULL, and a task with no
    // status is invisible to every board that filters on one. `createTask`
    // supplies these; this route cannot call it, so it supplies them itself.
    for (const col of ["status:", "priority:", "start_date:", "end_date:"]) {
      expect(route, col).toContain(col);
    }
  });

  it("creates no second status vocabulary", () => {
    // No bug table, no bug pipeline, no parallel statuses.
    expect(readSql(MIGRATION)).not.toMatch(/create table[^;]*\bbugs\b/i);
    expect(readSql(MIGRATION)).not.toMatch(/'reopened'|'fixed'|'retest'/i);
  });

  it("links rather than duplicates", () => {
    const sql = readSql(MIGRATION);
    expect(sql).toMatch(/bug_task_id\s+uuid references public\.developer_tasks\(id\) on delete set null/);
  });

  it("says plainly that automations do not fire on this path", () => {
    // createTask dispatches `task_created` automations and cannot run here — it
    // uses the browser client and sessionStorage. The row is identical; the
    // side effect is missing. Written down rather than assumed away.
    expect(raw(ROUTE)).toMatch(/does NOT currently\s*\n \* trigger those automations/);
  });
});

describe("the schema refuses the contradictions", () => {
  const sql = readSql(MIGRATION);

  it("will not let a passing test cite a defect", () => {
    // Otherwise the QA summary counts it green while the defect list counts it
    // red, and the link is decorative.
    expect(sql).toMatch(/constraint test_executions_bug_only_when_not_passing/);
    expect(sql).toMatch(/bug_task_id is null or result in \('failed','blocked'\)/);
  });

  it("allows a blocked test to cite one", () => {
    // Being unable to run a test because something is broken is exactly a
    // defect worth linking.
    const check = sql.slice(sql.indexOf("test_executions_bug_only_when_not_passing"));
    expect(check.slice(0, 200)).toContain("'blocked'");
  });

  it("asks each case once per run", () => {
    expect(sql).toMatch(/constraint test_executions_one_per_run unique \(run_id, test_case_id\)/);
  });

  it("archives a case rather than offering deletion as the only exit", () => {
    // A case that has been run is part of the history of every run it appeared
    // in; deleting it takes the meaning out of those rows.
    expect(sql).toMatch(/check \(status in \('draft','active','archived'\)\)/);
  });

  it("starts executions as untested so a run knows its own scope", () => {
    expect(sql).toMatch(/result\s+text not null default 'untested'/);
  });
});

describe("a closed run is closed", () => {
  const sql = readSql(MIGRATION);

  it("blocks writes with a trigger, not with a route check", () => {
    // These tables are reachable from the browser through PostgREST, so a rule
    // enforced only in a route is advisory.
    expect(sql).toMatch(/create trigger trg_test_execution_run_open/);
    expect(sql).toMatch(/on public\.test_executions/);
  });

  it("covers delete as well as insert and update", () => {
    const trigger = sql.slice(sql.indexOf("create trigger trg_test_execution_run_open"));
    expect(trigger.slice(0, 300)).toMatch(/before insert or update or delete/);
  });

  it("reads OLD on a delete", () => {
    const fn = sql.slice(sql.indexOf("function public.test_run_closed"), sql.indexOf("$$;", sql.indexOf("function public.test_run_closed")));
    expect(fn).toMatch(/coalesce\(new, old\)/);
  });

  it("blocks the results and not the run's own status", () => {
    // Reopening has to stay possible, or the escape hatch closes with the run.
    const fn = sql.slice(sql.indexOf("function public.test_run_closed"), sql.indexOf("$$;", sql.indexOf("function public.test_run_closed")));
    expect(fn).toMatch(/public\.test_executions/);
    expect(fn).not.toMatch(/update public\.test_runs/);
  });
});

describe("the route decides who may do what, per act", () => {
  const route = read(ROUTE);

  it("uses a different key for writing a case, a run, and a result", () => {
    expect(route).toMatch(/case: "test_case\.manage"/);
    expect(route).toMatch(/run: "test_run\.manage"/);
    expect(route).toMatch(/bug: "test_run\.execute"/);
  });

  it("reads a run's scope from the database, not from the body", () => {
    // Letting the caller send the case list would let a run quietly omit the
    // cases it would fail.
    const post = route.slice(route.indexOf('if (action === "run")'));
    expect(post).toMatch(/from\("test_cases"\)/);
    expect(post).toMatch(/eq\("status", "active"\)/);
    expect(post).not.toMatch(/body\?\.caseIds/);
  });

  it("removes a run whose executions could not be written", () => {
    // A run with no scope renders as "0 of 0" and means nothing.
    expect(route).toMatch(/from\("test_runs"\)\s*\.delete\(\)\s*\.eq\("id", run\.id\)/);
  });

  it("refuses a second defect on one result", () => {
    expect(route).toMatch(/already has a defect linked/);
  });

  it("refuses a defect on a result that is not failed or blocked", () => {
    expect(route).toMatch(/Only a failed or blocked test raises a defect/);
  });

  it("scopes every lookup to the caller's organization", () => {
    for (const table of ["test_runs", "test_executions", "test_cases", "projects"]) {
      const i = route.indexOf(`from("${table}")`);
      expect(i, table).toBeGreaterThan(-1);
      expect(route.slice(i, i + 400), table).toMatch(/eq\("organization_id", auth\.orgId\)/);
    }
  });

  it("validates every id it is handed", () => {
    expect(route).toMatch(/UUID_RE\.test\(String\(runId/);
    expect(route).toMatch(/UUID_RE\.test\(String\(executionId/);
  });
});

describe("the screen is wired and gated", () => {
  const adminSrc = read("src/app/admin/dashboard/page.js");
  const screen = read(SCREEN);

  it("renders and titles the section", () => {
    expect(adminSrc).toContain('case "quality":');
    expect(adminSrc).toMatch(/import Quality from "@\/components\/admin\/Quality"/);
    expect(SECTION_TITLES.quality.admin).toBeTruthy();
  });

  it("offers it to the reviewer roles and nobody else", () => {
    for (const role of REVIEWERS) {
      expect(adminNavFor(role).map((i) => i.id), role).toContain("quality");
    }
    for (const role of ["hr", "finance"]) {
      expect(canAccessAdminSection("quality", role), role).toBe(false);
    }
  });

  it("disables the controls on a closed run rather than hiding them", () => {
    // The results are the point of the screen.
    expect(screen).toMatch(/disabled=\{closed \|\| busy\}/);
  });

  it("offers Raise defect only on a failed or blocked result", () => {
    expect(screen).toMatch(/\["failed", "blocked"\]\.includes\(e\.result\)/);
  });
});

describe("the module does not widen the admin front door", () => {
  it("leaves ADMIN_AREA_ROLES at the seven roles", () => {
    expect([...ADMIN_AREA_ROLES].sort()).toEqual(
      ["admin", "finance", "hr", "manager", "owner", "qa", "team_lead"].sort()
    );
  });

  it("keeps every contributor out", () => {
    for (const role of CONTRIBUTORS) {
      expect(canEnterAdminArea(role), role).toBe(false);
    }
  });

  it("is a real screen, so it stays out of the non-widening exemption", () => {
    expect(NON_WIDENING_SECTIONS).not.toContain("quality");
    expect(SECTION_PERMISSIONS.quality).toBe("test_case.view");
  });
});

describe("the migration keeps its RLS in step with the catalogue", () => {
  const sql = readSql(MIGRATION);

  it("uses the reviewer list in every policy", () => {
    const policies = sql.match(/create policy[\s\S]*?;/g) || [];
    expect(policies.length).toBe(6);
    for (const p of policies) {
      expect(p, p.slice(0, 50)).toMatch(/in \('owner','admin','manager','team_lead','qa'\)/);
      expect(p, p.slice(0, 50)).toContain("public.auth_org()");
      expect(p, p.slice(0, 50)).toContain("public.auth_is_client()");
    }
  });

  it("no longer carries the wide list that opened the door", () => {
    expect(sql).not.toMatch(/'developer','designer','devops'/);
  });

  it("puts the billing lock on writes and not on reads", () => {
    const withChecks = sql.match(/with check\s*\([\s\S]*?\);/g) || [];
    expect(withChecks.length).toBe(3);
    for (const w of withChecks) expect(w).toContain("public.auth_org_unlocked()");
    const reads = sql.match(/for select to authenticated[\s\S]*?;/g) || [];
    for (const r of reads) expect(r).not.toContain("auth_org_unlocked");
  });

  it("is additive", () => {
    expect(sql).not.toMatch(/drop\s+table/i);
    expect(sql).not.toMatch(/truncate/i);
    expect(sql).not.toMatch(/delete\s+from/i);
  });
});
