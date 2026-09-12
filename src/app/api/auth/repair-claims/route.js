import { NextResponse } from "next/server";
import { getBearerToken, serviceClient } from "@/utils/serverAuth";
import { wouldEscalateRole } from "@/utils/claimRepair";
import { recordEvent } from "@/utils/systemEvents";
import { PROFILE_TABLE } from "@/utils/roles";

export const dynamic = "force-dynamic";

/**
 * Explicit self-service metadata repair only. Supabase verifies the caller;
 * an existing typed profile auth_user_id link and same-organization active
 * membership establish identity. Confirmed email is used only to detect
 * ambiguity or explain a missing link, never to authorize a repair. Missing
 * links require operator reconciliation; this route never writes profiles.
 * Request body is intentionally ignored. Role escalation remains forbidden.
 */
function isActiveMembership(status) {
  return status === "active";
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

function checkedRows(result) {
  if (result.error) throw Object.assign(new Error("Identity lookup unavailable"), { code: "identity_lookup_unavailable" });
  return result.data || [];
}

/** Email candidates cannot authorize repair without an existing profile link. */
async function findActiveMemberships(svc, authUser) {
  const found = new Map();

  // ── 1. via the profile link ──
  const profileTypes = Object.keys(PROFILE_TABLE);
  const results = await Promise.all(profileTypes.map(type =>
    svc.from(PROFILE_TABLE[type]).select("id, organization_id").eq("auth_user_id", authUser.id)
  ));
  const profiles = results.flatMap((result, index) => checkedRows(result).map(p => ({
    ...p, type: profileTypes[index],
  })));
  const linkedMemberships = new Set();

  for (const p of profiles) {
    const result = await svc
      .from("memberships")
      .select("id, organization_id, user_id, user_type, email, role, status, deletion_blocked")
      .eq("user_id", p.id)
      .eq("user_type", p.type)
      .eq("organization_id", p.organization_id);
    for (const row of checkedRows(result)) {
      if (isActiveMembership(row.status) && row.deletion_blocked !== true) {
        found.set(row.id, row);
        linkedMemberships.add(row.id);
      }
    }
  }

  // ── 2. via the confirmed address ──
  const email = normalizeEmail(authUser.email);
  const emailConfirmed = Boolean(authUser.email_confirmed_at);
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
    const result = await svc
      .from("memberships")
      .select("id, organization_id, user_id, user_type, email, role, status, deletion_blocked")
      .ilike("email", `%${email}%`);
    for (const row of checkedRows(result)) {
      if (!isActiveMembership(row.status) || row.deletion_blocked === true) continue;
      if (normalizeEmail(row.email) !== email) continue;
      found.set(row.id, row);
    }
  }

  return { memberships: [...found.values()], linkedMemberships };
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

  let candidates;
  try {
    candidates = await findActiveMemberships(svc, authUser);
  } catch {
    throw Object.assign(new Error("Identity lookup unavailable"), { code: "identity_lookup_unavailable" });
  }
  const { memberships, linkedMemberships } = candidates;

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
  if (!linkedMemberships.has(membership.id)) {
    return { response: NextResponse.json({
      error: "Your sign-in has no matching profile link. An operator must verify and repair the link before you can sign in.",
      code: "profile_link_requires_operator", repairable: false, activeMemberships: 1,
    }, { status: 409 }) };
  }
  const claims = authUser.app_metadata || {};

  // REFUSED BEFORE ANYTHING IS WRITTEN, and refused for GET too, so the
  // read-only inspection cannot report "will_repair" for a repair that POST
  // will decline. A raised role here means the membership row says something
  // the token does not, in the one direction that grants power — either the
  // row was edited directly, or a role change was applied to the row and not
  // to the token. Both need a human; neither is self-service.
  if (wouldEscalateRole(claims, membership)) {
    await recordEvent({
      orgId: membership.organization_id,
      type: "auth.self_repair_refused",
      severity: "critical",
      source: "auth",
      message:
        "Self-repair of auth claims was refused: it would have raised the caller's role.",
      context: {
        route,
        userId: authUser.id,
        reason: "role_would_escalate",
        fromRole: claims?.role ?? null,
        toRole: membership.role ?? null,
        membershipId: membership.id,
        statusCode: 409,
      },
    });
    return {
      response: NextResponse.json(
        {
          error:
            "Your membership role would add permissions to your sign-in. Ask an owner or admin to apply the intended role from the Members screen.",
          code: "role_would_escalate",
          repairable: false,
          activeMemberships: 1,
        },
        { status: 409 }
      ),
    };
  }

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
    if (err?.code === "identity_lookup_unavailable") return NextResponse.json({
      error: "Identity verification is temporarily unavailable. Please retry.",
      code: "identity_lookup_unavailable", repairable: false,
    }, { status: 503 });
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
    if (err?.code === "identity_lookup_unavailable") return NextResponse.json({
      error: "Identity verification is temporarily unavailable. Please retry.",
      code: "identity_lookup_unavailable", repairable: false,
    }, { status: 503 });
    console.error("[auth/repair-claims] Failed to repair claims:", err);
    return NextResponse.json({ error: "Could not repair your account" }, { status: 500 });
  }
}
