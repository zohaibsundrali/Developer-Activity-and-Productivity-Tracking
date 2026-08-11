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
  "employee",
  "client",
];

/**
 * Rank, for "is this caller at least X" and for refusing to grant a role at or
 * above your own.
 *
 * `designer` and `developer` SHARE a rank on purpose — they do the same kind of
 * work with the same access, so neither outranks the other. Anything comparing
 * these numbers must cope with a tie.
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
