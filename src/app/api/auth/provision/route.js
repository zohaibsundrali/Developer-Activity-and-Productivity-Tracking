import { NextResponse } from "next/server";
import { rankOf, userTypeForRole, PROFILE_TABLE } from "@/utils/roles";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { authCan } from "@/utils/serverPermissions";
import { checkSeatLimitForRole } from "@/utils/entitlements";

export const dynamic = "force-dynamic";

/**
 * Create a Supabase Auth account carrying organization claims in app_metadata
 * (so the JWT drives RLS). Called by the admin "Add developer" flow.
 *
 * SECURITY (audit finding C2): this route previously had NO authentication and
 * took `organizationId` and `role` straight from the request body — anyone on
 * the internet could mint an owner account for any organization, which defeats
 * every RLS policy in the system.
 *
 * It is now fail-closed:
 *   - the caller must present a valid JWT (401 otherwise),
 *   - the organization is taken from the caller's own token, never the body,
 *   - the caller must hold a people-ops role, and
 *   - the granted role must rank strictly below the caller's own.
 *
 * Registration and invite-accept do NOT use this route; they call createUser
 * directly with server-derived claims.
 */

// Mirrors ROLE_RANK in src/utils/permissions.js. Inlined so the server never
// depends on a client module.
// ROLE_RANK is NOT redeclared here any more. This file used to keep its own
// copy, and when designer/qa/finance were added only the other copy was
// updated — so those three could be assigned in Organization -> Members but
// could not have a login created, because this lookup found nothing and
// answered "Unknown role". See src/utils/roles.js.

// Roles permitted to provision an account for someone else.
// Managers provision too: a project manager onboarding a client for their own
// project should not have to queue behind an admin for the login.

export async function POST(request) {
  try {
    // ── Fail closed: a valid token is required ──
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (auth.userType === "client") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // The `requestedRank >= callerRank` refusal below stays — same reason as
    // in the invitations route.
    if (!authCan(auth, "member.provision")) {
      return NextResponse.json(
        { error: "Forbidden: your role cannot create accounts" },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { email, password, role, userType, appUserId } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "email and password are required" },
        { status: 400 }
      );
    }

    // ── The granted role must rank strictly below the caller's own ──
    const requestedRole = role || (userType === "admin" ? "admin" : userType === "client" ? "client" : "developer");
    // The profile table follows the ROLE, not the caller's `userType` hint:
    // asking for role "client" and userType "developer" must not write a
    // developer seat with a client's rank.
    const resolvedUserType = userTypeForRole(requestedRole);
    const callerRank = rankOf(auth.role) ?? 0;
    const requestedRank = rankOf(requestedRole);
    if (requestedRank === null) {
      return NextResponse.json({ error: "Unknown role" }, { status: 400 });
    }
    if (requestedRank >= callerRank) {
      return NextResponse.json(
        { error: `Forbidden: you cannot grant the "${requestedRole}" role` },
        { status: 403 }
      );
    }

    const svc = serviceClient();

    // ── A supplied app user id must belong to the caller's organization ──
    let seatAlreadyWritten = false;
    if (appUserId) {
      const table = PROFILE_TABLE[resolvedUserType];
      const { data: row } = await svc
        .from(table)
        .select("id, organization_id")
        .eq("id", appUserId)
        .maybeSingle();
      if (!row || row.organization_id !== auth.orgId) {
        return NextResponse.json(
          { error: "Target user does not belong to your organization" },
          { status: 403 }
        );
      }
      // The caller already wrote the profile row before asking for an auth
      // account, so the live count includes this seat. Counting it again would
      // refuse the last seat the plan actually sells.
      seatAlreadyWritten = true;
    }

    // Provisioning creates a real seat, so it is subject to the same plan limit
    // as an invitation — otherwise the cheaper path around the invite flow
    // would quietly hand out unlimited accounts. Which meters apply follows the
    // role being granted: an admin lands in admin_users and a developer in
    // developers, and only the second is what the `developers` limit counts.
    const seatLimit = await checkSeatLimitForRole(
      svc,
      auth.orgId,
      requestedRole,
      new Date(),
      { alreadyCounted: seatAlreadyWritten ? 1 : 0 }
    );
    if (seatLimit) {
      return NextResponse.json(seatLimit, { status: seatLimit.status });
    }

    // ── Organization comes from the verified token, never the body ──
    const app_metadata = {
      organization_id: auth.orgId,
      role: requestedRole,
      user_type: resolvedUserType,
      app_user_id: appUserId || null,
    };

    const { data, error } = await svc.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata,
    });

    if (error) {
      // Already-registered is not fatal for this flow.
      if (/already|exists|registered/i.test(error.message || "")) {
        return NextResponse.json({ success: true, alreadyExists: true });
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, userId: data?.user?.id || null });
  } catch {
    return NextResponse.json(
      { error: "Failed to provision auth user" },
      { status: 500 }
    );
  }
}
