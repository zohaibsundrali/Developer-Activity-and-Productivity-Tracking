/**
 * THE role list. One definition, imported by everything that needs it.
 *
 * This module exists because there were two. `src/utils/permissions.js` held
 * the ranking for the browser and `src/app/api/auth/provision/route.js` held
 * its own copy for the server — and when three roles were added, only one copy
 * was updated. The result was a role you could assign in Organization →
 * Members but could not create a login for: provisioning looked it up, found
 * nothing, and answered "Unknown role". Nobody would have connected those two
 * screens.
 *
 * Deliberately PURE — no imports, no session, no Supabase. That is what lets
 * the server route and the browser module share it; `permissions.js` reaches
 * for `sessionStorage` through orgContext and can never be imported by a route.
 *
 * Adding a role means: this file, the CHECK constraint (see database/058), and
 * whichever capability lists in permissions.js it belongs to. tests/roles.test.js
 * checks the lists against each other.
 */

/** Every role, ordered highest privilege → lowest. */
export const ROLES = [
  "owner",
  "admin",
  "manager",
  "hr",
  "finance",
  "team_lead",
  "qa",
  "developer",
  "designer",
  "devops",
  "employee",
  "client",
];

/**
 * Rank, for "is this caller at least X" and for refusing to grant a role at or
 * above your own.
 *
 * `designer`, `developer` and `devops` SHARE a rank on purpose — they do the
 * same kind of work with the same access, so none outranks the others.
 * Anything comparing these numbers must cope with a tie.
 *
 * The scale is sparse so a role can be inserted between two others without
 * renumbering. Do NOT write a comparison that assumes a particular maximum:
 * `atLeast()` once defaulted unknown roles to 99 and silently became fail-OPEN
 * the day `owner` grew past it.
 */
export const ROLE_RANK = {
  owner: 100,
  admin: 90,
  manager: 70,
  hr: 60,
  finance: 55,
  team_lead: 50,
  qa: 35,
  developer: 30,
  designer: 30,
  devops: 30,
  employee: 20,
  client: 10,
};

/**
 * Which profile table a role's account lives in. THE ONLY DEFINITION.
 *
 * `user_type` is a STORAGE fact — which of `admin_users`, `developers` and
 * `clients` holds this person's profile row — and it is written to three places
 * in one act of account creation: `memberships.user_type`, the table the row
 * goes in, and `app_metadata.user_type` on the Supabase Auth user. Anything
 * that computes it must call this function.
 *
 * THERE WAS A SECOND COPY AND IT DISAGREED. /api/invitations/accept computed
 * `isAdminLike = role === "owner" || role === "admin" || role === "hr"` and
 * wrote user_type "admin" for hr, while this function — and therefore
 * /api/auth/provision and the Employees screen — wrote "developer". The same
 * role produced a different claim depending on which door the person came
 * through, and the "admin" answer was the LOOSER one: /api/productivity,
 * /api/keyboard-stats and /api/task-submission each branch on `userType`
 * rather than on `role`, so an invited hr escaped self-scoping on the
 * monitoring routes that `monitoring.view` (owner + admin) is meant to close.
 * The accept route now imports this. See database/073, FINDING 3, for the
 * existing rows that change does NOT repair.
 *
 * hr IS "developer" ON PURPOSE, and it is not an oversight to be tidied up:
 * STAFF_ROLES below is DERIVED from this function and hr is in it, so an hr
 * created from the Employees directory has always had a `developers` row;
 * tests/roleDashboards.test.js pins the same fact for manager, team_lead, hr,
 * qa and finance. Admin-console access for those roles does NOT come from
 * user_type — middleware.ts admits /admin on `canEnterAdminArea(role)` too,
 * and the section table is derived from permissionCatalogue.js. Moving a role
 * to "admin" to give it a screen would hand it every `userType === 'admin'`
 * branch in the API along with the screen.
 *
 * Unknown roles fall through to "developer". That is a safe default for a
 * display decision and NOT a safe one for account creation, so callers that
 * create accounts validate with `isRole()` first rather than trusting it.
 */
export function userTypeForRole(role) {
  if (role === "client") return "client";
  if (role === "owner" || role === "admin") return "admin";
  return "developer";
}

/** The profile table name for a user_type. */
export const PROFILE_TABLE = {
  admin: "admin_users",
  developer: "developers",
  client: "clients",
};

export function isRole(value) {
  return Object.prototype.hasOwnProperty.call(ROLE_RANK, value);
}

export function rankOf(role) {
  return isRole(role) ? ROLE_RANK[role] : null;
}

/**
 * The roles whose account lives in `developers` — i.e. everyone the Employees
 * directory can create outright.
 *
 * DERIVED, never typed out. A hand-written list here is a fourth copy of the
 * role vocabulary and would go stale the same way the provision route's copy
 * did. Owner and admin are excluded because their profile row belongs in
 * `admin_users` and the only paths that write it are signup and invite-accept;
 * client is excluded because it has its own screen (CreateClientAccount) and
 * its own table.
 */
export const STAFF_ROLES = ROLES.filter((r) => userTypeForRole(r) === "developer");

/**
 * The roles a person can hold ON A PROJECT, as opposed to in the organization.
 *
 * The same names as ROLES on purpose: permissionEngine compares a project role
 * against defaultRolesFor(key), which holds catalogue role names, so a separate
 * vocabulary would need a mapping table — and a mapping table is the thing that
 * goes stale. Kept in step with the CHECK constraint in migration 071.
 *
 * `owner`, `admin` and `client` are absent. The first two are organization-wide
 * by definition and gain nothing from a project scope; a client's access to a
 * project is decided by project_clients, which is a different question.
 */
export const PROJECT_ROLES = Object.freeze([
  "manager",
  "team_lead",
  "qa",
  "developer",
  "designer",
  "devops",
  "employee",
]);

/**
 * Who may BE assigned as a project's manager.
 *
 * NOT A PERMISSION. Every entry in permissionCatalogue.js answers "may this
 * person do X"; this answers "may this person have X done to them", which is a
 * property of the target and belongs with the role vocabulary instead.
 *
 * It lived in two places — ELIGIBLE_MANAGER_ROLES in
 * /api/projects/[id]/manager and an inline filter in ProjectOverview.jsx — and
 * two copies of one list is the exact failure this phase exists to end. The
 * server copy is the one that enforces; this is now the only definition and
 * both read it.
 */
export const MANAGEABLE_BY_ROLES = Object.freeze([
  "owner",
  "admin",
  "manager",
  "team_lead",
]);

/**
 * Of those, the ones `callerRole` is actually allowed to grant.
 *
 * This MIRRORS the rule in /api/auth/provision — `requestedRank >= callerRank`
 * is refused there — and mirrors it deliberately rather than being the rule:
 * the server check is the one that counts, and it runs against a verified
 * token rather than whatever the browser believes about itself. This exists so
 * the dropdown does not offer a choice that will come back as a 403.
 *
 * Fail closed: an unknown caller role grants nothing. Note that a tie is
 * refused, not allowed, which is why an HR user cannot mint another HR user
 * and why `designer` and `developer` — who share a rank — cannot create each
 * other.
 */
export function grantableStaffRoles(callerRole) {
  const callerRank = rankOf(callerRole);
  if (callerRank === null) return [];
  return STAFF_ROLES.filter((r) => ROLE_RANK[r] < callerRank);
}
