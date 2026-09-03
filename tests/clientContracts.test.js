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
 * Client contracts, milestones and amendments — migration 092.
 *
 * The commercial chain was complete at both ends and empty in the middle. A
 * client could raise a proposal (014), the work could be planned, tracked,
 * approved and invoiced (079) — and nothing recorded what had actually been
 * AGREED. The invoice was the first written commitment in the entire system,
 * which is the wrong way round: an invoice is a consequence of a contract, not
 * a substitute for one.
 *
 * THE RULE THIS MODULE TURNS ON: a signed contract's terms cannot be edited.
 * They can be AMENDED, which is a different thing — the previous value is
 * written down and stays visible. "What did we agree, and when did it change"
 * is the question every commercial dispute turns on, and a record that can be
 * edited in place cannot answer it.
 */

const root = path.resolve(__dirname, "..");
const raw = (p) => readFileSync(path.join(root, p), "utf8");
const read = (p) =>
  raw(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const readSql = (p) => raw(p).replace(/^\s*--.*$/gm, "");

const MIGRATION = "database/092_client_contracts.sql";
const ROUTE = "src/app/api/contracts/route.js";
const SCREEN = "src/components/admin/Contracts.jsx";

describe("the keys narrow, and the narrowing is the design", () => {
  it("lets a manager read and not write", () => {
    // Delivering against a contract means knowing what it says. Committing the
    // company to a number is a different act.
    expect(defaultRolesFor("contract.view")).toContain("manager");
    expect(defaultRolesFor("contract.manage")).not.toContain("manager");
    expect(defaultRolesFor("contract.amend")).not.toContain("manager");
  });

  it("keeps amending narrower than drafting", () => {
    expect([...defaultRolesFor("contract.manage")].sort()).toEqual(
      ["owner", "admin", "finance"].sort()
    );
    expect([...defaultRolesFor("contract.amend")].sort()).toEqual(["owner", "admin"].sort());
    // finance may sign a contract and may not rewrite one already signed
    expect(defaultRolesFor("contract.amend")).not.toContain("finance");
  });

  it("gives a client no staff key", () => {
    expect(permissionsForRole("client")).toEqual([]);
  });
});

describe("a signed contract's terms are frozen", () => {
  const sql = readSql(MIGRATION);
  const start = sql.indexOf("function public.contract_terms_frozen");
  const fn = sql.slice(start, sql.indexOf("$$;", start));

  it("freezes in the database, not in the route", () => {
    // `contracts` is reachable from the browser through PostgREST like every
    // other table here, so a rule enforced in a route is advisory.
    expect(sql).toMatch(/create trigger trg_contract_terms_frozen/);
    expect(sql).toMatch(/on public\.contracts/);
  });

  it("leaves an unsigned contract editable", () => {
    // A draft is edited, not amended. Writing amendment rows for a draft would
    // put noise in the log that matters.
    expect(fn).toMatch(/if old\.status in \('draft','sent'\) then\s*\n\s*return new;/);
  });

  it("guards exactly the four commercial terms", () => {
    for (const field of ["value", "contract_type", "start_date", "end_date"]) {
      expect(fn, field).toContain(`new.${field}`);
    }
    // status is deliberately NOT frozen — a contract has to be able to become
    // active, completed or terminated after it is signed.
    expect(fn).not.toMatch(/new\.status\s+is distinct from\s+old\.status/);
  });

  it("requires an amendment row for each field that changed", () => {
    expect(fn).toMatch(/from public\.contract_amendments a/);
    expect(fn).toMatch(/a\.field\s+= f/);
    expect(fn).toMatch(/raise exception/);
  });

  it("will not accept a stale amendment as authorisation", () => {
    // Without a recency bound, one amendment from last year would authorise
    // every silent edit since.
    expect(fn).toMatch(/a\.created_at >= now\(\) - interval '10 seconds'/);
  });

  it("writes the amendment BEFORE the update, because the trigger looks for it", () => {
    const route = read(ROUTE);
    const amend = route.slice(route.indexOf("if (body?.amend)"));
    expect(amend.indexOf('from("contract_amendments")')).toBeLessThan(
      amend.indexOf('from("contracts")')
    );
    // and it records what the value WAS, read back from the row
    expect(amend).toMatch(/previous_value: existing\[field\] === null \? null : String\(existing\[field\]\)/);
  });

  it("refuses to amend something that is not signed yet", () => {
    expect(read(ROUTE)).toMatch(/not signed yet — edit it instead/);
  });

  it("asks for contract.amend on the amend path, not contract.manage", () => {
    // Mutation testing caught this: the catalogue's role sets were asserted and
    // the ROUTE's choice of key was not, so swapping in contract.manage — which
    // would have handed finance the ability to rewrite a signed contract —
    // stayed green.
    const route = read(ROUTE);
    const amend = route.slice(route.indexOf("if (body?.amend)"));
    expect(amend).toMatch(/requirePermission\(auth, "contract\.amend"\)/);
    // and the key is asked before anything is written
    expect(amend.indexOf('"contract.amend"')).toBeLessThan(
      amend.indexOf('from("contract_amendments")')
    );
  });

  it("keeps the amendment log append-only", () => {
    // A log that can be edited answers nothing at all.
    expect(sql).toMatch(/create policy amendments_insert on public\.contract_amendments\s*\n\s*for insert/);
    expect(sql).not.toMatch(/create policy[^;]*contract_amendments[^;]*for all/);
  });

  it("shows the history on the screen rather than burying it", () => {
    expect(read(SCREEN)).toMatch(/Amendments/);
    expect(read(SCREEN)).toMatch(/a\.previous_value/);
  });
});

describe("a commitment always has a moment and an invoice always has a bill", () => {
  const sql = readSql(MIGRATION);

  it("will not let a contract be signed without a date", () => {
    // Every status past 'sent' is a claim that somebody agreed, and a claim
    // with no date behind it is what a dispute exposes.
    expect(sql).toMatch(/constraint contracts_signed_has_date check \(/);
    expect(sql).toMatch(/status in \('draft','sent'\) or signed_at is not null/);
  });

  it("stamps the moment server-side, not from the body", () => {
    const route = read(ROUTE);
    expect(route).toMatch(/patch\.signed_at = now/);
    expect(route).not.toMatch(/signed_at: body/);
  });

  it("will not let a milestone be invoiced with no invoice", () => {
    expect(sql).toMatch(/constraint milestone_invoiced_has_invoice check \(/);
    expect(sql).toMatch(/status <> 'invoiced' or invoice_id is not null/);
    expect(read(ROUTE)).toMatch(/needs the invoice it went on/);
  });

  it("keeps the milestone when its invoice is deleted", () => {
    // The milestone is a thing that was agreed; the invoice is a thing that was
    // sent. Cascading would delete the agreement along with the paperwork.
    expect(sql).toMatch(/invoice_id\s+uuid references public\.invoices\(id\) on delete set null/);
  });

  it("picks the invoice rather than asking somebody to paste a uuid", () => {
    // The same mistake was made and removed in 090's screen; a prompt asking
    // for an id is not a picker.
    expect(read(SCREEN)).not.toMatch(/window\.prompt/);
    expect(read(SCREEN)).toMatch(/askForInvoice/);
  });
});

describe("the milestone gap is shown, not enforced", () => {
  const sql = readSql(MIGRATION);

  it("computes it and refuses nothing", () => {
    const view = sql.slice(sql.indexOf("create or replace view public.contract_summary_v"));
    expect(view).toMatch(/as milestone_gap/);
    expect(sql).not.toMatch(/sum\(m\.amount\)[^;]*=\s*c\.value/);
  });

  it("returns NULL where the contract value is unknown", () => {
    // A gap from an unknown total is not zero.
    const view = sql.slice(sql.indexOf("create or replace view public.contract_summary_v"));
    expect(view).toMatch(/when c\.value is null then null/);
  });

  it("renders the three states differently on screen", () => {
    const screen = read(SCREEN);
    expect(screen).toMatch(/gap === null \|\| gap === undefined/);
    expect(screen).toMatch(/Number\(gap\) === 0/);
  });
});

describe("a client reads their own contract", () => {
  const sql = readSql(MIGRATION);

  it("grants it on the project they are party to", () => {
    // They signed it. 014 already lets them see their projects and 079 the
    // lines of their own invoice; a contract they are party to is the least
    // surprising of the three.
    const policy = sql.slice(
      sql.indexOf("create policy contracts_read"),
      sql.indexOf(";", sql.indexOf("create policy contracts_read"))
    );
    expect(policy).toMatch(/public\.auth_is_client\(\)/);
    expect(policy).toMatch(/public\.auth_client_project_ids\(\)/);
  });

  it("does not let them write anything", () => {
    for (const name of ["contracts_write", "milestones_write", "amendments_insert"]) {
      const from = sql.indexOf(`create policy ${name}`);
      expect(from, name).toBeGreaterThan(-1);
      const policy = sql.slice(from, sql.indexOf(";", from));
      expect(policy, name).toMatch(/not public\.auth_is_client\(\)/);
    }
  });
});

describe("the screen is wired and gated", () => {
  const adminSrc = read("src/app/admin/dashboard/page.js");

  it("renders and titles the section", () => {
    expect(adminSrc).toContain('case "contracts":');
    expect(adminSrc).toMatch(/import Contracts from "@\/components\/admin\/Contracts"/);
    expect(SECTION_TITLES.contracts.admin).toBeTruthy();
  });

  it("offers it to the four roles that may read a contract", () => {
    for (const role of ["owner", "admin", "manager", "finance"]) {
      expect(adminNavFor(role).map((i) => i.id), role).toContain("contracts");
    }
    for (const role of ["hr", "qa", "team_lead"]) {
      expect(canAccessAdminSection("contracts", role), role).toBe(false);
    }
  });

  it("admits nobody new to the admin area", () => {
    expect(NON_WIDENING_SECTIONS).not.toContain("contracts");
    expect(SECTION_PERMISSIONS.contracts).toBe("contract.view");
    expect([...ADMIN_AREA_ROLES].sort()).toEqual(
      ["admin", "finance", "hr", "manager", "owner", "qa", "team_lead"].sort()
    );
  });
});

describe("the migration keeps its RLS in step with the catalogue", () => {
  const sql = readSql(MIGRATION);

  it("uses the catalogue's three role lists", () => {
    expect(sql).toMatch(/in \('owner','admin','manager','finance'\)/);
    expect(sql).toMatch(/in \('owner','admin','finance'\)/);
    expect(sql).toMatch(/in \('owner','admin'\)/);
    expect([...defaultRolesFor("contract.view")].sort()).toEqual(
      ["owner", "admin", "manager", "finance"].sort()
    );
  });

  it("puts the billing lock on writes and not on reads", () => {
    const withChecks = sql.match(/with check\s*\([\s\S]*?\);/g) || [];
    expect(withChecks.length).toBe(3);
    for (const w of withChecks) expect(w).toContain("public.auth_org_unlocked()");
    const reads = sql.match(/for select to authenticated[\s\S]*?;/g) || [];
    for (const r of reads) expect(r).not.toContain("auth_org_unlocked");
  });

  it("makes the view read as the caller", () => {
    expect(sql).toMatch(
      /create or replace view public\.contract_summary_v\s*\n\s*with \(security_invoker = true\)/
    );
  });

  it("is additive", () => {
    expect(sql).not.toMatch(/drop\s+table/i);
    expect(sql).not.toMatch(/truncate/i);
    expect(sql).not.toMatch(/delete\s+from/i);
  });
});
