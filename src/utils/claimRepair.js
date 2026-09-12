import { isRole, rankOf } from "@/utils/roles";
import { permissionsForRole } from "@/utils/permissionCatalogue";

/** Loose equality on claim values, where null, undefined and "" all mean absent. */
function same(a, b) {
  const norm = (v) => (v === null || v === undefined ? "" : String(v));
  return norm(a) === norm(b);
}

/**
 * Self-service claim repair may restore a missing role from an already linked
 * active membership. For an existing role it must neither raise rank nor add
 * capabilities. Role changes that add capabilities use the authorized member
 * role workflow, even when their numeric rank is lower.
 */
export function wouldEscalateRole(claims, membership) {
  const target = membership?.role;
  const current = claims?.role;

  // No role in the token yet: nothing is being raised, there is nothing there.
  if (current === null || current === undefined || current === "") {
    return !isRole(target);
  }
  if (!isRole(current) || !isRole(target)) return true;
  if (same(current, target)) return false;

  if (rankOf(target) > rankOf(current)) return true;
  // Numeric rank is not a capability hierarchy: Manager -> HR would add HR
  // permissions despite lowering rank. Such changes need the authorized role
  // change workflow; self-service repair must not introduce new capabilities.
  const currentPermissions = new Set(permissionsForRole(current));
  return permissionsForRole(target).some(key => !currentPermissions.has(key));
}
