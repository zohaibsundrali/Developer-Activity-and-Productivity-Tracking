import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { recordEvent } from "@/utils/systemEvents";
import { authorizeRoleChange, writeClaimFirst } from "./authorize";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/members/role — the ONLY supported way to change a member's
 * role.
 *
 * THE DEFECT THIS CLOSES
 *  `app_metadata.role` was written once, at account creation (auth/provision,
 *  auth/signup, invitations/accept) and never updated again — nothing in the
 *  codebase called auth.admin.updateUserById. RLS, however, reads that claim:
 *  migration 018 gates every `memberships` write on
 *  auth_role() in ('owner','admin','hr'). Meanwhile the browser wrote
 *  `memberships.role` directly. The two stores drifted, and the drift was not a
 *  cosmetic inconsistency:
 *
 *   - DEMOTION NEVER TOOK EFFECT. Demote an admin to developer and the app row
 *     changed while app_metadata.role stayed "admin", so auth_role() still
 *     returned admin and the demoted account could keep writing memberships —
 *     including setting its own role back. Not bounded by token lifetime: the
 *     STORED metadata was stale, so a refreshed token re-read the same wrong
 *     value. Permanent until repaired by hand.
 *   - PROMOTION HALF-WORKED. Promote to hr and the sidebar appeared (app-side
 *     role) while every write failed RLS (JWT still said developer).
 *
 * WHAT THIS ROUTE GUARANTEES
 *  - the caller is identified from a VERIFIED bearer token; org and actor come
 *    from that token and are never read from the body,
 *  - the body carries only { membershipId, role },
 *  - the authorisation matrix in ./authorize.js is applied (see it for the
 *    reasoning, including why nobody may change their own role),
 *  - BOTH stores are written; authorization rejects mismatched roles until
 *    the change is reconciled,
 *  - app_metadata is MERGED, never replaced: organization_id, user_type and
 *    app_user_id survive the update. A shallow overwrite would drop
 *    organization_id, auth_org() would return null, and the member would be
 *    locked out of their own organization by every RLS policy at once.
 *
 * SESSION REFRESH
 *  updateUserById changes stored metadata, not access tokens already issued.
 *  The API and database require matching membership and Auth roles. An old JWT
 *  cannot retain a previous role's permissions after membership changes; the
 *  member must refresh their session before using direct database requests.
 *  Numeric rank orders assignments but does not describe permission subsets:
 *  HR has people permissions that a higher-ranked Manager does not have.
 */

// A role change writes exactly this column plus the audit timestamp. Every
// other membership field stays on the direct-patch path in the client.
const ROLE_COLUMN = "role";

export async function POST(request) {
  let auth = null;
  try {
    // ── Fail closed: a valid token is required ──
    auth = await getAuthedOrg(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const membershipId = body?.membershipId ? String(body.membershipId) : null;
    const newRole = typeof body?.role === "string" ? body.role.trim() : null;

    if (!membershipId) {
      return NextResponse.json({ error: "membershipId is required" }, { status: 400 });
    }

    const svc = serviceClient();

    // The target is loaded on the service role so the lookup itself cannot be
    // shaped by the caller's (possibly stale) RLS view — but it is then checked
    // against the org from the VERIFIED token before anything is decided.
    const { data: membership, error: readError } = await svc
      .from("memberships")
      .select("id, organization_id, user_id, user_type, email, role")
      .eq("id", membershipId)
      .maybeSingle();

    if (readError) {
      return NextResponse.json({ error: "Could not read the membership" }, { status: 500 });
    }

    const verdict = authorizeRoleChange({ actor: auth, membership, newRole });
    if (!verdict.ok) {
      // Monitoring (best effort, never throws). A refused role change is worth a
      // durable record: a burst of them is someone probing the escalation path
      // that used to work. Only opaque ids and short codes are stored.
      await recordEvent({
        orgId: auth.orgId,
        type: "auth.role_change_refused",
        severity: "warning",
        source: "api",
        message: "A member role change was refused.",
        context: {
          route: "/api/admin/members/role",
          userId: auth.appUserId || null,
          userType: auth.userType || null,
          role: auth.role || null,
          statusCode: verdict.status,
        },
      });
      return NextResponse.json({ error: verdict.error }, { status: verdict.status });
    }

    const currentRole = membership.role || null;

    // ── Resolve the target's Supabase Auth account ──
    // memberships is keyed on (user_id, user_type); the auth user id lives on
    // the profile row (admin_users / developers, column added in 012).
    const profileTable = membership.user_type === "admin" ? "admin_users" : "developers";
    const { data: profile } = await svc
      .from(profileTable)
      .select("id, organization_id, auth_user_id")
      .eq("id", membership.user_id)
      .maybeSingle();

    const authUserId =
      profile && String(profile.organization_id || "") === String(auth.orgId || "")
        ? profile.auth_user_id || null
        : null;

    // ── The two writes ──
    const writeClaim = async () => {
      if (!authUserId) return { skipped: true };

      // Read-modify-write: the OTHER claims must survive. organization_id in
      // particular is what auth_org() returns, and losing it locks the member
      // out of every table in their own org.
      const { data: existingUser, error: getError } = await svc.auth.admin.getUserById(authUserId);
      if (getError || !existingUser?.user) {
        return { error: getError || new Error("Auth user not found") };
      }
      const existing = existingUser.user.app_metadata || {};
      // A secondary workspace role must not rewrite the identity's primary
      // workspace role. Selected-session tokens read this membership directly.
      if (existing.organization_id && existing.organization_id !== auth.orgId) return { skipped: true };
      const { error } = await svc.auth.admin.updateUserById(authUserId, {
        app_metadata: { ...existing, role: newRole },
      });
      return error ? { error } : { ok: true };
    };

    const writeRow = async () => {
      const { error } = await svc
        .from("memberships")
        .update({ [ROLE_COLUMN]: newRole, updated_at: new Date().toISOString() })
        .eq("id", membership.id)
        .eq("organization_id", auth.orgId);
      return error ? { error } : { ok: true };
    };

    // Preserve the established write order, but do not treat numeric rank as
    // a permission intersection. API/database authorization rejects role drift.
    const claimFirst = writeClaimFirst(currentRole, newRole);
    const [first, second] = claimFirst ? [writeClaim, writeRow] : [writeRow, writeClaim];
    const firstName = claimFirst ? "auth_claim" : "membership_row";
    const secondName = claimFirst ? "membership_row" : "auth_claim";

    const firstResult = await first();
    if (firstResult.error) {
      // Nothing was written. The member keeps their previous role in both
      // stores, which is consistent and safe.
      await recordEvent({
        orgId: auth.orgId,
        type: "auth.role_change_failed",
        severity: "error",
        source: "api",
        message: `Role change aborted before any write (${firstName} failed).`,
        context: {
          route: "/api/admin/members/role",
          userId: membership.user_id,
          userType: membership.user_type,
          role: newRole,
          reason: firstName,
        },
      });
      return NextResponse.json(
        { error: "Could not change the role. Nothing was changed." },
        { status: 502 }
      );
    }

    const secondResult = await second();
    if (secondResult.error) {
      // One store changed and the other did not. Requests with mismatched
      // roles are rejected. Retry this requested change: blindly syncing from
      // memberships could undo a demotion whose membership write failed.
      await recordEvent({
        orgId: auth.orgId,
        type: "auth.role_change_partial",
        severity: "error",
        source: "api",
        message: `Role change applied to ${firstName} but ${secondName} failed; mismatched role claims require reconciliation before access.`,
        context: {
          route: "/api/admin/members/role",
          userId: membership.user_id,
          userType: membership.user_type,
          role: newRole,
          reason: secondName,
        },
      });
      return NextResponse.json(
        {
          error:
            "The role change was only partly applied. Requests with mismatched roles are blocked. Retry this role change, then ask the member to refresh their session.",
          partial: true,
          requestedRole: newRole,
          applied: firstName,
          failed: secondName,
          role: claimFirst ? currentRole : newRole,
        },
        { status: 500 }
      );
    }

    const claimResult = claimFirst ? firstResult : secondResult;
    const authUpdated = !!claimResult.ok;

    await recordEvent({
      orgId: auth.orgId,
      type: "auth.role_changed",
      severity: "info",
      source: "api",
      message: "A member role was changed.",
      context: {
        route: "/api/admin/members/role",
        userId: membership.user_id,
        userType: membership.user_type,
        role: newRole,
        reason: currentRole || "unset",
      },
    });

    return NextResponse.json({
      success: true,
      membershipId: membership.id,
      previousRole: currentRole,
      role: newRole,
      // false means the member has no linked Supabase Auth account yet (invited
      // but never provisioned, or a legacy row with no auth_user_id). Their
      // claims will be stamped at account creation, so there is nothing stale to
      // repair — but the caller is told rather than left to assume.
      authUpdated,
      sessionRefreshRequired: authUpdated && currentRole !== newRole,
      ...(authUpdated
        ? {}
        : {
            warning:
              "This member has no linked auth account, so only the membership row was updated.",
          }),
    });
  } catch (err) {
    console.error("[admin/members/role] Failed to change role:", err);
    return NextResponse.json({ error: "Failed to change the role" }, { status: 500 });
  }
}
