import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  ADMIN_AREA_ROLES,
  ADMIN_SECTION_ROLES,
  SECTION_PERMISSIONS,
  NON_WIDENING_SECTIONS,
  canAccessAdminSection,
  canEnterAdminArea,
} from "@/components/shell/sectionAccess";
import { adminNavFor, staffNav } from "@/components/shell/navConfig";
import { SECTION_TITLES } from "@/components/shell/sectionTitles";
import { permissionsForRole } from "@/utils/permissionCatalogue";
import { ROLES } from "@/utils/roles";

/**
 * THE HALF OF THE FIX THAT WAS MISSING: somewhere to click.
 *
 * Admitting manager, hr, finance, qa and team_lead to /admin gave them the
 * screens their roles were written for and took away the ones every employee
 * needs. All five hold the nine `*_own` keys — own tasks, own timesheet, own
 * projects — and the admin shell rendered no screen for a single one, so a QA
 * engineer or a finance lead could not log an hour. Eight of the nine keys had
 * no surface at all; only `profile.manage_own` survived, because Account
 * happens to exist in both shells.
 *
 * Nothing was broken in the sense of being wrong. The keys were right, the API
 * was right, RLS was right. There was nowhere to click.
 *
 * THE TRAP THIS FILE EXISTS TO WATCH. `ADMIN_AREA_ROLES` is derived by
 * flattening every section's role list, which is what stops it going stale.
 * The own-work sections are keyed on `*_own` permissions and EVERY staff role
 * holds those, so flattening them in admits developer, designer, devops and
 * employee to the admin dashboard — and `canEnterAdminArea` feeds the edge
 * middleware, so that is the front door, not the sidebar.
 */

const root = path.resolve(__dirname, "..");
/** Comments stripped: this suite has twice asserted a comment, not the code. */
const read = (p) =>
  readFileSync(path.join(root, p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const ADMIN_DASHBOARD = "src/app/admin/dashboard/page.js";
/** The five moved into /admin by the area fix, who lost their own work to it. */
const MOVED = ["manager", "hr", "finance", "qa", "team_lead"];
const CONTRIBUTORS = ["developer", "designer", "devops", "employee"];

describe("the own-work sections exist and are gated on the *_own keys", () => {
  it("names a narrow permission rather than being left open", () => {
    // `null` would have worked and would have been wrong: unlike somebody's own
    // Account screen, logging time is a thing an organization may want to take
    // away from one person, and only a key can express that.
    expect(SECTION_PERMISSIONS["my-work"]).toBe("task.view_own");
    expect(SECTION_PERMISSIONS.timesheet).toBe("timesheet.view_own");
    expect(SECTION_PERMISSIONS.projects).toBe("project.view_own");
    for (const section of NON_WIDENING_SECTIONS) {
      expect(SECTION_PERMISSIONS[section], section).toBeTruthy();
    }
  });

  it("is not the org-wide project screen wearing a different name", () => {
    // `projects` is the caller's own; `all-projects` is everybody's. Keying the
    // first on project.view_all would hand qa and finance an empty screen,
    // which is exactly the failure this whole change is about.
    expect(SECTION_PERMISSIONS.projects).not.toBe(SECTION_PERMISSIONS["all-projects"]);
    expect(canAccessAdminSection("projects", "qa")).toBe(true);
    expect(canAccessAdminSection("all-projects", "qa")).toBe(false);
    expect(canAccessAdminSection("projects", "finance")).toBe(true);
    expect(canAccessAdminSection("all-projects", "finance")).toBe(false);
  });

  it("opens for every role that was moved into the admin shell", () => {
    for (const role of MOVED) {
      for (const section of NON_WIDENING_SECTIONS) {
        expect(canAccessAdminSection(section, role), `${role}/${section}`).toBe(true);
      }
      // and the sidebar actually offers them
      const ids = adminNavFor(role).map((i) => i.id);
      for (const section of NON_WIDENING_SECTIONS) {
        expect(ids, `${role}/${section}`).toContain(section);
      }
    }
  });

  it("opens for owner and admin too — an owner has a timesheet", () => {
    for (const role of ["owner", "admin"]) {
      for (const section of NON_WIDENING_SECTIONS) {
        expect(canAccessAdminSection(section, role), `${role}/${section}`).toBe(true);
      }
    }
  });

  it("stays shut for a client, who is not staff", () => {
    for (const section of NON_WIDENING_SECTIONS) {
      expect(canAccessAdminSection(section, "client"), section).toBe(false);
    }
    expect(permissionsForRole("client")).toEqual([]);
  });
});

describe("the own-work sections do not widen the front door", () => {
  it("leaves ADMIN_AREA_ROLES at the seven roles the area was opened to", () => {
    expect([...ADMIN_AREA_ROLES].sort()).toEqual(
      ["admin", "finance", "hr", "manager", "owner", "qa", "team_lead"].sort()
    );
  });

  it("keeps every contributor out despite their holding all three keys", () => {
    for (const role of CONTRIBUTORS) {
      for (const section of NON_WIDENING_SECTIONS) {
        expect(canAccessAdminSection(section, role), `${role}/${section}`).toBe(true);
      }
      expect(canEnterAdminArea(role), role).toBe(false);
    }
  });

  it("declares every own-work section as non-widening", () => {
    // The rule, stated so it cannot be satisfied by a stale hand-typed list: a
    // section whose permission is held by a role that may NOT enter the area
    // must be declared non-widening, or it lets that role in.
    for (const [section, roles] of Object.entries(ADMIN_SECTION_ROLES)) {
      if (!Array.isArray(roles)) continue;
      const heldByOutsider = roles.some((r) => !ADMIN_AREA_ROLES.includes(r));
      if (heldByOutsider) {
        expect(NON_WIDENING_SECTIONS, section).toContain(section);
      }
    }
  });

  it("does not smuggle a real admin screen into the exemption", () => {
    // The exemption is load-bearing, so it must stay small and it must never
    // cover a section that is a reason to be in /admin.
    for (const section of NON_WIDENING_SECTIONS) {
      const roles = ADMIN_SECTION_ROLES[section];
      expect(roles, section).toBeInstanceOf(Array);
      // every staff role holds it — that is what makes it "already inside"
      const staff = ROLES.filter((r) => r !== "client");
      expect([...roles].sort(), section).toEqual([...staff].sort());
    }
  });
});

describe("the admin dashboard actually renders them", () => {
  const src = read(ADMIN_DASHBOARD);

  it("has a switch case for every declared own-work section", () => {
    for (const section of NON_WIDENING_SECTIONS) {
      expect(src, section).toContain(`case "${section}":`);
    }
  });

  it("shares the staff components instead of rebuilding them", () => {
    for (const c of ["MyWork", "MyTimesheet", "MyProjects"]) {
      expect(src).toMatch(
        new RegExp(`import ${c} from ["']@/components/developer/${c}["']`)
      );
    }
  });

  it("feeds My Projects the caller's own rows, not the org-wide list", () => {
    // `projects` holds every project in the organization and RLS answers it
    // EMPTY for qa and finance. Passing it here would render an empty screen
    // for the two roles this change exists to serve.
    expect(src).toMatch(/assignedProjects=\{myProjects\}/);
    expect(src).not.toMatch(/assignedProjects=\{projects\}/);
    expect(src).toMatch(/eq\('assigned_developer_id', currentUser\.id\)/);
  });

  it("keeps the person inside their own shell when opening a project", () => {
    // The staff dashboard sends these to /developer/project-details. A manager
    // reading their own task list in /admin must not be thrown across.
    expect(src).toMatch(/\/admin\/project-details\//);
    const openFn = src.slice(src.indexOf("const openProjectDetails"));
    expect(openFn.slice(0, 400)).not.toMatch(/\/developer\//);
  });

  it("titles them, in the admin shell as well as the staff one", () => {
    for (const section of NON_WIDENING_SECTIONS) {
      expect(SECTION_TITLES[section], section).toBeTruthy();
      expect(SECTION_TITLES[section].admin, section).toBeTruthy();
    }
  });
});

describe("the two shells still say the same thing", () => {
  it("uses one section vocabulary rather than a parallel set of ids", () => {
    // The ids are shared with the staff nav on purpose: one vocabulary, one set
    // of titles, and a ?section= link that means the same thing in both shells.
    const staffIds = new Set(staffNav("developer").map((i) => i.id));
    for (const section of NON_WIDENING_SECTIONS) {
      expect(staffIds, section).toContain(section);
    }
  });

  it("leaves the staff dashboard's own sections alone", () => {
    // A contributor's sidebar is unchanged by any of this.
    expect(staffNav("developer").map((i) => i.id)).toEqual([
      "overview",
      "my-work",
      "timesheet",
      "projects",
      "my-attendance",
      "my-leave",
      "account",
    ]);
  });
});
