import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The eleven roles.
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

const ROLES = [
  "owner", "admin", "manager", "hr", "finance",
  "team_lead", "qa", "developer", "designer", "employee", "client",
];

const PERMISSIONS = read("src/utils/permissions.js");
const NAV = read("src/components/shell/navConfig.js");
const ORGMGMT = read("src/components/admin/OrganizationManagement.jsx");
const MIGRATION = read("database/058_software_house_roles.sql");

describe("every role exists in every list that decides anything", () => {
  it.each(ROLES)("permissions.js ranks %s", (role) => {
    expect(PERMISSIONS).toMatch(new RegExp(`\\b${role}:\\s*\\d+`));
  });

  it.each(ROLES)("the member role picker offers %s", (role) => {
    expect(ORGMGMT).toContain(`"${role}"`);
  });

  it.each(ROLES)("the database CHECK constraint accepts %s", (role) => {
    expect(MIGRATION).toContain(`'${role}'`);
  });

  it("ranks them strictly highest-to-lowest with no accidental ties", () => {
    const ranks = Object.fromEntries(
      [...PERMISSIONS.matchAll(/^\s*(\w+):\s*(\d+),/gm)].map((m) => [m[1], Number(m[2])])
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
      [...PERMISSIONS.matchAll(/^\s*(\w+):\s*(\d+),/gm)].map((m) => [m[1], Number(m[2])])
    );
    // atLeast("developer") must be true for a designer — they do the same
    // work with the same access.
    expect(ranks.designer).toBe(ranks.developer);
  });
});

describe("finance sees money and NOT monitoring", () => {
  it("reaches billing and clients in the sidebar", () => {
    expect(NAV).toMatch(/billing:\s*\[[^\]]*"finance"/);
    expect(NAV).toMatch(/clients:\s*\[[^\]]*"finance"/);
  });

  it("does NOT reach developer activity, employees or reports", () => {
    for (const section of ["developer-activity", '"team-stats"', "employees", "reports"]) {
      const m = NAV.match(new RegExp(`${section.replace(/"/g, '"?')}:\\s*\\[([^\\]]*)\\]`));
      if (m) expect(m[1], section).not.toContain("finance");
    }
  });

  it("is not in the people-signal audience", () => {
    const signals = read("src/utils/signals.js");
    const m = signals.match(/ALL_PEOPLE_ROLES\s*=\s*\[([^\]]*)\]/);
    expect(m?.[1]).not.toContain("finance");
  });

  it("can act on billing in the API layer", () => {
    expect(read("src/app/api/billing/subscription/route.js")).toContain('"finance"');
    expect(read("src/app/api/billing/access/route.js")).toContain('"finance"');
  });

  it("gets billing capabilities but not oversight ones", () => {
    const billing = PERMISSIONS.match(/const BILLING\s*=\s*\[([^\]]*)\]/);
    const supervisors = PERMISSIONS.match(/const SUPERVISORS\s*=\s*\[([^\]]*)\]/);
    const people = PERMISSIONS.match(/const PEOPLE_MANAGERS\s*=\s*\[([^\]]*)\]/);
    expect(billing?.[1]).toContain("finance");
    expect(supervisors?.[1]).not.toContain("finance");
    expect(people?.[1]).not.toContain("finance");
  });
});

describe("qa can review, and that is the point of it", () => {
  it("is a reviewer in the shared capability module", () => {
    const reviewers = PERMISSIONS.match(/const REVIEWERS\s*=\s*\[([^\]]*)\]/);
    expect(reviewers?.[1]).toContain("qa");
  });

  it("is a reviewer in both review routes", () => {
    expect(read("src/app/api/admin-review/route.js")).toContain("'qa'");
    expect(read("src/app/api/task-plan/review/route.js")).toContain("'qa'");
  });

  it("reaches the task-reviews section", () => {
    const m = NAV.match(/"task-reviews":\s*\[([^\]]*)\]/);
    expect(m?.[1]).toContain("qa");
  });

  it("does NOT get the rest of the oversight surface", () => {
    const supervisors = PERMISSIONS.match(/const SUPERVISORS\s*=\s*\[([^\]]*)\]/);
    expect(supervisors?.[1]).not.toContain("qa");
    for (const section of ["developer-activity", "automation", "billing"]) {
      const m = NAV.match(new RegExp(`"?${section}"?:\\s*\\[([^\\]]*)\\]`));
      if (m) expect(m[1], section).not.toContain("qa");
    }
  });
});

describe("designer and qa can file work like a developer", () => {
  it("both may submit a task", () => {
    const m = PERMISSIONS.match(/case "submit_task":\s*\n\s*return \[([^\]]*)\]/);
    expect(m?.[1]).toContain("designer");
    expect(m?.[1]).toContain("qa");
    expect(m?.[1]).toContain("developer");
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
