/**
 * The authorisation matrix for a role change, and the rule that decides which
 * of the two stores is written first.
 *
 * This lives beside the route rather than inside it so the decision can be
 * tested directly — a role change is authorised by pure data (who the caller
 * is, who the target is, what role is being granted), and none of that needs a
 * database or an HTTP request to exercise.
 *
 * WHY A SINGLE PATH EXISTS AT ALL
 *  A member's role is stored twice: in `memberships.role` (what the app reads)
 *  and in the Supabase Auth user's `app_metadata.role` (what RLS reads, via
 *  public.auth_role()). Until now the browser wrote only the first. The second
 *  was written once at account creation and never again, so:
 *    - a demotion never took effect — the JWT claim stayed privileged, and
 *      because the STORED app_metadata was stale, refreshing the token re-read
 *      the same wrong value. Permanent, not bounded by token lifetime.
 *    - a promotion half-worked — the UI unlocked, every write failed RLS.
 *  Both stores must move together, and that only happens if there is exactly
 *  one writer. This module is its rulebook.
 */

// Mirrors ROLE_RANK in src/utils/permissions.js and in the provision route.
// Inlined so the server never depends on a client module.
export const ROLE_RANK = {
  owner: 8,
  admin: 7,
  manager: 6,
  hr: 5,
  team_lead: 4,
  developer: 3,
  employee: 2,
  client: 1,
};

// The 8 roles the `memberships.role` CHECK constraint accepts (010, widened by
// 015 with team_lead + hr). A value outside this set is rejected here so the
// caller gets a sentence rather than a raw constraint violation.
export const VALID_ROLES = Object.keys(ROLE_RANK);

// Who may change anyone's role at all. Mirrors the memberships_update policy in
// migration 018: auth_role() in ('owner','admin','hr').
export const ROLE_CHANGERS = ["owner", "admin", "hr"];

function rank(role) {
  return ROLE_RANK[role] || 0;
}

/**
 * Is this membership row the caller's own?
 *
 * Primary identity is (app_user_id, user_type) from the verified token, which
 * is exactly the pair `memberships` is keyed on. Email is checked as a second
 * signal only, for legacy accounts provisioned before app_user_id was stamped
 * into app_metadata — without it those callers would slip past the self-change
 * refusal, which is the one rule that keeps the escalation from being
 * self-sustaining.
 */
export function isSelfTarget(actor, membership) {
  if (!actor || !membership) return false;

  const actorUserId = actor.appUserId ? String(actor.appUserId) : null;
  const targetUserId = membership.user_id ? String(membership.user_id) : null;
  if (
    actorUserId &&
    targetUserId &&
    actorUserId === targetUserId &&
    String(actor.userType || "") === String(membership.user_type || "")
  ) {
    return true;
  }

  const actorEmail = actor.email ? String(actor.email).trim().toLowerCase() : null;
  const targetEmail = membership.email ? String(membership.email).trim().toLowerCase() : null;
  return !!actorEmail && actorEmail === targetEmail;
}

/**
 * The matrix. Returns { ok: true } or { ok: false, status, error }.
 *
 *  1. clients are not org staff and never change roles;
 *  2. only owner / admin / hr may change a role at all (mirrors RLS 018);
 *  3. the new role must be one of the 8 known roles;
 *  4. the target must exist and be in the caller's own organization;
 *  5. NOBODY changes their own role — not even an owner. This is the loop that
 *     made the original defect self-sustaining: a stale-privileged member could
 *     simply set their own row back. Removing the loop is what makes a demotion
 *     stick, and an owner who needs their own role changed asks another owner,
 *     which is the correct number of people for that decision;
 *  6. only an owner may GRANT owner or take it away — an admin cannot mint a
 *     peer above themselves, nor unseat the person above them;
 *  7. for a non-owner caller, both the role being granted AND the target's
 *     current role must rank strictly BELOW the caller's own. The first stops
 *     hr promoting anyone to admin (or to hr); the second stops hr demoting an
 *     admin, which would otherwise let a people-ops account dismantle the
 *     administrators above it one row at a time.
 *
 * An owner is exempt from (7) only: they outrank every role, so "strictly
 * below" is already true for everything except owner itself, which (6) governs.
 */
export function authorizeRoleChange({ actor, membership, newRole }) {
  if (!actor) return { ok: false, status: 401, error: "Unauthorized" };

  if (actor.userType === "client" || actor.role === "client") {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  if (!ROLE_CHANGERS.includes(actor.role)) {
    return {
      ok: false,
      status: 403,
      error: "Forbidden: your role cannot change member roles",
    };
  }

  if (!newRole || !VALID_ROLES.includes(newRole)) {
    return { ok: false, status: 400, error: "Unknown role" };
  }

  if (!membership) {
    return { ok: false, status: 404, error: "Member not found in your organization" };
  }

  // Cross-tenant targets are reported as "not found", not "forbidden" — a 403
  // would confirm that the membership id exists in some other organization.
  if (String(membership.organization_id || "") !== String(actor.orgId || "")) {
    return { ok: false, status: 404, error: "Member not found in your organization" };
  }

  if (isSelfTarget(actor, membership)) {
    return {
      ok: false,
      status: 403,
      error: "You cannot change your own role. Ask another owner or admin.",
    };
  }

  const currentRole = membership.role || null;

  if ((newRole === "owner" || currentRole === "owner") && actor.role !== "owner") {
    return {
      ok: false,
      status: 403,
      error: "Only an owner may grant or revoke the owner role",
    };
  }

  if (actor.role !== "owner") {
    const callerRank = rank(actor.role);
    if (rank(newRole) >= callerRank) {
      return {
        ok: false,
        status: 403,
        error: `Forbidden: you cannot grant the "${newRole}" role`,
      };
    }
    if (currentRole && rank(currentRole) >= callerRank) {
      return {
        ok: false,
        status: 403,
        error: `Forbidden: you cannot change the role of a "${currentRole}"`,
      };
    }
  }

  return { ok: true };
}

/**
 * WHICH STORE GOES FIRST.
 *
 * There is no transaction spanning Postgres and the Auth user store, so a
 * failure between the two writes always leaves a mismatch. The only choice
 * available is WHICH mismatch, and the two are not equally bad:
 *
 *   - a stale-PERMISSIVE state (RLS still believes the higher role) is a live
 *     privilege escalation — precisely the defect being fixed;
 *   - a stale-RESTRICTIVE state (RLS believes the lower role) is an annoyance:
 *     the member sees UI they cannot yet write through, and /sync-roles or a
 *     retry repairs it.
 *
 * So: always write whichever store ends up holding the LOWER privilege first.
 * On a demotion that is the JWT claim (drop the privilege before the app row
 * advertises it); on a promotion it is the membership row (record the intent
 * before the claim grants anything). Either way the intermediate state is the
 * MINIMUM of the old and new role, never the maximum.
 *
 * Returns true when the auth claim must be written first.
 */
export function writeClaimFirst(currentRole, newRole) {
  return rank(newRole) < rank(currentRole);
}
