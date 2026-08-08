/**
 * Plan entitlements — what an organization is allowed to do, and how much of it
 * it has already used.
 *
 * This module is the single place that answers "is this organization over its
 * limit?". It runs on the SERVER with the service role, never in the browser:
 * a limit that the client evaluates is a suggestion, not a limit. The UI calls
 * the billing API to *display* usage; enforcement happens in the route that
 * creates the resource.
 *
 * An organization with no subscription row is treated as the free plan. That
 * keeps every tenant that predates billing working, and it fails closed —
 * the free plan is the most restrictive, not the least.
 */

// -1 means unlimited. Keys match the `limits` jsonb seeded in migration 027;
// a key present there but missing here is simply not enforced, which is the
// safe direction to be wrong in.
export const RESOURCES = {
  employees: {
    label: "Employees",
    // Counting is defined here so the API and the enforcement path can never
    // disagree about what "an employee" means.
    count: async (svc, orgId) =>
      svc
        .from("memberships")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .neq("user_type", "client"),
  },
  developers: {
    label: "Developers",
    count: async (svc, orgId) =>
      svc
        .from("developers")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId),
  },
  projects: {
    label: "Projects",
    count: async (svc, orgId) =>
      svc
        .from("projects")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId),
  },
  active_tasks: {
    label: "Active tasks",
    // Only work still in flight counts against the plan — closing tasks should
    // free capacity, otherwise a long-lived org can never create another task.
    count: async (svc, orgId) =>
      svc
        .from("developer_tasks")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .in("status", ["pending", "in_progress", "awaiting_approval", "reviewed"]),
  },
  screenshots: {
    label: "Screenshots",
    count: async (svc, orgId) =>
      svc
        .from("screenshots")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId),
  },
};

export const FREE_PLAN_CODE = "free";

// Mirrors the free plan seeded in 027. Used only when the plans table cannot be
// read at all, so a database hiccup does not accidentally grant unlimited use.
const FALLBACK_FREE_LIMITS = {
  employees: 3,
  developers: 3,
  projects: 2,
  active_tasks: 50,
  storage_mb: 100,
  screenshots: 500,
  tracking_history_days: 7,
};

/** Statuses that still entitle an organization to use its paid plan. */
const ENTITLED_STATUSES = new Set(["trialing", "active", "past_due"]);

/**
 * `past_due` keeps working until the grace period expires — dunning should not
 * lock a paying customer out over a card that will retry successfully.
 */
export function isSubscriptionEntitled(subscription, now = new Date()) {
  if (!subscription) return true; // no row = free plan, which is always usable
  const status = String(subscription.status || "");
  if (!ENTITLED_STATUSES.has(status)) return false;

  if (status === "past_due") {
    const graceEnd = subscription.grace_period_ends_at
      ? new Date(subscription.grace_period_ends_at)
      : null;
    if (graceEnd && now > graceEnd) return false;
  }

  if (status === "trialing") {
    const trialEnd = subscription.trial_end ? new Date(subscription.trial_end) : null;
    if (trialEnd && now > trialEnd) return false;
  }

  return true;
}

/** Whole days of trial left, or null when the org is not on a trial. */
export function trialDaysRemaining(subscription, now = new Date()) {
  if (!subscription || subscription.status !== "trialing") return null;
  if (!subscription.trial_end) return null;
  const end = new Date(subscription.trial_end);
  if (Number.isNaN(end.getTime())) return null;
  const ms = end.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / (24 * 60 * 60 * 1000));
}

/**
 * The plan an organization is actually entitled to right now.
 * An unentitled subscription (expired trial, canceled, grace period elapsed)
 * falls back to free rather than keeping the paid limits.
 */
export async function resolveEntitlement(svc, orgId, now = new Date()) {
  const { data: subscription } = await svc
    .from("organization_subscriptions")
    .select("*")
    .eq("organization_id", orgId)
    .maybeSingle();

  const entitled = isSubscriptionEntitled(subscription, now);
  const effectiveCode = entitled ? subscription?.plan_code || FREE_PLAN_CODE : FREE_PLAN_CODE;

  const { data: plan } = await svc
    .from("billing_plans")
    .select("*")
    .eq("code", effectiveCode)
    .maybeSingle();

  return {
    subscription: subscription || null,
    plan: plan || null,
    planCode: effectiveCode,
    entitled,
    limits: plan?.limits || FALLBACK_FREE_LIMITS,
    features: plan?.features || {},
    trialDaysRemaining: trialDaysRemaining(subscription, now),
  };
}

/** True when the plan grants a named feature flag. */
export function hasFeature(entitlement, feature) {
  return Boolean(entitlement?.features?.[feature]);
}

/**
 * Current usage for every countable resource, run as one batch.
 * Returns { employees: { used, limit, unlimited, remaining, exceeded }, ... }.
 */
export async function getUsage(svc, orgId, limits) {
  const keys = Object.keys(RESOURCES);
  const counts = await Promise.all(
    keys.map(async (key) => {
      try {
        const { count } = await RESOURCES[key].count(svc, orgId);
        return [key, count ?? 0];
      } catch {
        // A counting failure must not read as "limit reached" and block work.
        return [key, 0];
      }
    })
  );

  const usage = {};
  for (const [key, used] of counts) {
    const limit = limits?.[key];
    const unlimited = limit === undefined || limit === null || limit === -1;
    usage[key] = {
      label: RESOURCES[key].label,
      used,
      limit: unlimited ? null : limit,
      unlimited,
      remaining: unlimited ? null : Math.max(0, limit - used),
      exceeded: unlimited ? false : used >= limit,
    };
  }
  return usage;
}

/**
 * The enforcement call. Returns null when creation may proceed, or a
 * { error, status, ... } object the route should return verbatim.
 *
 * Deliberately counts at call time rather than trusting a cached snapshot:
 * a stale count is how a limit gets exceeded.
 */
export async function checkResourceLimit(svc, orgId, resourceKey, now = new Date()) {
  const resource = RESOURCES[resourceKey];
  if (!resource) return null; // unknown resource is not enforced

  const entitlement = await resolveEntitlement(svc, orgId, now);
  const limit = entitlement.limits?.[resourceKey];
  if (limit === undefined || limit === null || limit === -1) return null;

  let used = 0;
  try {
    const { count } = await resource.count(svc, orgId);
    used = count ?? 0;
  } catch {
    return null; // never block on a counting failure
  }

  if (used < limit) return null;

  return {
    status: 402, // Payment Required — the honest code for "your plan stops here"
    error: `${resource.label} limit reached`,
    detail: `Your ${entitlement.plan?.name || entitlement.planCode} plan allows ${limit} ${resource.label.toLowerCase()}. You are using ${used}.`,
    limitReached: true,
    resource: resourceKey,
    used,
    limit,
    planCode: entitlement.planCode,
    upgradeRequired: true,
  };
}
