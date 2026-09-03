import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  PERMISSIONS,
  PERMISSION_KEYS,
  defaultRolesFor,
  permissionsForRole,
} from "@/utils/permissionCatalogue";
import { roleCan } from "@/utils/permissionEngine";
import { ROLES } from "@/utils/roles";

/**
 * The half of the permission model that had no keys, and the storage column
 * that was standing in for it.
 *
 * TWO FAULTS, ONE CAUSE. `user_type` says which profile table a person's row
 * lives in — `userTypeForRole()` answers "admin" for owner and admin, "client"
 * for client and "developer" for the other nine. Routes were reading it as if
 * it meant a permission level, so:
 *
 *   - a manager and a team lead came out as "developer" and were self-scoped by
 *     four routes that the catalogue grants them wide access to, and
 *   - there was no key for "your own work" at all, so the narrow branch could
 *     not be expressed as a permission even where somebody wanted to.
 *
 * Fixing either one alone would not have worked: you cannot ask the wide key
 * first unless a narrow key exists to fall back to.
 */

const root = path.resolve(__dirname, "..");
const raw = (p) => readFileSync(path.join(root, p), "utf8");
/**
 * Comments stripped before any source assertion.
 *
 * Twice now a test in this repo has passed by matching the explanatory comment
 * it was written alongside rather than the code — including one that asserted a
 * route called `requirePermission` when the only occurrence was in a docblock
 * arguing about which key to use.
 */
const read = (p) =>
  raw(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const OWN_KEYS = [
  "task.view_own",
  "task.update_own",
  "project.view_own",
  "timesheet.view_own",
  "timesheet.log_own",
  "team.view_own",
  "profile.manage_own",
  "productivity.view_own",
  "monitoring.view_own",
];
const STAFF_ROLES = ROLES.filter((r) => r !== "client");

describe("the *_own family", () => {
  it.each(OWN_KEYS)("%s is a real catalogue key", (key) => {
    expect(PERMISSION_KEYS).toContain(key);
  });

  it.each(STAFF_ROLES)("%s holds every own key", (role) => {
    for (const key of OWN_KEYS) {
      expect(roleCan(role, key), `${role} should hold ${key}`).toBe(true);
    }
  });

  it("a client holds none of them, and no staff permission at all", () => {
    for (const key of OWN_KEYS) expect(roleCan("client", key)).toBe(false);
    expect(permissionsForRole("client")).toEqual([]);
  });

  /**
   * The regression this whole file exists for. A developer held ONE key of
   * fifty-three; if that number ever falls back toward one, the own family has
   * been dropped or narrowed and every route below starts refusing real work.
   */
  it("a developer is no longer stranded on a single permission", () => {
    const held = permissionsForRole("developer");
    expect(held).toContain("task.submit");
    expect(held.length).toBeGreaterThanOrEqual(10);
  });

  /**
   * Each own key must be paired with a WIDER key, because the routes are
   * written as "ask the wide one, fall back to the narrow one". An own key with
   * no counterpart is one a route can only ever answer with self-scope, which
   * is the bug this replaced.
   */
  it.each([
    ["task.view_own", "task.view_all"],
    ["task.update_own", "task.manage"],
    ["project.view_own", "project.view_all"],
    ["productivity.view_own", "report.view"],
    ["monitoring.view_own", "monitoring.view"],
  ])("%s has a wider counterpart %s that is strictly narrower in roles", (own, wide) => {
    const ownRoles = defaultRolesFor(own);
    const wideRoles = defaultRolesFor(wide);
    expect(wideRoles.length).toBeGreaterThan(0);
    expect(wideRoles.length).toBeLessThan(ownRoles.length);
    // and the wide key must not reach anybody the narrow one does not
    for (const r of wideRoles) expect(ownRoles).toContain(r);
  });
});

describe("user_type is no longer asked authorization questions", () => {
  const API = path.join(root, "src/app/api");
  const routes = [];
  (function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name === "route.js") routes.push(path.relative(root, full));
    }
  })(API);

  it("found the route tree", () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  /**
   * `userType === 'client'` is ALLOWED and deliberately not caught here.
   *
   * That one is not a permission level — it is the staff/customer boundary, the
   * same distinction serverPermissions.refuseClient makes before it looks at any
   * key, and clients hold no staff permission by construction. What this
   * forbids is treating "admin" or "developer" as a rank, because those two
   * values cover eleven roles between them and say nothing about capability.
   */
  const BANNED = /userType\s*[!=]==\s*['"](admin|developer)['"]/;

  /**
   * The four files that still read the value, each for a reason that is NOT a
   * permission question. Recorded here rather than left out of the pattern,
   * because "which table does this row live in" and "may this person do X" look
   * identical in a grep and only one of them is a bug.
   */
  const STORAGE_ONLY = {
    "src/app/api/auth/provision/route.js":
      "derives a DEFAULT role from the caller's hint; the profile table then " +
      "follows userTypeForRole(role), and the rank check runs regardless",
    "src/app/api/developer/change-password/route.js":
      "picks the profile table to read the password hash from",
    "src/app/api/invitations/accept/route.js":
      "picks the table to insert the new profile row into",
    "src/app/api/search/route.js":
      "builds the result URL (/admin/... vs /developer/...) and filters " +
      "candidates by which directory they came from",
  };

  it("only the recorded storage decisions still read userType", () => {
    const offenders = routes.filter((r) => BANNED.test(read(r)));
    expect(offenders.sort()).toEqual(Object.keys(STORAGE_ONLY).sort());
  });

  /**
   * The allowlist self-cleans. An entry for a file that no longer reads
   * userType is a stale exemption, and a stale exemption is how the next one
   * gets waved through — so it fails here rather than sitting until somebody
   * notices. The assertion above already fails in the other direction.
   */
  it.each(Object.keys(STORAGE_ONLY))("%s still needs its exemption", (file) => {
    expect(BANNED.test(read(file))).toBe(true);
  });

  it("the ban is real — it catches the shape it is written against", () => {
    expect(BANNED.test("if (auth.userType === 'developer') {")).toBe(true);
    expect(BANNED.test('if (auth.userType !== "admin") {')).toBe(true);
    expect(BANNED.test("if (auth.userType === 'client') {")).toBe(false);
  });
});

describe("the routes that were self-scoping nine roles", () => {
  it("developer-gantt asks project.view_all before falling back to own", () => {
    const src = read("src/app/api/developer-gantt/route.js");
    expect(src).toContain("project.view_all");
    expect(src).toContain("project.view_own");
    // the wide question has to come FIRST, or the fallback swallows it again
    expect(src.indexOf("project.view_all")).toBeLessThan(src.indexOf("project.view_own"));
    // and the id for the narrow branch comes from the token, never the query
    expect(src).toMatch(/developerId\s*=\s*auth\.appUserId/);
  });

  it("productivity resolves both viewers from keys and refuses when neither holds", () => {
    const src = read("src/app/api/productivity/route.js");
    expect(src).toMatch(/isAdminViewer\s*=\s*authCan\(auth,\s*['"]report\.view['"]\)/);
    expect(src).toMatch(/isDeveloperViewer\s*=\s*!isAdminViewer/);
    expect(src).toMatch(/if\s*\(!isAdminViewer\s*&&\s*!isDeveloperViewer\)/);
    expect(src).toContain("productivity.recalculate");
  });

  it("task-submission lets a reviewer read submissions that are not theirs", () => {
    const src = read("src/app/api/task-submission/route.js");
    expect(src).toMatch(/authCan\(auth,\s*['"]task\.view_all['"]\)/);
    expect(src).toMatch(/authCan\(auth,\s*['"]task\.review['"]\)/);
  });

  it("task-plan/submit takes the identity from the token and ignores the body", () => {
    const src = read("src/app/api/task-plan/submit/route.js");
    expect(src).toMatch(/developerId\s*=\s*auth\.appUserId/);
    // narrowed, not widened: nothing may name somebody else here any more
    expect(src).not.toMatch(/developerId\s*=\s*body\./);
  });

  it("task-plan/submit still asks for the permission before assuming identity", () => {
    // Mutation testing caught this one: deleting the authCan line entirely left
    // every assertion above green, because forcing developerId to the token is
    // a separate fact from being allowed to file a plan at all.
    //
    // The guard looks redundant — every staff role holds task.update_own, and
    // clients are refused higher up — so it is worth writing down what it
    // actually carries. authCan reads the per-person overrides that travel on
    // `auth`, so this line is the only thing that makes an explicit DENY of
    // task.update_own against one individual apply to plan submission, and the
    // only thing that returns 503 when those overrides could not be read. A
    // role-derived reading of the same key would do neither.
    // `read` has already stripped the comments the block above is written in.
    const code = read("src/app/api/task-plan/submit/route.js");
    expect(code).toMatch(/if\s*\(!authCan\(auth,\s*['"]task\.update_own['"]\)\)/);
    expect(code.indexOf("task.update_own")).toBeLessThan(
      code.indexOf("developerId = auth.appUserId")
    );
  });

  it("keyboard-stats self-scopes on the absence of monitoring.view", () => {
    const src = read("src/app/api/keyboard-stats/route.js");
    expect(src).toMatch(/if\s*\(!authCan\(auth,\s*["']monitoring\.view["']\)\)/);
  });
});

describe("admin-review no longer takes the caller's identity from the URL", () => {
  const src = read("src/app/api/admin-review/route.js");

  it("defaults adminId to the token and gates naming anybody else", () => {
    expect(src).toMatch(/String\(requestedAdminId\)\s*!==\s*String\(auth\.appUserId\)/);
    expect(src).toMatch(/wantsSomeoneElse\s*&&\s*!authCan\(auth,\s*['"]task\.view_all['"]\)/);
    expect(src).toMatch(/adminId\s*=\s*wantsSomeoneElse\s*\?\s*requestedAdminId\s*:\s*auth\.appUserId/);
  });

  it("validates the id before interpolating it into a PostgREST filter", () => {
    expect(src).toMatch(/UUID_RE\.test\(String\(adminId\)\)/);
    // the filter is still built by interpolation, so the guard has to run first
    expect(src.indexOf("UUID_RE.test")).toBeLessThan(src.indexOf("created_by.eq."));
  });

  it("the uuid pattern accepts a real id and rejects a filter-injection payload", () => {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(UUID_RE.test("3f6b1c2e-9a4d-4c7b-8e21-0d5f9a3b7c11")).toBe(true);
    expect(UUID_RE.test("3f6b1c2e-9a4d-4c7b-8e21-0d5f9a3b7c11,created_by.not.is.null")).toBe(false);
    expect(UUID_RE.test("*")).toBe(false);
  });
});

describe("proposals notifies whoever the catalogue says decides", () => {
  it("reads the role list from the catalogue rather than typing it out", () => {
    const src = read("src/app/api/proposals/route.js");
    expect(src).toContain('defaultRolesFor("proposal.decide")');
    expect(src).not.toMatch(/\.in\(\s*"role",\s*\[/);
  });
});

describe("migration 074 mirrors the catalogue exactly", () => {
  const sql = raw("database/074_permission_model_resync.sql");

  /** Only the VALUES rows — the PART 3 orphan query lists keys in comments. */
  const rows = [...sql.matchAll(/^\s*\('([a-z_]+)',\s*'([a-z_]+)',\s*'([a-z_]+)',\s*true\)/gm)].map(
    (m) => `${m[1]}|${m[2]}.${m[3]}`
  );

  const expected = [];
  for (const p of PERMISSIONS) {
    const i = p.key.indexOf(".");
    const resource = p.key.slice(0, i);
    const action = p.key.slice(i + 1);
    for (const r of p.roles) expected.push(`${r}|${resource}.${action}`);
  }

  it("has a row for every (role, permission) pair and no others", () => {
    expect(rows.slice().sort()).toEqual(expected.slice().sort());
  });

  it("names every key in the orphan query, so the check covers the whole model", () => {
    for (const key of PERMISSION_KEYS) expect(sql).toContain(`'${key}'`);
  });

  it("is idempotent and never deletes", () => {
    expect(sql).toContain("on conflict (role, resource, action) do update");
    expect(sql).not.toMatch(/^\s*delete\s+from/im);
    expect(sql).not.toMatch(/^\s*drop\s+/im);
  });
});

describe("the published matrix is generated, not written", () => {
  it("docs/roles-and-permissions.md is exactly what the generator produces", () => {
    // Generated to a temp file and diffed. Regenerating in place would have
    // this test rewriting a file other tests read, which is a race that only
    // shows up when the suite is busy.
    const tmp = path.join(mkdtempSync(path.join(tmpdir(), "permdoc-")), "matrix.md");
    execFileSync("node", ["scripts/generate-permission-matrix.mjs", tmp], { cwd: root });
    expect(readFileSync(tmp, "utf8")).toBe(raw("docs/roles-and-permissions.md"));
  });

  it("says how many keys each role holds, including the two that changed", () => {
    const doc = raw("docs/roles-and-permissions.md");
    expect(doc).toContain(`| \`developer\` | ${permissionsForRole("developer").length} |`);
    expect(doc).toContain(`| \`client\` | 0 |`);
  });
});
