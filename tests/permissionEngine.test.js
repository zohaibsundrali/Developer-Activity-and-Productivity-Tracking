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
  it("in every can(), allowed() and requirePermission() call", () => {
    const CALL = /\b(?:can|allowed|authCan|roleCan)\(\s*["']([a-z][a-z_.]*)["']/g;
    const unknown = [];
    for (const file of SOURCES) {
      // The catalogue and the shim legitimately mention keys as data.
      if (/permissionCatalogue|permissionEngine|serverPermissions/.test(file)) continue;
      const src = stripComments(readFileSync(file, "utf8"));
      for (const [, key] of src.matchAll(CALL)) {
        // Section ids reach a local `can(section)` helper on the dashboard, not
        // the permission one. Those are validated by the section test below.
        if (Object.prototype.hasOwnProperty.call(SECTION_PERMISSIONS, key)) continue;
        if (!isPermissionKey(key) && !LEGACY_KEYS[key]) {
          unknown.push(`${path.relative(root, file)} -> ${key}`);
        }
      }
    }
    expect(unknown).toEqual([]);
  });

  it("in every requirePermission() call", () => {
    const CALL = /requirePermission\(\s*[A-Za-z0-9_.]+\s*,\s*["']([^"']+)["']/g;
    const unknown = [];
    for (const file of SOURCES) {
      if (/serverPermissions/.test(file)) continue;
      for (const [, key] of stripComments(readFileSync(file, "utf8")).matchAll(CALL)) {
        if (!isPermissionKey(key)) unknown.push(`${path.relative(root, file)} -> ${key}`);
      }
    }
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
    for (const [section, key] of Object.entries(SECTION_PERMISSIONS)) {
      if (key === null) {
        expect(ADMIN_SECTION_ROLES[section], section).toBeNull();
      } else {
        expect([...ADMIN_SECTION_ROLES[section]], section).toEqual([...defaultRolesFor(key)]);
      }
    }
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
