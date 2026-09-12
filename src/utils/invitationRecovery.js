const isMissing = error => error?.status === 404 || error?.code === "user_not_found";

/** Recover only expired/revoked attempts claimed under a database lease. */
export async function recoverInvitations(svc) {
  const { data, error } = await svc.rpc("claim_invitation_cleanup", { p_limit: 50 });
  if (error) throw new Error("Invitation recovery lookup unavailable");
  let cleaned = 0;
  const errors = [];
  for (const attempt of data || []) {
    try {
      const { data: auth, error: authError } = await svc.auth.admin.getUserById(attempt.auth_user_id);
      if ((authError && !isMissing(authError)) || (!authError && !auth?.user)) throw new Error("Auth lookup unavailable");
      if (auth?.user) {
        const meta = auth.user.app_metadata || {};
        if (auth.user.id !== attempt.auth_user_id || meta.invitation_id !== attempt.invitation_id || meta.organization_id !== attempt.organization_id || meta.app_user_id !== attempt.profile_id) {
          throw new Error("Reserved account identity mismatch");
        }
        const { error: deleteError } = await svc.auth.admin.deleteUser(attempt.auth_user_id);
        if (deleteError && !isMissing(deleteError)) throw new Error("Auth cleanup unavailable");
        const { data: remaining, error: verifyError } = await svc.auth.admin.getUserById(attempt.auth_user_id);
        if (remaining?.user || !isMissing(verifyError)) throw new Error("Auth cleanup confirmation unavailable");
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
