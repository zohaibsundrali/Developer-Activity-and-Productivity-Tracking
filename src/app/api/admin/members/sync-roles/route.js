import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { recordEvent } from "@/utils/systemEvents";

export const dynamic = "force-dynamic";

/**
 * GET  /api/admin/members/sync-roles            → report only
 * POST /api/admin/members/sync-roles { apply }  → report, and repair if apply === true
 *
 * The repair for rows that are ALREADY wrong.
 *
 * Every role change made before /api/admin/members/role existed wrote
 * `memberships.role` and left `app_metadata.role` at whatever it was when the
 * account was created. RLS reads the second (018: auth_role()), the app reads
 * the first, so each of those rows is still live drift today:
 *   - metadata MORE privileged than the membership row → a member who was
 *     demoted on paper but still passes every RLS check. This is the actual
 *     escalation, and it is listed first in the report,
 *   - metadata LESS privileged → a promotion whose writes all fail.
 *
 * READ-ONLY BY DEFAULT, on purpose. The first thing an owner needs is to see
 * the damage: who is affected, and in which direction. Changing 40 people's
 * effective permissions is not something to do as a side effect of loading a
 * page, so the write requires POST with an explicit { apply: true }.
 *
 * SOURCE OF TRUTH: `memberships.role`. That is the row the org actually
 * administers through the UI, and it is what the admins believe is in force.
 * The auth claim is brought up to match it, never the other way around.
 */

// Only the two roles accountable for the organization. HR may change an
// individual role through /api/admin/members/role, but a bulk re-stamp of
// everyone's effective permissions belongs to owner/admin.
const SYNC_ROLES = ["owner", "admin"];

// Auth user lookups are one round trip each; run them in small batches so a
// 200-person org does not serialise 200 requests, and does not open 200 either.
const BATCH = 8;

async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

/** Load memberships + the auth_user_id for each, from the profile tables. */
async function loadMembers(svc, orgId) {
  const [{ data: memberships }, { data: admins }, { data: devs }] = await Promise.all([
    svc
      .from("memberships")
      .select("id, user_id, user_type, email, role")
      .eq("organization_id", orgId),
    svc.from("admin_users").select("id, auth_user_id").eq("organization_id", orgId),
    svc.from("developers").select("id, auth_user_id").eq("organization_id", orgId),
  ]);

  const authIdByKey = new Map();
  for (const a of admins || []) authIdByKey.set(`admin:${a.id}`, a.auth_user_id || null);
  for (const d of devs || []) authIdByKey.set(`developer:${d.id}`, d.auth_user_id || null);

  return (memberships || []).map((m) => ({
    ...m,
    authUserId: authIdByKey.get(`${m.user_type}:${m.user_id}`) || null,
  }));
}

async function buildReport(svc, orgId) {
  const members = await loadMembers(svc, orgId);

  const rows = await inBatches(members, BATCH, async (m) => {
    if (!m.authUserId) {
      return { ...m, state: "unlinked", claimRole: null, claims: null };
    }
    const { data, error } = await svc.auth.admin.getUserById(m.authUserId);
    if (error || !data?.user) {
      return { ...m, state: "missing_auth_user", claimRole: null, claims: null };
    }
    const claims = data.user.app_metadata || {};
    const claimRole = claims.role || null;
    return {
      ...m,
      claims,
      claimRole,
      state: claimRole === m.role ? "match" : "mismatch",
    };
  });

  const describe = (r) => ({
    membershipId: r.id,
    userId: r.user_id,
    userType: r.user_type,
    email: r.email || null,
    membershipRole: r.role || null,
    claimRole: r.claimRole,
    // Which way the drift runs is the whole point: "escalated" means RLS is
    // still honouring a role the organization has already taken away.
    direction:
      r.state === "mismatch"
        ? rank(r.claimRole) > rank(r.role)
          ? "escalated"
          : "restricted"
        : null,
  });

  const mismatches = rows.filter((r) => r.state === "mismatch");
  return {
    rows,
    report: {
      total: rows.length,
      matched: rows.filter((r) => r.state === "match").length,
      mismatched: mismatches.length,
      escalated: mismatches.filter((r) => rank(r.claimRole) > rank(r.role)).length,
      mismatches: mismatches.map(describe),
      // Not a fault: an invited member with no auth account yet has no claim to
      // drift. Reported so the number adds up rather than silently vanishing.
      unlinked: rows.filter((r) => r.state === "unlinked").map(describe),
      // This one IS a fault — a profile points at an auth user that is gone.
      orphaned: rows.filter((r) => r.state === "missing_auth_user").map(describe),
    },
  };
}

const ROLE_RANK = {
  owner: 8,
  admin: 7,
  manager: 6,
  hr: 5,
  team_lead: 4,
  developer: 3,
  employee: 2,
  client: 1,
};
function rank(role) {
  return ROLE_RANK[role] || 0;
}

async function authorize(request) {
  const auth = await getAuthedOrg(request);
  if (!auth) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (auth.userType === "client" || auth.role === "client" || !SYNC_ROLES.includes(auth.role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { auth };
}

export async function GET(request) {
  try {
    const { auth, error } = await authorize(request);
    if (error) return error;

    const { report } = await buildReport(serviceClient(), auth.orgId);
    return NextResponse.json({ success: true, applied: false, ...report });
  } catch (err) {
    console.error("[admin/members/sync-roles] Failed to build the report:", err);
    return NextResponse.json({ error: "Could not compare roles" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { auth, error } = await authorize(request);
    if (error) return error;

    const body = await request.json().catch(() => ({}));
    const apply = body?.apply === true;

    const svc = serviceClient();
    const { rows, report } = await buildReport(svc, auth.orgId);

    if (!apply) {
      // Same answer as GET. Read-only unless explicitly told otherwise.
      return NextResponse.json({ success: true, applied: false, ...report });
    }

    const mismatches = rows.filter((r) => r.state === "mismatch");
    const failures = [];
    let repaired = 0;

    await inBatches(mismatches, BATCH, async (r) => {
      // Merge, never replace. The other claims (organization_id, user_type,
      // app_user_id) are what auth_org() and auth_app_user_id() read; dropping
      // them would lock the member out of their own org. Where one is missing
      // on a legacy account it is backfilled from the membership row, which is
      // the same source the claim was originally stamped from.
      const next = {
        ...(r.claims || {}),
        role: r.role,
        organization_id: r.claims?.organization_id || auth.orgId,
        user_type: r.claims?.user_type || r.user_type,
        app_user_id: r.claims?.app_user_id || r.user_id,
      };
      const { error: updateError } = await svc.auth.admin.updateUserById(r.authUserId, {
        app_metadata: next,
      });
      if (updateError) {
        failures.push({ membershipId: r.id, reason: updateError.message || "update_failed" });
      } else {
        repaired += 1;
      }
      return null;
    });

    await recordEvent({
      orgId: auth.orgId,
      type: "auth.role_claims_synced",
      severity: failures.length ? "error" : "info",
      source: "api",
      message: "Member role claims were re-synchronised from memberships.",
      context: {
        route: "/api/admin/members/sync-roles",
        userId: auth.appUserId || null,
        userType: auth.userType || null,
        count: repaired,
        reason: failures.length ? "partial" : "complete",
      },
    });

    return NextResponse.json({
      success: failures.length === 0,
      applied: true,
      repaired,
      failures,
      ...report,
      // The claim only reaches the member's session at their next token
      // refresh (Supabase default: up to an hour). A repaired escalation is
      // therefore closed at refresh, not instantly.
      note:
        repaired > 0
          ? "Repaired claims take effect for each member at their next token refresh."
          : undefined,
    });
  } catch (err) {
    console.error("[admin/members/sync-roles] Failed to sync roles:", err);
    return NextResponse.json({ error: "Could not synchronise roles" }, { status: 500 });
  }
}
