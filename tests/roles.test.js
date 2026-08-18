import { describe, it, expect } from "vitest";
import { canAccessAdminSection } from "@/components/shell/sectionAccess";
import { defaultRolesFor, permissionsForRole } from "@/utils/permissionCatalogue";
import { roleCan } from "@/utils/permissionEngine";
import { ROLES as SHARED_ROLES } from "@/utils/roles";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Every role, however many there are.
 *
 * The danger with a role set is not that a role is missing — that is visible
 * the moment someone tries to assign it. The danger is a role that exists in
 * ONE list and not the others: it can be assigned, the person signs in, and
 * every screen quietly behaves as though they were nobody. So most of what
 * follows compares the lists against each other rather than testing behaviour.
 */

const root = path.resolve(__dirname, "..");
const read = (p) =>
  readFileSync(path.join(root, p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*--.*$/gm, "");

/**
 * IMPORTED, not retyped — and this file of all files should not have needed
 * telling. It held its own eleven-name copy while utils/roles.js had twelve:
 * `devops` (migration 067) was missing, so every `it.each(ROLES)` below quietly
 * skipped it. A suite whose whole job is "no role is missing from a list" was
 * itself missing a role from its list.
 */
const ROLES = SHARED_ROLES;

const PERMISSIONS = read("src/utils/permissions.js");
// The ranks moved out of permissions.js into a pure module so the SERVER can
// import them too — provision/route.js kept its own stale copy and could not
// create a login for designer/qa/finance as a result.
const ROLES_MODULE = read("src/utils/roles.js");
const NAV = read("src/components/shell/navConfig.js");
const ORGMGMT = read("src/components/admin/OrganizationManagement.jsx");
const MIGRATION = read("database/058_software_house_roles.sql");

/**
 * The role CHECK constraint is redefined by whichever migration last touched
 * it, and that is NOT always 058.
 *
 * This suite used to read 058 alone and enumerate eleven roles. `devops` came
 * in migration 067, and because the local role list was also missing it, the
 * assertion below never ran for the one role it would have failed on. Two
 * stale copies covering for each other.
 *
 * So: find every migration that redefines the constraint and take the
 * highest-numbered one, which is the definition actually in force.
 */
const ROLE_CHECK_MIGRATION = (() => {
  const dir = path.join(root, "database");
  const files = readdirSync(dir)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .sort()
    .reverse();
  for (const f of files) {
    const src = readFileSync(path.join(dir, f), "utf8");
    if (/check\s*\(\s*role\s+in\s*\(/i.test(src) || /'owner'\s*,\s*'admin'/.test(src)) {
      return { name: f, src };
    }
  }
  throw new Error("no migration defines the role CHECK constraint");
})();

describe("every role exists in every list that decides anything", () => {
  it.each(ROLES)("roles.js ranks %s", (role) => {
    expect(ROLES_MODULE).toMatch(new RegExp(`\\b${role}:\\s*\\d+`));
  });

  it.each(ROLES)("roles.js lists %s in ROLES", (role) => {
    expect(ROLES_MODULE).toContain(`"${role}"`);
  });

  it("keeps ONE definition — permissions.js must not redeclare the ranks", () => {
    expect(PERMISSIONS).not.toMatch(/const ROLE_RANK = \{/);
    expect(PERMISSIONS).toContain('from "@/utils/roles"');
  });

  it("the server route must not keep its own copy either", () => {
    const provision = read("src/app/api/auth/provision/route.js");
    expect(provision).not.toMatch(/const ROLE_RANK = \{/);
    expect(provision).toContain('from "@/utils/roles"');
  });

  /**
   * THE PICKER NO LONGER HOLDS A LIST, which is why this stopped being a
   * string search. It used to keep its own copy of the roles, ordered by rank,
   * and that copy was missing `devops` — so a DevOps engineer could hold a
   * role the CHECK constraint allows and be un-invitable, because the one
   * dropdown that grants roles had never heard of them.
   *
   * It now maps over the imported ROLES, so "offers every role" is structural
   * rather than something to re-check per role. These two assertions are what
   * keep it that way.
   */
  it("the member role picker maps over the shared list rather than its own", () => {
    expect(ORGMGMT).toContain('import { ROLES } from "@/utils/roles"');
    expect(ORGMGMT).toMatch(/ROLES\.filter\(\(r\) => r !== "owner"\)\.map\(/);
  });

  it("the member role picker keeps no local copy of the roles", () => {
    expect(ORGMGMT).not.toMatch(/const ROLES\s*=\s*\[/);
  });

  it.each(ROLES)("the database CHECK constraint accepts %s", (role) => {
    expect(ROLE_CHECK_MIGRATION.src, `${role} missing from ${ROLE_CHECK_MIGRATION.name}`)
      .toContain(`'${role}'`);
  });

  it("ranks them strictly highest-to-lowest with no accidental ties", () => {
    const ranks = Object.fromEntries(
      [...ROLES_MODULE.matchAll(/^\s*(\w+):\s*(\d+),/gm)].map((m) => [m[1], Number(m[2])])
    );
    expect(ranks.owner).toBeGreaterThan(ranks.admin);
    expect(ranks.admin).toBeGreaterThan(ranks.manager);
    expect(ranks.manager).toBeGreaterThan(ranks.hr);
    expect(ranks.hr).toBeGreaterThan(ranks.finance);
    expect(ranks.finance).toBeGreaterThan(ranks.team_lead);
    expect(ranks.team_lead).toBeGreaterThan(ranks.qa);
    expect(ranks.qa).toBeGreaterThan(ranks.developer);
    expect(ranks.employee).toBeGreaterThan(ranks.client);
  });

  it("puts designer on the SAME tier as developer, deliberately", () => {
    const ranks = Object.fromEntries(
      [...ROLES_MODULE.matchAll(/^\s*(\w+):\s*(\d+),/gm)].map((m) => [m[1], Number(m[2])])
    );
    // atLeast("developer") must be true for a designer — they do the same
    // work with the same access.
    expect(ranks.designer).toBe(ranks.developer);
  });
});

describe("finance sees money and NOT monitoring", () => {
  it("reaches billing and clients in the sidebar", () => {
    expect(canAccessAdminSection("billing", "finance")).toBe(true);
    expect(canAccessAdminSection("clients", "finance")).toBe(true);
  });

  it("does NOT reach developer activity, employees or reports", () => {
    for (const section of ["developer-activity", "team-stats", "employees", "reports"]) {
      expect(canAccessAdminSection(section, "finance"), section).toBe(false);
    }
  });

  it("is not in the people-signal audience", () => {
    const signals = read("src/utils/signals.js");
    const m = signals.match(/ALL_PEOPLE_ROLES\s*=\s*\[([^\]]*)\]/);
    expect(m?.[1]).not.toContain("finance");
  });

  it("can act on billing in the API layer", () => {
    // billing/subscription now asks for the permission; billing/access still
    // names finance inline, and both must keep admitting them.
    expect(read("src/app/api/billing/subscription/route.js"))
      .toContain('requirePermission(auth, "billing.view")');
    expect(roleCan("finance", "billing.view")).toBe(true);
    expect(read("src/app/api/billing/access/route.js")).toContain('"finance"');
  });

  it("still cannot buy, cancel or open the Stripe portal", () => {
    // Checkout, cancel and portal are owner-only in every route that does
    // them. `billing.manage` includes finance, so those three got their own
    // key rather than being folded in — mapping them to billing.manage would
    // have handed an accountant the power to cancel the company's plan.
    expect(roleCan("finance", "billing.purchase")).toBe(false);
    expect(roleCan("admin", "billing.purchase")).toBe(false);
    expect(roleCan("owner", "billing.purchase")).toBe(true);
  });

  it("gets billing capabilities but not oversight ones", () => {
    // Asked of the resolver rather than of the source text. The capability
    // groups this used to grep for moved into the catalogue, and a test that
    // reads the file the rules live in only ever proves they are written down.
    expect(roleCan("finance", "billing.view")).toBe(true);
    expect(roleCan("finance", "billing.manage")).toBe(true);
    // The whole reason the role exists: money WITHOUT the monitoring surface.
    // Before it, an accountant had to be made admin to read an invoice, which
    // also handed them every employee's screen captures.
    for (const denied of [
      "monitoring.view",
      "report.view",
      "task.manage",
      "member.manage",
      "project.view_all",
    ]) {
      expect(roleCan("finance", denied), denied).toBe(false);
    }
  });
});

describe("qa can review, and that is the point of it", () => {
  it("is a reviewer in the shared capability module", () => {
    expect(defaultRolesFor("task.review")).toContain("qa");
    expect(roleCan("qa", "task.review")).toBe(true);
  });

  it("is a reviewer in both review routes", () => {
    // Both routes ask for the permission now instead of listing roles.
    for (const route of ["src/app/api/admin-review/route.js", "src/app/api/task-plan/review/route.js"]) {
      expect(read(route), route).toContain('requirePermission(auth, "task.review")');
    }
    expect(roleCan("qa", "task.review")).toBe(true);
  });

  it("reaches the task-reviews section", () => {
    expect(canAccessAdminSection("task-reviews", "qa")).toBe(true);
  });

  it("does NOT get the rest of the oversight surface", () => {
    // Reviewing is the job. It does not come with project administration,
    // reports, monitoring or money.
    for (const denied of [
      "task.manage",
      "report.view",
      "monitoring.view",
      "automation.manage",
      "billing.view",
      "project.view_all",
    ]) {
      expect(roleCan("qa", denied), denied).toBe(false);
    }
    for (const section of ["developer-activity", "automation", "billing"]) {
      expect(canAccessAdminSection(section, "qa"), section).toBe(false);
    }
  });
});

describe("designer and qa can file work like a developer", () => {
  it("both may submit a task", () => {
    for (const role of ["designer", "qa", "developer", "devops", "employee", "team_lead"]) {
      expect(roleCan(role, "task.submit"), role).toBe(true);
    }
  });
});

describe("designer is honestly documented as permission-identical", () => {
  it("says so where someone would look", () => {
    const raw = readFileSync(path.join(root, "src/utils/permissions.js"), "utf8");
    expect(raw).toMatch(/designer[\s\S]{0,200}(identical|NO difference)/i);
  });
});

describe("the migration does not quietly change anyone else", () => {
  it("adds finance only to the three billing surfaces", () => {
    // Anything else mentioning finance would be scope creep in a migration
    // whose whole claim is that it changes nothing for existing roles.
    const tables = [...MIGRATION.matchAll(/on public\.(\w+)/g)].map((m) => m[1]);
    const financeTables = new Set(
      tables.filter((t) =>
        ["invoices", "organization_subscriptions", "billing_invoices"].includes(t)
      )
    );
    expect(financeTables.size).toBe(3);
    for (const t of tables) {
      expect(
        ["invoices", "organization_subscriptions", "billing_invoices"].includes(t),
        `unexpected table touched: ${t}`
      ).toBe(true);
    }
  });

  it("creates the invoices policy additively rather than rewriting an unknown name", () => {
    // The staff policy on `invoices` did not appear in either pg_policies dump
    // from the live project, so its name is not known here. Guessing it and
    // rewriting would leave the original in place beside the new one.
    expect(MIGRATION).toContain("invoices_finance_all");
    expect(MIGRATION).not.toMatch(/drop policy if exists invoices_staff/);
  });

  it("is re-runnable", () => {
    const creates = [...MIGRATION.matchAll(/create policy (\w+)/g)].map((m) => m[1]);
    for (const name of creates) {
      expect(MIGRATION, `${name} has no matching drop`).toContain(
        `drop policy if exists ${name}`
      );
    }
  });
});

describe("widening the rank scale must not break the fail-closed guard", () => {
  it("keeps unknown roles unreachable regardless of how the numbers are chosen", () => {
    // Regression: `atLeast` used to default an unknown TARGET to 99, which was
    // above every real rank only because the highest was 8. Adding finance and
    // qa widened the scale, owner became 100, and atLeast("superadmin")
    // flipped from false to true — a fail-OPEN. The sentinels are now
    // ±Infinity so no renumbering can overtake them.
    expect(PERMISSIONS).not.toMatch(/ROLE_RANK\[role\]\s*\|\|\s*\d+/);
    expect(PERMISSIONS).toContain("POSITIVE_INFINITY");
    expect(PERMISSIONS).toContain("NEGATIVE_INFINITY");
  });
});

describe("every role can actually be given a login", () => {
  const provision = read("src/app/api/auth/provision/route.js");

  it("resolves the profile table from the ROLE, not a caller-supplied hint", () => {
    // Asking for role "client" while claiming userType "developer" must not
    // write a developer seat carrying a client's rank.
    expect(provision).toContain("userTypeForRole(requestedRole)");
    expect(provision).toContain("PROFILE_TABLE[resolvedUserType]");
  });

  it("can provision a client, not just admins and developers", () => {
    expect(provision).not.toMatch(/userType === "admin" \? "admin_users" : "developers"/);
    expect(read("src/utils/roles.js")).toContain('client: "clients"');
  });

  it("lets managers and HR provision as well as owner/admin", () => {
    const m = provision.match(/PROVISIONER_ROLES\s*=\s*\[([^\]]*)\]/);
    for (const role of ["owner", "admin", "hr", "manager"]) {
      expect(m?.[1], role).toContain(role);
    }
  });

  it("distinguishes rank 0 from an unknown role", () => {
    // `ROLE_RANK[x] || 0` folded "unknown" and "lowest" together; rankOf()
    // returns null for unknown so the 400 still fires but a real role never
    // trips it.
    expect(provision).toContain("rankOf(");
    expect(provision).toContain("=== null");
  });
});

describe("seat metering knows about the new roles", () => {
  const ENT = read("src/utils/entitlements.js");

  it("charges designer and qa as delivery seats", () => {
    const m = ENT.match(/SEAT_RESOURCES_BY_ROLE\s*=\s*\{([\s\S]*?)\n\};/);
    expect(m?.[1]).toMatch(/designer:\s*\["employees", "developers"\]/);
    expect(m?.[1]).toMatch(/qa:\s*\["employees", "developers"\]/);
  });

  it("charges finance as an office seat", () => {
    const m = ENT.match(/SEAT_RESOURCES_BY_ROLE\s*=\s*\{([\s\S]*?)\n\};/);
    expect(m?.[1]).toMatch(/finance:\s*\["employees"\]/);
  });

  it("still does not meter clients", () => {
    const m = ENT.match(/SEAT_RESOURCES_BY_ROLE\s*=\s*\{([\s\S]*?)\n\};/);
    expect(m?.[1]).toMatch(/client:\s*\[\]/);
  });
});
