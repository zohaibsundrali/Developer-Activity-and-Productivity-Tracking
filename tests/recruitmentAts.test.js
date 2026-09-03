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
 * Job openings, candidates, and the hiring pipeline — migration 085.
 *
 * Everything about a person AFTER they join existed: memberships, profiles,
 * onboarding, attendance, reviews. Nothing before. `employee.onboard` has been
 * a permission since 058 with no process in front of it — somebody arrives
 * already hired, from nowhere.
 *
 * WHAT THESE TESTS GUARD, in one line each:
 *   1. an OPENING is not PII and a CANDIDATE is — the whole permission split;
 *   2. the hiring manager reads their own opening's applicants and no others,
 *      granted on the ROW rather than on a role;
 *   3. stage and outcome stay separate, or the funnel cannot be counted;
 *   4. every move is recorded, because a stage with no history only says where
 *      somebody is.
 */

const root = path.resolve(__dirname, "..");
const raw = (p) => readFileSync(path.join(root, p), "utf8");
const read = (p) =>
  raw(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const readSql = (p) => raw(p).replace(/^\s*--.*$/gm, "");

const MIGRATION = "database/085_recruitment_ats.sql";
const ROUTE = "src/app/api/recruitment/route.js";
const SCREEN = "src/components/admin/Recruitment.jsx";
const PEOPLE = ["owner", "admin", "hr"];
const PEOPLE_READERS = ["owner", "admin", "hr", "manager", "team_lead"];

describe("an opening is not PII and a candidate is", () => {
  it("opens the role list wider than the applicant list", () => {
    expect([...defaultRolesFor("job.view")].sort()).toEqual([...PEOPLE_READERS].sort());
    for (const key of ["job.manage", "candidate.view", "candidate.manage"]) {
      expect([...defaultRolesFor(key)].sort(), key).toEqual([...PEOPLE].sort());
    }
  });

  it("keeps a manager off the applicant list by role", () => {
    // They may still reach it as the named hiring manager — that is a fact
    // about the row, tested below, not a role.
    for (const role of ["manager", "team_lead"]) {
      expect(defaultRolesFor("job.view"), role).toContain(role);
      expect(defaultRolesFor("candidate.view"), role).not.toContain(role);
    }
  });

  it("keeps everybody else out entirely", () => {
    for (const key of ["job.view", "candidate.view"]) {
      for (const role of ["finance", "qa", "developer", "employee"]) {
        expect(defaultRolesFor(key), `${key}/${role}`).not.toContain(role);
      }
    }
    expect(permissionsForRole("client")).toEqual([]);
  });
});

describe("the hiring manager is granted on the row, not on a role", () => {
  const sql = readSql(MIGRATION);
  const route = read(ROUTE);

  it("names the exception in the candidates read policy", () => {
    const policy = sql.slice(
      sql.indexOf("create policy candidates_read"),
      sql.indexOf(";", sql.indexOf("create policy candidates_read"))
    );
    expect(policy).toMatch(/o\.hiring_manager_id = public\.auth_app_user_id\(\)/);
    expect(policy).toMatch(/in \('owner','admin','hr'\)/);
  });

  it("checks the same thing in the route, against a re-read row", () => {
    // Against the opening fetched scoped to the org — never against anything
    // in the request.
    expect(route).toMatch(/async function openingIfVisible/);
    expect(route).toMatch(/String\(opening\.hiring_manager_id \|\| ""\) === String\(auth\.appUserId\)/);
    const fn = route.slice(route.indexOf("async function openingIfVisible"));
    expect(fn.slice(0, 500)).toMatch(/eq\("organization_id", auth\.orgId\)/);
  });

  it("does NOT let the hiring manager edit those candidates", () => {
    // Moving somebody through a pipeline is a record of a decision, and the
    // person who made it should be the one who writes it down.
    const policy = sql.slice(
      sql.indexOf("create policy candidates_write"),
      sql.indexOf(";", sql.indexOf("create policy candidates_write"))
    );
    expect(policy).not.toMatch(/hiring_manager_id/);
    expect(policy).toMatch(/in \('owner','admin','hr'\)/);
  });

  it("says plainly on screen that an opening can be visible while its applicants are not", () => {
    expect(read(SCREEN)).toMatch(/Applicants are not shown to you/);
    expect(route).toMatch(/You can see this opening but not its applicants/);
  });
});

describe("stage and outcome are separate, so the funnel can be counted", () => {
  const sql = readSql(MIGRATION);

  it("keeps them in two columns", () => {
    // A single status list mixing 'interview' with 'rejected' overwrites the
    // stage the moment somebody is rejected, and "how many did we reject AT
    // interview" becomes unanswerable.
    expect(sql).toMatch(/stage\s+text not null default 'applied'/);
    expect(sql).toMatch(/check \(stage in \('applied','screening','interview','offer','hired'\)\)/);
    expect(sql).toMatch(/outcome\s+text/);
    expect(sql).toMatch(/outcome in \('rejected','withdrawn','hired'\)/);
  });

  it("counts in_play as the people with no outcome", () => {
    const view = sql.slice(sql.indexOf("create or replace view public.job_opening_pipeline_v"));
    expect(view).toMatch(/count\(\*\) filter \(where c\.outcome is null\)\s+as in_play/);
    expect(view).toMatch(/c\.outcome is null and c\.stage = 'interview'/);
    expect(view).toMatch(/count\(\*\) filter \(where c\.outcome = 'rejected'\)/);
  });

  it("fixes the stage when somebody is hired", () => {
    // Otherwise the funnel counts a hire at whatever stage it happened to be.
    expect(read(ROUTE)).toMatch(/if \(outcome === "hired"\) patch\.stage = "hired"/);
  });
});

describe("a decided candidate stays decided, and can be reopened", () => {
  const sql = readSql(MIGRATION);
  const start = sql.indexOf("function public.candidate_outcome_final");
  const fn = sql.slice(start, sql.indexOf("$$;", start));

  it("blocks a move once an outcome is set", () => {
    expect(sql).toMatch(/create trigger trg_candidate_outcome_final/);
    expect(fn).toMatch(/raise exception/);
  });

  it("allows clearing the outcome as the way back", () => {
    // Reversing a decision is not unthinkable; doing it silently is.
    expect(fn).toMatch(/if new\.outcome is null then\s*\n\s*return new;/);
  });

  it("offers exactly that on screen", () => {
    expect(read(SCREEN)).toMatch(/move\(c, \{ outcome: null \}\)/);
  });
});

describe("duplicates and identity", () => {
  const sql = readSql(MIGRATION);

  it("allows one application per person per opening", () => {
    expect(sql).toMatch(
      /constraint candidates_one_per_opening unique \(organization_id, job_opening_id, email\)/
    );
  });

  it("normalises the email in a trigger, not in a route", () => {
    // The browser writes this table directly, and one route lower-casing while
    // another does not is how the duplicate everybody was preventing gets in.
    expect(sql).toMatch(/create trigger trg_candidate_normalise_email/);
    expect(sql).toMatch(/new\.email := lower\(btrim\(new\.email\)\)/);
  });

  it("records a hire without creating an account", () => {
    // Creating a login is `member.provision` and a separate act.
    expect(sql).toMatch(/hired_user_id\s+uuid,/);
    expect(sql).not.toMatch(/insert into public\.memberships/);
    expect(read(SCREEN)).toMatch(/It does not create a login/);
  });

  it("keeps the CV a link rather than a bucket nobody created", () => {
    expect(sql).toMatch(/resume_url\s+text/);
    expect(sql).not.toMatch(/resume_path/);
  });
});

describe("every move is recorded", () => {
  const sql = readSql(MIGRATION);
  const route = read(ROUTE);

  it("writes an event on application and on every change", () => {
    const inserts = route.match(/from\("candidate_events"\)\s*\.insert\(/g) || [];
    expect(inserts.length).toBe(2);
    expect(route).toMatch(/from_stage: existing\.stage/);
    expect(route).toMatch(/actor_user_id: auth\.appUserId/);
  });

  it("makes the log append-only in the policies", () => {
    // An append-only log that can be edited is not a log.
    expect(sql).toMatch(/create policy candidate_events_insert on public\.candidate_events\s*\n\s*for insert/);
    expect(sql).not.toMatch(/create policy[^;]*candidate_events[^;]*for all/);
  });
});

describe("the route gates each act", () => {
  const route = read(ROUTE);

  it("uses job.manage for openings and candidate.manage for people", () => {
    expect(route).toMatch(/opening: "job\.manage", candidate: "candidate\.manage"/);
  });

  it("asks job.view before revealing that an opening id exists", () => {
    const candidatesView = route.slice(route.indexOf('if (view === "candidates")'));
    expect(candidatesView.indexOf('requirePermission(auth, "job.view")')).toBeLessThan(
      candidatesView.indexOf("openingIfVisible")
    );
  });

  it("refuses a candidate on a closed or filled opening", () => {
    expect(route).toMatch(/\["closed", "filled"\]\.includes\(opening\.status\)/);
  });

  it("validates the email before it reaches the database", () => {
    expect(route).toMatch(/EMAIL_RE\.test\(String\(email \|\| ""\)\)/);
  });
});

describe("the screen is wired and gated", () => {
  const adminSrc = read("src/app/admin/dashboard/page.js");

  it("renders and titles the section", () => {
    expect(adminSrc).toContain('case "recruitment":');
    expect(adminSrc).toMatch(/import Recruitment from "@\/components\/admin\/Recruitment"/);
    expect(SECTION_TITLES.recruitment.admin).toBeTruthy();
  });

  it("offers it to the people-reading roles and nobody else", () => {
    for (const role of PEOPLE_READERS) {
      expect(adminNavFor(role).map((i) => i.id), role).toContain("recruitment");
    }
    for (const role of ["finance", "qa"]) {
      expect(canAccessAdminSection("recruitment", role), role).toBe(false);
    }
  });

  it("is a real screen and admits nobody new to the area", () => {
    expect(NON_WIDENING_SECTIONS).not.toContain("recruitment");
    expect(SECTION_PERMISSIONS.recruitment).toBe("job.view");
    expect([...ADMIN_AREA_ROLES].sort()).toEqual(
      ["admin", "finance", "hr", "manager", "owner", "qa", "team_lead"].sort()
    );
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
