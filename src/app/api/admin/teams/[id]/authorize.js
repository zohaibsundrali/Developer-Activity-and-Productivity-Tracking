/**
 * Who may delete a team, and what a well-formed team id looks like.
 *
 * This lives beside the route rather than inside it because the decision is
 * pure data — who the caller is, and what id they asked about — and none of it
 * needs a database or an HTTP request to exercise. Same arrangement as
 * ../../members/role/authorize.js.
 */

/**
 * The roles that may delete a team.
 *
 * NOT invented here. src/utils/permissions.js is the app's rulebook, and it
 * already answers this question: `can("manage_teams")` returns
 * PEOPLE_MANAGERS.includes(role), where
 *
 *   const PEOPLE_MANAGERS = ["owner", "admin", "hr"];   // employee/people ops
 *
 * so owner, admin and hr — and nobody else. Deleting a team is org structure,
 * which is people ops; a manager or team_lead supervises a team without being
 * able to dissolve one.
 *
 * The list is INLINED rather than imported because permissions.js reads the
 * role from getOrgContext(), i.e. from sessionStorage in the browser. It is a
 * client module and there is no window here; more to the point, a server route
 * must never take the caller's role from anything the caller can write. The
 * role checked below comes from the VERIFIED bearer token. Same reason
 * ROLE_RANK is inlined in the role route's authorize.js.
 *
 * It also matches what RLS enforces underneath: migration 018 gates
 * `memberships` writes on auth_role() in ('owner','admin','hr'), and detaching
 * the members is a `memberships` write.
 */
export const TEAM_MANAGERS = ["owner", "admin", "hr"];

/** Postgres will reject anything else as an invalid uuid input. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isTeamId(value) {
  return typeof value === "string" && UUID.test(value.trim());
}

/**
 * May this caller delete a team in their own organisation?
 * Returns { ok: true } or { ok: false, status, error }.
 *
 * Note what is NOT decided here: whether the team exists, and whether it
 * belongs to the caller. Neither can be known without reading the database,
 * and both are answered by the same thing — the SQL function's `found` flag,
 * which reports "not yours" and "not there" identically so a 404 for one
 * cannot be told from a 404 for the other. See database/043_team_delete.sql.
 *
 * A malformed id is refused HERE, as a 404 rather than a 400, for the same
 * reason: "that is not a team id" and "that team is not yours" should read the
 * same from outside.
 */
export function authorizeTeamDelete(actor, teamId) {
  if (!actor) return { ok: false, status: 401, error: "Unauthorized" };

  // Clients are not org staff. Checked on user_type as well as role, because
  // the two are separate claims and only one of them being "client" is still a
  // client (mirrors the role route).
  if (actor.userType === "client" || actor.role === "client") {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  if (!TEAM_MANAGERS.includes(actor.role)) {
    return {
      ok: false,
      status: 403,
      error: "Forbidden: your role cannot delete teams",
    };
  }

  if (!isTeamId(teamId)) {
    return { ok: false, status: 404, error: "Team not found in your organization" };
  }

  return { ok: true };
}
