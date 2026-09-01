import { authFetch } from "@/utils/authFetch";
import { showConfirm, showPre, showWarning } from "@/utils/alerts";

/**
 * Permanently deleting a developer, and everything filed under them.
 *
 * This used to live inside src/components/admin/ViewDevelopers.jsx. That screen
 * has left the sidebar — Employees shows everyone now — and this is the one
 * thing it could do that Employees could not, so it moved here rather than
 * being lost with it.
 *
 * IT IS NOT THE SAME ACTION AS DEACTIVATE, and the directory offers both on
 * purpose. Deactivating writes `memberships.status` and revokes access at the
 * next login; the person, their projects and their logged hours all still
 * exist, and it is reversible. This deletes their Supabase Auth login, their
 * membership (which frees the paid seat), their own tasks, their own
 * submissions and their activity log, and it is not reversible. Almost every
 * real case — somebody left the company — wants the first one.
 *
 * WHAT IT DOES NOT TOUCH, AND WHY THAT IS A FIX
 *
 * The projects they were assigned to are KEPT and merely unassigned, and so is
 * every other contributor's work on them. Until this was corrected the route
 * deleted by `project_id`: one leaver took whole projects with them, along with
 * their colleagues' tasks and submitted proof-of-work, while this dialog
 * cheerfully showed counts filtered by `developer_id`. The numbers below now
 * come from the same code the delete runs, so they describe the delete that is
 * about to happen.
 *
 * WHY THE FLOW IS THIS LONG
 *
 *   1. A dry-run GET asks the server what would be destroyed.
 *   2. The counts are shown, and confirmed.
 *   3. Confirmed a second time, naming the person.
 *   4. Only then the DELETE, carrying the PRIMARY KEY.
 *
 * Step 1 exists because "delete this developer" and "delete these 3 projects,
 * 41 tasks and 260 activity rows" are different decisions, and only the server
 * knows which one is being taken. Step 4 sends `developerId` and never falls
 * back to the email or the user_id: those are not unique in the same way, and
 * resolving the target from one of them is how the wrong person gets deleted.
 *
 * The caller is responsible for the re-entrancy lock — two clicks on two rows
 * must not both get this far. See `deletingId` in the directory.
 *
 * Returns { deleted, cancelled, error }. `cancelled` is not a failure and is
 * reported to nobody; the person changed their mind, which the two
 * confirmations were there to allow.
 */
export async function deleteDeveloperAccount({ developer, actor }) {
  if (!developer?.id) {
    return { deleted: false, cancelled: false, error: "No developer to delete." };
  }

  // Captured before any await, so a re-render cannot change what is deleted
  // between the confirmation and the request.
  const devId = developer.id;
  const devName = developer.name || developer.email || "this developer";
  const devEmail = developer.email || "";
  const devUserId = developer.user_id || "";

  // Ownership pre-check, where the row records who added them.
  //
  // This comment used to claim "The route repeats it against the caller's
  // verified token". It did not — the route's copy of the check
  // (isAdminAuthorizedForDeveloper) was defined and called from nowhere, so the
  // only place this rule existed was here, in the browser, where anyone able to
  // send a DELETE never meets it. The route now runs it against `auth` from the
  // verified JWT, with one difference worth knowing about here: an OWNER is
  // exempt, so an owner cleaning up after a departed admin is allowed through
  // server-side even when this pre-check would have refused them.
  if (actor) {
    const hasOwnershipInfo =
      developer.added_by || developer.added_by_admin || developer.admin_id;
    const isOwner =
      developer.added_by === actor.id || developer.added_by_admin === actor.email;
    if (hasOwnershipInfo && !isOwner) {
      return {
        deleted: false,
        cancelled: false,
        error: "You can only delete developers you added.",
      };
    }
  }

  try {
    // ── 1. What would this destroy? ──
    const impactParams = new URLSearchParams({
      developerId: devId,
      userId: devUserId,
      developerEmail: devEmail,
    }).toString();
    const impactResponse = await authFetch(`/api/developer/delete?${impactParams}`);
    const impactData = await impactResponse.json().catch(() => ({}));

    if (!impactResponse.ok || !impactData?.success) {
      return {
        deleted: false,
        cancelled: false,
        error: impactData?.error || "Could not work out what deleting this would remove.",
      };
    }

    // ── 2. Confirm, with the counts ──
    const { impact, warning } = impactData;
    const confirmed = await showConfirm(
      "Confirm deletion",
      `WARNING: This action cannot be undone!\n\n` +
        `Delete Developer: ${devName} (${devEmail})\n\n` +
        `Their login and their seat are removed, and this data is permanently deleted:\n` +
        `• Tasks:         ${impact.tasks}\n` +
        `• Submissions:   ${impact.submissions}\n` +
        `• Activity logs: ${impact.activities}\n\n` +
        // Kept, unassigned — listed apart from the deletions above so the two
        // are not read as one list. This line said "Projects: 3" directly above
        // "will be permanently deleted" while the route was destroying them.
        `Projects kept, and left unassigned: ${impact.projects}\n\n` +
        `${warning}\n\n` +
        `Are you absolutely sure you want to proceed?`,
      { pre: true, confirmButtonText: "Yes, delete", confirmButtonColor: "#dc2626" }
    );
    if (!confirmed) return { deleted: false, cancelled: true, error: null };

    // ── 3. Confirm again, naming them ──
    const finalConfirmed = await showConfirm(
      "Final confirmation",
      `FINAL CONFIRMATION\n\n` +
        `You are about to permanently delete "${devName}".\n\n` +
        `Click to proceed.`,
      { pre: true, confirmButtonText: "Delete permanently", confirmButtonColor: "#dc2626" }
    );
    if (!finalConfirmed) return { deleted: false, cancelled: true, error: null };

    // ── 4. Delete, by primary key ──
    const deleteResponse = await authFetch("/api/developer/delete", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        developerId: devId, // the UUID pk, the single source of truth
        developerEmail: devEmail, // context only; the route uses the id first
        userId: devUserId,
        adminId: actor?.id,
        adminEmail: actor?.email,
      }),
    });
    const deleteData = await deleteResponse.json().catch(() => ({}));

    if (!deleteResponse.ok || !deleteData?.success) {
      return {
        deleted: false,
        cancelled: false,
        error: deleteData?.error || "The deletion failed.",
      };
    }

    const summary = deleteData.deletionSummary;
    showPre(
      "Developer deleted",
      `Developer deleted successfully!\n\n` +
        `Name:  ${summary?.developer?.name || devName}\n` +
        `Email: ${summary?.developer?.email || devEmail}\n\n` +
        `Access revoked:\n` +
        // The login is the half that stops them signing in. It is reported
        // rather than assumed because a legacy row with no auth_user_id has no
        // login this route can find — see the route's revocation step.
        `• Login:       ${summary?.accessRevoked?.login ? "removed" : "none was linked"}\n` +
        `• Seat:        freed\n\n` +
        `Data removed:\n` +
        `• Tasks:       ${summary?.relatedDataDeleted?.tasks ?? 0}\n` +
        `• Submissions: ${summary?.relatedDataDeleted?.submissions ?? 0}\n` +
        `• Activity:    ${summary?.relatedDataDeleted?.activities ?? 0}\n\n` +
        `Projects kept and unassigned: ${summary?.projectsUnassigned ?? 0}`,
      "success"
    );

    return { deleted: true, cancelled: false, error: null };
  } catch (error) {
    return {
      deleted: false,
      cancelled: false,
      error: error?.message || "An unexpected error occurred.",
    };
  }
}

/** Convenience wrapper: runs the flow and reports its own refusal. */
export async function confirmAndDeleteDeveloper({ developer, actor }) {
  const result = await deleteDeveloperAccount({ developer, actor });
  if (result.error) showWarning("Not deleted", result.error);
  return result;
}
