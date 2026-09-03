import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { resolvePermission, roleCan } from "@/utils/permissionEngine";
import { PERMISSION_KEYS } from "@/utils/permissionCatalogue";

/**
 * A PER-PERSON OVERRIDE ACTUALLY APPLIES NOW.
 *
 * THE GAP. 069 added `user_permissions`: an organization may grant or deny one
 * named permission to one named person. `getAuthedOrg` loads them,
 * `resolvePermission` honours them, and every route asking `authCan` respects
 * them.
 *
 * Ten capabilities were not gated by a route at all. They happen in components
 * writing straight to PostgREST, so their only gate was an RLS ROLE LIST —
 * and `public.auth_role() in ('owner','admin','hr')` has no idea an exception
 * was written. An administrator could deny `member.manage` to somebody, watch
 * it save, and that person could carry on editing memberships.
 *
 * And the browser could not see them either: `roleCan(getRole(), key)` passes
 * `{ role }`, a subject with no `overrides`, so `resolvePermission` had nothing
 * to honour.
 *
 * BOTH HALVES OR NEITHER. Fixing only the database gives a denied person a
 * button that now genuinely fails — the same dead end `canPay` had, arrived at
 * from the other direction. Fixing only the browser hides a button while the
 * capability stays open. 094 does the first; /api/me/permissions and
 * `loadPermissionSet` do the second.
 */

const root = path.resolve(__dirname, "..");
const raw = (p) => readFileSync(path.join(root, p), "utf8");
const read = (p) =>
  raw(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const readSql = (p) => raw(p).replace(/^\s*--.*$/gm, "");

const MIGRATION = "database/094_overrides_actually_apply.sql";
const sql = readSql(MIGRATION);

/** The seven policies 094 rewrites, and the role list each must keep. */
const REWRITTEN = {
  organizations_update: "'owner','admin'",
  memberships_insert: "'owner','admin','hr'",
  memberships_update: "'owner','admin','hr'",
  memberships_delete: "'owner','admin'",
  employee_profiles_write: "'owner','admin','hr'",
  employee_profiles_update: "'owner','admin','hr'",
  employee_profiles_delete: "'owner','admin','hr'",
};

const policyBody = (name) => {
  const from = sql.indexOf(`create policy ${name} on`);
  expect(from, `${name} is not created in 094`).toBeGreaterThan(-1);
  return sql.slice(from, sql.indexOf(";", from));
};

describe("the resolver reads the caller's own overrides and nothing else", () => {
  it("is SECURITY DEFINER with a pinned search_path", () => {
    // The caller cannot read user_permissions directly and should not be able
    // to. A definer function that resolves names through the caller's
    // search_path can be pointed at a table they control.
    expect(sql).toMatch(/create or replace function public\.auth_override/);
    expect(sql).toMatch(/security definer/);
    expect(sql).toMatch(/set search_path = public, pg_temp/);
    expect(sql).toMatch(/\bstable\b/);
  });

  it("scopes to the caller and to their organization", () => {
    const fn = sql.slice(sql.indexOf("function public.auth_override"), sql.indexOf("$$;"));
    expect(fn).toMatch(/m\.user_id\s+= public\.auth_app_user_id\(\)/);
    expect(fn).toMatch(/m\.organization_id = public\.auth_org\(\)/);
  });

  it("is executable by authenticated and by nobody else", () => {
    expect(sql).toMatch(/revoke all on function public\.auth_override\(text\) from public/);
    expect(sql).toMatch(/grant execute on function public\.auth_override\(text\) to authenticated/);
  });
});

describe("every rewritten policy consults the override AND keeps its role rule", () => {
  it.each(Object.entries(REWRITTEN))("%s", (name, roles) => {
    const body = policyBody(name);
    expect(body, `${name} does not consult auth_override`).toMatch(/public\.auth_override\(/);
    expect(body, `${name} lost its role list`).toContain(roles);
    // Still scoped to the organization — an override is not a way out of the
    // tenant boundary.
    expect(body).toMatch(/auth_org\(\)/);
  });

  it("keeps the owner clauses OUTSIDE the override", () => {
    // An exception may widen or narrow who administers members. It is not a way
    // to make somebody an owner, or to delete one.
    //
    // The first draft of 094 rewrote these policies from memory and dropped
    // both clauses — an hr could have created an owner, an admin deleted one.
    // They are asserted here because reading the originals is what caught it.
    const ins = policyBody("memberships_insert");
    expect(ins).toMatch(/role <> 'owner' or public\.auth_role\(\) = 'owner'/);
    expect(ins.indexOf("role <> 'owner'")).toBeGreaterThan(ins.indexOf("auth_override"));

    const upd = policyBody("memberships_update");
    expect(upd).toMatch(/role <> 'owner' or public\.auth_role\(\) = 'owner'/);

    const del = policyBody("memberships_delete");
    expect(del).toMatch(/and role <> 'owner'/);
  });

  it("puts a DENY ahead of a GRANT where two keys share a rule", () => {
    // employee_profiles_update is reached by both employee.activate and
    // employee.transfer, because RLS cannot tell which column somebody meant.
    //
    // A nested coalesce lets the OUTER key's grant beat the inner key's deny —
    // activate=true with transfer=false came out TRUE, so an exception written
    // to stop somebody transferring people could be side-stepped by granting
    // them activate. The draft did that while its comment claimed the opposite.
    //
    // A CASE in resolvePermission's own order fixes it: deny, then allow, then
    // role.
    const body = policyBody("employee_profiles_update");
    expect(body).toMatch(/case/);
    const denyActivate = body.indexOf("'employee.activate') = false");
    const denyTransfer = body.indexOf("'employee.transfer') = false");
    const grantActivate = body.indexOf("'employee.activate') = true");
    expect(denyActivate).toBeGreaterThan(-1);
    expect(denyTransfer).toBeGreaterThan(-1);
    expect(denyActivate, "a deny must be tested before any grant").toBeLessThan(grantActivate);
    expect(denyTransfer, "a deny must be tested before any grant").toBeLessThan(grantActivate);
    // and the naive form is gone
    expect(body).not.toMatch(/coalesce\(public\.auth_override\('employee\.transfer'\)/);
  });

  it("names only keys the catalogue defines", () => {
    const keys = [...sql.matchAll(/auth_override\('([a-z_.]+)'\)/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThanOrEqual(7);
    for (const k of new Set(keys)) {
      expect(PERMISSION_KEYS, `094 asks for ${k}, which is not a permission`).toContain(k);
    }
  });

  it("is additive", () => {
    // `drop policy if exists` is how a policy is replaced. Dropping a table or
    // deleting rows is not.
    expect(sql).not.toMatch(/drop\s+table/i);
    expect(sql).not.toMatch(/\btruncate\b/i);
    expect(sql).not.toMatch(/delete\s+from/i);
    expect(sql).not.toMatch(/drop\s+column/i);
  });
});

describe("the order the database uses is the order the application uses", () => {
  // 094 mirrors resolvePermission rather than inventing a second precedence.
  // These assert the application half, so the two cannot drift apart silently.
  const subject = (role, overrides) => ({ role, overrides });

  it("an explicit deny beats the role", () => {
    expect(roleCan("hr", "member.manage")).toBe(true);
    expect(resolvePermission(subject("hr", { "member.manage": false }), "member.manage")).toBe(false);
  });

  it("an explicit grant beats the role's absence", () => {
    expect(roleCan("developer", "member.manage")).toBe(false);
    expect(resolvePermission(subject("developer", { "member.manage": true }), "member.manage")).toBe(true);
  });

  it("no override leaves the role deciding", () => {
    expect(resolvePermission(subject("hr", {}), "member.manage")).toBe(true);
    expect(resolvePermission(subject("developer", {}), "member.manage")).toBe(false);
  });
});

describe("the browser is told what it may do, so it stops offering what it may not", () => {
  const route = read("src/app/api/me/permissions/route.js");
  const perms = read("src/utils/permissions.js");

  it("answers from the whole auth subject, not from the role alone", () => {
    // Passing `{ role: auth.role }` here would have reproduced the exact bug
    // this route exists to fix.
    expect(route).toMatch(/permissionSetFor\(auth\)/);
    expect(route).not.toMatch(/permissionSetFor\(\{\s*role/);
  });

  it("answers a client an empty set", () => {
    expect(route).toMatch(/auth\.userType === "client" \? \[\]/);
  });

  it("passes through overridesUnavailable rather than pretending", () => {
    // getAuthedOrg sets it when the overrides query failed. A screen that
    // cannot tell "no exceptions" from "could not read the exceptions" will
    // show the wrong menu confidently.
    expect(route).toMatch(/overridesUnavailable/);
  });

  it("says plainly that it is not a gate", () => {
    expect(raw("src/app/api/me/permissions/route.js")).toMatch(/NOT A GATE/i);
  });

  it("prefers the fetched set and falls back to the role", () => {
    expect(perms).toMatch(/if \(PERMISSION_SET && !scope\?\.projectId\) return PERMISSION_SET\.has\(key\)/);
    expect(perms).toMatch(/return roleCan\(getRole\(\), key, scope\)/);
  });

  it("sends a scoped question to the resolver, not to the set", () => {
    // The set is the caller's organization-wide answer and cannot speak for one
    // project, which is what project-scoped permissions are for.
    expect(perms).toMatch(/!scope\?\.projectId/);
  });

  it("routes the legacy can() through the same path", () => {
    // `can()` used to call roleCan directly, which would have left every legacy
    // call site blind to overrides while `allowed()` saw them.
    expect(perms).toMatch(/export function can\(action\) \{[\s\S]{0,120}return allowed\(key\)/);
  });

  it("loads at sign-in and never blocks it", () => {
    const login = read("src/app/login/page.js");
    expect(login).toMatch(/loadPermissionSet\(authFetch\)/);
    expect(login).toMatch(/try \{\s*await loadPermissionSet/);
  });

  it("clears on sign-out, so nobody inherits the last person's set", () => {
    const session = read("src/utils/sessionPolicy.js");
    const clears = session.match(/clearPermissionSet\(\)/g) || [];
    expect(clears.length).toBeGreaterThanOrEqual(2);
  });
});
