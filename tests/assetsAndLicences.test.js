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
 * Assets and software licences — migration 090.
 *
 * `employee.onboard` and `employee.activate` have existed since 058, and
 * offboarding has never had anything to hand back. The product could hire a
 * person, review them, pay them and release them, and at no point could it say
 * what they were holding.
 *
 * WHAT THESE TESTS HOLD:
 *   1. an asset and a licence are different SHAPES — one object with one
 *      holder, versus a pool of seats — and stay in different tables;
 *   2. an asset's status and its holder can never contradict each other;
 *   3. over-assignment of seats is RECORDED, not refused;
 *   4. no cost is invented, anywhere.
 */

const root = path.resolve(__dirname, "..");
const raw = (p) => readFileSync(path.join(root, p), "utf8");
const read = (p) =>
  raw(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const readSql = (p) => raw(p).replace(/^\s*--.*$/gm, "");

const MIGRATION = "database/090_assets_and_licences.sql";
const ROUTE = "src/app/api/assets/route.js";
const SCREEN = "src/components/admin/Assets.jsx";
const READERS = ["owner", "admin", "hr", "finance"];

describe("the keys the module introduced", () => {
  it("opens the register to people operations and money", () => {
    for (const key of ["asset.view", "licence.view"]) {
      expect([...defaultRolesFor(key)].sort(), key).toEqual([...READERS].sort());
    }
  });

  it("splits the two manage keys by whose process it is", () => {
    // Handing somebody a laptop is onboarding, which is HR's. Buying seats is
    // recurring spend against a renewal date, which is finance's.
    expect([...defaultRolesFor("asset.manage")].sort()).toEqual(
      ["owner", "admin", "hr"].sort()
    );
    expect([...defaultRolesFor("licence.manage")].sort()).toEqual(
      ["owner", "admin", "finance"].sort()
    );
  });

  it("keeps a manager out of the register entirely", () => {
    // An asset register a project manager can edit stops being a register of
    // what the company owns.
    for (const key of ["asset.view", "asset.manage", "licence.view", "licence.manage"]) {
      for (const role of ["manager", "team_lead", "qa", "developer"]) {
        expect(defaultRolesFor(key), `${key}/${role}`).not.toContain(role);
      }
    }
    expect(permissionsForRole("client")).toEqual([]);
  });

  it("does not make a key out of seeing what you hold", () => {
    // It is a fact about the row, granted by RLS — the same shape as the hiring
    // manager in 085. Nobody should need a permission to ask what they are
    // signed out.
    const sql = readSql(MIGRATION);
    expect(sql).toMatch(/assigned_user_id = public\.auth_app_user_id\(\)/);
    expect(sql).toMatch(/user_id = public\.auth_app_user_id\(\)/);
    const route = read(ROUTE);
    expect(route).toMatch(/wantsSomeoneElse/);
    expect(route).toMatch(/requirePermission\(auth, "asset\.view"\)/);
  });
});

describe("an asset cannot contradict itself", () => {
  const sql = readSql(MIGRATION);

  it("requires the status and the holder to agree", () => {
    // Without this the register can say "assigned" with nobody holding it, or
    // name a holder for something in the cupboard — and either way "who has the
    // laptop" is a guess.
    expect(sql).toMatch(/constraint assets_holder_matches_status check \(/);
    expect(sql).toMatch(/status = 'assigned' and assigned_user_id is not null/);
    expect(sql).toMatch(/status <> 'assigned' and assigned_user_id is null/);
  });

  it("makes the obvious intention work rather than raising", () => {
    // The browser writes this table directly. The trigger reconciles the two
    // most common accidental writes instead of failing them.
    expect(sql).toMatch(/create trigger trg_asset_status_follows_holder/);
    const fn = sql.slice(
      sql.indexOf("function public.asset_status_follows_holder"),
      sql.indexOf("$$;", sql.indexOf("function public.asset_status_follows_holder"))
    );
    expect(fn).toMatch(/new\.assigned_user_id is not null and new\.status = 'in_stock'/);
    expect(fn).toMatch(/new\.assigned_user_id is null and new\.status = 'assigned'/);
    // and anything that is not with somebody has no holder at all
    expect(fn).toMatch(/if new\.status <> 'assigned' then\s*\n\s*new\.assigned_user_id := null/);
  });

  it("refuses an assignment with nobody to assign to, with a reason", () => {
    // The CONDITION, not just the message. The message survives inside a branch
    // that can no longer be reached, which is exactly what a mutation did.
    const route = read(ROUTE);
    expect(route).toMatch(
      /if \(status === "assigned" && !UUID_RE\.test\(String\(userId \|\| ""\)\)\)/
    );
    expect(route).toMatch(/Assigning needs somebody to assign it to/);
  });

  it("clears the holder for every status but assigned", () => {
    // A returned laptop with a holder still on it is the contradiction the
    // CHECK exists to refuse; the route must not be the thing that writes it.
    const route = read(ROUTE);
    expect(route).toMatch(/assigned_user_id: status === "assigned" \? userId : null/);
    expect(route).toMatch(/assigned_at: status === "assigned" \? now : null/);
  });

  it("records every movement", () => {
    // "Who had this in March" is what an asset register is actually asked, and
    // a current-holder column alone can never answer it.
    const route = read(ROUTE);
    const inserts = route.match(/from\("asset_events"\)\s*\.insert\(/g) || [];
    expect(inserts.length).toBe(2);
    expect(route).toMatch(/from_user_id: existing\.assigned_user_id/);
    expect(route).toMatch(/actor_user_id: auth\.appUserId/);
  });

  it("keeps the log append-only in the policies", () => {
    expect(sql).toMatch(/create policy asset_events_insert on public\.asset_events\s*\n\s*for insert/);
    expect(sql).not.toMatch(/create policy[^;]*asset_events[^;]*for all/);
  });
});

describe("a licence is a pool of seats, not a pile of objects", () => {
  const sql = readSql(MIGRATION);

  it("keeps seats in their own table", () => {
    expect(sql).toMatch(/create table if not exists public\.licence_seats/);
    expect(sql).toMatch(/create table if not exists public\.software_licences/);
  });

  it("lets one person hold one live seat per licence", () => {
    // PARTIAL, on live seats only. Without the WHERE, somebody given a seat,
    // released and given it back is refused forever — the released row still
    // occupies the constraint.
    //
    // Bounded to the index statement: `where released_at is null` also appears
    // on the second index and in the view, so asserting it against the whole
    // file passed while the index itself had lost it. Mutation testing found
    // that.
    const from = sql.indexOf("create unique index if not exists licence_seats_one_active_per_person");
    expect(from).toBeGreaterThan(-1);
    const index = sql.slice(from, sql.indexOf(";", from));
    expect(index).toMatch(/\(licence_id, user_id\)/);
    expect(index).toMatch(/where released_at is null/);
  });

  it("counts only seats that are still held", () => {
    // Without this the usage view counts every seat ever issued and the
    // organization looks permanently over its contract.
    const from = sql.indexOf("create or replace view public.licence_usage_v");
    const view = sql.slice(from, sql.indexOf(";", from));
    expect(view).toMatch(/left join public\.licence_seats s[\s\S]{0,200}s\.released_at is null/);
  });

  it("releases rather than deletes", () => {
    // So "who had a seat when we were billed for fourteen" stays answerable.
    expect(read(ROUTE)).toMatch(/released_at: now/);
    expect(read(ROUTE)).not.toMatch(/from\("licence_seats"\)\s*\.delete\(\)/);
  });
});

describe("over-assignment is recorded, not refused", () => {
  const sql = readSql(MIGRATION);
  const route = read(ROUTE);

  it("puts no seat check in the route", () => {
    // Refusing the thirteenth seat does not stop it existing; it stops it being
    // written down, and then nobody can see the breach at all.
    //
    // Anchored on real code, not on `action === "seat"` — that string lives
    // only in a comment, and `read()` strips comments, so the slice was empty
    // and the assertion was passing on nothing.
    const seat = route.slice(route.indexOf('from("licence_seats")'));
    expect(seat.length).toBeGreaterThan(100);
    expect(seat).not.toMatch(/seats_total/);
    // The whole route never consults the contract size before inserting a seat.
    expect(route.slice(0, route.indexOf('from("licence_seats")'))).not.toMatch(
      /seats_total[\s\S]{0,200}(insert|reject|error)/i
    );
    // and the reasoning is written down where somebody would come to add one
    expect(raw(ROUTE)).toMatch(/NO SEAT-COUNT CHECK HERE/);
  });

  it("reports over_by from the view instead", () => {
    expect(sql).toMatch(/greatest\(0, count\(s\.id\) - l\.seats_total\)\s*\n?\s*end\s+as over_by/);
  });

  it("shows it on screen", () => {
    const screen = read(SCREEN);
    expect(screen).toMatch(/Number\(l\.over_by\) > 0/);
    expect(screen).toMatch(/over the contract/);
  });

  it("warns before the click, not after it fails", () => {
    expect(read(SCREEN)).toMatch(/seating\.licence\.seats_free === 0/);
  });

  it("returns NULL seats_free when the contract size is unknown", () => {
    // 0 would read as "fully used", which is a different claim.
    expect(sql).toMatch(/when l\.seats_total is null then null/);
    expect(read(SCREEN)).toMatch(/l\.seats_free \?\? "—"/);
  });
});

describe("no cost is invented", () => {
  const sql = readSql(MIGRATION);

  it("leaves both cost columns nullable with no default", () => {
    expect(sql).toMatch(/purchase_cost\s+numeric\(12,2\) check/);
    expect(sql).toMatch(/annual_cost\s+numeric\(12,2\) check/);
    expect(sql).not.toMatch(/(purchase_cost|annual_cost)[^,]*default \d/i);
  });

  it("renders an unset cost as a dash", () => {
    // A register full of confident zeroes reads as "we own nothing valuable".
    expect(read(SCREEN)).toMatch(/v === null \|\| v === undefined\s*\n?\s*\? "—"/);
  });

  it("says so on the form", () => {
    expect(read(SCREEN)).toMatch(/blank is not zero|Leave blank if unknown/);
  });
});

describe("the screen is wired and gated", () => {
  const adminSrc = read("src/app/admin/dashboard/page.js");

  it("renders and titles the section", () => {
    expect(adminSrc).toContain('case "assets":');
    expect(adminSrc).toMatch(/import Assets from "@\/components\/admin\/Assets"/);
    expect(SECTION_TITLES.assets.admin).toBeTruthy();
  });

  it("offers it to the reader roles and nobody else", () => {
    for (const role of READERS) {
      expect(adminNavFor(role).map((i) => i.id), role).toContain("assets");
    }
    for (const role of ["manager", "team_lead", "qa"]) {
      expect(canAccessAdminSection("assets", role), role).toBe(false);
    }
  });

  it("uses no browser prompt for a real workflow", () => {
    // A window.prompt asking somebody to paste a uuid is not a picker.
    expect(read(SCREEN)).not.toMatch(/window\.prompt/);
  });

  it("admits nobody new to the admin area", () => {
    expect(NON_WIDENING_SECTIONS).not.toContain("assets");
    expect(SECTION_PERMISSIONS.assets).toBe("asset.view");
    expect([...ADMIN_AREA_ROLES].sort()).toEqual(
      ["admin", "finance", "hr", "manager", "owner", "qa", "team_lead"].sort()
    );
  });
});

describe("the migration keeps its RLS in step with the catalogue", () => {
  const sql = readSql(MIGRATION);

  it("scopes every policy to the organization and excludes clients", () => {
    const policies = sql.match(/create policy[\s\S]*?;/g) || [];
    expect(policies.length).toBe(8);
    for (const p of policies) {
      expect(p, p.slice(0, 50)).toContain("public.auth_org()");
      expect(p, p.slice(0, 50)).toContain("public.auth_is_client()");
    }
  });

  it("uses the catalogue's three role lists", () => {
    expect(sql).toMatch(/in \('owner','admin','hr','finance'\)/);
    expect(sql).toMatch(/in \('owner','admin','hr'\)/);
    expect(sql).toMatch(/in \('owner','admin','finance'\)/);
  });

  it("puts the billing lock on writes and not on reads", () => {
    const withChecks = sql.match(/with check\s*\([\s\S]*?\);/g) || [];
    expect(withChecks.length).toBe(4);
    for (const w of withChecks) expect(w).toContain("public.auth_org_unlocked()");
    const reads = sql.match(/for select to authenticated[\s\S]*?;/g) || [];
    for (const r of reads) expect(r).not.toContain("auth_org_unlocked");
  });

  it("makes both views read as the caller", () => {
    // The whole reason 087 exists.
    const views = sql.match(/create or replace view public\.\w+\s*\n\s*with \(security_invoker = true\)/g) || [];
    expect(views.length).toBe(2);
  });

  it("is additive", () => {
    expect(sql).not.toMatch(/drop\s+table/i);
    expect(sql).not.toMatch(/truncate/i);
    expect(sql).not.toMatch(/delete\s+from/i);
  });
});
