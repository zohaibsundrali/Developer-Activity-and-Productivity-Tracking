/** Bounded recovery only finalizes an already-created, exactly reserved Auth ID.
 * It never creates accounts, changes passwords, adopts emails, or deletes users.
 * The database claim defers each selected pending attempt for five minutes;
 * concurrent workers skip locked claims and completion is idempotent.
 */
export async function recoverProfileProvisions(svc, { limit = 10 } = {}) {
  const claimed = await svc.rpc('claim_profile_provisions', { p_limit: limit });
  if (claimed.error || !Array.isArray(claimed.data)) throw new Error('Profile provisioning recovery unavailable');
  const result = { checked: 0, completed: 0, pending: 0, errors: [] };
  for (const attempt of claimed.data) {
    result.checked += 1;
    try {
      const found = await svc.auth.admin.getUserById(attempt.auth_user_id);
      if (found.error?.status === 404 || found.error?.code === 'user_not_found') { result.pending += 1; continue; }
      if (found.error || !found.data?.user) throw new Error('Reserved Auth verification unavailable');
      const user = found.data.user, metadata = user.app_metadata || {};
      if (user.id !== attempt.auth_user_id || user.deleted_at || (user.banned_until && Date.parse(user.banned_until) > Date.now())
        || String(user.email || '').trim().toLowerCase() !== attempt.email
        || metadata.provisioning_id !== attempt.id || metadata.organization_id !== attempt.organization_id
        || metadata.app_user_id !== attempt.profile_id || metadata.user_type !== attempt.user_type || metadata.role !== attempt.role) throw new Error('Reserved Auth identity conflict');
      const done = await svc.rpc('finish_profile_provision', {
        p_org: attempt.organization_id, p_profile: attempt.profile_id, p_type: attempt.user_type,
        p_role: attempt.role, p_email: attempt.email, p_auth: attempt.auth_user_id,
      });
      if (done.error || done.data !== true) throw new Error('Profile finalization unavailable');
      result.completed += 1;
    } catch { result.errors.push({ message: "A reserved profile could not be finalized; its recorded attempt remains available for retry." }); }
  }
  return result;
}
