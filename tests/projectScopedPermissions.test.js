import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { mayActOnProject, projectRoleFor, loadProjectRoles } from "@/utils/projectAccess";
import { resolvePermission, roleCan } from "@/utils/permissionEngine";
import { isPermissionKey, defaultRolesFor } from "@/utils/permissionCatalogue";
import { PROJECT_ROLES, ROLES } from "@/utils/roles";

/**
 * Project-scoped permissions — the half of the engine that had no data.
 *
 * permissionEngine.js has accepted `subject.projectRoles` and `scope.projectId`
 * since it was written, and nothing ever supplied either: across the whole
 * repository the identifier appeared only in that file and its own comments,
 * and no route passed a scope. The consequence was that every `manager` and
 * `team_lead` permission is organization-wide, so a project manager could see,
 * edit and complete every project in the company.
 *
 * The reason it stayed unreachable is that the database could not answer the
 * question: `projects.assigned_to` holds ONE developer and `manager_id` ONE
 * manager. Migration 071 adds project_members; this suite pins the behaviour.
 */

const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const PID = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

describe("a project role grants, and only grants", () => {
  it("lets a project manager do what an org-wide manager could", () => {
    // The person is a plain developer in the organization and the manager of
    // THIS project. That is the arrangement the engine could express and
    // nothing could store.
    const subject = { role: "developer", projectRoles: { [PID]: "manager" } };
    expect(resolvePermission(subject, "project.manage_members", { projectId: PID })).toBe(true);
  });

  it("does not leak that grant to a different project", () => {
    const subject = { role: "developer", projectRoles: { [PID]: "manager" } };
    expect(resolvePermission(subject, "project.manage_members", { projectId: OTHER })).toBe(false);
  });

  it("does not grant without a projectId in scope", () => {
    // No scope means the org-wide question, and org-wide this person is a
    // developer.
    const subject = { role: "developer", projectRoles: { [PID]: "manager" } };
    expect(resolvePermission(subject, "project.manage_members")).toBe(false);
  });

  it("cannot grant a permission the project role does not hold anyway", () => {
    // A project 'manager' is still not an owner. The project role is matched
    // against the SAME role list as the org role; it is not a bypass.
    const subject = { role: "developer", projectRoles: { [PID]: "manager" } };
    expect(resolvePermission(subject, "billing.purchase", { projectId: PID })).toBe(false);
    expect(resolvePermission(subject, "organization.delete", { projectId: PID })).toBe(false);
  });

  it("never takes anything away from the org-wide role", () => {
    // THE SAFETY PROPERTY. A route that forgets to pass a projectId must behave
    // exactly as the product does today. If this ever fails, adding project
    // scope has started removing access somewhere.
    for (const key of ["project.view_all", "task.manage", "project.create"]) {
      const withScope = resolvePermission({ role: "manager", projectRoles: {} }, key, { projectId: PID });
      expect(withScope, key).toBe(roleCan("manager", key));
    }
  });

  it("ignores a project role that is not a real role", () => {
    const subject = { role: "developer", projectRoles: { [PID]: "superuser" } };
    expect(resolvePermission(subject, "project.manage_members", { projectId: PID })).toBe(false);
  });
});

describe("projectRoleFor reads own properties only", () => {
  it("finds a real membership", () => {
    expect(projectRoleFor({ [PID]: "team_lead" }, PID)).toBe("team_lead");
  });

  it("returns null for a project the person is not on", () => {
    expect(projectRoleFor({ [PID]: "developer" }, OTHER)).toBeNull();
    expect(projectRoleFor(null, PID)).toBeNull();
    expect(projectRoleFor({}, PID)).toBeNull();
    expect(projectRoleFor({ [PID]: "developer" }, null)).toBeNull();
  });

  it("does not answer from the prototype chain", () => {
    // The same hole permissionEngine's own() closes. `constructor` and
    // `toString` alone do NOT prove it: their values are not strings, so the
    // PROJECT_ROLES check refuses them even with the ownership guard removed —
    // mutation testing showed that deleting the guard left this green.
    //
    // The real case is a polluted prototype carrying a VALID project role under
    // a real project id, which is what a JSON body can arrange.
    expect(projectRoleFor({}, "constructor")).toBeNull();
    try {
      // eslint-disable-next-line no-extend-native
      Object.prototype[PID] = "manager";
      expect(projectRoleFor({}, PID)).toBeNull();
      expect(mayActOnProject({ role: "developer", userType: "developer" }, PID, {})).toBe(false);
    } finally {
      delete Object.prototype[PID];
    }
  });

  it("refuses a value that is not one of the project roles", () => {
    expect(projectRoleFor({ [PID]: "owner" }, PID)).toBeNull();
    expect(projectRoleFor({ [PID]: 42 }, PID)).toBeNull();
  });
});

describe("mayActOnProject is the half that RESTRICTS", () => {
  const on = { [PID]: "developer" };

  it("lets owner and admin act on any project", () => {
    // They see the whole company by definition; that is what those roles mean.
    for (const role of ["owner", "admin"]) {
      expect(mayActOnProject({ role, userType: "admin" }, PID, {}), role).toBe(true);
      expect(mayActOnProject({ role, userType: "admin" }, OTHER, null), role).toBe(true);
    }
  });

  it("refuses an org-wide manager who is not on the project", () => {
    // THE POINT OF THE WHOLE CHANGE. Today every manager permission is
    // organization-wide, so a PM can act on all forty projects.
    expect(mayActOnProject({ role: "manager", userType: "developer" }, PID, {})).toBe(false);
  });

  it("admits that same manager once they are on it", () => {
    expect(mayActOnProject({ role: "manager", userType: "developer" }, PID, on)).toBe(true);
  });

  it("refuses a client outright, whatever else is true", () => {
    expect(mayActOnProject({ role: "client", userType: "client" }, PID, on)).toBe(false);
    // Even a client who somehow carried an owner role claim.
    expect(mayActOnProject({ role: "owner", userType: "client" }, PID, on)).toBe(false);
  });

  it("treats unloaded project roles as NOT a member", () => {
    // null means "nobody loaded them". Guessing would make the answer depend on
    // whether a route remembered to call withProjectRoles.
    expect(mayActOnProject({ role: "developer", userType: "developer" }, PID, null)).toBe(false);
    expect(mayActOnProject({ role: "developer", userType: "developer" }, PID, undefined)).toBe(false);
  });

  it("refuses when there is no caller at all", () => {
    expect(mayActOnProject(null, PID, on)).toBe(false);
  });
});

describe("loadProjectRoles", () => {
  const fakeClient = (result) => ({
    from: () => ({
      select: () => ({
        eq: function () { return this; },
        then: undefined,
        // terminal: the last .eq() is awaited
      }),
    }),
    ...result,
  });

  it("returns {} when the session is incomplete rather than guessing", async () => {
    expect(await loadProjectRoles(null, { orgId: "o", appUserId: "u" })).toEqual({});
    expect(await loadProjectRoles({}, { orgId: null, appUserId: "u" })).toEqual({});
    expect(await loadProjectRoles({}, { orgId: "o", appUserId: null })).toEqual({});
    expect(await loadProjectRoles({}, null)).toEqual({});
  });

  /** Records the filters, because WHICH ones were applied is the security part. */
  const recordingClient = (rows) => {
    const calls = { table: null, eq: [] };
    const q = {
      select: () => q,
      eq: (col, val) => { calls.eq.push([col, val]); return q; },
      then: (resolve) => resolve({ data: rows, error: null }),
    };
    return { client: { from: (t) => { calls.table = t; return q; } }, calls };
  };

  it("builds the map the engine expects", async () => {
    const { client } = recordingClient([
      { project_id: PID, project_role: "manager" },
      { project_id: OTHER, project_role: "developer" },
      { project_id: null, project_role: "qa" }, // dropped
      { project_id: "x", project_role: 7 },      // dropped
    ]);
    expect(await loadProjectRoles(client, { orgId: "o", appUserId: "u" })).toEqual({
      [PID]: "manager",
      [OTHER]: "developer",
    });
  });

  it("scopes by organization AND person", async () => {
    // This is read to make an authorization decision. Dropping either filter
    // would answer with somebody else's project roles — and asserting only the
    // returned shape does not notice, which mutation testing demonstrated.
    const { client, calls } = recordingClient([]);
    await loadProjectRoles(client, { orgId: "o", appUserId: "u" });
    expect(calls.table).toBe("project_members");
    expect(calls.eq).toContainEqual(["organization_id", "o"]);
    expect(calls.eq).toContainEqual(["user_id", "u"]);
  });

  it("narrows to one project when asked", async () => {
    const { client, calls } = recordingClient([]);
    await loadProjectRoles(client, { orgId: "o", appUserId: "u" }, PID);
    expect(calls.eq).toContainEqual(["project_id", PID]);
  });

  it("answers {} on an error, which is the STRICT answer here", async () => {
    // Project roles only ever grant, so {} is the narrow reading. A deployment
    // where 071 has not been run then behaves exactly as it does today instead
    // of failing every project route closed.
    const client = {
      from: () => {
        const q = {
          select: () => q,
          eq: () => q,
          then: (resolve) => resolve({ data: null, error: { code: "PGRST205" } }),
        };
        return q;
      },
    };
    expect(await loadProjectRoles(client, { orgId: "o", appUserId: "u" })).toEqual({});
  });
});

describe("the vocabulary is one vocabulary", () => {
  it("every project role is a real role", () => {
    for (const r of PROJECT_ROLES) expect(ROLES, r).toContain(r);
  });

  it("excludes the roles a project scope cannot mean", () => {
    // owner and admin are organization-wide by definition; a client's access to
    // a project is decided by project_clients, a different question.
    for (const r of ["owner", "admin", "client"]) {
      expect(PROJECT_ROLES, r).not.toContain(r);
    }
  });

  it("matches the CHECK constraint in migration 071", () => {
    // Two copies of one list. They cannot be one file, so they are pinned here.
    const sql = read("database/071_project_members.sql");
    const m = sql.match(/project_role\s+text not null\s*\n?\s*check \(project_role in\s*\n?\s*\(([^)]*)\)\)/);
    expect(m, "could not find the project_role CHECK").toBeTruthy();
    const inSql = m[1].split(",").map((s) => s.trim().replace(/'/g, "")).filter(Boolean).sort();
    expect(inSql).toEqual([...PROJECT_ROLES].sort());
  });
});

describe("the new key, and the route that enforces it", () => {
  const src = read("src/app/api/projects/[id]/members/route.js");

  it("is a real catalogue key", () => {
    expect(isPermissionKey("project.manage_members")).toBe(true);
    expect(defaultRolesFor("project.manage_members")).toEqual(["owner", "admin", "manager"]);
  });

  it("is not another key that nothing enforces", () => {
    // The audit's largest structural finding was 34 of 53 keys never being
    // passed to requirePermission. Adding a 54th dead key would have made that
    // worse, not better.
    expect(src).toContain('requirePermission(auth, "project.manage_members", { projectId })');
  });

  it("asks BOTH questions on every write", () => {
    // requirePermission = may this KIND of person; mayActOnProject = on THIS
    // project. A permission alone cannot express the second, because
    // resolvePermission ORs the project role with the org role and can only
    // ever grant.
    for (const verb of ["POST", "DELETE"]) {
      const body = src.slice(src.indexOf(`export async function ${verb}`));
      const fn = body.slice(0, body.indexOf("\n}\n") + 3);
      expect(fn, `${verb} is missing requirePermission`).toContain("requirePermission(auth");
      expect(fn, `${verb} is missing mayActOnProject`).toContain("mayActOnProject(auth");
    }
  });

  it("loads project roles BEFORE it asks the permission", () => {
    // The permission is one a project role can satisfy. Asking first would mean
    // a project manager without the org-wide role was refused.
    const post = src.slice(src.indexOf("export async function POST"));
    expect(post.indexOf("withProjectRoles")).toBeLessThan(post.indexOf("requirePermission"));
  });

  it("scopes every project read by organization", () => {
    // serviceClient bypasses RLS, so this filter IS the tenant boundary.
    expect(src).toContain('.eq("organization_id", orgId)');
    expect(src).toMatch(/resolveProject\(svc, projectId, (base\.orgId|orgId)\)/);
  });

  it("answers 404, never 403, for a project it will not act on", () => {
    // A 403 confirms the id exists. Iterating ids against a route that
    // distinguishes the two maps out another company's work — the reasoning
    // client/tasks/_lib/clientTask.js already records.
    const notFound = (src.match(/status: 404/g) || []).length;
    expect(notFound).toBeGreaterThanOrEqual(4);
    expect(src).not.toMatch(/mayActOnProject[\s\S]{0,200}status: 403/);
  });

  it("keeps clients out of the roster", () => {
    expect(src).toMatch(/userType === "client"[\s\S]{0,400}status: 403/);
  });

  it("refuses to remove the manager behind the trigger's back", () => {
    // projects.manager_id is the authority and 071's trigger keeps the row in
    // step. Deleting the row underneath it recreates the disagreement the
    // trigger exists to prevent.
    expect(src).toMatch(/project_role === "manager"[\s\S]{0,300}status: 409/);
  });

  it("validates the role against the shared list, not a literal", () => {
    expect(src).toContain("PROJECT_ROLES.includes(projectRole)");
  });

  it("bounds allocation rather than storing anything", () => {
    expect(src).toMatch(/n < 0 \|\| n > 100/);
  });
});

describe("migration 071 does not break what exists", () => {
  const sql = read("database/071_project_members.sql");

  it("drops nothing and alters no existing column", () => {
    const statements = sql.replace(/^\s*--.*$/gm, "");
    expect(statements).not.toMatch(/drop table/i);
    expect(statements).not.toMatch(/alter table public\.projects/i);
    expect(statements).not.toMatch(/delete from/i);
    // The only DROPs are the idempotent policy/trigger re-creates.
    for (const m of statements.matchAll(/drop (\w+) if exists/gi)) {
      expect(["policy", "trigger"]).toContain(m[1].toLowerCase());
    }
  });

  it("is re-runnable", () => {
    // PART 3 only. The trigger in PART 4 also inserts, but it is an upsert
    // with `do update` — a different and deliberate conflict behaviour — so
    // counting it here would compare two unlike things.
    const backfill = sql.slice(sql.indexOf("PART 3"), sql.indexOf("PART 4"));
    const inserts = (backfill.match(/insert into public\.project_members/g) || []).length;
    const guards = (backfill.match(/on conflict \(project_id, user_id\) do nothing/g) || []).length;
    expect(inserts).toBe(3);
    expect(guards).toBe(inserts);
    // And the trigger's own insert resolves its conflict rather than ignoring
    // it, or a reassignment would silently leave the old role in place.
    expect(sql).toMatch(/on conflict \(project_id, user_id\)\s*\n?\s*do update set project_role = 'manager'/);
  });

  it("backfills from all three places a project already named people", () => {
    expect(sql).toContain("p.manager_id");
    expect(sql).toContain("p.assigned_to");
    expect(sql).toContain("developer_tasks");
  });

  it("keeps clients out and scopes reads to the organization", () => {
    expect(sql).toContain("not public.auth_is_client()");
    expect(sql).toContain("organization_id = public.auth_org()");
  });

  it("does not let a team_lead staff themselves onto a project", () => {
    expect(sql).toMatch(/auth_role\(\) in \('owner','admin','manager'\)/);
    expect(sql).not.toMatch(/auth_role\(\) in \('owner','admin','manager','team_lead'\)/);
  });
});

describe("the screen exists, and asks the server who may manage", () => {
  const ui = read("src/components/admin/ProjectTeam.jsx");
  const page = read("src/app/admin/project-details/[projectId]/page.jsx");

  it("is rendered, so the API has a consumer", () => {
    // The audit's structural finding was 34 catalogue keys that nothing
    // enforces. A route that nothing calls is the same failure facing the other
    // way — which is why this is a test and not a follow-up.
    expect(page).toContain("<ProjectTeam projectId={projectId} />");
    expect(page).toContain('import ProjectTeam from "@/components/admin/ProjectTeam"');
  });

  it("takes canManage from the response, not from allowed()", () => {
    // allowed() builds its subject from the role alone and has no project
    // roles, so it can only answer the ORGANIZATION-wide question. Using it
    // would show these controls to every manager in the company and hand each
    // of them a 404 on use.
    expect(ui).toContain("Boolean(body.canManage)");
    // Comments stripped first: the component's own docblock EXPLAINS why
    // allowed() is wrong here, and matching that explanation would fail a
    // correct file. Same trap as asserting "security definer" against a
    // migration that warns about it.
    const code = ui.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
    expect(code).not.toMatch(/allowed\(\s*["']project\.manage_members["']/);
  });

  it("checks res.ok before it trusts the body", () => {
    // A 404 here is the route declining to say whether the project exists.
    // Reading body.members off it would render an empty team as a fact — the
    // "failed fetch shown as an authoritative empty state" pattern the audit
    // found on nine screens.
    expect(ui).toMatch(/if \(!res\.ok\) throw new Error/);
  });

  it("guards every write against double submission", () => {
    expect(ui).toMatch(/disabled=\{busy \|\| !pickedUser\}/);
    expect(ui).toMatch(/disabled=\{busy\}/);
  });

  it("does not offer manager in the picker", () => {
    // projects.manager_id is the authority and a trigger keeps this table in
    // step; offering it here would be a second way to say the same thing.
    expect(ui).toContain('PROJECT_ROLES.filter((r) => r !== MANAGER)');
  });

  it("reads the role list from the shared module", () => {
    expect(ui).toContain('import { PROJECT_ROLES } from "@/utils/roles"');
    expect(ui).not.toMatch(/const PROJECT_ROLES\s*=\s*\[/);
  });
});
