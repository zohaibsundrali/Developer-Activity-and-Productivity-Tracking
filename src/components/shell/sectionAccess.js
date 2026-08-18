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
 * Deliberately PURE: no imports, no icons, no session. That is what lets the
 * middleware, the login page, the sidebar and the dashboard's own section guard
 * all read the SAME table. `navConfig.js` re-exports these names, so every
 * existing import keeps working.
 *
 * THE THREE GATES THIS FEEDS, none of which replaces the others:
 *   1. this file       — which area and which section the UI will show
 *   2. the API routes  — getAuthedOrg on every request, against a verified JWT
 *   3. RLS             — role-scoped policies in the database
 * Hiding a sidebar entry is not a permission. It is the first of three.
 */

// Which roles may see each ADMIN dashboard section. null = every admin-dashboard
// user (owner/admin/hr). Used to filter the sidebar AND to gate section access.
export const ADMIN_SECTION_ROLES = {
  overview: null,
  // A project manager who may create a project has to be able to reach the
  // list of them. Manager and team_lead already had `project-hub`, `views`
  // and `sprints` — this was the one screen in that set they were locked out
  // of, which made the others look broken.
  "all-projects": ["owner", "admin", "manager", "team_lead"],
  // Everyone who can decide, plus team_lead who can read but not decide —
  // the route and the RLS policy both refuse a decision from them.
  requests: ["owner", "admin", "manager", "team_lead"],
  // Same audience as Requests. Pricing is owner/admin/manager and approving
  // to sell is owner/admin — the screen tells team_lead which is which
  // rather than hiding it.
  "change-requests": ["owner", "admin", "manager", "team_lead"],
  "project-hub": ["owner", "admin", "manager", "team_lead"],
  board: ["owner", "admin"],
  views: ["owner", "admin", "manager", "team_lead"],
  sprints: ["owner", "admin", "manager", "team_lead"],
  // QA is here and nowhere else on this map: reviewing submitted work is the
  // job the role exists for. Manager and team_lead join it because they were
  // already reviewers everywhere except this sidebar entry.
  "task-reviews": ["owner", "admin", "manager", "team_lead", "qa"],
  // Same audience as Task Reviews. Developers and designers see their own
  // bugs on the board; this queue is for the people who triage them.
  bugs: ["owner", "admin", "manager", "team_lead", "qa"],
  "developer-activity": ["owner", "admin"],
  reports: ["owner", "admin", "manager", "team_lead"],
  automation: ["owner", "admin"],
  employees: ["owner", "admin", "hr"],
  // Founder, admin and HR see the whole structure; a manager and a team lead
  // need it to see who is free before they assign anything. It is read-only —
  // nothing on it writes — so the audience is wider than Employees.
  hierarchy: ["owner", "admin", "hr", "manager", "team_lead"],
  // Same audience, same reason: a manager deciding who to assign needs this
  // more than anyone. Read-only — nothing on it writes.
  capacity: ["owner", "admin", "hr", "manager", "team_lead"],
  "team-stats": ["owner", "admin", "hr"],
  organization: ["owner", "admin", "hr"],
  clients: ["owner", "admin", "finance"],
  billing: ["owner", "admin", "finance"],
  // Infrastructure failure detail — same two roles the RLS policy on
  // system_events admits (migration 038).
  "system-health": ["owner", "admin"],
  // null, like `overview`: this shows the caller their OWN details and changes
  // their OWN password. There is no role that should be denied its own account,
  // and the route behind it always targets the verified caller, never an id
  // from the page.
  account: null,
};

export function canAccessAdminSection(section, role) {
  const allowed = ADMIN_SECTION_ROLES[section];
  if (allowed === undefined || allowed === null) return true;
  return allowed.includes(role);
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
 */
export const ADMIN_AREA_ROLES = Object.freeze(
  Array.from(
    new Set(
      Object.values(ADMIN_SECTION_ROLES)
        .filter((roles) => Array.isArray(roles))
        .flat()
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
 */
export function canEnterAdminArea(role) {
  return typeof role === "string" && ADMIN_AREA_ROLES.includes(role);
}
