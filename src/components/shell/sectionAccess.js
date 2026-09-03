/**
 * Who may enter the admin dashboard, and which of its sections they may open.
 *
 * SPLIT OUT OF navConfig.js, and for a reason that has bitten this project
 * before: that file imports two dozen lucide icons for the sidebar. `middleware.ts`
 * runs on the EDGE runtime and needs exactly one fact from here — whether a
 * role belongs in /admin at all — and pulling an icon library into the edge
 * bundle to learn it is not a trade worth making. sectionTitles.js was carved
 * off the same file for the same reason.
 *
 * Deliberately PURE: no icons, no session, and nothing imported that is not
 * itself pure. That is what lets the middleware, the login page, the sidebar
 * and the dashboard's own section guard all read the SAME rules. `navConfig.js`
 * re-exports these names, so every existing import keeps working.
 *
 * THE ROLE LISTS MOVED. Each section now names a PERMISSION, and the roles that
 * hold it live in utils/permissionCatalogue.js beside every other permission in
 * the product. The table below used to be one of four independent copies of the
 * access rules, and the copies had drifted; `ADMIN_SECTION_ROLES` is still
 * exported, but it is now DERIVED from the catalogue rather than typed out, so
 * it cannot drift from it again.
 *
 * THE THREE GATES THIS FEEDS, none of which replaces the others:
 *   1. this file       — which area and which section the UI will show
 *   2. the API routes  — getAuthedOrg on every request, against a verified JWT
 *   3. RLS             — role-scoped policies in the database
 * Hiding a sidebar entry is not a permission. It is the first of three.
 */

import { defaultRolesFor } from "@/utils/permissionCatalogue";
import { roleCan } from "@/utils/permissionEngine";

/**
 * Section → the permission that opens it. `null` means "every admin-dashboard
 * user": `overview` and `account` are statements about people already inside
 * the area, not gates, and inventing a permission for someone's own account
 * screen would be a new restriction rather than a move.
 *
 * The comments that used to sit beside each role list have moved to the
 * catalogue entries, next to the roles they explain.
 */
export const SECTION_PERMISSIONS = Object.freeze({
  overview: null,
  "all-projects": "project.view_all",
  requests: "proposal.view",
  "change-requests": "change_request.view",
  "project-hub": "project.hub",
  board: "project.board",
  views: "task.view_all",
  sprints: "sprint.view",
  "task-reviews": "task.review",
  bugs: "bug.triage",
  "developer-activity": "monitoring.view",
  reports: "report.view",
  automation: "automation.manage",
  employees: "member.view",
  hierarchy: "hierarchy.view",
  capacity: "capacity.view",
  "team-stats": "team_stats.view",
  organization: "organization.view",
  clients: "client.view",
  billing: "billing.view",
  "system-health": "system.health",
  permissions: "permissions.manage",
  // Widening, unlike the two above: `leave.approve` is owner/admin/hr/manager,
  // all four of whom are in the area already, so it adds nobody. It is left out
  // of NON_WIDENING deliberately — the exemption is for sections everybody
  // holds, and quietly parking a real screen there is how the front door drifts.
  "leave-approvals": "leave.approve",
  // Delivery oversight rather than people operations: owner/admin/manager/
  // team_lead, all of whom are in the area already, so this widens nobody.
  "timesheet-approvals": "timesheet.approve",
  // NOT IN THE SIDEBAR — its ADMIN_NAV entry is commented out — but still a
  // live `case` in the dashboard's section switch, so `?section=productivity`
  // rendered it. With no entry here `canAccessAdminSection` fell through to
  // its "unknown ids stay open" branch and returned true for all seven roles
  // the area admits, including hr and finance, who are deliberately kept off
  // the monitoring surface. Found by adversarial review, not by a test.
  //
  // A screen you can reach is a screen that needs a rule, whether or not
  // anything links to it. tests/permissionEngine.test.js now asserts that
  // every case in that switch has an entry here.
  productivity: "monitoring.view",

  // ── The signed-in person's OWN work ───────────────────────────────────
  //
  // These three exist because admitting manager, hr, finance, qa and team_lead
  // to /admin took their own-work screens away. Those five hold all nine
  // `*_own` keys — own tasks, own timesheet, own projects — and the admin shell
  // rendered no screen for any of them, so a QA engineer or a finance lead
  // could not log an hour. The keys were right, the API was right, RLS was
  // right; there was nowhere to click.
  //
  // Keyed on the narrow `*_own` permissions rather than left `null` like
  // `overview` and `account`, so an explicit DENY against one person still
  // hides the screen. See NON_WIDENING_SECTIONS for why that is not enough on
  // its own.
  "my-work": "task.view_own",
  timesheet: "timesheet.view_own",
  projects: "project.view_own",
  // Attendance and leave (migration 075). The `employee` role is the reason
  // these exist: it had ten permissions and a delivery-shaped dashboard, so a
  // staff member with no delivery role opened it and found nothing.
  "my-attendance": "attendance.view_own",
  "my-leave": "leave.request_own",

  account: null,
});

/**
 * Sections that must NOT be read as a reason to let somebody into /admin.
 *
 * ADMIN_AREA_ROLES is derived by flattening every section's role list, which is
 * what stops it going stale. But the three own-work sections above are keyed on
 * `*_own` permissions, and EVERY staff role holds those — an owner has a
 * timesheet and so does an employee. Flattening them in would have quietly
 * admitted developer, designer, devops and employee to the admin dashboard: not
 * a widened sidebar, a widened FRONT DOOR, since `canEnterAdminArea` feeds the
 * edge middleware.
 *
 * So the rule these encode is the same one `overview` and `account` encode —
 * "everybody already inside may open this" — and the difference is only that
 * these three still name a permission, because unlike somebody's own account
 * screen they are a thing an organization might want to take away.
 *
 * A section belongs here when its permission is held by roles that do NOT
 * otherwise belong in /admin. Adding one is a decision about the front door.
 */
export const NON_WIDENING_SECTIONS = Object.freeze([
  "my-work",
  "timesheet",
  "projects",
  "my-attendance",
  "my-leave",
]);

/**
 * The old shape, derived rather than typed.
 *
 * Kept because the sidebar, the tests and the login page all read it, and
 * because "which roles can open this" is a genuinely useful thing to be able to
 * ask. What changed is that nobody maintains it: it is computed from the
 * catalogue, so adding a role to a permission moves this with it.
 */
export const ADMIN_SECTION_ROLES = Object.freeze(
  Object.fromEntries(
    Object.entries(SECTION_PERMISSIONS).map(([section, key]) => [
      section,
      key === null ? null : Object.freeze([...defaultRolesFor(key)]),
    ])
  )
);

export function canAccessAdminSection(section, role) {
  // `undefined` — a section nobody wrote a rule for — stays open, exactly as
  // before. That is deliberate and it is NOT the fail-open default the old
  // `can()` had: every id here is a tab in a dashboard the caller has already
  // been admitted to, and the API and RLS behind each one gate the data. A new
  // tab appearing blank because somebody forgot a map entry would be a worse
  // failure than it appearing.
  const key = SECTION_PERMISSIONS[section];
  if (key === undefined || key === null) return true;
  return roleCan(role, key);
}

/**
 * Who belongs in /admin at all.
 *
 * THE BUG THIS EXISTS TO FIX
 *
 * The table above grants `manager`, `team_lead`, `hr`, `qa` and `finance`
 * access to fifteen sections between them. Not one of them could reach a single
 * one. `userTypeForRole` puts every role except owner and admin in the
 * `developers` table, so their session carries `userType: "developer"`, and the
 * middleware admitted /admin only for `userType === "admin"`. The area gate
 * above the section gate refused everybody the section gate was written for.
 *
 * Nothing failed loudly. The sidebar those roles saw was MANAGER_NAV on the
 * staff dashboard — four entries — so an HR user simply never saw Employees,
 * a project manager never saw All Projects, and the config that said otherwise
 * looked correct in review.
 *
 * DERIVED, NEVER TYPED OUT. A hand-written list here is a second copy of the
 * role vocabulary, and it would go stale exactly the way the provision route's
 * copy of ROLES did — see utils/roles.js, which exists because that happened.
 *
 * `null` entries are skipped deliberately. `overview` and `account` mean "every
 * admin-dashboard user", which is a statement about people already inside the
 * area; reading them as "every role" would admit a developer to the admin
 * dashboard on the strength of the Account screen.
 *
 * NON_WIDENING_SECTIONS is skipped for exactly that reason and not for a new
 * one — those sections mean the same "already inside" thing, they just say it
 * with a permission instead of a `null`.
 */
export const ADMIN_AREA_ROLES = Object.freeze(
  Array.from(
    new Set(
      Object.entries(ADMIN_SECTION_ROLES)
        .filter(
          ([section, roles]) =>
            Array.isArray(roles) && !NON_WIDENING_SECTIONS.includes(section)
        )
        .flatMap(([, roles]) => roles)
    )
  ).sort()
);

/**
 * Fail closed: an unknown or absent role enters nothing.
 *
 * Note what this does NOT do — it does not grant anything. A role that gets in
 * here still meets `canAccessAdminSection` for every screen, `getAuthedOrg` on
 * every request, and RLS at the table. This only decides whether the door to
 * the building opens.
 *
 * There was a `typeof role === "string" &&` in front of the includes(). It read
 * as the fail-closed part and it was dead code: ADMIN_AREA_ROLES holds only
 * strings, and Array.prototype.includes compares with SameValueZero, so null,
 * undefined, 1 and {} were already false without it. Mutation testing could not
 * kill it — removing it changed no answer — and a guard nobody can tell is
 * load-bearing is worse than no guard, because the next reader trusts it to be
 * doing something. The tests that pass those exact values still pass; they now
 * prove the line below fails closed on its own.
 */
export function canEnterAdminArea(role) {
  return ADMIN_AREA_ROLES.includes(role);
}
