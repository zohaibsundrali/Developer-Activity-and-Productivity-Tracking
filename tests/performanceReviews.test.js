import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  SECTION_PERMISSIONS,
  NON_WIDENING_SECTIONS,
  ADMIN_AREA_ROLES,
  canAccessAdminSection,
  canEnterAdminArea,
} from "@/components/shell/sectionAccess";
import { adminNavFor, staffNav } from "@/components/shell/navConfig";
import { SECTION_TITLES } from "@/components/shell/sectionTitles";
import { defaultRolesFor, permissionsForRole } from "@/utils/permissionCatalogue";
import { ROLES } from "@/utils/roles";

/**
 * Review cycles, reviews and goals — migration 083.
 *
 * `hr` held thirty-five permissions and had no way to run the one process an HR
 * function exists to run. `employee_profiles.performance` has been a jsonb
 * column since 015 described as "cached rollups (optional)" that nothing ever
 * wrote to — a place to put an answer, with no process to produce one.
 *
 * THE RULE THESE TESTS EXIST FOR: a review is private until it is shared. A
 * half-written assessment is not feedback, it is a draft its author would edit
 * if they knew it was being read. draft -> submitted -> shared, and the subject
 * sees only the last one. Enforced twice, independently: the route filters on
 * status, and the RLS policy carries the same clause.
 */

const root = path.resolve(__dirname, "..");
const raw = (p) => readFileSync(path.join(root, p), "utf8");
const read = (p) =>
  raw(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const readSql = (p) => raw(p).replace(/^\s*--.*$/gm, "");

const MIGRATION = "database/083_performance_reviews.sql";
const ROUTE = "src/app/api/performance/route.js";
const PEOPLE = ["owner", "admin", "hr"];
const WRITERS = ["owner", "admin", "hr", "manager", "team_lead"];
const STAFF = ROLES.filter((r) => r !== "client");

describe("the keys the module introduced", () => {
  it("keeps running the cycle to people operations", () => {
    expect([...defaultRolesFor("review_cycle.manage")].sort()).toEqual([...PEOPLE].sort());
    expect([...defaultRolesFor("review.view_all")].sort()).toEqual([...PEOPLE].sort());
  });

  it("lets a manager and a team lead write reviews", () => {
    expect([...defaultRolesFor("review.write")].sort()).toEqual([...WRITERS].sort());
    expect([...defaultRolesFor("goal.manage")].sort()).toEqual([...WRITERS].sort());
  });

  it("does not let a reviewer read everybody else's reviews", () => {
    // A reviewer reads what THEY wrote — RLS grants that on authorship, not on
    // a key. Reading everyone's assessment of everyone belongs with HR.
    for (const role of ["manager", "team_lead"]) {
      expect(defaultRolesFor("review.view_all"), role).not.toContain(role);
      expect(defaultRolesFor("review.write"), role).toContain(role);
    }
  });

  it("gives every staff role their own review to read", () => {
    expect([...defaultRolesFor("review.view_own")].sort()).toEqual([...STAFF].sort());
    expect(permissionsForRole("client")).toEqual([]);
  });
});

describe("a review is private until it is shared", () => {
  const sql = readSql(MIGRATION);
  const route = read(ROUTE);

  it("gates the subject's read on the shared status", () => {
    // Without the status test the subject reads every draft the moment it is
    // typed, and a reviewer can never think on the page.
    const policy = sql.slice(
      sql.indexOf("create policy performance_reviews_read"),
      sql.indexOf(";", sql.indexOf("create policy performance_reviews_read"))
    );
    expect(policy).toMatch(/subject_user_id = public\.auth_app_user_id\(\) and status = 'shared'/);
  });

  it("lets a reviewer read their own drafts", () => {
    const policy = sql.slice(
      sql.indexOf("create policy performance_reviews_read"),
      sql.indexOf(";", sql.indexOf("create policy performance_reviews_read"))
    );
    expect(policy).toMatch(/reviewer_user_id = public\.auth_app_user_id\(\)/);
  });

  it("filters the route's own view to shared as well", () => {
    // Two independent enforcements; neither is the only thing standing there.
    const mine = route.slice(route.indexOf('if (view === "mine")'));
    expect(mine).toMatch(/eq\("status", "shared"\)/);
    expect(mine).toMatch(/eq\("subject_user_id", auth\.appUserId\)/);
  });

  it("makes sharing HR's act and submitting the reviewer's", () => {
    // Two different decisions: "I have finished" and "this should be read".
    const patch = route.slice(route.indexOf("export async function PATCH"));
    expect(patch).toMatch(/Only the reviewer may submit their own review/);
    expect(patch).toMatch(/requirePermission\(auth, "review\.view_all"\)/);
    expect(patch).toMatch(/Only a submitted review can be shared/);
  });
});

describe("the schema refuses the contradictions", () => {
  const sql = readSql(MIGRATION);

  it("will not let anybody review themselves", () => {
    expect(sql).toMatch(/constraint review_not_self check \(subject_user_id <> reviewer_user_id\)/);
  });

  it("takes the reviewer from the token and never from the body", () => {
    const route = read(ROUTE);
    expect(route).toMatch(/const reviewerUserId = auth\.appUserId/);
    expect(route).not.toMatch(/body\?\.reviewerUserId/);
  });

  it("asks each reviewer for one review per person per cycle", () => {
    expect(sql).toMatch(
      /constraint review_one_per_reviewer unique \(cycle_id, subject_user_id, reviewer_user_id\)/
    );
  });

  it("leaves the rating nullable with no default", () => {
    // A 3 nobody chose averages into every report as if it meant something.
    expect(sql).toMatch(/rating\s+integer check \(rating is null or rating between 1 and 5\)/);
    expect(sql).not.toMatch(/rating\s+integer[^,]*default/);
  });

  it("keeps a goal alive past the cycle that set it", () => {
    // A goal set in one review is often still open in the next. Tying it to the
    // cycle would delete it with the cycle or make it look finished when the
    // cycle closes.
    expect(sql).toMatch(/cycle_id\s+uuid references public\.review_cycles\(id\) on delete set null/);
  });
});

describe("a closed cycle is closed, with one exception", () => {
  const sql = readSql(MIGRATION);
  const fnStart = sql.indexOf("function public.review_cycle_closed");
  const fn = sql.slice(fnStart, sql.indexOf("$$;", fnStart));

  it("blocks writes with a trigger, not a route check", () => {
    expect(sql).toMatch(/create trigger trg_review_cycle_open/);
    const trigger = sql.slice(sql.indexOf("create trigger trg_review_cycle_open"));
    expect(trigger.slice(0, 300)).toMatch(/before insert or update or delete/);
  });

  it("reads OLD on a delete", () => {
    expect(fn).toMatch(/coalesce\(new, old\)/);
  });

  it("still allows a completed review to be shared", () => {
    // Closing ends the writing, not the reading. A lock that blocked sharing
    // would force HR to reopen the cycle to finish it.
    expect(fn).toMatch(/new\.status = 'shared' and old\.status <> 'shared'/);
  });

  it("allows nothing else on a closed cycle", () => {
    expect(fn).toMatch(/raise exception/);
    expect(fn).toMatch(/review cycle is closed/i);
  });
});

describe("the route decides per act", () => {
  const route = read(ROUTE);

  it("uses a different key for a cycle, a review and a goal", () => {
    expect(route).toMatch(/cycle: "review_cycle\.manage"/);
    expect(route).toMatch(/review: "review\.write"/);
    expect(route).toMatch(/goal: "goal\.manage"/);
  });

  it("refuses a review in a cycle that is not open", () => {
    expect(route).toMatch(/not open for reviews/);
  });

  it("confirms the subject is in this organization", () => {
    expect(route).toMatch(/async function memberExists/);
    expect(route).toMatch(/memberExists\(svc, auth\.orgId, subjectUserId\)/);
  });

  it("answers self-review with a reason rather than a constraint name", () => {
    expect(route).toMatch(/You cannot review yourself/);
  });

  it("only accepts a whole 1..5 rating", () => {
    expect(route).toMatch(/Number\.isInteger\(rating\) && rating >= 1 && rating <= 5 \? rating : null/);
  });
});

describe("the screens are wired in both shells", () => {
  const adminSrc = read("src/app/admin/dashboard/page.js");
  const staffSrc = read("src/app/developer/dashboard/page.jsx");

  it("renders My Reviews in both, from one component", () => {
    for (const src of [adminSrc, staffSrc]) {
      expect(src).toContain('case "my-reviews":');
      expect(src).toMatch(/import MyReviews from "@\/components\/shared\/MyReviews"/);
    }
  });

  it("offers My Reviews in every staff nav", () => {
    for (const role of ["developer", "employee", "manager", "designer", "devops"]) {
      expect(staffNav(role).map((i) => i.id), role).toContain("my-reviews");
    }
  });

  it("renders and titles the Performance section", () => {
    expect(adminSrc).toContain('case "performance":');
    expect(SECTION_TITLES.performance.admin).toBeTruthy();
    expect(SECTION_TITLES["my-reviews"].admin).toBeTruthy();
    expect(SECTION_TITLES["my-reviews"].developer).toBeTruthy();
  });

  it("offers Performance to people operations and nobody else", () => {
    for (const role of PEOPLE) {
      expect(adminNavFor(role).map((i) => i.id), role).toContain("performance");
    }
    for (const role of ["manager", "team_lead", "finance", "qa"]) {
      expect(canAccessAdminSection("performance", role), role).toBe(false);
    }
  });
});

describe("the module does not widen the admin front door", () => {
  it("declares my-reviews non-widening and performance not", () => {
    expect(NON_WIDENING_SECTIONS).toContain("my-reviews");
    expect(NON_WIDENING_SECTIONS).not.toContain("performance");
    expect(SECTION_PERMISSIONS["my-reviews"]).toBe("review.view_own");
    expect(SECTION_PERMISSIONS.performance).toBe("review_cycle.manage");
  });

  it("leaves ADMIN_AREA_ROLES at the seven roles", () => {
    expect([...ADMIN_AREA_ROLES].sort()).toEqual(
      ["admin", "finance", "hr", "manager", "owner", "qa", "team_lead"].sort()
    );
    for (const role of ["developer", "designer", "devops", "employee"]) {
      expect(canAccessAdminSection("my-reviews", role), role).toBe(true);
      expect(canEnterAdminArea(role), role).toBe(false);
    }
  });
});

describe("the migration keeps its RLS in step with the catalogue", () => {
  const sql = readSql(MIGRATION);

  it("scopes every policy to the organization and excludes clients", () => {
    const policies = sql.match(/create policy[\s\S]*?;/g) || [];
    expect(policies.length).toBe(6);
    for (const p of policies) {
      expect(p, p.slice(0, 50)).toContain("public.auth_org()");
      expect(p, p.slice(0, 50)).toContain("public.auth_is_client()");
    }
  });

  it("uses the catalogue's two role lists", () => {
    expect(sql).toMatch(/in \('owner','admin','hr'\)/);
    expect(sql).toMatch(/in\s*\n?\s*\('owner','admin','hr','manager','team_lead'\)/);
    expect([...defaultRolesFor("review_cycle.manage")].sort()).toEqual([...PEOPLE].sort());
    expect([...defaultRolesFor("review.write")].sort()).toEqual([...WRITERS].sort());
  });

  it("puts the billing lock on writes and not on reads", () => {
    const withChecks = sql.match(/with check\s*\([\s\S]*?\);/g) || [];
    expect(withChecks.length).toBe(3);
    for (const w of withChecks) expect(w).toContain("public.auth_org_unlocked()");
    const reads = sql.match(/for select to authenticated[\s\S]*?;/g) || [];
    for (const r of reads) expect(r).not.toContain("auth_org_unlocked");
  });

  it("is additive", () => {
    expect(sql).not.toMatch(/drop\s+table/i);
    expect(sql).not.toMatch(/truncate/i);
    expect(sql).not.toMatch(/delete\s+from/i);
  });
});
