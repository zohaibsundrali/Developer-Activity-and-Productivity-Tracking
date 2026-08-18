/**
 * Where a signed-in user's dashboard lives.
 *
 * One map, because there were already two: `DASHBOARD_ROUTE` in
 * src/components/shell/searchCommands.js and three literal `router.push`
 * strings in the login page. A third copy was about to be written for the
 * marketing header, which is how a rename of `/client` ends up fixed in two
 * places out of three and the header quietly points at a 404.
 *
 * Deliberately PURE — no storage, no session, and its one import is another
 * pure module. The landing page header, the command palette, the login page and
 * (in principle) any server code can all read it. Deciding WHO is signed in is
 * a different question and is not answered here; this only answers "given that
 * they are, where do they belong".
 *
 * The MAP is keyed by user_type — the three profile tables. The QUESTION
 * "where does this person go" is not, because user_type cannot answer it: a
 * manager, a team lead, an HR user, a QA and a developer are all `developer` in
 * that table, and the first four belong in the admin shell while the last does
 * not. `dashboardHomeFor` therefore takes the membership role as well, and
 * consults it first.
 */

import { canEnterAdminArea } from "@/components/shell/sectionAccess";

export const DASHBOARD_HOME = Object.freeze({
  admin: "/admin/dashboard",
  developer: "/developer/dashboard",
  client: "/client",
});

/**
 * The dashboard path for a signed-in user, or `null` if we cannot tell.
 *
 * MEMBERSHIP ROLE WINS OVER PROFILE TABLE, and that is the whole point of the
 * second argument. `userTypeForRole` files a project manager, a team lead, an
 * HR user, a QA and a finance user in the `developers` table, so all five carry
 * `userType: "developer"` — and keying only on that sent every one of them to
 * the four-entry staff dashboard, which is not where any of their work lives.
 * A manager belongs in the admin shell, where `adminNavFor(role)` shows them
 * All Projects, Sprints, Task Reviews and the rest.
 *
 * Returns null rather than defaulting. A caller holding an unrecognised value
 * does not have a signed-in user — it has a bug or a stale session — and
 * guessing /developer/dashboard produces a redirect to /login that looks like
 * the session broke.
 */
export function dashboardHomeFor(userType, membershipRole) {
  if (canEnterAdminArea(membershipRole)) return DASHBOARD_HOME.admin;
  if (typeof userType !== "string") return null;
  return DASHBOARD_HOME[userType] ?? null;
}
