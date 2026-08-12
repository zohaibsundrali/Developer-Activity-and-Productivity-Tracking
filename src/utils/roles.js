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

/** Which profile table a role's account lives in. */
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
