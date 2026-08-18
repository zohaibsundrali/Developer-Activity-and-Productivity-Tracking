import { NextResponse } from "next/server";

import { resolvePermission } from "@/utils/permissionEngine";
import { isPermissionKey } from "@/utils/permissionCatalogue";

/**
 * The permission check for API routes.
 *
 * WHAT IT REPLACED: fifteen hand-typed role arrays living inside individual
 * route files. Each was correct on the day it was written and each was
 * invisible to the others, so `qa` and `finance` were added to the product
 * twice and to those arrays never.
 *
 * THE ROLE COMES FROM THE TOKEN. `auth` is whatever `getAuthedOrg` returned —
 * derived from a verified JWT, never from a body, a query string or a header
 * the caller controls. These helpers take the whole `auth` object rather than a
 * role string, so there is no call site where somebody can pass `body.role` and
 * have it look right in review.
 *
 * ── WHERE THE OVERRIDES COME FROM, AND WHY THESE STAYED SYNCHRONOUS ──────
 *
 * Per-person exceptions are read ONCE, by `getAuthedOrg`, and travel on `auth`
 * beside the role. These helpers stay synchronous and do no I/O.
 *
 * The first version made them async and loaded overrides here. It was wrong
 * twice over. Every route test would have had to learn to mock a query it does
 * not care about — the failure was immediate and loud, ten route tests
 * answering 500. And the quieter problem: `authCan` is used as
 * `if (!authCan(...))`, and an un-awaited Promise is truthy, so `!Promise` is
 * FALSE and the guard silently never fires. An async helper whose misuse grants
 * access is a bad helper no matter how carefully its call sites are written
 * today.
 *
 * Auth is the right place for it. `auth` already means "everything known about
 * the verified caller"; the role is there, and an exception written against
 * that person is the same kind of fact. One query, one place to mock, and the
 * check itself stays a pure function of data already in hand.
 *
 * THIS IS NOT THE ONLY GATE AND IS NOT THE LAST ONE. RLS is the boundary; this
 * is the layer that gives a clear 403 instead of an empty result set, and that
 * stops a route doing expensive work it will not be allowed to finish.
 */

/** Shared by both helpers so they cannot disagree about who a client is. */
function refuseClient(auth) {
  // A client is a customer, not a member of staff, and holds no staff
  // permission whatever their `role` column happens to say. Checked on
  // userType and not left to fall out of the role lists, so a corrupted row
  // claiming `owner` is still not a way into the staff API.
  return !auth || auth.userType === "client";
}

/**
 * @param {{role?: string|null, userType?: string|null}|null} auth  from getAuthedOrg
 * @param {string} key   a permission key from the catalogue
 * @param {{projectId?: string|null}} [scope]
 * @returns {NextResponse|null} a response to return, or null to continue
 */
export function requirePermission(auth, key, scope = {}) {
  if (!isPermissionKey(key)) {
    // A route asking for a permission that does not exist is a bug in the
    // route, and answering "allowed" would be the worst possible reading of it.
    // 500, not 403: the caller did nothing wrong.
    return NextResponse.json(
      { error: "Server misconfigured: unknown permission." },
      { status: 500 }
    );
  }
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (auth.userType === "client") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (auth.overridesUnavailable) {
    // Overrides MAY exist and getAuthedOrg could not read them. Falling back to
    // the role would silently ignore every DENY in the organization — fail-open
    // on the one direction whose entire purpose is to take access away. 503, so
    // the caller retries rather than quietly getting more than they should.
    return NextResponse.json(
      { error: "Permissions are temporarily unavailable. Try again." },
      { status: 503 }
    );
  }

  if (!resolvePermission({ role: auth.role, overrides: auth.overrides }, key, scope)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/**
 * The same question without the response, for routes that branch on it.
 *
 * Answers FALSE when overrides could not be read. That is the safe direction
 * here for the same reason 503 is the safe answer above: an unreadable deny
 * must never become a grant. A route that needs to tell "refused" apart from
 * "unavailable" should use requirePermission, which says so with a status.
 */
export function authCan(auth, key, scope = {}) {
  if (refuseClient(auth)) return false;
  if (!isPermissionKey(key)) return false;
  if (auth.overridesUnavailable) return false;
  return resolvePermission({ role: auth.role, overrides: auth.overrides }, key, scope);
}
