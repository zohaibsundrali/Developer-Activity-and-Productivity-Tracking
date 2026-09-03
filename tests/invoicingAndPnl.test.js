import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  SECTION_PERMISSIONS,
  NON_WIDENING_SECTIONS,
  ADMIN_AREA_ROLES,
  canAccessAdminSection,
} from "@/components/shell/sectionAccess";
import { adminNavFor } from "@/components/shell/navConfig";
import { SECTION_TITLES } from "@/components/shell/sectionTitles";
import { defaultRolesFor, permissionsForRole } from "@/utils/permissionCatalogue";

/**
 * Invoicing from approved hours, and project P&L — migration 079.
 *
 * WHAT THIS JOINS UP. `invoices` has existed since 014 with a single `amount`
 * column typed by hand, so a bill could say $4,000 and nothing could say what
 * for. 077 made hours agreeable — submitted, approved, locked. This is the
 * join: a line is "40 approved billable hours, week of 31 Aug", and the number
 * follows from the work.
 *
 * THE THREE THINGS THESE TESTS HOLD:
 *   1. the browser never prices anything — hours and rates are read back
 *      server-side, because `invoices` is reachable through PostgREST;
 *   2. the same hours cannot be billed onto two live invoices, and voiding an
 *      invoice releases them;
 *   3. no rate is ever invented, and an unpriced week is refused rather than
 *      billed at zero.
 */

const root = path.resolve(__dirname, "..");
const raw = (p) => readFileSync(path.join(root, p), "utf8");
const read = (p) =>
  raw(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const readSql = (p) => raw(p).replace(/^\s*--.*$/gm, "");

const MIGRATION = "database/079_invoicing_and_pnl.sql";
const ROUTE = "src/app/api/invoicing/route.js";
const SCREEN = "src/components/admin/Invoicing.jsx";
const BILLING = ["owner", "admin", "finance"];

describe("the keys the feature introduced", () => {
  it("puts client invoicing with the money roles", () => {
    for (const key of ["invoice.view", "invoice.manage", "pnl.view"]) {
      expect([...defaultRolesFor(key)].sort(), key).toEqual([...BILLING].sort());
    }
  });

  it("keeps P&L away from managers, because cost is pay", () => {
    // Cost is hours x employee_profiles.cost_rate — what a person is paid,
    // spread over an hour. A manager wanting their project's margin is fair; it
    // does not outweigh their team's pay staying private, and there is no way
    // to show one without the other while cost is computed per person.
    expect(defaultRolesFor("pnl.view")).not.toContain("manager");
    expect(defaultRolesFor("pnl.view")).not.toContain("team_lead");
    expect(defaultRolesFor("pnl.view")).not.toContain("hr");
  });

  it("does not reuse the subscription billing keys for client invoices", () => {
    // `billing.*` is what this organization pays US. `invoice.*` is what this
    // organization bills its own clients. One key for both would make "can see
    // billing" mean two unrelated things.
    expect(SECTION_PERMISSIONS.billing).toBe("billing.view");
    expect(SECTION_PERMISSIONS.invoicing).toBe("invoice.view");
    expect(SECTION_PERMISSIONS.invoicing).not.toBe(SECTION_PERMISSIONS.billing);
  });

  it("gives a client none of it", () => {
    expect(permissionsForRole("client")).toEqual([]);
  });
});

describe("nothing invents a price", () => {
  const sql = readSql(MIGRATION);
  const route = read(ROUTE);

  it("adds the three rate columns with no default", () => {
    for (const col of ["bill_rate", "default_bill_rate", "cost_rate"]) {
      expect(sql, col).toMatch(new RegExp(`add column if not exists ${col} numeric`));
    }
    // A DEFAULT here would price every project in the system at once.
    expect(sql).not.toMatch(/add column if not exists (bill_rate|default_bill_rate|cost_rate)[^;]*default \d/i);
  });

  it("resolves a rate in one place, most specific first", () => {
    expect(sql).toMatch(/create or replace function public\.bill_rate_for/);
    const fn = sql.slice(sql.indexOf("function public.bill_rate_for"));
    // member rate is looked up before the project default
    expect(fn.indexOf("pm.bill_rate")).toBeLessThan(fn.indexOf("default_bill_rate"));
  });

  it("refuses an unpriced week instead of billing it at zero", () => {
    // A line at 0.00 is an invoice that quietly gives work away, and it looks
    // identical to one that was meant to.
    expect(route).toMatch(/row\.rate == null/);
    expect(route).toMatch(/No rate is set for/);
  });

  it("shows unpriced hours rather than hiding them", () => {
    // Somebody worked them. Hiding them because nobody set a price is how work
    // goes unbilled quietly.
    const screen = read(SCREEN);
    expect(screen).toMatch(/rate not set/);
    expect(screen).toMatch(/unpricedCount/);
  });
});

describe("the browser does not price anything", () => {
  const route = read(ROUTE);
  const screen = read(SCREEN);

  it("reads hours and rate back from the view, not from the body", () => {
    expect(route).toMatch(/from\("billable_hours_v"\)/);
    expect(route).toMatch(/const hours = Number\(row\.hours\)/);
    expect(route).toMatch(/const rate = Number\(row\.rate\)/);
    expect(route).not.toMatch(/body\?\.hours/);
    expect(route).not.toMatch(/body\?\.rate/);
    expect(route).not.toMatch(/sel\?\.rate/);
    expect(route).not.toMatch(/sel\?\.hours/);
  });

  it("sends only which weeks to bill", () => {
    const post = screen.slice(screen.indexOf("const raise"));
    expect(post).toMatch(/userId: r\.user_id/);
    expect(post).toMatch(/weekStart: r\.week_start/);
    expect(post).not.toMatch(/rate:/);
    expect(post).not.toMatch(/hours:/);
    expect(post).not.toMatch(/amount:/);
  });

  it("confirms the project belongs to this organization first", () => {
    expect(route).toMatch(/from\("projects"\)[\s\S]{0,200}eq\("organization_id", auth\.orgId\)/);
  });

  it("validates every selection before it reaches a query", () => {
    expect(route).toMatch(/UUID_RE\.test\(userId\)/);
    expect(route).toMatch(/DATE_RE\.test\(week\)/);
  });

  it("refuses the whole request when a chosen week is gone", () => {
    // An invoice missing a week somebody selected is worse than an error
    // saying so.
    expect(route).toMatch(/no longer available to bill/);
    expect(route).toMatch(/status: 409/);
  });

  it("gates P&L on its own key, not on invoice.view", () => {
    expect(route).toMatch(/view === "pnl" \? "pnl\.view" : "invoice\.view"/);
  });
});

describe("the same hours cannot be billed twice", () => {
  const sql = readSql(MIGRATION);

  /**
   * BOUNDED TO THE FUNCTION BODY, and that is not fussiness.
   *
   * The first version of these assertions sliced from the function name to the
   * end of the file. `billable_hours_v` also tests `i.status <> 'void'`, a few
   * hundred lines further down — so deleting the void check from the GUARD left
   * the assertion passing on the VIEW's copy of the same string. Mutation
   * testing caught it: that mutation was the only survivor of eleven.
   */
  const guardBody = (() => {
    const from = sql.indexOf("function public.invoice_line_not_already_billed");
    const end = sql.indexOf("$$;", from);
    expect(end).toBeGreaterThan(from);
    return sql.slice(from, end);
  })();

  it("guards on the person-week-project grain the view produces", () => {
    for (const col of ["organization_id", "project_id", "user_id", "week_start"]) {
      expect(guardBody, col).toContain(`il.${col}`);
    }
  });

  it("ignores voided invoices, so voiding releases the hours", () => {
    expect(guardBody).toMatch(/i\.status\s*<>\s*'void'/);
  });

  it("agrees with the view, which must release the same hours", () => {
    // If the guard excluded voided invoices and the view did not, released
    // hours would be billable-in-principle and refused in practice.
    const from = sql.indexOf("create or replace view public.billable_hours_v");
    const view = sql.slice(from, sql.indexOf(";", sql.indexOf("group by", from)));
    expect(view).toMatch(/i\.status\s*<>\s*'void'/);
  });

  it("is a trigger and not an index, and says why", () => {
    // An index predicate must be immutable and may not contain a subquery, so
    // it cannot see the invoice's status. This is asserted so the next person
    // does not "fix" it into an index that silently drops the void rule.
    expect(sql).toMatch(/create trigger trg_invoice_line_not_billed/);
    // The comment wraps across lines and the `--  ` prefix sits in the middle
    // of the sentence, so the prose is flattened before matching. Asserting the
    // raw text would pass or fail on where the line happened to break.
    const prose = raw(MIGRATION).replace(/^\s*--/gm, "").replace(/\s+/g, " ");
    expect(prose).toMatch(/may not contain a subquery/);
  });

  it("makes a timesheet line name the hours it bills", () => {
    // Otherwise the guard compares three nulls against three nulls.
    expect(sql).toMatch(/constraint invoice_line_timesheet_identified/);
    expect(sql).toMatch(/source <> 'timesheet'\s*\n\s*or \(project_id is not null and user_id is not null and week_start is not null\)/);
  });

  it("removes the header when its lines fail, rather than leaving a bare amount", () => {
    const route = read(ROUTE);
    expect(route).toMatch(/from\("invoices"\)\s*\.delete\(\)\s*\.eq\("id", invoice\.id\)/);
  });
});

describe("only approved hours are billable, and invoices.amount stays true", () => {
  const sql = readSql(MIGRATION);

  it("joins the timesheet and requires approved", () => {
    const view = sql.slice(
      sql.indexOf("create or replace view public.billable_hours_v"),
      sql.indexOf("create or replace view public.project_pnl_v")
    );
    expect(view).toMatch(/t\.status\s*=\s*'approved'/);
    expect(view).toMatch(/l\.is_billable/);
  });

  it("keeps invoices.amount equal to the sum of its lines", () => {
    // The client portal renders `amount`. Lines that disagreed with the total
    // would be worse than no lines at all.
    expect(sql).toMatch(/create trigger trg_invoice_lines_sync/);
    expect(sql).toMatch(/after insert or update or delete/);
  });

  it("leaves an invoice with no lines alone", () => {
    // Every invoice written before today is exactly that.
    const fn = sql.slice(sql.indexOf("function public.invoice_sync_amount"));
    expect(fn).toMatch(/if v_count > 0 then/);
  });

  it("prices a line at the moment it is written", () => {
    // A line that re-prices itself after the invoice was sent is not a record.
    expect(sql).toMatch(/amount\s+numeric\(12,2\) not null/);
    expect(sql).not.toMatch(/generated always as/i);
  });
});

describe("P&L is honest about what it does not know", () => {
  const sql = readSql(MIGRATION);
  const view = sql.slice(sql.indexOf("create or replace view public.project_pnl_v"));

  it("counts revenue as invoiced, not as pipeline", () => {
    expect(view).toMatch(/from public\.invoices/);
    expect(view).toMatch(/status <> 'void'/);
  });

  it("returns NULL cost and NULL margin when no cost rate is set", () => {
    // A margin that treats unpriced people as free is the most misleading
    // number this view could produce.
    expect(view).toMatch(/when h\.cost is null then null/);
  });

  it("shows how much of the hours are actually costed", () => {
    expect(view).toMatch(/costed_hours/);
    expect(view).toMatch(/filter \(where ep\.cost_rate is not null\)/);
  });

  it("names the gap on screen instead of absorbing it", () => {
    const screen = read(SCREEN);
    expect(screen).toMatch(/partial/);
    expect(screen).toMatch(/no cost rates/);
  });
});

describe("a client sees the breakdown of their own bill and nothing else", () => {
  const sql = readSql(MIGRATION);

  it("lets a client read the lines of an invoice on their project", () => {
    // 014 already lets them read the invoice. A total with no breakdown is the
    // complaint this migration exists to answer.
    expect(sql).toMatch(/create policy invoice_lines_client_read/);
    expect(sql).toMatch(/public\.auth_client_project_ids\(\)/);
  });

  it("never puts a cost rate anywhere a client can reach", () => {
    // Bounded to the policy itself. Slicing to end-of-file swept in PART 7's
    // verify queries, which mention cost_rate legitimately — the assertion
    // failed on text that was not the policy.
    const from = sql.indexOf("create policy invoice_lines_client_read");
    const clientPolicy = sql.slice(from, sql.indexOf(";", from));
    expect(clientPolicy).not.toMatch(/cost_rate/);
    expect(clientPolicy).toMatch(/auth_is_client\(\)/);
    // project_pnl_v is the only place cost appears, and no client policy grants it
    expect(sql).not.toMatch(/auth_is_client\(\)[\s\S]{0,200}project_pnl_v/);
  });

  it("scopes staff writes to the money roles and the billing lock", () => {
    const staff = sql.slice(sql.indexOf("create policy invoice_lines_staff"));
    expect(staff.slice(0, 800)).toMatch(/in \('owner','admin','finance'\)/);
    expect(staff.slice(0, 800)).toContain("public.auth_org_unlocked()");
  });

  it("is additive", () => {
    expect(sql).not.toMatch(/drop\s+table/i);
    expect(sql).not.toMatch(/truncate/i);
    expect(sql).not.toMatch(/delete\s+from/i);
  });
});

describe("the screen is wired and gated", () => {
  const adminSrc = read("src/app/admin/dashboard/page.js");

  it("renders and titles the section", () => {
    expect(adminSrc).toContain('case "invoicing":');
    expect(adminSrc).toMatch(/import Invoicing from "@\/components\/admin\/Invoicing"/);
    expect(SECTION_TITLES.invoicing.admin).toBeTruthy();
  });

  it("offers it to the money roles and nobody else", () => {
    for (const role of BILLING) {
      expect(adminNavFor(role).map((i) => i.id), role).toContain("invoicing");
    }
    for (const role of ["manager", "team_lead", "hr", "qa"]) {
      expect(canAccessAdminSection("invoicing", role), role).toBe(false);
    }
  });

  it("is a real screen, so it stays out of the non-widening exemption", () => {
    expect(NON_WIDENING_SECTIONS).not.toContain("invoicing");
  });

  it("admits nobody new to the admin area", () => {
    expect([...ADMIN_AREA_ROLES].sort()).toEqual(
      ["admin", "finance", "hr", "manager", "owner", "qa", "team_lead"].sort()
    );
  });
});
