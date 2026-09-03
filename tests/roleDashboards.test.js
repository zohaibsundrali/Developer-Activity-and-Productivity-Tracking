import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  ADMIN_AREA_ROLES,
  ADMIN_SECTION_ROLES,
  NON_WIDENING_SECTIONS,
  canAccessAdminSection,
  canEnterAdminArea,
} from "@/components/shell/sectionAccess";
import { adminNavFor, staffNav } from "@/components/shell/navConfig";
import { dashboardHomeFor } from "@/utils/dashboardHome";
import { ROLES, userTypeForRole } from "@/utils/roles";
import { KPI_CATALOGUE, KPI_SLOTS } from "@/utils/adminOverview";

/**
 * Every role reaching the screens that were written for it.
 *
 * THE BUG. `ADMIN_SECTION_ROLES` has always granted `manager`, `team_lead`,
 * `hr`, `qa` and `finance` fifteen sections between them — All Projects,
 * Employees, Task Reviews, Team Structure, Capacity, Billing and the rest. Not
 * one of those five could open a single one.
 *
 * `userTypeForRole` files every role except owner and admin in the `developers`
 * table, so their session carries `userType: "developer"`, and THREE separate
 * gates above the section table turned them away:
 *
 *   1. the middleware admitted /admin only for `userType === 'admin'`
 *   2. the login page sent anything that was not admin/client to
 *      /developer/dashboard
 *   3. the admin page's own auth check read `sessionStorage.adminUser` and
 *      required `role === 'admin'` — and called clearAdminSession() on the way
 *      out, which clears the shared server cookie, so the bounce logged them
 *      out of the staff dashboard they were legitimately using
 *
 * Nothing failed loudly. Those roles saw MANAGER_NAV — four entries — and the
 * config that promised otherwise read as correct in review. An HR user never
 * saw Employees; a project manager never saw All Projects.
 *
 * WHAT THIS FILE HOLDS: that the config and the routes agree. Every assertion
 * below is behavioural — the imported rules, not a regex over whichever file
 * currently holds them — except where the thing under test IS a line of source
 * in a page component.
 */

const root = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ADMIN_PAGE = stripComments(read("src/app/admin/dashboard/page.js"));
const MIDDLEWARE = stripComments(read("src/middleware.ts"));
const LOGIN = stripComments(read("src/app/login/page.js"));

/** Roles whose profile row is NOT in admin_users — the ones the bug hit. */
const STAFF_ADMIN_ROLES = ["manager", "team_lead", "hr", "qa", "finance"];

describe("the area gate agrees with the section table", () => {
  it("admits every role the section table grants something to", () => {
    // The exact set the bug excluded. If any of these falls out, that role is
    // back to a four-entry sidebar with none of its work on it.
    for (const role of ["owner", "admin", ...STAFF_ADMIN_ROLES]) {
      expect(canEnterAdminArea(role), role).toBe(true);
    }
  });

  it("admits nobody the section table grants nothing to", () => {
    // `overview` and `account` are null — "every admin-dashboard user" — which
    // is a statement about people already inside. Reading them as "every role"
    // would let a developer into the admin shell on the strength of the
    // Account screen.
    for (const role of ["developer", "designer", "devops", "employee", "client"]) {
      expect(canEnterAdminArea(role), role).toBe(false);
    }
  });

  it("fails closed on anything that is not a known role", () => {
    for (const value of [null, undefined, "", "ADMIN", " admin", "root", 1, {}]) {
      expect(canEnterAdminArea(value)).toBe(false);
    }
  });

  it("is derived from the table, not typed out beside it", () => {
    // A hand-written list here is a second copy of the role vocabulary and
    // would go stale the way the provision route's copy of ROLES did.
    //
    // NON_WIDENING_SECTIONS is subtracted, and that subtraction is the whole
    // reason the constant exists. The own-work sections are keyed on `*_own`
    // permissions, which EVERY staff role holds; flattening them in would admit
    // developer, designer, devops and employee to /admin — not a wider sidebar,
    // a wider front door, because canEnterAdminArea feeds the edge middleware.
    const fromTable = new Set(
      Object.entries(ADMIN_SECTION_ROLES)
        .filter(
          ([section, roles]) =>
            Array.isArray(roles) && !NON_WIDENING_SECTIONS.includes(section)
        )
        .flatMap(([, roles]) => roles)
    );
    expect(new Set(ADMIN_AREA_ROLES)).toEqual(fromTable);
    // And every name in it is a real role.
    for (const role of ADMIN_AREA_ROLES) expect(ROLES).toContain(role);
  });

  it("admits nobody on the strength of an own-work section alone", () => {
    // The specific regression the subtraction above prevents, stated as a fact
    // about roles rather than about the derivation — so it still holds if
    // somebody rewrites how ADMIN_AREA_ROLES is computed.
    for (const section of NON_WIDENING_SECTIONS) {
      expect(Object.keys(ADMIN_SECTION_ROLES), section).toContain(section);
    }
    for (const role of ["developer", "designer", "devops", "employee"]) {
      // Holds every own-work section...
      for (const section of NON_WIDENING_SECTIONS) {
        expect(canAccessAdminSection(section, role), `${role}/${section}`).toBe(true);
      }
      // ...and is still not let in.
      expect(canEnterAdminArea(role), role).toBe(false);
    }
  });

  it("covers exactly the roles whose section list is non-empty", () => {
    for (const role of ROLES) {
      // "A section of their own" means a section that is a REASON to be here —
      // an own-work section is not, because everybody has one.
      const hasASection = Object.entries(ADMIN_SECTION_ROLES).some(
        ([section, allowed]) =>
          Array.isArray(allowed) &&
          !NON_WIDENING_SECTIONS.includes(section) &&
          canAccessAdminSection(section, role)
      );
      expect(canEnterAdminArea(role), role).toBe(hasASection);
    }
  });
});

describe("every role lands on the dashboard its work is on", () => {
  it("sends the five staff-table roles to the admin shell", () => {
    for (const role of STAFF_ADMIN_ROLES) {
      // Their profile row really is in `developers` — this is the fact that
      // made user_type the wrong thing to key on.
      expect(userTypeForRole(role), role).toBe("developer");
      expect(dashboardHomeFor("developer", role), role).toBe("/admin/dashboard");
    }
  });

  it("leaves contributors on the staff dashboard", () => {
    for (const role of ["developer", "designer", "devops", "employee"]) {
      expect(dashboardHomeFor("developer", role), role).toBe("/developer/dashboard");
    }
  });

  it("does not move owners, admins or clients", () => {
    expect(dashboardHomeFor("admin", "owner")).toBe("/admin/dashboard");
    expect(dashboardHomeFor("admin", "admin")).toBe("/admin/dashboard");
    expect(dashboardHomeFor("client", "client")).toBe("/client");
    // No membership role at all — a legacy session — still resolves.
    expect(dashboardHomeFor("developer")).toBe("/developer/dashboard");
    expect(dashboardHomeFor("client")).toBe("/client");
  });

  it("still returns null for something that is not a user type", () => {
    expect(dashboardHomeFor("nonsense")).toBeNull();
    expect(dashboardHomeFor(null)).toBeNull();
    // …but a real membership role wins even when the user type is junk, which
    // is the whole point of consulting it first.
    expect(dashboardHomeFor("nonsense", "hr")).toBe("/admin/dashboard");
  });

  it("the login page routes by membership role, not by the form's picker", () => {
    // The picker chooses a PROFILE TABLE (admin_users / clients / developers).
    // Six different roles come out of the `developers` branch and four of them
    // belong elsewhere.
    expect(LOGIN).toMatch(/dashboardHomeFor\("developer", org\.membershipRole\)/);
  });
});

describe("the three gates that used to disagree", () => {
  it("the middleware consults the membership role for /admin", () => {
    expect(MIDDLEWARE).toMatch(/canEnterAdminArea\(s\.role\)/);
    // Read from the SIGNED cookie — verifySession runs before this line and
    // rejects a tampered payload, so the browser cannot name its own role.
    expect(MIDDLEWARE).toMatch(/verifySession\(raw\)/);
    const verifyAt = MIDDLEWARE.indexOf("verifySession(raw)");
    const allowAt = MIDDLEWARE.indexOf("rule.allow(session)");
    expect(verifyAt).toBeGreaterThan(-1);
    expect(allowAt).toBeGreaterThan(verifyAt);
  });

  it("the middleware still refuses the other two areas by user type", () => {
    // Widening /admin must not widen /client. A staff member with an elevated
    // role has no business in a customer's portal.
    //
    // ANCHORED TO THE CLOSING BRACE, AND THAT IS THE POINT. This assertion
    // used to stop at `=> s.userType === 'client'`. Mutation testing appended
    // `|| canEnterAdminArea(s.role)` to that very line and nothing failed —
    // the prefix still matched, so the test was watching a boundary it could
    // not actually see move. The `}` makes it exhaustive.
    expect(MIDDLEWARE).toMatch(
      /prefix: '\/client', allow: \(s\) => s\.userType === 'client' \}/
    );
    expect(MIDDLEWARE).toMatch(
      /prefix: '\/developer', allow: \(s\) => s\.userType === 'developer' \|\| s\.userType === 'admin' \}/
    );
    // Belt and braces: the role check is invoked on exactly one rule, /admin.
    expect(MIDDLEWARE.match(/canEnterAdminArea\(/g) || []).toHaveLength(1);
  });

  it("the admin page reads both session stores", () => {
    expect(ADMIN_PAGE).toMatch(/sessionStorage\.getItem\("adminUser"\)/);
    expect(ADMIN_PAGE).toMatch(/sessionStorage\.getItem\("developerUser"\)/);
    expect(ADMIN_PAGE).toMatch(/canEnterAdminArea\(userData\.membership_role\)/);
  });

  it("the admin page no longer wipes a session it merely does not want", () => {
    // The old bounce called clearAdminSession(), which clears the shared
    // server cookie — so a developer who followed a stale /admin link was
    // signed out of the dashboard they DO belong on.
    expect(ADMIN_PAGE).not.toMatch(/if \(!user\) \{\s*clearAdminSession\(\)/);
    // An EXPIRED session is still cleared, and only in the store it was found
    // in.
    expect(ADMIN_PAGE).toMatch(/if \(key === 'adminUser'\) clearAdminSession\(\);/);
    expect(ADMIN_PAGE).toMatch(/else clearDeveloperSession\(\);/);
  });

  it("watches both stores for a sign-out in another tab", () => {
    expect(ADMIN_PAGE).toMatch(/e\.key === "adminUser" \|\| e\.key === "developerUser"/);
  });

  it("still gates every section after letting the role in", () => {
    // Entering the area grants nothing. This is the assertion that says so.
    expect(ADMIN_PAGE).toMatch(/if \(!canAccessAdminSection\(activeSection, role\)\)/);
  });
});

describe("what each role actually sees", () => {
  /** The KPI tiles a role gets, by the one rule that decides them. */
  const kpisFor = (role) =>
    KPI_CATALOGUE.filter((e) => canAccessAdminSection(e.section, role))
      .slice(0, KPI_SLOTS)
      .map((e) => e.key);

  it("gives the founder the delivery view the brief asked for", () => {
    expect(kpisFor("owner")).toEqual([
      "totalProjects",
      "activeProjects",
      "atRiskProjects",
      "overdueTasks",
      "pendingProposals",
      "teamMembers",
    ]);
  });

  it("gives a project manager delivery without the people admin", () => {
    const pm = kpisFor("manager");
    expect(pm).toContain("totalProjects");
    expect(pm).toContain("atRiskProjects");
    expect(pm).toContain("pendingProposals");
    // Employees is owner/admin/hr — a manager does not hire.
    expect(pm).not.toContain("teamMembers");
    // …and the freed slot goes to something they CAN open and act on.
    expect(pm).toContain("unmanagedProjects");
  });

  it("gives HR a staffing dashboard, not a project one", () => {
    const hr = kpisFor("hr");
    // Not one project counter: HR cannot open All Projects, Views,
    // Project Hub or Requests, and a number with no door is noise.
    for (const absent of [
      "totalProjects",
      "activeProjects",
      "atRiskProjects",
      "overdueTasks",
      "pendingProposals",
    ]) {
      expect(hr, absent).not.toContain(absent);
    }
    expect(hr).toEqual([
      "teamMembers",
      "unmanagedProjects",
      "overloadedPeople",
      "availablePeople",
      "rolesInUse",
    ]);
  });

  it("never shows a tile whose screen the viewer cannot open", () => {
    // The invariant behind all three cases above, stated once for every role.
    for (const role of ADMIN_AREA_ROLES) {
      for (const key of kpisFor(role)) {
        const entry = KPI_CATALOGUE.find((e) => e.key === key);
        expect(canAccessAdminSection(entry.section, role), `${role} -> ${key}`).toBe(true);
      }
    }
  });

  it("leaves nobody with an empty KPI row", () => {
    // A role admitted to the area and shown nothing is worse than a role kept
    // out: the screen looks broken rather than restricted.
    for (const role of ADMIN_AREA_ROLES) {
      expect(kpisFor(role).length, role).toBeGreaterThan(0);
    }
  });

  it("every catalogue entry names a real section, and a distinct number", () => {
    const keys = KPI_CATALOGUE.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of KPI_CATALOGUE) {
      expect(Object.keys(ADMIN_SECTION_ROLES), entry.key).toContain(entry.section);
    }
  });

  it("gives each of the five the screens their own job is on", () => {
    // THIS ASSERTION USED TO COUNT. It read
    // `adminNavFor(role).length > staffNav("manager").length` and it passed
    // for four of the five — then failed for QA, whose admin nav is also four
    // entries: overview, task reviews, bugs, account. Nothing was wrong with
    // QA's menu. The measurement was. A count cannot tell four screens about
    // testing apart from four screens about nothing in particular, and the
    // middle two of those four are the entire reason the QA role exists.
    //
    // So name the screen. Each section below is one the staff nav has never
    // had an entry for, on the dashboard that role now lands on.
    const NEEDS = {
      manager: ["all-projects", "project-hub", "requests"],
      team_lead: ["all-projects", "sprints", "task-reviews"],
      hr: ["employees", "team-stats", "capacity"],
      qa: ["task-reviews", "bugs"],
      finance: ["clients", "billing"],
    };
    // A role added to STAFF_ADMIN_ROLES without a line here would otherwise be
    // waved through by a loop that never visits it.
    expect(Object.keys(NEEDS).sort()).toEqual([...STAFF_ADMIN_ROLES].sort());

    const staffSections = new Set(staffNav("manager").map((i) => i.id));
    for (const [role, sections] of Object.entries(NEEDS)) {
      const nav = adminNavFor(role).map((i) => i.id);
      for (const section of sections) {
        expect(nav, `${role} -> ${section}`).toContain(section);
        // …and it is genuinely new ground: the staff nav never offered it.
        expect(staffSections.has(section), `staffNav already had ${section}`).toBe(false);
      }
    }
  });

  it("gives QA the review queue and the bug counts, not an empty row", () => {
    // The same failure finance had. QA can open exactly two screens, and for
    // the first ten catalogue entries the answer is no to every one — so
    // before the tail entries existed a QA user reached the Overview and saw
    // six blanks where the numbers go.
    expect(kpisFor("qa")).toEqual(["pendingReviews", "openBugs", "bugsInQa"]);
  });

  it("does not disturb a dashboard that was already full", () => {
    // The QA tiles were appended, not inserted. Anyone whose first six slots
    // were already taken must see exactly what they saw before.
    expect(kpisFor("owner")).not.toContain("pendingReviews");
    expect(kpisFor("manager")).not.toContain("openBugs");
    expect(kpisFor("hr")).not.toContain("bugsInQa");
    // team_lead CAN open both QA screens and still gets none of the three,
    // because delivery fills the row first.
    expect(kpisFor("team_lead")).toHaveLength(KPI_SLOTS);
    for (const key of ["pendingReviews", "openBugs", "bugsInQa"]) {
      expect(kpisFor("team_lead"), key).not.toContain(key);
    }
  });

  it("still shows a contributor nothing but the staff nav", () => {
    // adminNavFor is not the gate — canEnterAdminArea is — but a developer
    // reaching this function must not be handed a menu either.
    for (const role of ["developer", "designer", "devops", "employee"]) {
      const sections = adminNavFor(role).map((i) => i.id);
      // The two `null` entries plus the three own-work ones — all five mean
      // "everyone already inside", and a contributor is never inside.
      expect(sections.sort(), role).toEqual(
        ["account", "overview", ...NON_WIDENING_SECTIONS].sort()
      );
      // The part that actually matters: not one org-wide screen. If a section
      // that is a reason to be in /admin ever appears here, this fails.
      const orgWide = Object.keys(ADMIN_SECTION_ROLES).filter(
        (id) =>
          Array.isArray(ADMIN_SECTION_ROLES[id]) && !NON_WIDENING_SECTIONS.includes(id)
      );
      for (const id of orgWide) expect(sections, `${role}/${id}`).not.toContain(id);
    }
  });
});
