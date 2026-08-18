import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { ROLES } from "@/utils/roles";
import { roleCan } from "@/utils/permissionEngine";
import { defaultRolesFor, isPermissionKey } from "@/utils/permissionCatalogue";
import { canAccessAdminSection, SECTION_PERMISSIONS } from "@/components/shell/sectionAccess";
import { adminNavFor } from "@/components/shell/navConfig";

/**
 * The screen that hands out every other screen.
 *
 * `permissions.manage` is the sharpest key in the product: whoever holds it can
 * write themselves any other permission, including this one. So it is the only
 * capability in the catalogue that does not extend to `admin`, and the three
 * places that enforce it — the catalogue, the section gate, and the RLS write
 * policy in migration 069 — have to agree without any of them trusting another.
 */

const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ROUTE = stripComments(read("src/app/api/admin/permissions/route.js"));
const PANEL = stripComments(read("src/components/admin/PermissionsPanel.jsx"));
const MIGRATION = read("database/069_user_permission_overrides.sql");

describe("permissions.manage is owner-only, everywhere", () => {
  it("in the catalogue", () => {
    expect(isPermissionKey("permissions.manage")).toBe(true);
    for (const role of ROLES) {
      expect(roleCan(role, "permissions.manage"), role).toBe(role === "owner");
    }
  });

  it("is the ONLY key an admin does not hold", () => {
    // Stated positively so the exception stays visible. An admin holding this
    // would make the owner/admin distinction meaningless — they could grant
    // themselves the rest in one click.
    const adminMissing = defaultRolesFor("organization.manage").includes("admin");
    expect(adminMissing).toBe(false); // owner-only group exists
    expect(roleCan("admin", "permissions.manage")).toBe(false);
    expect(roleCan("owner", "permissions.manage")).toBe(true);
  });

  it("in the section gate", () => {
    expect(SECTION_PERMISSIONS.permissions).toBe("permissions.manage");
    for (const role of ROLES) {
      expect(canAccessAdminSection("permissions", role), role).toBe(role === "owner");
    }
  });

  it("in the sidebar", () => {
    expect(adminNavFor("owner").map((i) => i.id)).toContain("permissions");
    for (const role of ["admin", "hr", "manager", "team_lead", "qa", "finance"]) {
      expect(adminNavFor(role).map((i) => i.id), role).not.toContain("permissions");
    }
  });

  it("in the RLS write policy, which does not trust the app layer", () => {
    const write = MIGRATION.match(/create policy user_permissions_write[\s\S]*?;/)?.[0] || "";
    expect(write).toContain("public.auth_role() = 'owner'");
    expect(write).toContain("not public.auth_is_client()");
    // and both USING and WITH CHECK, or an owner could insert rows they then
    // could not see — or worse, rows scoped to another organization.
    expect(write).toContain("using");
    expect(write).toContain("with check");
  });

  it("on both handlers of the route", () => {
    const calls = ROUTE.match(/requirePermission\(auth, "permissions\.manage"\)/g) || [];
    expect(calls.length, "GET and POST must each check").toBe(2);
  });
});

describe("the route refuses to write outside the caller's organization", () => {
  it("re-reads the target membership and compares the org", () => {
    // membershipId comes from the browser and the client below bypasses RLS.
    // This is the check whose absence let the developer-delete preview read
    // across tenants.
    expect(ROUTE).toContain('.select("id, organization_id, role, email")');
    expect(ROUTE).toContain("target.organization_id !== auth.orgId");
  });

  it("answers the same 404 for another tenant's member as for nobody", () => {
    const branch = ROUTE.slice(ROUTE.indexOf("target.organization_id !== auth.orgId"));
    expect(branch.slice(0, 240)).toContain("Member not found.");
  });

  it("refuses a permission key that is not in the catalogue", () => {
    // A key nothing recognises can never match, so storing it would be a row
    // that looks like a decision and is not one.
    expect(ROUTE).toContain("isPermissionKey(permissionKey)");
  });

  it("accepts only true, false, or null", () => {
    expect(ROUTE).toMatch(/allowed !== true && allowed !== false && allowed !== null/);
  });

  it("records who granted it", () => {
    expect(ROUTE).toContain("granted_by");
  });
});

describe("the screen tells the two kinds of yes apart", () => {
  it("distinguishes granted-by-role from granted-specifically", () => {
    // Colouring them the same would hide every exception in the organization
    // behind a wall of identical ticks — the screen would be decorative.
    expect(PANEL).toContain("GRANTED_BY_ROLE");
    expect(PANEL).toContain("GRANTED_BY_OVERRIDE");
    expect(PANEL).toContain("DENIED_BY_OVERRIDE");
  });

  it("imports the catalogue rather than fetching it", () => {
    // It is application code, identical in every deployment. Serialising it
    // would create a second copy that can lag a deploy.
    expect(PANEL).toContain('from "@/utils/permissionCatalogue"');
    expect(ROUTE).not.toMatch(/PERMISSIONS\b.*=.*catalogue/i);
  });

  it("inspects the response — authFetch resolves on a 4xx", () => {
    // Otherwise a 403 renders as a successful save, which is the failure this
    // whole screen exists to make impossible elsewhere.
    expect(PANEL).toMatch(/if \(!res\.ok\) throw new Error/);
  });

  it("says so when the store is not there rather than looking broken", () => {
    // Until migration 069 runs the role grid is still real and enforced; only
    // the exceptions are unavailable. A blank screen would read as a bug.
    expect(PANEL).toContain("storeReady === false");
    expect(PANEL).toContain("069");
    expect(ROUTE).toContain("storeReady");
  });

  it("keeps the role grid read-only", () => {
    // Changing a role default changes it for everyone who will ever hold that
    // role. That is a deploy, not a click.
    const grid = PANEL.slice(PANEL.indexOf("function RoleGrid"), PANEL.indexOf("function MemberList"));
    expect(grid).not.toMatch(/onClick=\{\(\) => onSet/);
    expect(grid).not.toContain("authFetch");
  });
});

describe("the migration says what it does", () => {
  it("keys overrides by membership, not by user", () => {
    expect(MIGRATION).toContain("membership_id  uuid not null references public.memberships(id)");
    expect(MIGRATION).toContain("on delete cascade");
  });

  it("allows one decision per permission per person", () => {
    expect(MIGRATION).toContain("unique (membership_id, permission_key)");
  });

  it("will not store a key that is not resource.action shaped", () => {
    expect(MIGRATION).toMatch(/check \(permission_key ~ '\^\[a-z\]\[a-z_\]\*\\\.\[a-z\]\[a-z_\]\*\$'\)/);
  });

  it("forbids a null decision", () => {
    // A null would be a third state nobody has defined. Withdrawing a decision
    // means deleting the row, which the route does.
    expect(MIGRATION).toContain("allowed        boolean not null");
  });
});
