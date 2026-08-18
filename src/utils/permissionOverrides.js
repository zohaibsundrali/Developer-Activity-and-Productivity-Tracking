/**
 * Per-person permission grants and denies, loaded for a verified caller.
 *
 * WHAT THIS IS FOR. The catalogue says what a ROLE may do. Real organizations
 * always have exceptions — the contractor who may not see billing, the senior
 * developer trusted to review, the manager on leave whose approvals are paused.
 * Encoding those as new roles is how a twelve-role product becomes a
 * forty-role product where no two roles differ by more than one permission.
 *
 * THE RESOLUTION ORDER LIVES IN permissionEngine.js and is unchanged: a deny
 * beats everything, then a grant, then the project role, then the org role,
 * then refuse. This module only supplies the `overrides` map that order reads.
 *
 * ── The failure modes, which are the whole design ──────────────────────────
 *
 * There are two ways this lookup can not answer, and they must NOT be treated
 * the same, because one of them is safe and the other is a security decision:
 *
 *   TABLE ABSENT (PGRST205). The migration has not been applied. No override
 *   can exist, because there is nowhere to have stored one — so "no overrides"
 *   is not a guess, it is the truth, and the caller falls through to their role
 *   exactly as they did before this file existed. Safe. Logged once per
 *   process so it is visible without flooding.
 *
 *   QUERY FAILED (anything else — network, timeout, permission). Overrides may
 *   exist and we could not read them. Returning "no overrides" here would
 *   silently ignore every DENY in the organization, which is fail-OPEN on the
 *   one direction that exists specifically to take access away. So this throws,
 *   and the route answers 503 rather than quietly granting.
 *
 * That distinction is the reason this is a module and not three lines inline.
 */

/** Thrown when overrides could not be read and their absence cannot be trusted. */
export class OverridesUnavailableError extends Error {
  constructor(cause) {
    super("Permission overrides could not be read.");
    this.name = "OverridesUnavailableError";
    this.cause = cause;
  }
}

/** PostgREST's code for "no such table in the schema cache". */
const TABLE_ABSENT = "PGRST205";

/**
 * Logged once per process, not once per request. A missing migration is a
 * standing condition, and a line per API call would bury it.
 */
let absenceReported = false;
function reportAbsence() {
  if (absenceReported) return;
  absenceReported = true;
  console.warn(
    "[permissions] user_permissions table is absent — per-person overrides are " +
      "inactive and every caller resolves by role alone. Apply database/069."
  );
}

/**
 * `{ "billing.view": false, "task.review": true }` for one member, or `{}`.
 *
 * Keyed by MEMBERSHIP, not by user: the same person in two organizations is two
 * memberships, and an exception granted in one must not follow them to the
 * other. That is the same boundary every other table here draws.
 *
 * TAKES THE CLIENT RATHER THAN MAKING ONE. serverAuth calls this, and this
 * importing `serviceClient` back out of serverAuth would be a cycle — the kind
 * that resolves to `undefined` at module-init time and fails only in
 * production, on the auth path. The caller already holds an admin client.
 *
 * @param {object} svc  a service-role Supabase client
 * @param {{orgId?: string|null, appUserId?: string|null, userType?: string|null}} auth
 * @returns {Promise<Record<string, boolean>>}
 * @throws {OverridesUnavailableError} when the table exists but could not be read
 */
export async function loadOverrides(svc, auth) {
  if (!svc || !auth?.orgId || !auth?.appUserId || !auth?.userType) return {};

  // Service role, deliberately. RLS on user_permissions restricts writes to
  // whoever may manage permissions; a caller reading their OWN effective
  // permissions is not the same question and must not require them to hold the
  // management permission. The organization + user filters below are what scope
  // this, and they come from a verified token.
  const { data, error } = await svc
    .from("user_permissions")
    .select("permission_key, allowed, memberships!inner(organization_id, user_id, user_type)")
    .eq("memberships.organization_id", auth.orgId)
    .eq("memberships.user_id", auth.appUserId)
    .eq("memberships.user_type", auth.userType);

  if (error) {
    if (error.code === TABLE_ABSENT) {
      reportAbsence();
      return {};
    }
    throw new OverridesUnavailableError(error);
  }

  const out = {};
  for (const row of data || []) {
    // Only true and false are answers. The column is a real boolean, so
    // anything else would have to be null — which means "row exists, decision
    // withdrawn", and the safe reading of that is to fall through to the role.
    if (row.allowed === true || row.allowed === false) {
      out[row.permission_key] = row.allowed;
    }
  }
  return out;
}
