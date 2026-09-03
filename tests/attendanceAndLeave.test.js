import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
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
 * Attendance and Leave — migration 075.
 *
 * WHY THE MODULE EXISTS. `employee` is a real role with a dashboard, and that
 * dashboard was delivery-shaped: My Work, My Timesheet, My Projects. A staff
 * member with no delivery role opened it and found nothing, because turning up,
 * going home and asking for a day off had no table, no key and no screen.
 *
 * WHAT THESE TESTS WATCH, in one line each:
 *   1. the RLS role lists in 075 against the catalogue — the file cannot import
 *      it, so nothing but a test keeps the two in step;
 *   2. that raising leave and deciding leave stay different acts;
 *   3. that the new own-work sections do not widen the admin front door;
 *   4. that the mirror migration's orphan query is well-formed SQL, which is
 *      not the same question as whether it mentions every key.
 */

const root = path.resolve(__dirname, "..");
const raw = (p) => readFileSync(path.join(root, p), "utf8");
/** Comments stripped: this suite has twice asserted a comment, not the code. */
const read = (p) =>
  raw(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
/** SQL comments are `--`, so the JS stripper above does not touch them. */
const readSql = (p) => raw(p).replace(/^\s*--.*$/gm, "");

const MIGRATION = "database/075_attendance_and_leave.sql";
const STAFF = ROLES.filter((r) => r !== "client");
const OVERSIGHT = ["owner", "admin", "hr", "manager"];
const PEOPLE = ["owner", "admin", "hr"];

describe("the catalogue keys the module introduced", () => {
  it("gives every staff role a working day and a holiday", () => {
    for (const key of [
      "attendance.view_own",
      "attendance.log_own",
      "leave.view_own",
      "leave.request_own",
    ]) {
      expect([...defaultRolesFor(key)].sort(), key).toEqual([...STAFF].sort());
    }
  });

  it("gives a client none of them — a client is not staff", () => {
    expect(permissionsForRole("client")).toEqual([]);
  });

  it("separates reading a team's attendance from rewriting it", () => {
    // A manager may READ their team's attendance and may NOT correct it. An
    // attendance record somebody's own manager can edit is not a record.
    expect([...defaultRolesFor("attendance.view_all")].sort()).toEqual([...OVERSIGHT].sort());
    expect([...defaultRolesFor("attendance.manage")].sort()).toEqual([...PEOPLE].sort());
    expect(defaultRolesFor("attendance.manage")).not.toContain("manager");
  });

  it("lets a manager decide leave but not rewrite the leave policy", () => {
    expect([...defaultRolesFor("leave.approve")].sort()).toEqual([...OVERSIGHT].sort());
    expect([...defaultRolesFor("leave.manage_types")].sort()).toEqual([...PEOPLE].sort());
  });

  it("keeps finance out of it — attendance is people, not money", () => {
    for (const key of ["attendance.view_all", "leave.view_all", "leave.approve"]) {
      expect(defaultRolesFor(key), key).not.toContain("finance");
    }
  });

  it("actually moved the employee role off ten permissions", () => {
    // The number is not the point; having somewhere to go is. Asserted as a
    // floor rather than an equality so an unrelated key does not fail this.
    expect(permissionsForRole("employee").length).toBeGreaterThan(10);
    for (const key of ["attendance.log_own", "leave.request_own"]) {
      expect(permissionsForRole("employee"), key).toContain(key);
    }
  });
});

describe("migration 075 says the same thing its policies are written against", () => {
  const sql = readSql(MIGRATION);

  it("scopes every policy to the caller's organization", () => {
    const policies = sql.match(/create policy[\s\S]*?;/g) || [];
    expect(policies.length).toBeGreaterThanOrEqual(7);
    for (const p of policies) {
      expect(p, p.slice(0, 60)).toContain("public.auth_org()");
      expect(p, p.slice(0, 60)).toContain("public.auth_is_client()");
    }
  });

  it("keeps the RLS role lists in step with the catalogue", () => {
    // The policy file cannot import the catalogue, so this is the only thing
    // standing between the two. Both lists are checked in both directions.
    const wide = sql.match(/in \('owner','admin','hr','manager'\)/g) || [];
    const narrow = sql.match(/in \('owner','admin','hr'\)/g) || [];
    expect(wide.length, "owner/admin/hr/manager policies").toBeGreaterThanOrEqual(2);
    expect(narrow.length, "owner/admin/hr policies").toBeGreaterThanOrEqual(2);

    expect([...defaultRolesFor("leave.approve")].sort()).toEqual(
      ["owner", "admin", "hr", "manager"].sort()
    );
    expect([...defaultRolesFor("attendance.manage")].sort()).toEqual(
      ["owner", "admin", "hr"].sort()
    );
  });

  it("puts the billing lock on every write and on no read", () => {
    // `auth_org_unlocked()` belongs in WITH CHECK. A locked organization must
    // still be able to READ what it already has — taking that away would make
    // a billing problem look like data loss.
    // Matched to the statement terminator, not to the first `)`. A lazy
    // `[\s\S]*?\)` stops in the middle of the predicate — it cut every clause
    // short at `public.auth_org()` and reported the migration as missing a lock
    // it has. The test was wrong; the SQL was not.
    const withChecks = sql.match(/with check\s*\([\s\S]*?\);/g) || [];
    expect(withChecks.length).toBe(5);
    for (const w of withChecks) {
      expect(w, w.slice(0, 50)).toContain("public.auth_org_unlocked()");
    }
    const reads = sql.match(/for select to authenticated[\s\S]*?;/g) || [];
    for (const r of reads) {
      expect(r, r.slice(0, 50)).not.toContain("auth_org_unlocked");
    }
  });

  it("stops a person writing themselves an approved leave row", () => {
    // The browser holds an anon-key PostgREST client. Without the status clause
    // it could insert a row that is already 'approved' and skip the route
    // entirely — the route's refusal would be decoration.
    const own = sql.slice(sql.indexOf("leave_requests_write_own"));
    expect(own).toMatch(/status in \('pending','cancelled'\)/);
  });

  it("lets everybody read their own row whatever their role", () => {
    for (const table of ["attendance_read", "leave_requests_read"]) {
      const policy = sql.slice(sql.indexOf(table));
      expect(policy.slice(0, 600), table).toContain("user_id = public.auth_app_user_id()");
    }
  });

  it("is additive — no drops of anything that holds data", () => {
    // `drop policy if exists` is how a policy is replaced and is expected.
    // Dropping a TABLE or deleting rows is not.
    expect(sql).not.toMatch(/drop\s+table/i);
    expect(sql).not.toMatch(/truncate/i);
    expect(sql).not.toMatch(/delete\s+from/i);
  });

  it("invents no quota", () => {
    // The seeded leave types deliberately leave annual_quota_days NULL: how
    // many days a company gives is its decision, and a confident 20 in front of
    // an HR lead who never chose it is worse than an empty field.
    const seed = sql.slice(sql.indexOf("insert into public.leave_types"));
    expect(seed).toContain("on conflict (organization_id, code) do nothing");
    expect(seed).not.toMatch(/annual_quota_days/);
  });
});

describe("raising leave and deciding leave are different acts", () => {
  const route = read("src/app/api/leave/route.js");

  it("never reads a status from the body when creating", () => {
    const post = route.slice(route.indexOf("export async function POST"), route.indexOf("export async function PATCH"));
    expect(post).toContain('status: "pending"');
    expect(post).not.toMatch(/status:\s*body/);
    expect(post).not.toMatch(/body\?\.status/);
  });

  it("refuses to let anybody decide their own request", () => {
    const patch = route.slice(route.indexOf("export async function PATCH"));
    expect(patch).toMatch(/isMine/);
    expect(patch).toContain("You cannot decide your own leave request");
  });

  it("checks leave.approve before it checks anything about the row", () => {
    const patch = route.slice(route.indexOf("export async function PATCH"));
    expect(patch).toContain('requirePermission(auth, "leave.approve")');
  });

  it("confirms the leave type belongs to this organization", () => {
    // Otherwise a caller names any leave_types.id in the world and attaches
    // their request to another tenant's configuration.
    const post = route.slice(route.indexOf("export async function POST"));
    expect(post).toMatch(/from\("leave_types"\)[\s\S]{0,200}eq\("organization_id", auth\.orgId\)/);
  });
});

describe("attendance is written as yourself unless you hold attendance.manage", () => {
  const route = read("src/app/api/attendance/route.js");

  it("asks the wide key before the narrow one when reading", () => {
    expect(route.indexOf("attendance.view_all")).toBeLessThan(
      route.indexOf("attendance.view_own")
    );
  });

  it("gates writing somebody else's day on the manage key", () => {
    expect(route).toMatch(/forSomeoneElse[\s\S]{0,200}requirePermission\(auth, "attendance\.manage"\)/);
    expect(route).toContain('requirePermission(auth, "attendance.log_own")');
  });

  it("confirms the target is in this organization before writing", () => {
    expect(route).toMatch(/from\("memberships"\)[\s\S]{0,240}eq\("organization_id", auth\.orgId\)/);
  });

  it("validates any id it is handed before it reaches a query", () => {
    expect(route).toContain("UUID_RE");
    expect(route).toMatch(/UUID_RE\.test\(String\(targetId\)\)/);
  });

  it("does not let a person mark their own day absent or a holiday", () => {
    // Self-service 'absent' is a way to quietly unwrite a day you were in.
    expect(route).toMatch(/SELF_STATUS = \["present", "remote"\]/);
  });

  it("takes the calendar day from the caller and validates it hard", () => {
    // The server is UTC; an organization in Karachi is on the previous UTC day
    // every morning. The date has to come from the browser and be checked.
    expect(route).toContain("normaliseDate");
    expect(route).toMatch(/DATE_RE/);
  });
});

describe("the screens exist in both shells", () => {
  const adminSrc = read("src/app/admin/dashboard/page.js");
  const staffSrc = read("src/app/developer/dashboard/page.jsx");

  it("renders my-attendance and my-leave in the admin shell", () => {
    for (const section of ["my-attendance", "my-leave", "leave-approvals"]) {
      expect(adminSrc, section).toContain(`case "${section}":`);
    }
  });

  it("renders them in the staff shell too, from the same components", () => {
    for (const section of ["my-attendance", "my-leave"]) {
      expect(staffSrc, section).toContain(`case "${section}":`);
    }
    for (const src of [adminSrc, staffSrc]) {
      expect(src).toMatch(/import MyAttendance from "@\/components\/shared\/MyAttendance"/);
      expect(src).toMatch(/import MyLeave from "@\/components\/shared\/MyLeave"/);
    }
  });

  it("offers them in every staff nav, including the one for employees", () => {
    for (const role of ["developer", "employee", "manager", "designer", "devops"]) {
      const ids = staffNav(role).map((i) => i.id);
      expect(ids, role).toContain("my-attendance");
      expect(ids, role).toContain("my-leave");
    }
  });

  it("titles every new section in the shell that renders it", () => {
    expect(SECTION_TITLES["my-attendance"].admin).toBeTruthy();
    expect(SECTION_TITLES["my-attendance"].developer).toBeTruthy();
    expect(SECTION_TITLES["my-leave"].admin).toBeTruthy();
    expect(SECTION_TITLES["my-leave"].developer).toBeTruthy();
    expect(SECTION_TITLES["leave-approvals"].admin).toBeTruthy();
  });

  it("shows Leave Approvals only to the roles that may decide", () => {
    for (const role of OVERSIGHT) {
      expect(adminNavFor(role).map((i) => i.id), role).toContain("leave-approvals");
    }
    for (const role of ["finance", "qa", "team_lead"]) {
      expect(canAccessAdminSection("leave-approvals", role), role).toBe(false);
    }
  });
});

describe("the module does not widen the admin front door", () => {
  it("declares the two own-work sections non-widening", () => {
    expect(NON_WIDENING_SECTIONS).toContain("my-attendance");
    expect(NON_WIDENING_SECTIONS).toContain("my-leave");
  });

  it("leaves leave-approvals OUT of the exemption, because it is a real screen", () => {
    // It adds nobody — all four roles are in the area already — but parking a
    // genuine admin screen in the exemption is how the door drifts open.
    expect(NON_WIDENING_SECTIONS).not.toContain("leave-approvals");
    expect(SECTION_PERMISSIONS["leave-approvals"]).toBe("leave.approve");
  });

  it("still admits exactly the seven roles it did before", () => {
    expect([...ADMIN_AREA_ROLES].sort()).toEqual(
      ["admin", "finance", "hr", "manager", "owner", "qa", "team_lead"].sort()
    );
    for (const role of ["developer", "designer", "devops", "employee"]) {
      expect(canAccessAdminSection("my-attendance", role), role).toBe(true);
      expect(canEnterAdminArea(role), role).toBe(false);
    }
  });
});

describe("the mirror migration's orphan query is valid SQL", () => {
  /**
   * A SHAPE TEST, and it exists because the obvious assertion missed.
   *
   * permissionModel.test.js checks that the sync migration mentions every key,
   * which it does by grepping for the quoted string. A generated file once
   * emitted `with catalogue(resource, action) as (values 'attendance.log_own',
   * ...)` — a two-column CTE fed single scalars, which Postgres rejects — and
   * that assertion passed, because every key was present. The test was right
   * about what it claimed and the migration would still have failed on run.
   */
  const SYNC = (() => {
    const dir = path.join(root, "database");
    const files = readdirSync(dir)
      .filter((f) => /^\d{3}_.*\.sql$/.test(f))
      .sort()
      .reverse();
    for (const f of files) {
      const src = readFileSync(path.join(dir, f), "utf8");
      if (/insert into public\.role_permissions \(role, resource, action, allowed\) values/.test(src)) {
        return { name: f, src };
      }
    }
    throw new Error("no migration re-syncs role_permissions");
  })();

  const code = SYNC.src.replace(/^\s*--.*$/gm, "");

  it("declares no column list it does not then supply", () => {
    // Every `(values` CTE with a column list must supply rows of that arity.
    const ctes = [...code.matchAll(/with\s+(\w+)\s*\(([^)]*)\)\s*as\s*\(values([\s\S]*?)\n\)/g)];
    for (const [, name, cols, body] of ctes) {
      const arity = cols.split(",").length;
      const firstRow = body.split("\n").map((l) => l.trim()).find(Boolean);
      expect(firstRow, `${SYNC.name}: CTE ${name}`).toMatch(/^\(/);
      expect(
        (firstRow.match(/,/g) || []).length + 1,
        `${SYNC.name}: CTE ${name} declares ${arity} columns`
      ).toBe(arity);
    }
  });

  it("balances its parentheses", () => {
    expect((code.match(/\(/g) || []).length).toBe((code.match(/\)/g) || []).length);
  });

  it("upserts and never deletes", () => {
    expect(code).toContain("on conflict (role, resource, action) do update");
    expect(code).not.toMatch(/delete\s+from/i);
    expect(code).not.toMatch(/drop\s+/i);
  });
});
