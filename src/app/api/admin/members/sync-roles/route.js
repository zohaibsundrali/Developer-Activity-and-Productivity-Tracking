import { NextResponse } from "next/server";
import { ROLE_RANK as SHARED_ROLE_RANK, rankOf } from "@/utils/roles";
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
 * WHY THIS IS NO LONGER JUST ABOUT `role`
 *  RLS reads FOUR claims, not one: auth_org() → organization_id,
 *  auth_app_user_id() → app_user_id, auth_user_type() → user_type and
 *  auth_role() → role. Each drifts by the same mechanism and each has its own
 *  misleading symptom:
 *    - organization_id  → "new row violates row-level security policy". The app
 *      sends the org it is holding, the policy checks the one in the token.
 *    - app_user_id      → 401 "Unauthorized" from every admin route, because
 *      getAuthedOrg() finds no membership for the id in the token.
 *    - user_type        → the same 401, plus the wrong profile table.
 *    - role             → the demotion/promotion cases above.
 *  So this audit now compares all four and repairs all four. It is the
 *  application-side equivalent of database/052_repair_auth_claims.sql, and it
 *  follows the same rules that file states.
 *
 * 052'S RULES, APPLIED HERE
 *  - repair ONLY where the answer is unambiguous: exactly one ACTIVE membership
 *    for that identity, org-wide and platform-wide. An address (or an auth
 *    account) with two active memberships is listed as `ambiguous` and left
 *    alone. Guessing which organization someone belongs to is worse than
 *    leaving them logged out, because the wrong guess silently grants access to
 *    a tenant they are not in.
 *  - never repair a membership that is not active (`inactive`): re-stamping the
 *    claims of a suspended member would hand their session back.
 *  - list, never guess, for the rows that cannot be resolved: `unlinked` (no
 *    auth account yet), `orphaned` (the auth account is gone).
 *
 * READ-ONLY BY DEFAULT, on purpose. The first thing an owner needs is to see
 * the damage: who is affected, and in which direction. Changing 40 people's
 * effective permissions is not something to do as a side effect of loading a
 * page, so the write requires POST with an explicit { apply: true }.
 *
 * SOURCE OF TRUTH: the `memberships` row. That is the row the org actually
 * administers through the UI, and it is what the admins believe is in force.
 * The auth claims are brought up to match it, never the other way around.
 *
 * WHAT THIS ROUTE CANNOT DO, AND WHY THE OTHER ONE EXISTS
 *  Every path into here goes through getAuthedOrg — which is exactly what fails
 *  when the caller's OWN claims have drifted. An owner whose app_user_id claim
 *  is stale gets a 401 here and cannot reach the tool that would fix them. That
 *  chicken-and-egg is closed by POST /api/auth/repair-claims, which repairs the
 *  caller's own claims only, from their verified identity.
 */

// Only the two roles accountable for the organization. HR may change an
// individual role through /api/admin/members/role, but a bulk re-stamp of
// everyone's effective permissions belongs to owner/admin.
const SYNC_ROLES = ["owner", "admin"];

// Auth user lookups are one round trip each; run them in small batches so a
// 200-person org does not serialise 200 requests, and does not open 200 either.
const BATCH = 8;

// The four claims RLS reads. Anything else already in app_metadata (Supabase's
// own `provider` / `providers`, product flags) is preserved by merging.
const CLAIM_FIELDS = ["organization_id", "app_user_id", "user_type", "role"];

// How many addresses go into one case-insensitive `or` filter.
const EMAIL_CHUNK = 40;

async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

/** Compare claim values as strings — a uuid may arrive either way round. */
function same(a, b) {
  const norm = (v) => (v === null || v === undefined ? "" : String(v));
  return norm(a) === norm(b);
}

function normalizeEmail(email) {
  return email ? String(email).trim().toLowerCase() : null;
}

/**
 * 052 counts only `status = 'active'` memberships. A null status cannot occur
 * (the column is NOT NULL with a default) but is treated as active so a legacy
 * row is never silently dropped from the audit.
 */
export function isActiveMembership(status) {
  if (!status) return true;
  return String(status).trim().toLowerCase() === "active";
}

/** Which of the four claims disagree with the membership row. */
export function claimDrift(membership, claims) {
  const c = claims || {};
  const drifted = [];
  if (!same(c.organization_id, membership.organization_id)) drifted.push("organization_id");
  if (!same(c.app_user_id, membership.user_id)) drifted.push("app_user_id");
  if (!same(c.user_type, membership.user_type)) drifted.push("user_type");
  if (!same(c.role, membership.role)) drifted.push("role");
  return drifted;
}

/** Load memberships + the auth_user_id for each, from the profile tables. */
async function loadMembers(svc, orgId) {
  const [{ data: memberships }, { data: admins }, { data: devs }] = await Promise.all([
    svc
      .from("memberships")
      .select("id, organization_id, user_id, user_type, email, role, status")
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

/**
 * How many ACTIVE memberships exist platform-wide for each address in this org.
 *
 * This is 052's `n_active > 1 → ambiguous_skip` rule. It has to look outside the
 * caller's organization, because that is the only place a competing membership
 * can be: two active memberships for one address mean the claims can only ever
 * be right for one of them, and nothing here can know which. Only the COUNT
 * leaves this function — no other tenant's ids, emails or roles are read into
 * the report.
 */
async function loadActiveMembershipCounts(svc, members) {
  const emails = new Set();
  const variants = new Set();
  for (const m of members) {
    const key = normalizeEmail(m.email);
    if (!key) continue;
    emails.add(key);
    // Exact variants, for the one query that cannot fail on syntax.
    variants.add(String(m.email));
    variants.add(String(m.email).trim());
    variants.add(key);
  }
  const counts = new Map();
  if (!emails.size) return counts;

  const seen = new Map();
  const absorb = (data) => {
    for (const row of data || []) {
      if (!isActiveMembership(row.status)) continue;
      const key = normalizeEmail(row.email);
      // Exact, normalised comparison — the same rule 052 uses. A loose SQL
      // match may return extra rows; none of them survive this line.
      if (!key || !emails.has(key)) continue;
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key).add(row.id);
    }
  };

  const exact = await svc.from("memberships").select("id, email, status").in("email", [...variants]);
  absorb(exact.data);

  // …and again case-insensitively, because a membership stored elsewhere as
  // "ME@Example.com " is the same person and must still count. Missing it would
  // turn an ambiguous identity into an apparently unambiguous one, and this
  // audit would then repair a row it is supposed to skip. Chunked, and skipping
  // the addresses whose characters are meaningful in PostgREST's `or` grammar —
  // those are already covered exactly above.
  const patternable = [...emails].filter((e) => !/[,()"\\]/.test(e));
  for (let i = 0; i < patternable.length; i += EMAIL_CHUNK) {
    const chunk = patternable.slice(i, i + EMAIL_CHUNK);
    const filter = chunk.map((e) => `email.ilike.*${e}*`).join(",");
    const { data } = await svc.from("memberships").select("id, email, status").or(filter);
    absorb(data);
  }

  for (const [key, ids] of seen) counts.set(key, ids.size);
  return counts;
}

async function buildReport(svc, orgId) {
  const members = await loadMembers(svc, orgId);
  const activeCounts = await loadActiveMembershipCounts(svc, members);

  // Two membership rows in this org pointing at ONE auth account: repairing
  // either one would stamp claims that describe the other. Also ambiguous.
  const rowsPerAuthUser = new Map();
  for (const m of members) {
    if (!m.authUserId || !isActiveMembership(m.status)) continue;
    rowsPerAuthUser.set(m.authUserId, (rowsPerAuthUser.get(m.authUserId) || 0) + 1);
  }

  const rows = await inBatches(members, BATCH, async (m) => {
    const activeElsewhere = activeCounts.get(normalizeEmail(m.email)) || 0;
    const base = {
      ...m,
      claims: null,
      claimRole: null,
      drift: [],
      activeMemberships: activeElsewhere,
    };

    if (!m.authUserId) return { ...base, state: "unlinked" };

    const { data, error } = await svc.auth.admin.getUserById(m.authUserId);
    if (error || !data?.user) return { ...base, state: "missing_auth_user" };

    const claims = data.user.app_metadata || {};
    const drift = claimDrift(m, claims);
    const resolved = { ...base, claims, claimRole: claims.role || null, drift };

    // Precedence matters. A suspended member is never re-stamped, and an
    // ambiguous identity is never guessed at — both outrank "the claims differ".
    if (!isActiveMembership(m.status)) return { ...resolved, state: "inactive" };
    if (activeElsewhere > 1 || (rowsPerAuthUser.get(m.authUserId) || 0) > 1) {
      return { ...resolved, state: "ambiguous" };
    }
    return { ...resolved, state: drift.length === 0 ? "match" : "mismatch" };
  });

  const describe = (r) => ({
    membershipId: r.id,
    userId: r.user_id,
    userType: r.user_type,
    email: r.email || null,
    status: r.status || null,
    membershipRole: r.role || null,
    claimRole: r.claimRole,
    // Which claims are wrong, and what the token currently says. This is the
    // whole diagnostic: a stale organization_id and a stale app_user_id produce
    // completely different symptoms, and neither looks like an auth problem.
    fields: r.drift,
    claimOrgId: r.claims ? r.claims.organization_id || null : null,
    claimAppUserId: r.claims ? r.claims.app_user_id || null : null,
    claimUserType: r.claims ? r.claims.user_type || null : null,
    activeMemberships: r.activeMemberships,
    // Which way the ROLE drift runs: "escalated" means RLS is still honouring a
    // role the organization has already taken away.
    direction: r.drift.includes("role")
      ? rank(r.claimRole) > rank(r.role)
        ? "escalated"
        : "restricted"
      : null,
  });

  const mismatches = rows.filter((r) => r.state === "mismatch");
  const driftCounts = {};
  for (const field of CLAIM_FIELDS) {
    driftCounts[field] = mismatches.filter((r) => r.drift.includes(field)).length;
  }

  return {
    rows,
    report: {
      total: rows.length,
      matched: rows.filter((r) => r.state === "match").length,
      mismatched: mismatches.length,
      escalated: mismatches.filter(
        (r) => r.drift.includes("role") && rank(r.claimRole) > rank(r.role)
      ).length,
      // How many repairable rows have each claim wrong.
      drift: driftCounts,
      mismatches: mismatches.map(describe),
      // Not a fault: an invited member with no auth account yet has no claim to
      // drift. Reported so the number adds up rather than silently vanishing.
      unlinked: rows.filter((r) => r.state === "unlinked").map(describe),
      // This one IS a fault — a profile points at an auth user that is gone.
      orphaned: rows.filter((r) => r.state === "missing_auth_user").map(describe),
      // 052's ambiguous_skip: more than one active membership for this identity.
      // Reported for a human to resolve; never repaired.
      ambiguous: rows.filter((r) => r.state === "ambiguous").map(describe),
      // Suspended / invited / terminated. Their claims are left as they are.
      inactive: rows.filter((r) => r.state === "inactive").map(describe),
    },
  };
}

// ROLE_RANK is imported, not redeclared. This file kept its own copy, and
// when designer/qa/finance were added it was not updated — so an unknown
// role fell to rank 0, the LOWEST, and sailed through every comparison
// meant to stop someone granting a role at or above their own. See
// src/utils/roles.js.
const ROLE_RANK = SHARED_ROLE_RANK;
function rank(role) {
  // An UNKNOWN role must not read as the lowest one — that is how a role this
  // file has never been taught about becomes safe to grant. Unknown reaches
  // nothing, and -Infinity cannot be overtaken by any future renumbering.
  return Object.prototype.hasOwnProperty.call(ROLE_RANK, role)
    ? ROLE_RANK[role]
    : Number.NEGATIVE_INFINITY;
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
    return NextResponse.json({ error: "Could not compare claims" }, { status: 500 });
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

    // Only `mismatch`. `ambiguous`, `inactive`, `unlinked` and `orphaned` are
    // reported and skipped — see the rules at the top of this file.
    const mismatches = rows.filter((r) => r.state === "mismatch");
    const failures = [];
    let repaired = 0;

    await inBatches(mismatches, BATCH, async (r) => {
      // The membership row always came from the caller's own organization (the
      // query is filtered on it). Re-checked here anyway, because this is the
      // line that decides which organization a token will speak for.
      if (!same(r.organization_id, auth.orgId)) {
        failures.push({ membershipId: r.id, reason: "org_mismatch" });
        return null;
      }

      // Merge, never replace: Supabase's own `provider` / `providers` keys and
      // any product flags in app_metadata must survive. The four claims RLS
      // reads are OVERWRITTEN from the membership row rather than preserved —
      // a wrong organization_id is precisely what this repairs, so keeping the
      // existing value would leave the drift in place.
      const next = {
        ...(r.claims || {}),
        organization_id: r.organization_id,
        app_user_id: r.user_id,
        user_type: r.user_type,
        role: r.role,
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
      message: "Member auth claims were re-synchronised from memberships.",
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
      // Named so the caller knows these were deliberately left alone rather
      // than missed.
      skipped: {
        ambiguous: report.ambiguous.length,
        inactive: report.inactive.length,
        unlinked: report.unlinked.length,
        orphaned: report.orphaned.length,
      },
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
    console.error("[admin/members/sync-roles] Failed to sync claims:", err);
    return NextResponse.json({ error: "Could not synchronise claims" }, { status: 500 });
  }
}
