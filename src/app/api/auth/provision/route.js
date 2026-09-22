import { NextResponse } from "next/server";
import { rankOf, userTypeForRole, PROFILE_TABLE } from "@/utils/roles";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { authCan } from "@/utils/serverPermissions";
import { checkSeatLimitForRole } from "@/utils/entitlements";
import { recordEvent } from "@/utils/systemEvents";

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

    const body = await request.json().catch(() => null);
    if (!body || Array.isArray(body) || typeof body !== "object") return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    const { email, password, role, userType, appUserId } = body;

    if (typeof email !== "string" || typeof password !== "string" || password.length < 6 || typeof appUserId !== "string" || !appUserId) {
      return NextResponse.json(
        { error: "A profile, email and password of at least 6 characters are required" },
        { status: 400 }
      );
    }

    // ── The granted role must rank strictly below the caller's own ──
    const requestedRole = role || (userType === "admin" ? "owner" : userType === "client" ? "client" : "developer");
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

    // ── The address must not already belong to another tenant ──
    //
    // THE HOLE THIS CLOSES. This route creates a Supabase Auth account with
    // `email_confirm: true` for whatever address it is handed. It carefully
    // checks the caller's organization, permission, rank, and any supplied
    // appUserId — and never checked the EMAIL against anything.
    //
    // /api/auth/repair-claims resolves an identity by confirmed email across
    // every membership row on the platform, unscoped by organization, on the
    // stated reasoning that "every account-creation path in this codebase sets
    // email_confirm, so an unconfirmed address means an unverified self-signup".
    // This route is that path, and it sets email_confirm unconditionally — so
    // the flag proved nothing about who controls the mailbox.
    //
    // Composed, the two were a cross-tenant takeover: provision an account for
    // a member of ANOTHER organization who has a membership row but no auth
    // account yet, sign in as it, POST repair-claims, and the token is rewritten
    // to that person's organization, identity and role — up to owner.
    //
    // The population this needs is not hypothetical: it is exactly what
    // /api/admin/legacy-auth-audit exists to count, and staffAccounts.js
    // produces one every time a membership is written and the provision call
    // that follows it fails.
    //
    // Matched the way 052 and repair-claims match, on lower(btrim(email)), so a
    // row stored as "ME@Example.com " is still found. Refused with 409 whether
    // the conflict is in this organization or another, and the message names
    // neither — "already in use" tells an attacker nothing about which tenant,
    // or that another tenant exists at all.
    const normalizedEmail = String(email).trim().toLowerCase();
    const { data: emailRows, error: emailErr } = await svc
      .from("memberships")
      .select("id, organization_id")
      .ilike("email", normalizedEmail);

    if (emailErr) {
      // Fail closed. Not knowing whether the address is taken is not a reason
      // to mint a confirmed credential for it.
      console.error("[auth/provision] Could not check the address:", emailErr);
      return NextResponse.json(
        { error: "Could not verify that address right now. Try again." },
        { status: 503 }
      );
    }

    const foreign = (emailRows || []).filter(
      (row) => String(row.organization_id || "") !== String(auth.orgId || "")
    );
    if (foreign.length > 0) {
      await recordEvent({
        orgId: auth.orgId,
        type: "auth.provision_refused",
        severity: "critical",
        source: "auth",
        message:
          "Provisioning was refused: the address already belongs to another organization.",
        context: {
          route: "/api/auth/provision",
          actorUserId: auth.appUserId ?? null,
          reason: "email_belongs_to_another_org",
          statusCode: 409,
        },
      });
      return NextResponse.json(
        { error: "That email address is already in use.", code: "email_taken" },
        { status: 409 }
      );
    }

    // ── A supplied app user id must belong to the caller's organization ──
    let seatAlreadyWritten = false;
    if (appUserId) {
      const table = PROFILE_TABLE[resolvedUserType];
      const { data: row } = await svc
        .from(table)
        .select("id, organization_id, email")
        .eq("id", appUserId)
        .maybeSingle();
      if (!row || row.organization_id !== auth.orgId || String(row.email || "").trim().toLowerCase() !== normalizedEmail) {
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

    const reserved = await svc.rpc("reserve_profile_provision", {
      p_org: auth.orgId, p_profile: appUserId, p_type: resolvedUserType,
      p_role: requestedRole, p_email: normalizedEmail,
    });
    if (reserved.error || !reserved.data?.authUserId) return NextResponse.json({
      error: reserved.error?.code === "42501" ? "Saved sign-in setup conflicts with the requested role, email or identity. Retry the original details, or ask an administrator to review it." : "The profile could not be reserved for sign-in. Its saved details remain available; please retry.",
      retryable: true,
    }, { status: reserved.error?.code === "42501" ? 409 : 503 });
    const reservation = reserved.data;
    const app_metadata = {
      organization_id: auth.orgId, role: requestedRole, user_type: resolvedUserType,
      app_user_id: appUserId, provisioning_id: reservation.reservationId,
    };
    const exactIdentity = user => user?.id === reservation.authUserId && !user.deleted_at
      && !(user.banned_until && Date.parse(user.banned_until) > Date.now())
      && String(user.email || "").trim().toLowerCase() === normalizedEmail
      && ["organization_id", "role", "user_type", "app_user_id"].every(key => user.app_metadata?.[key] === app_metadata[key])
      && (reservation.alreadyLinked || user.app_metadata?.provisioning_id === reservation.reservationId);
    let user;
    let passwordSet = false;
    const found = await svc.auth.admin.getUserById(reservation.authUserId);
    if (found.error && found.error.status !== 404 && found.error.code !== "user_not_found") return NextResponse.json({ error: "Sign-in verification is temporarily unavailable. Retry this saved profile.", retryable: true }, { status: 503 });
    user = found.data?.user;
    if (!found.error && !user) return NextResponse.json({ error: "Sign-in verification returned no identity. Retry this saved profile.", retryable: true }, { status: 503 });
    if (!user) {
      if (reservation.alreadyLinked) return NextResponse.json({ error: "The linked sign-in account needs administrator review.", retryable: true }, { status: 409 });
      const created = await svc.auth.admin.createUser({ id: reservation.authUserId, email: normalizedEmail, password, email_confirm: true, app_metadata });
      user = created.data?.user;
      passwordSet = !created.error && Boolean(user);
      if (created.error || !user) {
        // A lost provider response or concurrent retry can leave the reserved
        // account present. Read only its reserved ID; never adopt by email.
        const recovered = await svc.auth.admin.getUserById(reservation.authUserId);
        user = recovered.data?.user;
        if (recovered.error || !user) return NextResponse.json({
          error: "Sign-in setup is not complete. The profile is saved; retry with the same details. An email conflict requires administrator review.", retryable: true,
        }, { status: 503 });
      }
    }
    if (!exactIdentity(user)) return NextResponse.json({ error: "Reserved sign-in identity does not match this profile. Administrator review is required.", retryable: true }, { status: 409 });
    const finished = await svc.rpc("finish_profile_provision", { p_org: auth.orgId, p_profile: appUserId, p_type: resolvedUserType, p_role: requestedRole, p_email: normalizedEmail, p_auth: user.id });
    if (finished.error || finished.data !== true) return NextResponse.json({ error: "Sign-in was created but profile synchronization is pending. Retry this saved profile.", retryable: true }, { status: 503 });
    return NextResponse.json({ success: true, userId: user.id, alreadyExists: Boolean(reservation.alreadyLinked), passwordUnchanged: !passwordSet });

  } catch {
    return NextResponse.json(
      { error: "Failed to provision auth user" },
      { status: 500 }
    );
  }
}

// Organization-scoped recovery status; never expose reserved Auth IDs or secrets.
export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (auth.userType === "client" || !authCan(auth, "member.provision")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const result = await serviceClient().rpc("profile_provision_status", { p_org: auth.orgId });
    if (result.error || !Array.isArray(result.data)) return NextResponse.json({ error: "Sign-in setup status unavailable." }, { status: 503 });
    return NextResponse.json({ attempts: result.data });
  } catch { return NextResponse.json({ error: "Sign-in setup status unavailable." }, { status: 503 }); }
}
