import { NextResponse } from "next/server";

import { roleCan } from "@/utils/permissionEngine";
import { isPermissionKey } from "@/utils/permissionCatalogue";

/**
 * The permission check for API routes.
 *
 * WHAT IT REPLACES: fifteen hand-typed role arrays living inside individual
 * route files — REVIEWER_ROLES, SUPERVISORS, BILLING_ROLES, INVITER_ROLES,
 * DECIDER_ROLES, STAFF_RAISERS, PROVISIONER_ROLES, AUDIT_ROLES, SYNC_ROLES,
 * HEALTH_ROLES and the rest. Each was correct on the day it was written and
 * each was invisible to the others, so `qa` and `finance` were added to the
 * product twice and to those arrays never.
 *
 * THE ROLE COMES FROM THE TOKEN. `auth` is whatever `getAuthedOrg` returned —
 * derived from a verified JWT, never from a body, a query string or a header
 * the caller controls. This helper deliberately takes the whole `auth` object
 * rather than a role string, so there is no call site where somebody can pass
 * `body.role` and have it look right in review.
 *
 * THIS IS NOT THE ONLY GATE AND IS NOT THE LAST ONE. RLS is the boundary; this
 * is the layer that gives a clear 403 instead of an empty result set, and that
 * stops a route doing expensive work it will not be allowed to finish.
 */

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
  // A client is a customer, not a member of staff, and holds no staff
  // permission whatever their `role` column happens to say. Checked separately
  // from the resolver because `client` is a legitimate role that simply never
  // appears in a staff permission's list — this makes the refusal explicit
  // rather than incidental.
  if (auth.userType === "client") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!roleCan(auth.role, key, scope)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/** The same question without the response, for routes that branch on it. */
export function authCan(auth, key, scope = {}) {
  if (!auth || auth.userType === "client") return false;
  return roleCan(auth.role, key, scope);
}
