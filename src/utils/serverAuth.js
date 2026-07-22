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

  return {
    token,
    userId: data.user.id,
    email: data.user.email || null,
    orgId,
    role: meta.role || null,
    userType: meta.user_type || null,
    appUserId: meta.app_user_id || null,
  };
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
