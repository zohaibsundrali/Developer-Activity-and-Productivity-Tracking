import { isRole, rankOf } from "@/utils/roles";

/** Loose equality on claim values, where null, undefined and "" all mean absent. */
function same(a, b) {
  const norm = (v) => (v === null || v === undefined ? "" : String(v));
  return norm(a) === norm(b);
}

/**
 * Would repairing these claims RAISE the caller's role?
 *
 * THE HOLE THIS CLOSES. This route copies `memberships.role` into the JWT, and
 * `auth_role()` — which every RLS policy in the database reads — reads it back
 * out. So whoever can write that row decides what the token says. RLS lets
 * `owner`, `admin` and `hr` update membership rows in their own organization,
 * and its WITH CHECK blocks only the literal role 'owner'. An `hr` could
 * therefore set their OWN row to 'admin' straight through PostgREST with the
 * anon key the browser already holds, call this route, refresh, and be an
 * admin. The rank and self-target rules that forbid exactly that live in
 * api/admin/members/role/authorize.js — a route the attack never touches.
 *
 * The header above says this route "never changes a role beyond copying the one
 * the organization already recorded". That was the intent; "recorded" is just
 * the row's current value, and the row is writable by the person being
 * promoted.
 *
 * THE RULE. Repair may LOWER a role or leave it alone, and may SET one when the
 * token carries none — that last case is the whole point of the route, the
 * legacy account whose claims were never written. It may never RAISE one.
 * Demotions still propagate, so this cannot be used to keep a role after being
 * demoted; only the direction that grants power is refused.
 *
 * An unknown role on either side returns true — fail closed. A role that is not
 * in ROLE_RANK has no defined position, and admitting it because it cannot be
 * compared is how a typo becomes an escalation.
 */
export function wouldEscalateRole(claims, membership) {
  const target = membership?.role;
  const current = claims?.role;

  // No role in the token yet: nothing is being raised, there is nothing there.
  if (current === null || current === undefined || current === "") {
    return !isRole(target);
  }
  if (same(current, target)) return false;
  if (!isRole(current) || !isRole(target)) return true;

  return rankOf(target) > rankOf(current);
}
