import { supabase } from "@/utils/supabaseClient";

/**
 * Organization (multi-tenant) context helpers.
 *
 * Phase 1 uses APP-LAYER isolation: the logged-in session carries the user's
 * organization_id + role, and data queries filter by it. (DB-level RLS is a
 * later phase once auth moves to Supabase Auth.)
 */

// Read the current org context from the logged-in session (client-side).
export function getOrgContext() {
  if (typeof window === "undefined") return null;
  try {
    const raw =
      sessionStorage.getItem("adminUser") ||
      sessionStorage.getItem("developerUser") ||
      sessionStorage.getItem("clientUser");
    if (!raw) return null;
    const s = JSON.parse(raw);
    const userType =
      s.role === "admin" ? "admin" : s.role === "client" ? "client" : "developer";
    return {
      organizationId: s.organization_id || null,
      organizationName: s.organization_name || null,
      organizationLogo: s.organization_logo || null,
      organizationTimezone: s.organization_timezone || null,
      role: s.membership_role || s.role || null,
      userId: s.id || null,
      userType,
    };
  } catch {
    return null;
  }
}

// Convenience: just the current organization id (or null).
export function getOrgId() {
  return getOrgContext()?.organizationId || null;
}

/**
 * Fetch a user's organization id + name + membership role. Called at login to
 * enrich the session. Falls back to `fallbackOrgId` (the org_id already on the
 * admin_users/developers row from the backfill) if no membership row is found.
 */
export async function loadOrgContext(userId, userType, fallbackOrgId = null) {
  const ctx = {
    organizationId: fallbackOrgId || null,
    organizationName: null,
    organizationLogo: null,
    organizationTimezone: null,
    membershipRole: null,
    // Membership lifecycle state. `suspended`/`terminated` members must not be
    // allowed to sign in — see isMembershipActive() below (audit finding C10).
    membershipStatus: null,
  };
  try {
    const { data: membership } = await supabase
      .from("memberships")
      .select("organization_id, role, status")
      .eq("user_id", userId)
      .eq("user_type", userType)
      .maybeSingle();

    if (membership) {
      ctx.organizationId = membership.organization_id || ctx.organizationId;
      ctx.membershipRole = membership.role || null;
      ctx.membershipStatus = membership.status || null;
    }

    if (ctx.organizationId) {
      const { data: org } = await supabase
        .from("organizations")
        .select("id, name, logo_url, timezone")
        .eq("id", ctx.organizationId)
        .maybeSingle();
      if (org) {
        ctx.organizationName = org.name || null;
        ctx.organizationLogo = org.logo_url || null;
        ctx.organizationTimezone = org.timezone || null;
      }
    }
  } catch {
    // best-effort — return whatever we resolved
  }
  return ctx;
}

/**
 * Is this membership allowed to sign in?
 *
 * Deactivating or offboarding someone writes `memberships.status`, but nothing
 * used to read it — a suspended employee kept full access (audit finding C10).
 * Login now calls this before establishing a session.
 *
 * Unknown/absent status is treated as active so that legacy rows created before
 * the column was populated keep working; only an explicit non-active state
 * blocks sign-in.
 */
const BLOCKED_MEMBERSHIP_STATUSES = ["suspended", "terminated", "inactive", "offboarded"];

export function isMembershipActive(status) {
  if (!status) return true;
  return !BLOCKED_MEMBERSHIP_STATUSES.includes(String(status).toLowerCase());
}

/**
 * Apply an organization filter to a Supabase query builder when an org id is
 * available. Safe no-op if orgId is falsy (keeps current behaviour for any
 * legacy/unscoped rows during the transition).
 */
export function scopeToOrg(query, orgId) {
  return orgId ? query.eq("organization_id", orgId) : query;
}
