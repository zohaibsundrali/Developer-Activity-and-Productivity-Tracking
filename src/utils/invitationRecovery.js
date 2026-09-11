/** Recover only expired/revoked attempts claimed under a database lease. */
export async function recoverInvitations(svc) {
  const { data, error } = await svc.rpc("claim_invitation_cleanup", { p_limit: 50 });
  if (error) throw new Error("Invitation recovery lookup unavailable");
  let cleaned = 0;
  const errors = [];
  for (const attempt of data || []) {
    try {
      const { data: auth, error: authError } = await svc.auth.admin.getUserById(attempt.auth_user_id);
      if (authError && authError.status !== 404 && authError.code !== "user_not_found") throw new Error("Auth lookup unavailable");
      if (auth?.user) {
        const meta = auth.user.app_metadata || {};
        if (meta.invitation_id !== attempt.invitation_id || meta.organization_id !== attempt.organization_id || meta.app_user_id !== attempt.profile_id) {
          throw new Error("Reserved account identity mismatch");
        }
        const { error: deleteError } = await svc.auth.admin.deleteUser(attempt.auth_user_id);
        if (deleteError) throw new Error("Auth cleanup unavailable");
      }
      const { error: finishError } = await svc.rpc("finish_invitation_cleanup", { p_id: attempt.invitation_id, p_claim: attempt.claim_id });
      if (finishError) throw new Error("Cleanup confirmation unavailable");
      cleaned += 1;
    } catch (error) {
      errors.push({ invitationId: attempt.invitation_id, message: error.message });
    }
  }
  return { cleaned, errors };
}
