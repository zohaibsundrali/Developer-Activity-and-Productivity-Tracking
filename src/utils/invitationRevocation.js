export async function revokePendingInvitation(client, organizationId, invitationId) {
  if (!organizationId || !invitationId) throw new Error("Refresh invitations before revoking.");
  let result;
  try {
    result = await client.from("invitations").update({ status: "revoked" })
      .eq("organization_id", organizationId).eq("id", invitationId).eq("status", "pending")
      .select("id,status").maybeSingle();
  } catch { throw new Error("Invitation revocation could not be confirmed. Refresh and try again."); }
  if (result?.error) throw new Error("Invitation revocation could not be confirmed. Refresh and try again.");
  if (result?.data?.id !== invitationId || result?.data?.status !== "revoked") {
    throw new Error("This invitation is no longer pending or you no longer have access. Refresh invitations.");
  }
  return result.data;
}

export function createInvitationRevoker({ confirm, mutate, identity, busy, success, error, reload, refreshError = error }) {
  let pending = false;
  let alive = true;
  return {
    async run(orgId, invitation) {
      if (!alive || pending || invitation.status !== "pending") return;
      pending = true;
      const owner = identity();
      const current = () => alive && owner === identity();
      busy(invitation.id);
      try {
        const accepted = await confirm(invitation);
        if (!accepted || !current()) return;
        await mutate(orgId, invitation.id);
        if (!current()) return;
        success(invitation);
        try { await reload(); }
        catch { if (current()) refreshError("Invitation was revoked, but the list could not be refreshed. Refresh invitations."); }
      } catch (cause) {
        if (current()) error(cause.message || "Could not revoke invitation. Refresh and try again.");
      } finally {
        pending = false;
        if (alive) busy(null);
      }
    },
    dispose() { alive = false; },
  };
}
