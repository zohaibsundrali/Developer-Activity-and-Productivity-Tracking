import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { ROLES } from "@/utils/roles";
import {
  PERMISSIONS,
  PERMISSION_KEYS,
  PERMISSION_MODULES,
  LEGACY_KEYS,
  defaultRolesFor,
  isPermissionKey,
  permissionsForRole,
} from "@/utils/permissionCatalogue";
import { resolvePermission, roleCan, permissionSetFor } from "@/utils/permissionEngine";
import { requirePermission, authCan } from "@/utils/serverPermissions";
import { SECTION_PERMISSIONS, ADMIN_SECTION_ROLES } from "@/components/shell/sectionAccess";

/**
 * The resolver, and the registry it reads.
 *
 * The parity suite next door proves the new rules match the old ones. This one
 * proves the machine around them behaves: that it fails closed, that a deny
 * beats a grant, that the catalogue is internally consistent, and — the
 * assertion that made the fail-closed switch safe to throw — that every
 * permission named anywhere in the source is a permission that exists.
 */

const root = path.resolve(__dirname, "..");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|jsx|ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}
const SOURCES = walk(path.join(root, "src"));

/**
 * Comments are stripped before scanning. They discuss permission keys — this
 * file's own subject matter — and the very first run of the test below flagged
 * `can("manage_setting")` from a doc comment explaining the typo that used to
 * answer true. A scanner that reads prose reports prose.
 */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the resolver fails closed", () => {
  it("refuses a key that is not in the catalogue", () => {
    // The old `can()` ended `default: return true`. Every typo was a yes.
    for (const key of ["", "nonsense", "project.viewall", "PROJECT.VIEW_ALL", null, undefined, 7, {}]) {
      expect(resolvePermission({ role: "owner" }, key), String(key)).toBe(false);
    }
  });

  it("refuses when there is no subject at all", () => {
    for (const subject of [null, undefined, "owner", 7, []]) {
      expect(resolvePermission(subject, "project.view_all"), String(subject)).toBe(false);
    }
  });

  it("refuses a role that is not a role", () => {
    for (const role of [null, undefined, "", "OWNER", " owner", "root", 1, {}]) {
      expect(roleCan(role, "project.view_all"), String(role)).toBe(false);
    }
  });

  it("is case-sensitive and does not trim", () => {
    // A role arriving with whitespace is a bug upstream; matching it anyway
    // would hide the bug and grant the access.
    expect(roleCan("owner", "project.view_all")).toBe(true);
    expect(roleCan("Owner", "project.view_all")).toBe(false);
    expect(roleCan("owner ", "project.view_all")).toBe(false);
  });
});

describe("user overrides", () => {
  it("lets a deny beat the role grant, including for an owner", () => {
    // The only reason to write a deny is to take something away from somebody
    // who would otherwise have it, so it has to outrank everything.
    expect(roleCan("owner", "billing.manage")).toBe(true);
    expect(
      resolvePermission({ role: "owner", overrides: { "billing.manage": false } }, "billing.manage")
    ).toBe(false);
  });

  it("lets a grant reach past the role", () => {
    expect(roleCan("developer", "task.review")).toBe(false);
    expect(
      resolvePermission({ role: "developer", overrides: { "task.review": true } }, "task.review")
    ).toBe(true);
  });

  it("ignores an override that is not a yes or a no", () => {
    // Anything else in that column is not an answer. Falling through to the
    // role is the only reading that cannot accidentally grant.
    for (const junk of ["true", "false", 1, 0, null, undefined, ""]) {
      expect(
        resolvePermission({ role: "developer", overrides: { "task.review": junk } }, "task.review"),
        String(junk)
      ).toBe(false);
    }
    expect(
      resolvePermission({ role: "owner", overrides: { "billing.manage": "false" } }, "billing.manage")
    ).toBe(true); // the string "false" is junk, not a deny — role still applies
  });

  it("only applies to the key it names", () => {
    const subject = { role: "owner", overrides: { "billing.manage": false } };
    expect(resolvePermission(subject, "billing.manage")).toBe(false);
    expect(resolvePermission(subject, "billing.view")).toBe(true);
  });

  it("does not let an inherited property act as an override", () => {
    // `{}.toString` exists on every object. Reading overrides with `in` or a
    // bare property access would make `toString` a granted permission on a
    // subject nobody wrote an override for.
    const subject = { role: "developer", overrides: Object.create({ "task.review": true }) };
    expect(resolvePermission(subject, "task.review")).toBe(false);
  });
});

describe("project scope", () => {
  const PROJECT = "11111111-1111-1111-1111-111111111111";

  it("grants through the role held on that project", () => {
    const subject = { role: "developer", projectRoles: { [PROJECT]: "manager" } };
    expect(resolvePermission(subject, "task.manage")).toBe(false);
    expect(resolvePermission(subject, "task.manage", { projectId: PROJECT })).toBe(true);
  });

  it("does not leak to a different project", () => {
    const subject = { role: "developer", projectRoles: { [PROJECT]: "manager" } };
    expect(resolvePermission(subject, "task.manage", { projectId: "other" })).toBe(false);
  });

  it("never takes away what the org role already granted", () => {
    // Plenty of these screens are org-wide reads. An owner who is not a member
    // of one project has not lost the right to look at it; removing access for
    // a single project is what an override is for.
    const subject = { role: "owner", projectRoles: {} };
    expect(resolvePermission(subject, "task.manage", { projectId: PROJECT })).toBe(true);
  });

  it("still loses to a deny", () => {
    const subject = {
      role: "developer",
      projectRoles: { [PROJECT]: "manager" },
      overrides: { "task.manage": false },
    };
    expect(resolvePermission(subject, "task.manage", { projectId: PROJECT })).toBe(false);
  });
});

describe("the catalogue holds together", () => {
  it("has no duplicate keys", () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  });

  it("names only real roles", () => {
    for (const entry of PERMISSIONS) {
      for (const role of entry.roles) expect(ROLES, entry.key).toContain(role);
    }
  });

  it("uses resource.action, one dot, lower snake case", () => {
    for (const key of PERMISSION_KEYS) {
      expect(key, key).toMatch(/^[a-z][a-z_]*\.[a-z][a-z_]*$/);
    }
  });

  it("gives every entry a module and a label", () => {
    for (const entry of PERMISSIONS) {
      expect(entry.module, entry.key).toBeTruthy();
      expect(entry.label, entry.key).toBeTruthy();
      expect(PERMISSION_MODULES, entry.key).toContain(entry.module);
    }
  });

  it("grants nothing to nobody", () => {
    // An entry with an empty role list is a capability that exists and cannot
    // be exercised — dead weight that reads as a real rule.
    for (const entry of PERMISSIONS) {
      expect(entry.roles.length, entry.key).toBeGreaterThan(0);
    }
  });

  it("maps each legacy name to exactly one key", () => {
    const targets = Object.values(LEGACY_KEYS);
    expect(new Set(targets).size).toBe(targets.length);
    for (const key of targets) expect(isPermissionKey(key), key).toBe(true);
  });

  it("keeps client out of every staff permission", () => {
    // A client is a customer. `client` is a legitimate role, but no staff
    // capability may name it — the portal is gated separately end to end.
    for (const entry of PERMISSIONS) {
      expect(entry.roles, entry.key).not.toContain("client");
    }
    expect(permissionsForRole("client")).toHaveLength(0);
  });
});

describe("every permission named in the source exists", () => {
  /**
   * THE ASSERTION THAT MADE FAIL-CLOSED SAFE.
   *
   * Turning `default: return true` into `return false` is only safe if no call
   * site was relying on the old default — that is, if every key asked for is a
   * key that exists. Before this test that was an assumption; grep is not a
   * guarantee, and the next `can("typo")` would have silently answered yes
   * before and would silently answer no now. Both are wrong; only one is
   * detectable, and this is what detects it.
   */
  /**
   * BOTH SCANNERS BELOW USED TO BE VACUOUS, and adversarial review is what said
   * so. Neither could fail:
   *
   *   - the key-first pattern also listed `authCan` and `roleCan`, which take
   *     the key SECOND, so those two alternatives matched nothing ever;
   *   - the requirePermission pattern matched nothing at all, so its `unknown`
   *     array was empty by construction rather than by evidence.
   *
   * A scanner that finds nothing and a scanner that is broken produce the same
   * green tick. So each one now asserts what it FOUND before asserting that
   * what it found is valid — if the regex stops matching, the count drops and
   * the test fails instead of quietly passing.
   */

  /** Every `fn(..., "key")` occurrence, wherever the key sits in the call. */
  function scan(pattern, { skip = /$^/ } = {}) {
    const hits = [];
    for (const file of SOURCES) {
      if (skip.test(file)) continue;
      const src = stripComments(readFileSync(file, "utf8"));
      for (const m of src.matchAll(pattern)) {
        hits.push({ file: path.relative(root, file), key: m[1] });
      }
    }
    return hits;
  }

  it("in every can() and allowed() call — the key-first forms", () => {
    const hits = scan(/\b(?:can|allowed)\(\s*["']([a-z][a-z_.]*)["']/g, {
      skip: /permissionCatalogue|permissionEngine|serverPermissions/,
    });
    // Section ids reach a LOCAL `can(section)` helper on the dashboard, not the
    // permission one; they are checked by the section suites instead.
    const permissionHits = hits.filter(
      (h) => !Object.prototype.hasOwnProperty.call(SECTION_PERMISSIONS, h.key)
    );
    // The proof the scanner works. `can()` has real call sites; if this ever
    // reads 0 the regex has gone stale and the assertion below means nothing.
    expect(permissionHits.length, "scanner found no can()/allowed() calls").toBeGreaterThan(0);

    const unknown = permissionHits
      .filter((h) => !isPermissionKey(h.key) && !LEGACY_KEYS[h.key])
      .map((h) => `${h.file} -> ${h.key}`);
    expect(unknown).toEqual([]);
  });

  it("in every roleCan(), authCan() and requirePermission() call — the key-second forms", () => {
    const hits = scan(
      /\b(?:roleCan|authCan|requirePermission)\(\s*[^,()]+,\s*["']([^"']+)["']/g,
      { skip: /permissionCatalogue|permissionEngine|serverPermissions/ }
    );
    expect(hits.length, "scanner found no key-second calls").toBeGreaterThan(0);

    const unknown = hits
      .filter((h) => !isPermissionKey(h.key))
      .map((h) => `${h.file} -> ${h.key}`);
    expect(unknown).toEqual([]);
  });
});

describe("the section map is derived, not a second copy", () => {
  it("gives every gated section a real permission", () => {
    for (const [section, key] of Object.entries(SECTION_PERMISSIONS)) {
      if (key === null) continue;
      expect(isPermissionKey(key), `${section} -> ${key}`).toBe(true);
    }
  });

  it("derives ADMIN_SECTION_ROLES from the catalogue", () => {
    // TAUTOLOGY REMOVED. This compared ADMIN_SECTION_ROLES[section] against
    // defaultRolesFor(key) — the same array object, reached two ways. It could
    // only fail if the spread that builds it were deleted, and it proved
    // derivation while reading as though it proved correctness.
    //
    // Spot-checked against literal expectations instead, so a wrong mapping in
    // SECTION_PERMISSIONS actually fails something.
    expect([...ADMIN_SECTION_ROLES.billing]).toEqual(["owner", "admin", "finance"]);
    expect([...ADMIN_SECTION_ROLES.employees]).toEqual(["owner", "admin", "hr"]);
    expect([...ADMIN_SECTION_ROLES["task-reviews"]]).toEqual([
      "owner", "admin", "manager", "team_lead", "qa",
    ]);
    expect([...ADMIN_SECTION_ROLES["developer-activity"]]).toEqual(["owner", "admin"]);
    expect([...ADMIN_SECTION_ROLES.productivity]).toEqual(["owner", "admin"]);
    expect(ADMIN_SECTION_ROLES.overview).toBeNull();
    expect(ADMIN_SECTION_ROLES.account).toBeNull();

    // And that the shape holds for the rest — every gated section resolves to a
    // non-empty role list, every ungated one to null.
    for (const [section, key] of Object.entries(SECTION_PERMISSIONS)) {
      if (key === null) expect(ADMIN_SECTION_ROLES[section], section).toBeNull();
      else expect(ADMIN_SECTION_ROLES[section].length, section).toBeGreaterThan(0);
    }
  });

  it("freezes the catalogue itself, not just the copy taken from it", () => {
    // The freeze assertion below used to cover only ADMIN_SECTION_ROLES — the
    // derived copy, which decides nothing. The live arrays were mutable, and
    // because the role bundles are shared objects one push widened every
    // permission in that bundle at once, invisibly: the sidebar keeps
    // rendering the frozen copy while the resolver answers yes.
    expect(Object.isFrozen(PERMISSIONS)).toBe(true);
    for (const entry of PERMISSIONS) {
      expect(Object.isFrozen(entry), entry.key).toBe(true);
      expect(Object.isFrozen(entry.roles), `${entry.key}.roles`).toBe(true);
    }
    expect(Object.isFrozen(defaultRolesFor("organization.manage"))).toBe(true);
    expect(Object.isFrozen(defaultRolesFor("not.a_key"))).toBe(true);

    // The exact escalation, refused.
    expect(() => defaultRolesFor("organization.manage").push("developer")).toThrow();
    expect(roleCan("developer", "organization.delete")).toBe(false);
  });

  it("cannot be edited into disagreeing with the catalogue", () => {
    // Frozen, so a well-meaning `ADMIN_SECTION_ROLES.billing.push("hr")`
    // somewhere in a component throws instead of quietly re-opening a screen.
    expect(Object.isFrozen(ADMIN_SECTION_ROLES)).toBe(true);
    for (const value of Object.values(ADMIN_SECTION_ROLES)) {
      if (value !== null) expect(Object.isFrozen(value)).toBe(true);
    }
  });
});

describe("permissionSetFor", () => {
  it("lists exactly the keys the subject holds", () => {
    for (const role of ROLES) {
      const set = permissionSetFor({ role });
      expect(set.sort()).toEqual(permissionsForRole(role).sort());
    }
  });

  it("reflects overrides", () => {
    const set = permissionSetFor({ role: "developer", overrides: { "task.review": true } });
    expect(set).toContain("task.review");
  });
});

describe("requirePermission — the guard API routes call", () => {
  /**
   * SHIPPED WITH NO TESTS AT ALL, and mutation testing is what said so:
   * deleting the entire client check from serverPermissions.js broke nothing.
   * A security helper whose failure is invisible is worse than no helper,
   * because every route that adopts it inherits the blind spot.
   */
  const staff = (role) => ({ role, userType: "developer" });

  it("returns null — meaning continue — when the permission is held", () => {
    expect(requirePermission(staff("owner"), "billing.manage")).toBeNull();
    expect(requirePermission(staff("qa"), "task.review")).toBeNull();
  });

  it("401s when there is nobody", () => {
    for (const auth of [null, undefined]) {
      expect(requirePermission(auth, "billing.view")?.status, String(auth)).toBe(401);
    }
  });

  it("403s a signed-in member who does not hold it", () => {
    expect(requirePermission(staff("developer"), "billing.view")?.status).toBe(403);
    expect(requirePermission(staff("hr"), "project.view_all")?.status).toBe(403);
  });

  it("403s a client no matter what their role column says", () => {
    // A client is a customer. Their `role` is `client` and no staff permission
    // lists it — but a corrupted or hand-edited row claiming `owner` must not
    // become a way into the staff API, so this is checked on userType and not
    // left to fall out of the role lists.
    expect(requirePermission({ role: "client", userType: "client" }, "billing.view")?.status).toBe(403);
    expect(requirePermission({ role: "owner", userType: "client" }, "billing.view")?.status).toBe(403);
    expect(requirePermission({ role: "owner", userType: "client" }, "project.view_all")?.status).toBe(403);
  });

  it("500s — not 403s — when the route names a permission that does not exist", () => {
    // The caller did nothing wrong; the route did. A 403 here would send
    // somebody hunting for a permission to grant that can never be granted.
    const res = requirePermission(staff("owner"), "billing.viewx");
    expect(res?.status).toBe(500);
  });

  it("takes the whole auth object, so no call site can pass a body field", () => {
    // Passing a bare string must not accidentally work: `requirePermission(
    // body.role, ...)` has to be obviously wrong, not subtly right.
    expect(requirePermission("owner", "billing.view")?.status).toBe(403);
  });

  it("authCan answers the same question without a response", () => {
    expect(authCan(staff("owner"), "billing.manage")).toBe(true);
    expect(authCan(staff("developer"), "billing.manage")).toBe(false);
    expect(authCan({ role: "owner", userType: "client" }, "billing.manage")).toBe(false);
    expect(authCan(null, "billing.manage")).toBe(false);
  });
});

describe("the role lists that used to go stale", () => {
  /**
   * The bug this whole change started from: a hand-typed copy of the roles in
   * a file nobody thought of as owning the role vocabulary. Mutation testing
   * put the old literal back and nothing failed — the bug was fixed and
   * nothing was keeping it fixed.
   */
  const routeSrc = stripComments(
    readFileSync(path.join(root, "src/app/api/invitations/route.js"), "utf8")
  );
  const pickerSrc = stripComments(
    readFileSync(path.join(root, "src/components/admin/OrganizationManagement.jsx"), "utf8")
  );

  it("the invitations route derives the assignable roles", () => {
    expect(routeSrc).toMatch(/ASSIGNABLE_ROLES = ROLES\.filter\(/);
  });

  it("the invitations route holds no literal role list", () => {
    // The exact shape of the stale copy: an array of quoted role names.
    expect(routeSrc).not.toMatch(/ASSIGNABLE_ROLES\s*=\s*\[\s*['"]/);
  });

  it("every role except owner is assignable, including the four that were not", () => {
    // finance, qa and designer were offered by the form and rejected by the
    // route with `400 Invalid role.`; devops was never offered at all.
    const assignable = ROLES.filter((r) => r !== "owner");
    for (const role of ["finance", "qa", "designer", "devops"]) {
      expect(assignable, role).toContain(role);
    }
    expect(assignable).toHaveLength(ROLES.length - 1);
  });

  it("the member picker holds no literal role list either", () => {
    expect(pickerSrc).not.toMatch(/const ROLES\s*=\s*\[/);
    expect(pickerSrc).toContain('import { ROLES } from "@/utils/roles"');
  });
});
