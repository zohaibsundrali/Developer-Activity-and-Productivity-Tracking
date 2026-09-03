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
import { buildWeek } from "@/utils/timesheet";
import { ROLES } from "@/utils/roles";

/**
 * Timesheet submission, approval, and billable hours — migration 077.
 *
 * TWO GAPS, ONE FEATURE. `task_time_logs` has been called "billable time" in
 * three migrations' comments and never had a column saying which hours were
 * billable; and time was logged but never AGREED — no submission, no review, no
 * point at which a week became a fact somebody had signed off.
 *
 * THE ONE THING TO GET RIGHT HERE is that the lock is in the DATABASE. Time
 * logs are written straight from the browser through PostgREST — see
 * `addManualTimeLog` in src/utils/pmData.js — so there is no route in front of
 * them to check anything. An approval enforced in application code would be
 * advisory: the same browser that renders the approved week could patch the
 * hours behind it. The tests below hold that line.
 */

const root = path.resolve(__dirname, "..");
const raw = (p) => readFileSync(path.join(root, p), "utf8");
const read = (p) =>
  raw(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const readSql = (p) => raw(p).replace(/^\s*--.*$/gm, "");

const MIGRATION = "database/077_timesheet_approval.sql";
const ROUTE = "src/app/api/timesheets/route.js";
const SUPERVISORS = ["owner", "admin", "manager", "team_lead"];
const STAFF = ROLES.filter((r) => r !== "client");

describe("the keys the feature introduced", () => {
  it("lets everybody submit their own week", () => {
    expect([...defaultRolesFor("timesheet.submit_own")].sort()).toEqual([...STAFF].sort());
  });

  it("keeps approving to delivery oversight", () => {
    expect([...defaultRolesFor("timesheet.approve")].sort()).toEqual([...SUPERVISORS].sort());
    expect([...defaultRolesFor("timesheet.view_all")].sort()).toEqual([...SUPERVISORS].sort());
  });

  it("does not give finance the timesheet surface yet", () => {
    // Billable hours feed invoicing and finance will need them — but with an
    // invoice in front of it, as that feature's own decision. Asserted so the
    // widening is a deliberate edit here rather than a quiet one elsewhere.
    for (const key of ["timesheet.view_all", "timesheet.approve"]) {
      expect(defaultRolesFor(key), key).not.toContain("finance");
    }
  });

  it("gives hr no say over delivery hours", () => {
    // hr approves LEAVE; a team lead approves the hours booked to their
    // projects. The two queues are deliberately different people.
    for (const key of ["timesheet.view_all", "timesheet.approve"]) {
      expect(defaultRolesFor(key), key).not.toContain("hr");
    }
    expect(defaultRolesFor("leave.approve")).toContain("hr");
  });

  it("gives a client none of it", () => {
    expect(permissionsForRole("client")).toEqual([]);
  });
});

describe("the lock lives in the database, because nothing else can hold it", () => {
  const sql = readSql(MIGRATION);

  it("puts a trigger on task_time_logs, not a check in a route", () => {
    expect(sql).toMatch(/create trigger trg_time_log_week_lock/);
    expect(sql).toMatch(/on public\.task_time_logs/);
  });

  it("covers delete as well as insert and update", () => {
    // Without delete, the way to edit an approved week is to remove the row and
    // insert a new one.
    const trigger = sql.slice(sql.indexOf("create trigger trg_time_log_week_lock"));
    expect(trigger.slice(0, 300)).toMatch(/before insert or update or delete/);
  });

  it("locks a submitted week, not only an approved one", () => {
    // A week under review its author can still edit is not under review — the
    // approver would agree to numbers that changed while they read them.
    expect(sql).toMatch(/v_status in \('submitted','approved'\)/);
  });

  it("reads OLD on a delete, so the trigger does not fall over on one", () => {
    // `new` is null for DELETE. Without the coalesce this raises instead of
    // enforcing, which fails in the direction of blocking everything.
    expect(sql).toMatch(/coalesce\(new, old\)/);
  });

  it("computes the week in one place both sides can agree on", () => {
    expect(sql).toMatch(/create or replace function public\.timesheet_week_of/);
    expect(sql).toMatch(/public\.timesheet_week_of\(v_row\.started_at\)/);
    // and the route agrees about which day a week starts
    expect(read(ROUTE)).toMatch(/getUTCDay\(\) !== 1/);
  });

  it("stops a person writing themselves an approved week through PostgREST", () => {
    const own = sql.slice(sql.indexOf("timesheets_write_own"));
    expect(own).toMatch(/status in \('draft','submitted'\)/);
  });

  it("defaults is_billable to true rather than reclassifying history", () => {
    // 017 already called this table billable time. A default of false would
    // rewrite the meaning of every row ever logged.
    expect(sql).toMatch(/add column if not exists is_billable boolean not null default true/);
  });

  it("adds no rate — an hour's price is not this feature's to invent", () => {
    expect(sql).not.toMatch(/rate/i);
    expect(sql).not.toMatch(/currency/i);
  });

  it("is additive", () => {
    expect(sql).not.toMatch(/drop\s+table/i);
    expect(sql).not.toMatch(/truncate/i);
    expect(sql).not.toMatch(/delete\s+from/i);
  });

  it("keeps its RLS role list in step with the catalogue", () => {
    expect(sql).toMatch(/in \('owner','admin','manager','team_lead'\)/);
    expect([...defaultRolesFor("timesheet.approve")].sort()).toEqual(
      ["owner", "admin", "manager", "team_lead"].sort()
    );
  });

  it("puts the billing lock on writes and not on reads", () => {
    const withChecks = sql.match(/with check\s*\([\s\S]*?\);/g) || [];
    expect(withChecks.length).toBe(2);
    for (const w of withChecks) expect(w).toContain("public.auth_org_unlocked()");
    const reads = sql.match(/for select to authenticated[\s\S]*?;/g) || [];
    for (const r of reads) expect(r).not.toContain("auth_org_unlocked");
  });
});

describe("the route computes the totals rather than believing them", () => {
  const src = read(ROUTE);

  it("never reads totals from the body", () => {
    // A submission that took totalSeconds from the caller would let the browser
    // claim any number it liked and have an approver sign it.
    expect(src).not.toMatch(/body\?\.totalSeconds/);
    expect(src).not.toMatch(/total_seconds:\s*body/);
    expect(src).toMatch(/from\("task_time_logs"\)/);
    expect(src).toMatch(/total \+= s/);
  });

  it("sums only the caller's own logs for the week", () => {
    const post = src.slice(src.indexOf("export async function POST"), src.indexOf("export async function PATCH"));
    expect(post).toMatch(/eq\("developer_id", auth\.appUserId\)/);
    expect(post).toMatch(/eq\("organization_id", auth\.orgId\)/);
  });

  it("refuses a week that is not a Monday instead of rounding it", () => {
    // Silently rounding to a Monday the caller did not choose is how two rows
    // appear for one week and both look right.
    expect(src).toMatch(/getUTCDay\(\) !== 1/);
    expect(src).toMatch(/weekStart must be a Monday/);
  });

  it("refuses to let anybody decide their own week", () => {
    const patch = src.slice(src.indexOf("export async function PATCH"));
    expect(patch).toMatch(/String\(existing\.user_id\) === String\(auth\.appUserId\)/);
    expect(patch).toContain("You cannot decide your own timesheet");
  });

  it("gates every decision on timesheet.approve, reopen included", () => {
    const patch = src.slice(src.indexOf("export async function PATCH"));
    expect(patch).toContain('requirePermission(auth, "timesheet.approve")');
    expect(patch).toMatch(/"approved", "rejected", "reopen"/);
    // the permission check must precede the row being touched
    expect(patch.indexOf('requirePermission(auth, "timesheet.approve")')).toBeLessThan(
      patch.indexOf('.from("timesheets")')
    );
  });

  it("lets a rejected week be submitted again but not an approved one", () => {
    const post = src.slice(src.indexOf("export async function POST"));
    expect(post).toMatch(/existing\.status !== "draft" && existing\.status !== "rejected"/);
  });

  it("clears the old verdict when a week is resubmitted", () => {
    // Otherwise the screen shows "rejected by X" beside a week now waiting on
    // somebody else.
    const post = src.slice(src.indexOf("export async function POST"));
    expect(post).toMatch(/decided_by: null/);
    expect(post).toMatch(/decided_at: null/);
  });

  it("asks the wide key before the narrow one when reading", () => {
    expect(src.indexOf("timesheet.view_all")).toBeLessThan(src.indexOf("timesheet.view_own"));
  });
});

describe("buildWeek carries what the screen needs to act", () => {
  const log = (over) => ({
    id: over.id,
    task_id: over.task_id || "t1",
    started_at: over.started_at,
    ended_at: over.ended_at,
    seconds: over.seconds,
    is_billable: over.is_billable,
    task: { task_title: "Build it" },
  });

  // A Monday, so the week under test is unambiguous.
  const MON = "2026-08-31";

  it("gives every row the log ids behind it", () => {
    // Without these the screen can display a row and do nothing about it.
    const week = buildWeek(
      [
        log({ id: "a", started_at: `${MON}T09:00:00Z`, ended_at: `${MON}T10:00:00Z`, seconds: 3600 }),
        log({ id: "b", started_at: `${MON}T11:00:00Z`, ended_at: `${MON}T12:00:00Z`, seconds: 3600 }),
      ],
      MON,
      new Date(`${MON}T18:00:00Z`)
    );
    const row = week.days.find((d) => d.rows.length)?.rows[0];
    expect(row.logIds.sort()).toEqual(["a", "b"]);
    expect(row.entries).toBe(2);
  });

  it("treats a log with no flag as billable, the way the table always meant", () => {
    // Rows written before 077 have no `is_billable`. Reading undefined as
    // non-billable would silently zero every hour ever logged.
    const week = buildWeek(
      [log({ id: "a", started_at: `${MON}T09:00:00Z`, ended_at: `${MON}T10:00:00Z`, seconds: 3600 })],
      MON,
      new Date(`${MON}T18:00:00Z`)
    );
    expect(week.billable).toBe(3600);
    expect(week.days.find((d) => d.rows.length).rows[0].billableSeconds).toBe(3600);
  });

  it("excludes only what is explicitly not billable", () => {
    const week = buildWeek(
      [
        log({ id: "a", task_id: "t1", started_at: `${MON}T09:00:00Z`, ended_at: `${MON}T10:00:00Z`, seconds: 3600, is_billable: true }),
        log({ id: "b", task_id: "t2", started_at: `${MON}T11:00:00Z`, ended_at: `${MON}T12:00:00Z`, seconds: 3600, is_billable: false }),
      ],
      MON,
      new Date(`${MON}T18:00:00Z`)
    );
    expect(week.total).toBe(7200);
    expect(week.billable).toBe(3600);
  });
});

describe("the approvals screen is wired and gated", () => {
  const adminSrc = read("src/app/admin/dashboard/page.js");

  it("renders and titles the section", () => {
    expect(adminSrc).toContain('case "timesheet-approvals":');
    expect(adminSrc).toMatch(/import TimesheetApprovals from "@\/components\/admin\/TimesheetApprovals"/);
    expect(SECTION_TITLES["timesheet-approvals"].admin).toBeTruthy();
  });

  it("gates it on timesheet.approve and offers it to exactly those roles", () => {
    expect(SECTION_PERMISSIONS["timesheet-approvals"]).toBe("timesheet.approve");
    for (const role of SUPERVISORS) {
      expect(adminNavFor(role).map((i) => i.id), role).toContain("timesheet-approvals");
    }
    for (const role of ["hr", "finance", "qa"]) {
      expect(canAccessAdminSection("timesheet-approvals", role), role).toBe(false);
    }
  });

  it("is a real screen, so it stays out of the non-widening exemption", () => {
    expect(NON_WIDENING_SECTIONS).not.toContain("timesheet-approvals");
  });

  it("admits nobody new to the admin area", () => {
    expect([...ADMIN_AREA_ROLES].sort()).toEqual(
      ["admin", "finance", "hr", "manager", "owner", "qa", "team_lead"].sort()
    );
  });
});

describe("My Timesheet can submit, and stops editing once it is locked", () => {
  const src = read("src/components/developer/MyTimesheet.jsx");

  it("submits the displayed week and nothing else", () => {
    expect(src).toMatch(/JSON\.stringify\(\{ weekStart: start \}\)/);
  });

  it("treats submitted and approved as locked", () => {
    expect(src).toMatch(/sheet\?\.status === "submitted" \|\| sheet\?\.status === "approved"/);
  });

  it("disables the billable toggle on a locked week rather than hiding it", () => {
    // The state is worth seeing even when it cannot be changed, and a control
    // that vanishes reads as a bug.
    expect(src).toMatch(/disabled=\{locked \|\| busy \|\| !row\.logIds\?\.length\}/);
  });

  it("hides the submit button on a locked week, where it would do nothing", () => {
    expect(src).toMatch(/\{!locked && week\.total > 0 &&/);
  });

  it("writes every log behind the row, not just the first", () => {
    expect(src).toMatch(/\.in\("id", row\.logIds\)/);
  });

  it("does not take the timesheet down when the banner cannot load", () => {
    // The hours are the screen's content; a missing banner is a smaller loss
    // than a blank page.
    expect(src).toMatch(/catch \{\s*setSheet\(null\);\s*\}/);
  });
});
