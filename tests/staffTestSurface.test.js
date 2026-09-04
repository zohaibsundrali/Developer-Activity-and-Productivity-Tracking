import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  SECTION_PERMISSIONS,
  NON_WIDENING_SECTIONS,
  OWN_WORK_SECTIONS,
  ADMIN_AREA_ROLES,
  canEnterAdminArea,
} from "@/components/shell/sectionAccess";
import { staffNav } from "@/components/shell/navConfig";
import { PERMISSIONS, defaultRolesFor } from "@/utils/permissionCatalogue";
import { reportingChain } from "@/utils/employeesData";

/**
 * THE STAFF TEST SURFACE — migrations 095 and 096, the Tests screen in the
 * staff shell, and the reporting-lines editor that landed in the same branch.
 *
 * WHAT 081 DEFERRED, AND WHY. It wanted `test_case.view` to include developer,
 * designer and devops, and could not: those roles cannot enter /admin, so the
 * key would have had no screen — and because ADMIN_AREA_ROLES is DERIVED from
 * every gated section's roles, gating the admin Quality section on a widened
 * key would have opened the admin front door to all of them. It wrote that
 * down and kept the key narrow.
 *
 * WHAT CHANGES NOW. The key is widened WITH a screen: `my-tests`, rendered by
 * the staff shell. Two independent edits hold the admin door still — the admin
 * Quality section is re-keyed to `test_case.manage`, AND `my-tests` is in
 * NON_WIDENING_SECTIONS. Either one alone reopens the door; the tests below
 * re-derive the area set with each undone to prove it.
 *
 * WHAT MUST NOT MOVE. Writing a case or a run stays with the reviewers.
 * Filing a defect gets its own key, `bug.raise`, holding exactly what
 * `test_run.execute` held before, so widening "run a test" did not widen
 * "create a task". And the one `for all` policy on test_executions becomes
 * three, because otherwise the list that may set `result = 'failed'` is the
 * list that may DELETE the row.
 */

const root = path.resolve(__dirname, "..");
const raw = (p) => readFileSync(path.join(root, p), "utf8");
const read = (p) =>
  raw(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const readSql = (p) => raw(p).replace(/^\s*--.*$/gm, "");

const REVIEWERS = ["owner", "admin", "manager", "team_lead", "qa"];
const CONTRIBUTORS = ["developer", "designer", "devops", "employee"];
const TESTERS = [...REVIEWERS, ...CONTRIBUTORS];
const sorted = (a) => [...a].sort();

const RLS = "database/095_staff_test_visibility.sql";
const MIRROR = "database/096_staff_test_permissions.sql";
const ROUTE = "src/app/api/quality/route.js";
const SCREEN = "src/components/shared/TestCases.jsx";
const LINES = "src/components/admin/ReportingLines.jsx";
const CHART = "src/components/admin/ProjectHierarchy.jsx";
const ADMIN_DASHBOARD = "src/app/admin/dashboard/page.js";
const STAFF_DASHBOARD = "src/app/developer/dashboard/page.jsx";

const rls = readSql(RLS);

const READ_POLICIES = ["test_cases_read", "test_runs_read", "test_executions_read"];
const WRITE_POLICIES = [
  "test_cases_write",
  "test_runs_write",
  "test_executions_update",
  "test_executions_insert",
  "test_executions_delete",
];

/** One `create policy NAME on … ;` statement from 095, comments stripped. */
const policy = (name) => {
  const from = rls.indexOf(`create policy ${name} on`);
  expect(from, `${name} is not created in 095`).toBeGreaterThan(-1);
  return rls.slice(from, rls.indexOf(";", from) + 1);
};

/** Every role list quoted inside `auth_role() in (...)` in one policy body. */
const rolesIn = (body) =>
  [...body.matchAll(/auth_role\(\) in\s*\(([^)]*)\)/g)].map((m) =>
    sorted(m[1].match(/'([a-z_]+)'/g).map((s) => s.replace(/'/g, "")))
  );

// ─────────────────────────────────────────────────────────────────────────
// 095 — the row perimeter
// ─────────────────────────────────────────────────────────────────────────

describe("095 — who may READ a test plan", () => {
  it.each(READ_POLICIES)("%s admits every tester, keyed on test_case.view", (name) => {
    const body = policy(name);
    expect(body).toMatch(/for select to authenticated/);
    expect(body).toContain("auth_override('test_case.view')");
    const lists = rolesIn(body);
    expect(lists.length).toBe(1);
    expect(lists[0]).toEqual(sorted(TESTERS));
  });

  it("agrees with the catalogue — SQL and JS drifting apart is the failure mode here", () => {
    // The role list is written out in SQL rather than derived, because the
    // mirror table is not load-bearing. So the only thing keeping the two in
    // step is this test.
    for (const key of ["test_case.view", "test_run.execute"]) {
      expect(sorted(defaultRolesFor(key)), key).toEqual(sorted(TESTERS));
    }
    for (const key of ["test_case.manage", "test_run.manage", "bug.raise"]) {
      expect(sorted(defaultRolesFor(key)), key).toEqual(sorted(REVIEWERS));
    }
  });

  it("keeps a client out and stays inside the caller's organization, in every policy", () => {
    for (const name of [...READ_POLICIES, ...WRITE_POLICIES]) {
      const body = policy(name);
      expect(body, name).toContain("organization_id = public.auth_org()");
      expect(body, name).toContain("not public.auth_is_client()");
    }
  });
});

describe("095 — who may WRITE a case or a run: nobody new", () => {
  it.each([
    ["test_cases_write", "test_case.manage"],
    ["test_runs_write", "test_run.manage"],
  ])("%s stays with the reviewers, keyed on %s", (name, key) => {
    const body = policy(name);
    expect(body).toContain(`auth_override('${key}')`);
    const lists = rolesIn(body);
    expect(lists.length, "using and with check").toBe(2);
    for (const list of lists) expect(list).toEqual(sorted(REVIEWERS));
    expect(body).toMatch(/with check[\s\S]*auth_org_unlocked\(\)/);
  });
});

describe("095 — executions: one `for all` becomes three", () => {
  it("drops the 081 policy and does not bring it back under the same name", () => {
    expect(rls).toContain("drop policy if exists test_executions_write on public.test_executions");
    expect(rls).not.toContain("create policy test_executions_write");
  });

  it("leaves no `for all` policy on test_executions", () => {
    const stmts = [...rls.matchAll(/create policy (\w+) on public\.test_executions[\s\S]*?;/g)];
    expect(stmts.map((m) => m[1]).sort()).toEqual([
      "test_executions_delete",
      "test_executions_insert",
      "test_executions_read",
      "test_executions_update",
    ]);
    for (const m of stmts) expect(m[0], m[1]).not.toMatch(/for all/);
  });

  it("UPDATE is wide and keyed on test_run.execute", () => {
    const body = policy("test_executions_update");
    expect(body).toMatch(/for update to authenticated/);
    expect(body).toContain("auth_override('test_run.execute')");
    expect(body).not.toContain("auth_override('test_run.manage')");
    const lists = rolesIn(body);
    expect(lists.length, "using and with check").toBe(2);
    for (const list of lists) expect(list).toEqual(sorted(TESTERS));
    expect(body).toMatch(/with check[\s\S]*auth_org_unlocked\(\)/);
  });

  it.each([
    ["test_executions_insert", /for insert to authenticated/],
    ["test_executions_delete", /for delete to authenticated/],
  ])("%s is narrow and keyed on test_run.manage — a developer cannot remove a failure", (name, cmd) => {
    const body = policy(name);
    expect(body).toMatch(cmd);
    expect(body).toContain("auth_override('test_run.manage')");
    expect(body).not.toContain("auth_override('test_run.execute')");
    const lists = rolesIn(body);
    expect(lists.length).toBe(1);
    expect(lists[0]).toEqual(sorted(REVIEWERS));
    for (const r of CONTRIBUTORS) expect(lists[0]).not.toContain(r);
  });

  it("keeps the billing lock on the writes that create rows", () => {
    // 081's `for all` policy locked inserts and updates through `with check`
    // and never locked deletes, because a `using` clause is all a delete has.
    // The split keeps that shape exactly rather than quietly widening or
    // narrowing it.
    expect(policy("test_executions_insert")).toContain("auth_org_unlocked()");
    expect(policy("test_executions_update")).toContain("auth_org_unlocked()");
  });

  it("is beneath 081's closed-run trigger, not instead of it", () => {
    expect(rls).not.toMatch(/drop trigger/i);
    expect(rls).not.toMatch(/drop function/i);
    expect(rls).not.toMatch(/alter table/i);
    expect(rls).toMatch(/from pg_trigger/);
  });

  it("consults the override NULL-safely, every time", () => {
    // `auth_override(k)` is true, false, or NULL for "no override written".
    // A bare `auth_override(k) or role in (...)` would evaluate to NULL — which
    // RLS reads as false — the moment the role list says false, and to NULL —
    // also false — when it says true and the override is absent, depending on
    // how Postgres folds it. The only shape that means what it says is
    // coalesce(override, coalesce(role_list, false)). Count the two and demand
    // they match.
    const uses = [...rls.matchAll(/public\.auth_override\('[a-z_.]+'\)/g)].length;
    const safe = [
      ...rls.matchAll(
        /coalesce\(public\.auth_override\('[a-z_.]+'\),\s*coalesce\(public\.auth_role\(\) in/g
      ),
    ].length;
    expect(uses).toBeGreaterThan(0);
    expect(safe).toBe(uses);
  });

  it("touches the three quality tables and nothing else", () => {
    const tables = new Set([...rls.matchAll(/on public\.([a-z_]+)/g)].map((m) => m[1]));
    expect([...tables].sort()).toEqual(["test_cases", "test_executions", "test_runs"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 096 — the mirror
// ─────────────────────────────────────────────────────────────────────────

describe("096 — the mirror, re-synced", () => {
  const mirror = raw(MIRROR);
  const rowsOf = (src) =>
    [...src.matchAll(/^\s*\('([a-z_]+)',\s*'([a-z_]+)',\s*'([a-z_]+)',\s*true\)/gm)].map(
      (m) => `${m[1]}|${m[2]}.${m[3]}`
    );
  const rows = rowsOf(mirror);
  const keyOf = (row) => row.split("|")[1];
  const roleOf = (row) => row.split("|")[0];

  /** The sync migration BEFORE 096, found by reading the directory. */
  const previous = (() => {
    const dir = path.join(root, "database");
    const isSync = (f) =>
      /insert into public\.role_permissions \(role, resource, action, allowed\) values/.test(
        readFileSync(path.join(dir, f), "utf8")
      );
    const syncs = readdirSync(dir)
      .filter((f) => /^\d{3}_.*\.sql$/.test(f))
      .sort()
      .filter(isSync);
    const i = syncs.indexOf(path.basename(MIRROR));
    expect(i, "096 is a sync migration with a predecessor").toBeGreaterThan(0);
    return { name: syncs[i - 1], rows: rowsOf(readFileSync(path.join(dir, syncs[i - 1]), "utf8")) };
  })();

  it("says how many rows and keys it writes, and is right about both", () => {
    // Read from the file's own header rather than pinned here, so the next
    // sync does not inherit a stale number from this test.
    const m = mirror.match(/(\d+) rows over (\d+) keys/);
    expect(m, "the header states the row and key counts").not.toBeNull();
    expect(rows.length).toBe(Number(m[1]));
    expect(new Set(rows.map(keyOf)).size).toBe(Number(m[2]));
    expect(new Set(rows.map(keyOf)).size).toBe(PERMISSIONS.length);
  });

  it("only ADDS to the previous sync — the condition under which upsert-only is complete", () => {
    const now = new Set(rows);
    const stale = previous.rows.filter((r) => !now.has(r));
    expect(
      stale,
      `rows ${previous.name} wrote that 096 would leave standing — a narrowing needs a delete`
    ).toEqual([]);
  });

  it("adds exactly the thirteen rows 095 is about", () => {
    const before = new Set(previous.rows);
    const added = sorted(rows.filter((r) => !before.has(r)));
    expect(added).toEqual(
      sorted([
        ...REVIEWERS.map((r) => `${r}|bug.raise`),
        ...CONTRIBUTORS.map((r) => `${r}|test_case.view`),
        ...CONTRIBUTORS.map((r) => `${r}|test_run.execute`),
      ])
    );
  });

  it("gives bug.raise to exactly the roles test_run.execute had before — nobody gains or loses the defect button", () => {
    const executeBefore = sorted(
      previous.rows.filter((r) => keyOf(r) === "test_run.execute").map(roleOf)
    );
    expect(executeBefore.length).toBeGreaterThan(0);
    expect(sorted(defaultRolesFor("bug.raise"))).toEqual(executeBefore);
    expect(sorted(rows.filter((r) => keyOf(r) === "bug.raise").map(roleOf))).toEqual(executeBefore);
  });

  it("says it runs after 095", () => {
    expect(mirror).toMatch(/RUN AFTER 095/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The admin door
// ─────────────────────────────────────────────────────────────────────────

describe("the admin door does not move", () => {
  /** ADMIN_AREA_ROLES, re-derived the way sectionAccess derives it, with knobs. */
  const derive = ({ sections = SECTION_PERMISSIONS, exempt = NON_WIDENING_SECTIONS } = {}) => {
    const roles = new Set();
    for (const [section, key] of Object.entries(sections)) {
      if (key === null || exempt.includes(section)) continue;
      for (const r of defaultRolesFor(key)) roles.add(r);
    }
    return sorted(roles);
  };

  it("re-derives to exactly the roles the code exports, and no contributor is among them", () => {
    expect(derive()).toEqual(sorted(ADMIN_AREA_ROLES));
    for (const r of CONTRIBUTORS) expect(canEnterAdminArea(r), r).toBe(false);
  });

  it("WOULD open to every contributor if Quality were still keyed on test_case.view", () => {
    const opened = derive({ sections: { ...SECTION_PERMISSIONS, quality: "test_case.view" } });
    for (const r of CONTRIBUTORS) expect(opened, r).toContain(r);
  });

  it("WOULD open to every contributor if my-tests were not exempt", () => {
    const opened = derive({ exempt: NON_WIDENING_SECTIONS.filter((s) => s !== "my-tests") });
    for (const r of CONTRIBUTORS) expect(opened, r).toContain(r);
  });

  it("so both edits are in place, and my-tests is exempt without being an own-work screen", () => {
    expect(SECTION_PERMISSIONS.quality).toBe("test_case.manage");
    expect(SECTION_PERMISSIONS["my-tests"]).toBe("test_case.view");
    expect(NON_WIDENING_SECTIONS).toContain("my-tests");
    // It is about the product under test, not about the person looking — so
    // it is not held by every staff role (hr and finance have no reason to
    // read a test plan) and does not belong on the own-work list.
    expect(OWN_WORK_SECTIONS).not.toContain("my-tests");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The route
// ─────────────────────────────────────────────────────────────────────────

describe("the route draws the same three lines", () => {
  const route = read(ROUTE);

  it("records on test_run.execute, closes on test_run.manage, files a defect on bug.raise", () => {
    expect(route).toMatch(/keyFor = \{[^}]*bug: "bug\.raise"/);
    expect(route).not.toMatch(/bug: "test_run\.execute"/);
    expect(route).toContain('requirePermission(auth, "test_run.execute")');
    expect(route).toContain('requirePermission(auth, "test_run.manage")');
  });

  it("writes executed_by from the verified token and never from the body", () => {
    // 095 says so in as many words: an update policy that admits a developer
    // admits them to every column, so the column guarantee lives here.
    expect(route).toContain("executed_by: auth.appUserId");
    expect(route).not.toMatch(/executed_by:\s*body/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The staff Tests screen
// ─────────────────────────────────────────────────────────────────────────

describe("the staff Tests screen", () => {
  const screen = read(SCREEN);

  it("takes no role prop — the route decides, and a second opinion here would be a fourth gate", () => {
    expect(screen).toMatch(/export default function TestCases\(\)/);
    expect(screen).not.toMatch(/\brole\b/);
  });

  it("reads through /api/quality and records through PATCH, and does nothing else", () => {
    expect(screen).toContain("authFetch(`/api/quality?view=");
    expect(screen).toMatch(/method: "PATCH"/);
    expect(screen).toMatch(/JSON\.stringify\(\{ executionId: execution\.id, result \}\)/);
    expect(screen).not.toMatch(/method: "(POST|DELETE|PUT)"/);
    expect(screen).not.toMatch(/\bfetch\(/);
  });

  it("offers exactly the results a person can record — the route's list minus untested", () => {
    const unquote = (list) => list.match(/"[a-z]+"/g).map((s) => s.replace(/"/g, ""));
    const routeResults = unquote(read(ROUTE).match(/const RESULTS = \[([^\]]*)\]/)[1]);
    const recordable = unquote(screen.match(/const RECORDABLE = \[([^\]]*)\]/)[1]);
    expect(recordable).toEqual(routeResults.filter((r) => r !== "untested"));
  });

  it("has no create, close, reopen or raise-defect control, and says who to ask instead", () => {
    expect(screen).not.toMatch(/status: "(closed|open)"/);
    expect(screen).not.toMatch(/action[=:]\s*"?(case|run|bug)\b/);
    expect(screen).not.toMatch(/Raise (a )?defect/i);
    expect(screen).toContain("A reviewer can raise the defect from the Quality");
  });

  it("freezes a closed run rather than hiding it", () => {
    expect(screen).toContain('const runClosed = openRun?.status === "closed"');
    expect(screen).toMatch(/disabled=\{[^}]*runClosed/);
    expect(screen).toContain("Closed runs are read-only");
  });

  it("is wired into the staff shell, not the admin one, and reaches every holder of its key", () => {
    const staff = read(STAFF_DASHBOARD);
    expect(staff).toContain('import TestCases from "@/components/shared/TestCases"');
    expect(staff).toMatch(/case "my-tests":\s*return <TestCases \/>;/);
    expect(read(ADMIN_DASHBOARD)).not.toContain('"my-tests"');

    for (const r of TESTERS) {
      const inStaff = staffNav(r).some((i) => i.id === "my-tests");
      expect(inStaff || canEnterAdminArea(r), `${r} holds the key but has no screen`).toBe(true);
    }
    for (const r of ["hr", "finance", "client"]) {
      expect(staffNav(r).some((i) => i.id === "my-tests"), `${r} has no reason to read a test`).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The reporting-lines editor
// ─────────────────────────────────────────────────────────────────────────

describe("the reporting-lines editor", () => {
  const src = read(LINES);

  it("asks hierarchy.manage and shows the control only to a holder", () => {
    expect(src).toContain('allowed("hierarchy.manage")');
    expect(src).toMatch(/\{mayManage \? \(/);
  });

  it("writes through saveEmployee — the profile editor's path — and never straight to PostgREST", () => {
    expect(src).toContain("membershipPatch: { reports_to: next }");
    expect(src).not.toMatch(/supabase|\.from\(/);
  });

  it("refuses a cycle with a sentence before 037 refuses it with an error", () => {
    expect(src).toMatch(/reportingCycleError\(\{ employees, userId: emp\.userId, reportsTo: next \}\)/);
  });

  it("does not offer a person as their own manager", () => {
    expect(src).toMatch(/\.filter\(\(o\) => o\.userId !== p\.userId\)/);
  });

  it("fills nothing in by itself", () => {
    // The one place reports_to is written is the user's own choice. A default
    // here would be believed by the signals feed and the nightly digest.
    expect((src.match(/reports_to/g) || []).length).toBe(1);
    expect(src).toContain("Nothing is filled in by default");
  });

  it("sits beneath the project chart, which no longer claims reports_to is empty for everyone", () => {
    const admin = read(ADMIN_DASHBOARD);
    expect(admin).toContain('import ReportingLines from "@/components/admin/ReportingLines"');
    expect(admin).toMatch(/case "hierarchy":[\s\S]*?<ProjectHierarchy \/>[\s\S]*?<ReportingLines \/>/);
    expect(raw(CHART)).not.toMatch(/is null for every member/);
  });
});

describe("reportingChain — the ladder above one person", () => {
  const people = [
    { userId: "a", name: "A", reportsTo: "b" },
    { userId: "b", name: "B", reportsTo: "c" },
    { userId: "c", name: "C", reportsTo: null },
  ];

  it("walks up to the top", () => {
    expect(reportingChain(people, "a").map((p) => p.userId)).toEqual(["b", "c"]);
    expect(reportingChain(people, "b").map((p) => p.userId)).toEqual(["c"]);
    expect(reportingChain(people, "c")).toEqual([]);
  });

  it("stops at a manager who is not in the directory, and at a person who is not", () => {
    expect(reportingChain([{ userId: "a", reportsTo: "ghost" }], "a")).toEqual([]);
    expect(reportingChain(people, "nobody")).toEqual([]);
    expect(reportingChain(null, "a")).toEqual([]);
  });

  it("terminates on a cycle instead of hanging the screen", () => {
    // 037 refuses to write one, but a directory loaded mid-edit can hold one.
    const loop = [
      { userId: "a", reportsTo: "b" },
      { userId: "b", reportsTo: "a" },
    ];
    expect(reportingChain(loop, "a").map((p) => p.userId)).toEqual(["b"]);
    const three = [
      { userId: "a", reportsTo: "b" },
      { userId: "b", reportsTo: "c" },
      { userId: "c", reportsTo: "b" },
    ];
    expect(reportingChain(three, "a").map((p) => p.userId)).toEqual(["b", "c"]);
  });

  it("respects the limit", () => {
    const long = Array.from({ length: 40 }, (_, i) => ({
      userId: `p${i}`,
      reportsTo: i < 39 ? `p${i + 1}` : null,
    }));
    expect(reportingChain(long, "p0").length).toBe(16);
    expect(reportingChain(long, "p0", 3).map((p) => p.userId)).toEqual(["p1", "p2", "p3"]);
  });

  it("copes with numeric and string ids alike", () => {
    const mixed = [
      { userId: 1, reportsTo: 2 },
      { userId: "2", reportsTo: null },
    ];
    expect(reportingChain(mixed, 1).map((p) => p.userId)).toEqual(["2"]);
  });
});
