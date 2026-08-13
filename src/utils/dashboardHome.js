/**
 * Where a signed-in user's dashboard lives.
 *
 * One map, because there were already two: `DASHBOARD_ROUTE` in
 * src/components/shell/searchCommands.js and three literal `router.push`
 * strings in the login page. A third copy was about to be written for the
 * marketing header, which is how a rename of `/client` ends up fixed in two
 * places out of three and the header quietly points at a 404.
 *
 * Deliberately PURE — no imports, no storage, no session. The landing page
 * header, the command palette and (in principle) any server code can all read
 * it. Deciding WHO is signed in is a different question and is not answered
 * here; this only answers "given that they are, where do they belong".
 *
 * Keyed by user_type — the three profile tables — and not by membership role.
 * A manager, a team lead, a QA and a developer are all `developer` here: they
 * share the /developer surface, and which sections they see inside it is
 * decided by staffNav(), not by the route.
 */

export const DASHBOARD_HOME = Object.freeze({
  admin: "/admin/dashboard",
  developer: "/developer/dashboard",
  client: "/client",
});

/**
 * The dashboard path for a user_type, or `null` if it is not one we know.
 *
 * Returns null rather than defaulting to a dashboard. A caller holding an
 * unrecognised value does not have a signed-in user — it has a bug or a stale
 * session — and sending it to /developer/dashboard on a guess produces a
 * redirect to /login that looks like the session broke.
 */
export function dashboardHomeFor(userType) {
  if (typeof userType !== "string") return null;
  return DASHBOARD_HOME[userType] ?? null;
}
