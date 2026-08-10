import { NextResponse } from "next/server";
import { getBearerToken, serviceClient } from "@/utils/serverAuth";
import { recordEvent } from "@/utils/systemEvents";

export const dynamic = "force-dynamic";

/**
 * GET  /api/auth/repair-claims → what is wrong with MY claims (read-only)
 * POST /api/auth/repair-claims → repair MY claims
 *
 * THE CHICKEN-AND-EGG THIS EXISTS TO BREAK
 *  Every admin route — including /api/admin/members/sync-roles, the audit that
 *  repairs claim drift — starts with getAuthedOrg(). getAuthedOrg reads the
 *  organization, identity and role out of the caller's JWT and looks up the
 *  membership they name. When those claims are the thing that has drifted, that
 *  lookup fails and the route answers 401. So the person whose claims are
 *  broken is precisely the person who cannot reach the tool that fixes them:
 *  the only remaining repair is a human running
 *  database/052_repair_auth_claims.sql by hand.
 *
 *  This route is the way out. It repairs ONE user's claims — the caller's own —
 *  and it is the only route in the codebase that does not require the caller's
 *  claims to be correct first.
 *
 * HOW IT AUTHENTICATES WITHOUT TRUSTING THE CLAIMS
 *  Two different things are wrapped up in "the token":
 *    1. the SIGNATURE and the identity it carries (`sub`, `email`) — issued by
 *       Supabase Auth, verified here by auth.getUser(token). Nothing the caller
 *       can edit. This is trustworthy even when everything else is wrong.
 *    2. app_metadata (organization_id, app_user_id, user_type, role) — written
 *       into the auth user by this application, and the thing that goes stale.
 *  So this route authenticates on (1) and deliberately reads NOTHING from (2).
 *  The truth is then re-derived from the database, with the service role,
 *  starting from the verified identity:
 *    - profile rows (admin_users / developers) whose auth_user_id IS this
 *      verified `sub` — a link this application wrote deliberately, and
 *    - membership rows whose email IS this verified, confirmed address —
 *      the same rule 052 repairs on.
 *
 * WHY IT CANNOT BE USED TO MOVE BETWEEN ORGANIZATIONS
 *  - The request body is never read. Not validated and ignored — never parsed.
 *    There is no organizationId, userId, role or email input on this route, so
 *    there is nothing to smuggle a target in through.
 *  - The organization written into the claims is the one on the single matching
 *    membership row, which was written by that organization. The caller cannot
 *    influence which row is found: both lookup keys are fields of the verified
 *    token that only Supabase Auth can set.
 *  - AMBIGUITY IS REFUSED, NEVER GUESSED. Two or more active memberships for
 *    this identity → 409 and no write. A wrong guess would silently move
 *    somebody into a tenant they are not in, which is far worse than leaving
 *    them locked out; 052 makes the same call for the same reason.
 *  - ABSENCE IS REFUSED. No active membership → 404 and no write. There is no
 *    organization to point at, and inventing one is the same failure.
 *  - Only ACTIVE memberships count, so this cannot resurrect the access of a
 *    suspended member.
 *  - It never creates a membership, a profile row or an auth account, and never
 *    changes a role beyond copying the one the organization already recorded.
 *    A member with correct claims gains nothing by calling it.
 *
 * AFTERWARDS
 *  updateUserById changes the STORED claims. The caller's current access token
 *  still carries the old ones until it refreshes, so the response asks them to
 *  sign out and back in — the same instruction 052 ends with.
 */

// Mirrors 052: only `status = 'active'` counts. A null status cannot occur (the
// column is NOT NULL with a default) but is treated as active so a legacy row
// is never silently ignored.
function isActiveMembership(status) {
  if (!status) return true;
  return String(status).trim().toLowerCase() === "active";
}

function normalizeEmail(email) {
  return email ? String(email).trim().toLowerCase() : null;
}

function same(a, b) {
  const norm = (v) => (v === null || v === undefined ? "" : String(v));
  return norm(a) === norm(b);
}

/** The four claims RLS reads, as they should be for this membership. */
function claimsFor(membership) {
  return {
    organization_id: membership.organization_id,
    app_user_id: membership.user_id,
    user_type: membership.user_type,
    role: membership.role,
  };
}

function driftedFields(membership, claims) {
  const want = claimsFor(membership);
  const have = claims || {};
  return Object.keys(want).filter((k) => !same(have[k], want[k]));
}

/**
 * Every ACTIVE membership that belongs to this verified identity.
 *
 * Two independent routes to the same person, unioned so that a disagreement
 * between them surfaces as ambiguity rather than being resolved by whichever
 * happened to be checked first:
 *
 *  1. the auth_user_id link on the profile row. Strongest evidence — this
 *     application wrote it when the account was provisioned.
 *  2. the address on the membership row. This is what 052 matches on, and it is
 *     the only route left for a user whose profile row was never linked. The
 *     address must be CONFIRMED on the auth account: every account-creation path
 *     in this codebase sets email_confirm, so an unconfirmed address means an
 *     unverified self-signup, and letting one of those claim a membership row
 *     by address would be a way into somebody else's organization.
 */
async function findActiveMemberships(svc, authUser) {
  const found = new Map();

  // ── 1. via the profile link ──
  const [{ data: admins }, { data: devs }] = await Promise.all([
    svc.from("admin_users").select("id").eq("auth_user_id", authUser.id),
    svc.from("developers").select("id").eq("auth_user_id", authUser.id),
  ]);

  const profiles = [
    ...(admins || []).map((a) => ({ id: a.id, type: "admin" })),
    ...(devs || []).map((d) => ({ id: d.id, type: "developer" })),
  ];

  for (const p of profiles) {
    const { data } = await svc
      .from("memberships")
      .select("id, organization_id, user_id, user_type, email, role, status")
      .eq("user_id", p.id)
      .eq("user_type", p.type);
    for (const row of data || []) {
      if (isActiveMembership(row.status)) found.set(row.id, row);
    }
  }

  // ── 2. via the confirmed address ──
  const email = normalizeEmail(authUser.email);
  const emailConfirmed = Boolean(authUser.email_confirmed_at || authUser.confirmed_at);
  if (email && emailConfirmed) {
    // Matched CASE-INSENSITIVELY and loosely (`%addr%`), then filtered on a
    // normalised comparison in code. 052 matches on lower(btrim(email)) and this
    // has to agree with it: a membership stored as "ME@Example.com " must be
    // found, because missing it would turn an AMBIGUOUS identity into an
    // apparently unambiguous one and this route would then repair what it should
    // refuse. Over-matching is harmless in the other direction — a `_` or `%`
    // inside an address is a wildcard to Postgres, so the pattern can pull in
    // extra rows, and every one of them is dropped by the exact comparison
    // below before it can influence anything.
    const { data } = await svc
      .from("memberships")
      .select("id, organization_id, user_id, user_type, email, role, status")
      .ilike("email", `%${email}%`);
    for (const row of data || []) {
      if (!isActiveMembership(row.status)) continue;
      if (normalizeEmail(row.email) !== email) continue;
      found.set(row.id, row);
    }
  }

  return [...found.values()];
}

/**
 * Verify the token, then resolve the caller to at most one active membership.
 * Returns either { response } — a refusal, already shaped — or { authUser,
 * membership, claims, drift }.
 */
async function resolveSelf(request, svc, { route }) {
  const token = getBearerToken(request);
  if (!token) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  // The ONLY thing trusted from the caller: that Supabase Auth signed this
  // token and that it names this `sub` / this email.
  const { data, error } = await svc.auth.getUser(token);
  if (error || !data?.user) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const authUser = data.user;

  const memberships = await findActiveMemberships(svc, authUser);

  if (memberships.length === 0) {
    // 052's `orphan_no_member`. There is no organization to point the claims
    // at. Repairing would mean inventing one.
    await recordEvent({
      orgId: null,
      type: "auth.self_repair_refused",
      severity: "warning",
      source: "auth",
      message: "Self-repair of auth claims was refused: no active membership for this identity.",
      context: { route, userId: authUser.id, reason: "no_active_membership", count: 0, statusCode: 404 },
    });
    return {
      response: NextResponse.json(
        {
          error:
            "This account is not an active member of any organization, so there are no claims to restore. Ask an owner or admin to reinstate your membership.",
          code: "no_active_membership",
          repairable: false,
          activeMemberships: 0,
        },
        { status: 404 }
      ),
    };
  }

  if (memberships.length > 1) {
    // 052's `ambiguous_skip`. Refused on purpose — see the header. The count is
    // returned; the organizations are NOT, because naming them would disclose a
    // tenant to a caller this route has not placed in any tenant yet.
    await recordEvent({
      orgId: null,
      type: "auth.self_repair_refused",
      severity: "warning",
      source: "auth",
      message: "Self-repair of auth claims was refused: the identity matches more than one active membership.",
      context: {
        route,
        userId: authUser.id,
        reason: "ambiguous",
        count: memberships.length,
        statusCode: 409,
      },
    });
    return {
      response: NextResponse.json(
        {
          error:
            "This account matches more than one active membership, so the right organization cannot be determined automatically. An owner or admin must resolve it.",
          code: "ambiguous",
          repairable: false,
          activeMemberships: memberships.length,
        },
        { status: 409 }
      ),
    };
  }

  const membership = memberships[0];
  const claims = authUser.app_metadata || {};
  return { authUser, membership, claims, drift: driftedFields(membership, claims) };
}

/** What the caller is told about themselves. Never another tenant's data. */
function describe(membership, drift) {
  return {
    organizationId: membership.organization_id,
    userId: membership.user_id,
    userType: membership.user_type,
    role: membership.role,
    fields: drift,
    verdict: drift.length ? "will_repair" : "ok",
    activeMemberships: 1,
  };
}

export async function GET(request) {
  try {
    const svc = serviceClient();
    const resolved = await resolveSelf(request, svc, { route: "/api/auth/repair-claims" });
    if (resolved.response) return resolved.response;

    const { membership, drift } = resolved;
    // Read-only, always. The repair is a POST.
    return NextResponse.json({
      success: true,
      applied: false,
      repairable: drift.length > 0,
      ...describe(membership, drift),
    });
  } catch (err) {
    console.error("[auth/repair-claims] Failed to inspect claims:", err);
    return NextResponse.json({ error: "Could not check your account" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const svc = serviceClient();
    // NOTE: request.json() is never called. The body cannot reach any decision
    // below, because it is never read at all.
    const resolved = await resolveSelf(request, svc, { route: "/api/auth/repair-claims" });
    if (resolved.response) return resolved.response;

    const { authUser, membership, claims, drift } = resolved;

    if (drift.length === 0) {
      // Idempotent: nothing is written when nothing is wrong.
      return NextResponse.json({
        success: true,
        applied: false,
        repaired: false,
        ...describe(membership, drift),
        message: "Your account claims already match your membership. Nothing was changed.",
      });
    }

    // Merge, never replace: Supabase's own `provider` / `providers` keys and any
    // product flags in app_metadata must survive. The four claims RLS reads are
    // overwritten from the membership row — a wrong organization_id is exactly
    // what is being repaired, so preserving the existing value would be a no-op.
    const next = { ...claims, ...claimsFor(membership) };
    const { error: updateError } = await svc.auth.admin.updateUserById(authUser.id, {
      app_metadata: next,
    });

    if (updateError) {
      await recordEvent({
        orgId: membership.organization_id,
        type: "auth.self_repair_failed",
        severity: "error",
        source: "auth",
        message: "Self-repair of auth claims could not be written.",
        context: {
          route: "/api/auth/repair-claims",
          userId: membership.user_id,
          userType: membership.user_type,
          reason: "update_failed",
          statusCode: 502,
        },
      });
      return NextResponse.json(
        { error: "Your account could not be repaired. Nothing was changed." },
        { status: 502 }
      );
    }

    await recordEvent({
      orgId: membership.organization_id,
      type: "auth.self_claims_repaired",
      severity: "info",
      source: "auth",
      message: "A user repaired their own auth claims from their active membership.",
      context: {
        route: "/api/auth/repair-claims",
        userId: membership.user_id,
        userType: membership.user_type,
        role: membership.role,
        status: membership.status || null,
        reason: drift.join(","),
        count: drift.length,
      },
    });

    return NextResponse.json({
      success: true,
      applied: true,
      repaired: true,
      ...describe(membership, drift),
      verdict: "repaired",
      // Claims are baked into the access token at issue time, so the session
      // holding the broken ones keeps them until it is replaced.
      note: "Sign out and back in for the repaired claims to take effect.",
    });
  } catch (err) {
    console.error("[auth/repair-claims] Failed to repair claims:", err);
    return NextResponse.json({ error: "Could not repair your account" }, { status: 500 });
  }
}
