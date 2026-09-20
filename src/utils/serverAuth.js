import { workspaceTokenClaims, sameWorkspace } from "@/utils/workspaceClaims";
import { createClient } from "@supabase/supabase-js";
import { recordEvent } from "@/utils/systemEvents";
import { isRole, PROFILE_TABLE } from "@/utils/roles";
import { loadOverrides } from "@/utils/permissionOverrides";
import { fetchWithDeadline } from "@/utils/fetchDeadline";

// Server-side auth helpers for API routes.
//
// The website authenticates users through Supabase Auth, so every logged-in
// caller carries a JWT whose app_metadata holds { organization_id, role,
// user_type, app_user_id }. These helpers verify that JWT and give routes a
// trustworthy org context — replacing the old forgeable cookie checks.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Extract the Bearer token from the Authorization header.
export function getBearerToken(request) {
  const header =
    request.headers.get("authorization") ||
    request.headers.get("Authorization") ||
    "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

// Verify the caller's JWT and return their organization context, or null if
// the request is unauthenticated / the token is invalid / no org claim.
export async function getAuthedOrg(request, { allowDeletion = false } = {}) {
  const token = getBearerToken(request);
  if (!token) return null;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY || ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) {
    // Monitoring (best effort, never throws — see src/utils/systemEvents.js).
    // A rejected token is the one auth failure worth a durable record: a burst
    // of them is a forged/replayed token or an expiry bug, and today every one
    // of them is an anonymous 401 that leaves no trace anywhere. Platform-scoped
    // (orgId null) because an unverifiable token carries no trustworthy org
    // claim — attributing it to an organization would mean believing it.
    // `reason` is the driver's short code only; the token itself never leaves
    // this function.
    await recordEvent({
      orgId: null,
      type: "auth.token_rejected",
      severity: "warning",
      source: "auth",
      message: "A bearer token was rejected during verification.",
      context: { reason: error?.name || "invalid_token", code: error?.status || null },
    });
    return null;
  }

  if (data.user.deleted_at || (data.user.banned_until && Date.parse(data.user.banned_until) > Date.now())) return null;

  let meta = data.user.app_metadata || {};
  // getUser verifies this exact token, but returns global user metadata. The
  // access-token hook issues session-specific workspace claims instead.
  const claims = workspaceTokenClaims(token);
  if (claims?.session_id) {
    if (claims.sub !== data.user.id) return null;
    try {
      const context = await admin.rpc("workspace_context", { p_auth: data.user.id, p_session: claims.session_id, p_allow_deletion: allowDeletion });
      if (context.error || !sameWorkspace(context.data, claims.app_metadata)) return null;
      meta = context.data;
    } catch { return null; }
  }
  const orgId = meta.organization_id || null;
  if (!orgId) {
    // CLAIM DRIFT, detected at the point of failure (see
    // database/052_repair_auth_claims.sql). A verified token with no
    // organization claim is an account whose app_metadata was never stamped or
    // was overwritten shallowly. Every admin route it touches answers 401, and
    // the 401 looks like a bug in whichever screen the person was on — so the
    // condition is recorded here, where it is unambiguous, instead of being
    // invisible until somebody reports a broken page.
    //
    // Platform-scoped (orgId null): there is no trustworthy org to file it
    // under. Best effort, never throws — see src/utils/systemEvents.js.
    await recordDriftOnce(data.user.id, {
      orgId: null,
      type: "auth.claims_drift_detected",
      severity: "warning",
      source: "auth",
      message: "A verified token carried no organization claim.",
      context: {
        userId: data.user.id,
        reason: "missing_org_claim",
        route: "/api/auth/repair-claims",
      },
    });
    return null;
  }

  const organizationState = await admin.from('organizations').select('status').eq('id', orgId).maybeSingle();
  if (organizationState.error || organizationState.data?.status !== 'active') return null;

  // Membership is the current authority. Missing rows, query failures and
  // pending invitations must never retain privileges from an old Auth claim.
  const appUserId = meta.app_user_id || null;
  const userType = meta.user_type || null;
  if (!appUserId || !["admin", "developer", "client"].includes(userType)) return null;
  let membership;
  try {
    const result = await admin.from("memberships")
      .select("status, role, deletion_blocked")
      .eq("organization_id", orgId)
      .eq("user_id", appUserId)
      .eq("user_type", userType)
      .maybeSingle();
    if (result.error) return null;
    membership = result.data;
  } catch {
    return null;
  }
  if (!membership) {
    await recordDriftOnce(data.user.id, {
      orgId, type: "auth.claims_drift_detected", severity: "warning", source: "auth",
      message: "A verified token named a membership that does not exist.",
      context: { userId: appUserId, userType, role: meta.role || null,
        reason: "membership_not_found", route: "/api/auth/repair-claims" },
    });
    return null;
  }
  if ((membership.deletion_blocked && !allowDeletion) || membership.status !== "active" || !isRole(membership.role)) {
    await recordEvent({
      orgId, type: "auth.membership_blocked", severity: "warning", source: "auth",
      message: "A member without an active, valid membership was denied API access.",
      context: { userId: appUserId, userType, status: membership.status, role: membership.role },
    });
    return null;
  }
  // Role permissions are not nested by numeric rank (for example HR and
  // Manager). A partial two-store role change must not preserve either role's
  // unique permissions. Refresh/repair must establish the exact current role.
  if (meta.role !== membership.role) return null;

  // A client profile cannot become staff through an inconsistent role row.
  if ((userType === "client") !== (membership.role === "client")) return null;

  // Auth metadata can outlive an account repair/relink. Service-role API
  // queries must prove the current profile still belongs to this Auth user,
  // independently of the typed membership and the browser JWT.
  try {
    const profile = await admin.from(PROFILE_TABLE[userType])
      .select("auth_user_id")
      .eq("id", appUserId)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (profile.error || profile.data?.auth_user_id !== data.user.id) return null;
  } catch { return null; }

  // PER-PERSON OVERRIDES, read once and carried on `auth`.
  //
  // The catalogue says what a ROLE may do; `user_permissions` records the
  // exceptions — the contractor who may not see billing, the developer trusted
  // to review. They are loaded HERE rather than inside requirePermission for
  // two reasons. `auth` already means "everything known about the verified
  // caller", and the role is part of it, so an exception written against that
  // person is the same kind of fact. And a permission check that does I/O has
  // to be async, which turns `if (!authCan(...))` into `!Promise` — always
  // false, guard silently skipped — the moment anyone forgets one `await`.
  //
  // One query, in parallel with nothing else that blocks, and it never throws:
  // see permissionOverrides.js for why a missing TABLE and a failed QUERY are
  // treated differently. `overridesUnavailable` is what makes the second case
  // fail closed instead of quietly ignoring every deny in the organization.
  let overrides = {};
  let overridesUnavailable = false;
  try {
    overrides = await loadOverrides(admin, { orgId, appUserId, userType });
  } catch (e) {
    // Fail closed AND say so. This used to be a bare `catch {}`, and the
    // silence is how an ambiguous PostgREST embed in loadOverrides turned every
    // permission-gated route into a 503 for every organization without one
    // line in any log to point at the cause.
    console.error("[serverAuth] overrides unreadable; failing closed:", e?.cause?.message || e?.message || e);
    overridesUnavailable = true;
  }

  return {
    token,
    userId: data.user.id,
    email: data.user.email || null,
    orgId,
    role: membership.role,
    userType,
    appUserId,
    overrides,
    overridesUnavailable,
  };
}

// ── Drift telemetry ───────────────────────────────────────────────────
// A drifted account keeps drifting: every request it makes hits the same
// condition, so recording one row per request would bury System Health under a
// single broken user. One row per (account, reason) per window is enough to
// show the condition and to see it clear once the claims are repaired.
//
// Deliberately a plain in-process Map: this is monitoring, so losing the memo
// on a cold start costs one extra row, and nothing here may add a round trip to
// an auth path. Bounded so a burst of distinct ids cannot grow it without limit.
const DRIFT_WINDOW_MS = 10 * 60 * 1000;
const DRIFT_MEMO_MAX = 500;
const driftMemo = new Map();

async function recordDriftOnce(key, event) {
  try {
    const memoKey = `${key || "anon"}:${event?.context?.reason || "drift"}`;
    const now = Date.now();
    const last = driftMemo.get(memoKey);
    if (last && now - last < DRIFT_WINDOW_MS) return false;
    if (driftMemo.size >= DRIFT_MEMO_MAX) driftMemo.clear();
    driftMemo.set(memoKey, now);
  } catch {
    // Never let the memo itself break an auth path; fall through and record.
  }
  return recordEvent(event);
}

// A Supabase client bound to the caller's JWT. All reads/writes through it are
// automatically constrained to the caller's organization by Row Level Security.
export function orgScopedClient(token) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// A privileged service-role client (bypasses RLS). Use only for writes that
// must succeed regardless of RLS, after the caller's org has been verified.
export function serviceClient({ requestTimeoutMs = 0 } = {}) {
  return createClient(SUPABASE_URL, SERVICE_KEY || ANON_KEY, {
    ...(requestTimeoutMs ? { global: { fetch: fetchWithDeadline(requestTimeoutMs) } } : {}),
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── Client-portal auth ────────────────────────────────────────────────
// Verify the caller is an authenticated CLIENT and resolve the set of project
// ids they are linked to. Returns null for non-clients / unauthenticated, so
// every /api/client/* route is closed to admins, developers, and anon callers.
//
// Returned shape: { ...authedOrg, projectIds: string[], clientId }
// projectIds is the authoritative scope — client routes MUST filter every query
// by it (defense-in-depth on top of RLS), and never trust a project id from the
// request without checking membership in this list.
export async function getAuthedClient(request) {
  const auth = await getAuthedOrg(request);
  if (!auth) return null;
  if (auth.userType !== "client" && auth.role !== "client") return null;

  const clientId = auth.appUserId;
  if (!clientId) return null;

  const svc = serviceClient();
  const { checkFeatureAccess } = await import("@/utils/entitlements");
  const planRefusal = await checkFeatureAccess(svc, auth.orgId, "client_portal", "Client portal");
  if (planRefusal) return { ...auth, clientId, projectIds: [], planRefusal };
  const { data, error } = await svc
    .from("project_clients")
    .select("project_id")
    .eq("client_id", clientId)
    .eq("organization_id", auth.orgId);

  if (error) return { ...auth, clientId, projectIds: [], planRefusal: { status: 503, error: "Project access verification unavailable. Please retry." } };
  const projectIds = (data || []).map((r) => r.project_id).filter(Boolean);
  return { ...auth, clientId, projectIds };
}

// Guard: is a given project id inside the client's allowed set?
export function clientCanAccessProject(authClient, projectId) {
  return !!projectId && Array.isArray(authClient?.projectIds) && authClient.projectIds.includes(projectId);
}
