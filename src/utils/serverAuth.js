import { createClient } from "@supabase/supabase-js";

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
export async function getAuthedOrg(request) {
  const token = getBearerToken(request);
  if (!token) return null;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY || ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;

  const meta = data.user.app_metadata || {};
  const orgId = meta.organization_id || null;
  if (!orgId) return null;

  // Deactivated / offboarded members lose API access immediately, not merely
  // at token expiry. memberships.status used to be written and never read, so
  // suspending someone had no effect (audit finding C10). An absent membership
  // row or status is treated as active so legacy accounts keep working.
  const appUserId = meta.app_user_id || null;
  const userType = meta.user_type || null;
  if (appUserId && userType) {
    const { data: membership } = await admin
      .from("memberships")
      .select("status")
      .eq("organization_id", orgId)
      .eq("user_id", appUserId)
      .eq("user_type", userType)
      .maybeSingle();
    if (membership && !isActiveStatus(membership.status)) return null;
  }

  return {
    token,
    userId: data.user.id,
    email: data.user.email || null,
    orgId,
    role: meta.role || null,
    userType,
    appUserId,
  };
}

// Mirrors isMembershipActive() in src/utils/orgContext.js. Kept inline so the
// server never imports a client module.
const BLOCKED_MEMBERSHIP_STATUSES = ["suspended", "terminated", "inactive", "offboarded"];
function isActiveStatus(status) {
  if (!status) return true;
  return !BLOCKED_MEMBERSHIP_STATUSES.includes(String(status).toLowerCase());
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
export function serviceClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY || ANON_KEY, {
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
  const { data, error } = await svc
    .from("project_clients")
    .select("project_id")
    .eq("client_id", clientId)
    .eq("organization_id", auth.orgId);

  const projectIds = error ? [] : (data || []).map((r) => r.project_id).filter(Boolean);
  return { ...auth, clientId, projectIds };
}

// Guard: is a given project id inside the client's allowed set?
export function clientCanAccessProject(authClient, projectId) {
  return !!projectId && Array.isArray(authClient?.projectIds) && authClient.projectIds.includes(projectId);
}
