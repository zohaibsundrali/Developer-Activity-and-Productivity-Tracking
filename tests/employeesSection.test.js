import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";

import { ROLES, ROLE_RANK, STAFF_ROLES, grantableStaffRoles } from "@/utils/roles";
import { ADMIN_NAV, ADMIN_SECTION_ROLES } from "@/components/shell/navConfig";
import { SECTION_TITLES } from "@/components/shell/sectionTitles";

/**
 * People is one screen now.
 *
 * WHAT CHANGED
 *  The admin sidebar had three entries covering overlapping halves of the same
 *  subject: Add Developer (a form that could only ever make developers),
 *  View Developers (a list of the ones in the `developers` table, with the
 *  delete control) and Employees (everybody, with roles, teams and profiles).
 *  Somebody looking for a designer found them on one of the three.
 *
 *  Both developer screens were folded into Employees. What has to stay true
 *  afterwards is checked here:
 *
 *   1. Neither old screen is in the sidebar, and neither old section id is
 *      left half-wired — a nav entry with no component, or a title for a
 *      section that no longer exists.
 *   2. The old ?section= links still resolve, because they are in bookmarks
 *      and in the empty state on Developer Activity.
 *   3. Nothing the two screens could do was lost: creating the account,
 *      deleting it, and the project count.
 *   4. The role dropdown cannot offer a role the server will refuse.
 */

const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");
const code = (p) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");

const navIds = ADMIN_NAV.map((item) => item.id);

describe("the sidebar", () => {
  it("no longer offers Add Developer or View Developers", () => {
    expect(navIds).not.toContain("add-developer");
    expect(navIds).not.toContain("view-developers");
  });

  it("still offers Employees", () => {
    expect(navIds).toContain("employees");
  });

  it("leaves no half-wired remains of either screen", () => {
    // A role list or a title for a section that cannot be reached is the sort
    // of leftover that makes the next person think the screen still exists.
    for (const gone of ["add-developer", "view-developers"]) {
      expect(ADMIN_SECTION_ROLES[gone], `${gone} role list`).toBeUndefined();
      expect(SECTION_TITLES[gone], `${gone} title`).toBeUndefined();
    }
  });

  it("has a component for every id it lists", () => {
    // The inverse mistake: an entry pointing at a case that was deleted, which
    // falls through to Overview and reads as a broken button. `overview` is
    // the exception and always has been — it IS the default arm of the switch,
    // so it has no case of its own.
    const page = code("src/app/admin/dashboard/page.js");
    for (const id of navIds.filter((x) => x !== "overview")) {
      expect(page, `no case for ${id}`).toContain(`case "${id}":`);
    }
    expect(page, "overview must remain the default arm").toMatch(
      /default:\s*\n\s*return <DashboardOverview/
    );
  });
});

describe("the links that still point at the old screens", () => {
  const page = code("src/app/admin/dashboard/page.js");

  it("resolve to Employees rather than falling through to Overview", () => {
    expect(page).toMatch(/"add-developer":\s*"employees"/);
    expect(page).toMatch(/"view-developers":\s*"employees"/);
    // …and the mapping is actually applied to the URL parameter, rather than
    // sitting in the file being correct and unused.
    expect(page).toMatch(/resolveSection\(searchParams\?\.get\("section"\)\)/);
  });

  it("includes the button on Developer Activity, which pointed at one", () => {
    const activity = read("src/components/admin/DeveloperActivity.jsx");
    expect(activity).not.toContain("section=add-developer");
  });
});

describe("nothing the two screens could do was lost", () => {
  it("deleted them both, rather than leaving them unreachable", () => {
    // Dead code that still compiles is the version of this change that looks
    // finished and is not.
    expect(existsSync(path.join(root, "src/components/admin/AddDeveloper.jsx"))).toBe(false);
    expect(existsSync(path.join(root, "src/components/admin/ViewDevelopers.jsx"))).toBe(false);
  });

  it("keeps creating the account — the whole of Add Developer", () => {
    const dialog = code("src/components/admin/AddEmployeeDialog.jsx");
    expect(dialog).toContain("createStaffMember(");
    expect(code("src/components/admin/EmployeeDirectory.jsx")).toContain(
      "<AddEmployeeDialog"
    );
  });

  it("keeps the permanent delete — the one thing only View Developers had", () => {
    const directory = code("src/components/admin/EmployeeDirectory.jsx");
    expect(directory).toContain("confirmAndDeleteDeveloper(");

    // Both confirmations survived the move. A one-click delete of somebody's
    // projects, tasks and submissions is what the second one exists to prevent.
    const flow = code("src/utils/developerDeletion.js");
    expect(flow.match(/await showConfirm\(/g) || []).toHaveLength(2);
    // And the dry run that fills in the counts those confirmations show.
    expect(flow).toContain("authFetch(`/api/developer/delete?");
  });

  it("deletes by primary key, never by the email", () => {
    const flow = code("src/utils/developerDeletion.js");
    expect(flow).toMatch(/developerId:\s*devId/);
    // devId is read once, before any await, so a re-render cannot move it.
    expect(flow).toMatch(/const devId = developer\.id/);
  });

  it("offers delete only where there is a row to delete", () => {
    // The route deletes from `developers`; an owner or admin is in
    // `admin_users`, so the button must not appear on their card.
    const directory = code("src/components/admin/EmployeeDirectory.jsx");
    expect(directory.match(/emp\.userType === "developer"/g) || []).not.toHaveLength(0);
  });

  it("keeps the project count, without a query per person", () => {
    const data = code("src/utils/employeesData.js");
    expect(data).toContain("projectCount");
    // One select for the organization, counted in memory. The list this
    // replaced issued a count query per developer.
    expect(data).toMatch(/from\("projects"\)\s*\.select\("assigned_developer_email"\)/);
    expect(code("src/components/admin/EmployeeDirectory.jsx")).toContain("emp.projectCount");
  });
});

describe("STAFF_ROLES", () => {
  it("is every role whose account lives in the developers table", () => {
    expect(STAFF_ROLES).toContain("developer");
    expect(STAFF_ROLES).toContain("designer");
    expect(STAFF_ROLES).toContain("qa");
    expect(STAFF_ROLES).toContain("hr");
    expect(STAFF_ROLES).toContain("finance");
  });

  it("excludes the three that belong to another table or another screen", () => {
    // owner/admin are admin_users rows, written by signup and invite-accept;
    // client is a clients row with its own creation screen.
    expect(STAFF_ROLES).not.toContain("owner");
    expect(STAFF_ROLES).not.toContain("admin");
    expect(STAFF_ROLES).not.toContain("client");
  });

  it("is derived from ROLES, so a new role cannot be forgotten here", () => {
    const source = code("src/utils/roles.js");
    expect(source).toMatch(/STAFF_ROLES = ROLES\.filter/);
    // Every member came from ROLES rather than being typed out again.
    for (const r of STAFF_ROLES) expect(ROLES).toContain(r);
  });
});

describe("grantableStaffRoles mirrors the provision route", () => {
  it("offers only roles ranking strictly below the caller's own", () => {
    const forHr = grantableStaffRoles("hr");
    for (const r of forHr) {
      expect(ROLE_RANK[r], `${r} vs hr`).toBeLessThan(ROLE_RANK.hr);
    }
    expect(forHr).toContain("developer");
    expect(forHr).toContain("designer");
    expect(forHr).toContain("qa");
  });

  it("refuses a tie, which is what the route does", () => {
    // `requestedRank >= callerRank` is a refusal there. So HR cannot mint
    // another HR…
    expect(grantableStaffRoles("hr")).not.toContain("hr");
    // …and designer and developer, who share a rank on purpose, cannot create
    // each other.
    expect(grantableStaffRoles("designer")).not.toContain("developer");
    expect(grantableStaffRoles("developer")).not.toContain("designer");
  });

  it("never offers a role above the caller", () => {
    // HR does not outrank a manager, so it cannot create one. The reverse IS
    // allowed and is not a bug: a manager outranks HR, so a manager may hire
    // one — which is the rule the route enforces, in that direction only.
    expect(grantableStaffRoles("hr")).not.toContain("manager");
    expect(grantableStaffRoles("manager")).toContain("hr");
    expect(ROLE_RANK.manager).toBeGreaterThan(ROLE_RANK.hr);
  });

  it("fails closed on a role it does not recognise", () => {
    // Not "everything" and not a crash — an unknown role grants nothing.
    expect(grantableStaffRoles("wizard")).toEqual([]);
    expect(grantableStaffRoles(undefined)).toEqual([]);
    expect(grantableStaffRoles(null)).toEqual([]);
    expect(grantableStaffRoles("")).toEqual([]);
  });

  it("lets an owner create every staff role", () => {
    expect(grantableStaffRoles("owner").sort()).toEqual([...STAFF_ROLES].sort());
  });
});

describe("the directory shows every role it might be handed", () => {
  const directory = read("src/components/admin/EmployeeDirectory.jsx");

  it("reads its role presentation from the shared module, not its own copy", () => {
    // These two maps used to live in this file and were asserted here. They
    // moved to components/shared/roleMeta.js the moment the Team Structure
    // screen needed the same icons — two copies is how `designer`, `qa` and
    // `finance` went weeks without a badge variant after 058 added them.
    //
    // The coverage assertion moved with them, to
    // tests/hierarchyAndAttachments.test.js, which checks every role in ROLES
    // has an icon, a label and a variant. Repeating it here would be the same
    // duplication in the tests that the change removed from the source.
    expect(directory).toContain('from "@/components/shared/roleMeta"');
    expect(directory).not.toMatch(/const ROLE_VARIANTS = \{/);
    expect(directory).not.toMatch(/const ROLE_META = \{/);
    // …and it actually calls them, rather than importing and then inlining.
    expect(directory).toContain("roleIcon(role)");
    expect(directory).toContain("rolePlural(role)");
    expect(directory).toContain("roleVariant(emp.role)");
  });

  it("counts the roles present rather than every role that exists", () => {
    // A column of "0 Designers, 0 QA, 0 Finance" is what makes the numbers
    // that matter hard to find.
    expect(directory).toContain("const counts = new Map();");
    expect(directory).not.toMatch(/ROLES\.map\([^)]*count/);
  });
});
