import { describe, it, expect } from "vitest";
import {
  isSubscriptionEntitled,
  trialDaysRemaining,
  resolveEntitlement,
  getUsage,
  checkResourceLimit,
  checkSeatLimitForRole,
  checkFeatureAccess,
  seatResourcesForRole,
  hasFeature,
  RESOURCES,
  FREE_PLAN_CODE,
} from "@/utils/entitlements";

/**
 * Entitlement is the only thing standing between a plan and the resources it
 * pays for, so the interesting cases are the ones where it must FAIL CLOSED:
 * an expired trial, a lapsed grace period, a cancelled subscription. Getting
 * those wrong hands out the product for free; getting the other direction
 * wrong locks a paying customer out.
 */

const NOW = new Date("2026-06-15T12:00:00Z");
const days = (n) => new Date(NOW.getTime() + n * 86400000).toISOString();

const PLANS = {
  free: {
    code: "free",
    name: "Free",
    limits: { employees: 3, projects: 2, active_tasks: 50, developers: 3, screenshots: 500 },
    features: { reports: false, automation: false },
  },
  business: {
    code: "business",
    name: "Business",
    limits: { employees: 100, projects: 150, active_tasks: -1, developers: 100, screenshots: 200000 },
    features: { reports: true, automation: true },
  },
};

/** Minimal stand-in for the service-role client: no network, exact counts. */
function fakeService({ subscription = null, counts = {}, failCount = false } = {}) {
  return {
    from(table) {
      if (table === "organization_subscriptions") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: subscription }) }) }),
        };
      }
      if (table === "billing_plans") {
        return {
          select: () => ({
            eq: (_col, code) => ({ maybeSingle: async () => ({ data: PLANS[code] || null }) }),
          }),
        };
      }
      // Counting tables: every builder method chains and finally resolves.
      const result = failCount
        ? Promise.reject(new Error("count failed"))
        : Promise.resolve({ count: counts[table] ?? 0 });
      const builder = {
        select: () => builder,
        eq: () => builder,
        neq: () => builder,
        in: () => builder,
        then: (res, rej) => result.then(res, rej),
      };
      return builder;
    },
  };
}

describe("isSubscriptionEntitled", () => {
  it("treats a missing subscription as the free plan, which is always usable", () => {
    expect(isSubscriptionEntitled(null, NOW)).toBe(true);
  });

  it("entitles an active subscription", () => {
    expect(isSubscriptionEntitled({ status: "active" }, NOW)).toBe(true);
  });

  it("entitles a trial that has not expired", () => {
    expect(isSubscriptionEntitled({ status: "trialing", trial_end: days(3) }, NOW)).toBe(true);
  });

  it("refuses a trial that has expired", () => {
    expect(isSubscriptionEntitled({ status: "trialing", trial_end: days(-1) }, NOW)).toBe(false);
  });

  it("keeps a past_due org working inside its grace period", () => {
    // Dunning must not lock out a customer whose card will retry successfully.
    expect(
      isSubscriptionEntitled({ status: "past_due", grace_period_ends_at: days(4) }, NOW)
    ).toBe(true);
  });

  it("cuts a past_due org off once the grace period has elapsed", () => {
    expect(
      isSubscriptionEntitled({ status: "past_due", grace_period_ends_at: days(-1) }, NOW)
    ).toBe(false);
  });

  it.each(["canceled", "expired", "incomplete", "incomplete_expired", "unpaid", "paused"])(
    "refuses status %s",
    (status) => {
      expect(isSubscriptionEntitled({ status }, NOW)).toBe(false);
    }
  );
});

describe("trialDaysRemaining", () => {
  it("counts whole days left", () => {
    expect(trialDaysRemaining({ status: "trialing", trial_end: days(5) }, NOW)).toBe(5);
  });

  it("floors at zero rather than going negative", () => {
    expect(trialDaysRemaining({ status: "trialing", trial_end: days(-3) }, NOW)).toBe(0);
  });

  it("is null when the org is not on a trial", () => {
    expect(trialDaysRemaining({ status: "active", trial_end: days(5) }, NOW)).toBeNull();
    expect(trialDaysRemaining(null, NOW)).toBeNull();
  });
});

describe("resolveEntitlement", () => {
  it("falls back to free when there is no subscription row", async () => {
    const e = await resolveEntitlement(fakeService(), "org-1", NOW);
    expect(e.planCode).toBe(FREE_PLAN_CODE);
    expect(e.entitled).toBe(true);
    expect(e.limits.projects).toBe(2);
  });

  it("grants the paid plan's limits while the subscription is active", async () => {
    const svc = fakeService({ subscription: { plan_code: "business", status: "active" } });
    const e = await resolveEntitlement(svc, "org-1", NOW);
    expect(e.planCode).toBe("business");
    expect(e.limits.projects).toBe(150);
    expect(hasFeature(e, "automation")).toBe(true);
  });

  it("drops a lapsed paid plan back to free limits, not its old ones", async () => {
    // The important direction: a cancelled Business org must not keep 150 projects.
    const svc = fakeService({ subscription: { plan_code: "business", status: "canceled" } });
    const e = await resolveEntitlement(svc, "org-1", NOW);
    expect(e.entitled).toBe(false);
    expect(e.planCode).toBe(FREE_PLAN_CODE);
    expect(e.limits.projects).toBe(2);
    expect(hasFeature(e, "automation")).toBe(false);
  });

  it("drops an expired trial back to free limits", async () => {
    const svc = fakeService({
      subscription: { plan_code: "business", status: "trialing", trial_end: days(-1) },
    });
    const e = await resolveEntitlement(svc, "org-1", NOW);
    expect(e.entitled).toBe(false);
    expect(e.planCode).toBe(FREE_PLAN_CODE);
  });
});

describe("getUsage", () => {
  it("reports used, limit and remaining per resource", async () => {
    const svc = fakeService({ counts: { projects: 1, memberships: 2 } });
    const usage = await getUsage(svc, "org-1", PLANS.free.limits);
    expect(usage.projects).toMatchObject({ used: 1, limit: 2, remaining: 1, exceeded: false });
    expect(usage.employees).toMatchObject({ used: 2, limit: 3, exceeded: false });
  });

  it("marks a resource exceeded once usage reaches the limit", async () => {
    const svc = fakeService({ counts: { projects: 2 } });
    const usage = await getUsage(svc, "org-1", PLANS.free.limits);
    expect(usage.projects.exceeded).toBe(true);
    expect(usage.projects.remaining).toBe(0);
  });

  it("treats -1 as unlimited", async () => {
    const svc = fakeService({ counts: { developer_tasks: 999999 } });
    const usage = await getUsage(svc, "org-1", PLANS.business.limits);
    expect(usage.active_tasks).toMatchObject({ unlimited: true, limit: null, exceeded: false });
  });

  it("covers every countable resource", async () => {
    const usage = await getUsage(fakeService(), "org-1", PLANS.free.limits);
    expect(Object.keys(usage).sort()).toEqual(Object.keys(RESOURCES).sort());
  });
});

describe("checkResourceLimit", () => {
  it("allows creation below the limit", async () => {
    const svc = fakeService({ counts: { projects: 1 } });
    expect(await checkResourceLimit(svc, "org-1", "projects", NOW)).toBeNull();
  });

  it("blocks creation at the limit with a 402 and an upgrade hint", async () => {
    const svc = fakeService({ counts: { projects: 2 } });
    const blocked = await checkResourceLimit(svc, "org-1", "projects", NOW);
    expect(blocked).toMatchObject({
      status: 402,
      limitReached: true,
      upgradeRequired: true,
      resource: "projects",
      used: 2,
      limit: 2,
    });
  });

  it("blocks past the limit too, not only exactly at it", async () => {
    const svc = fakeService({ counts: { projects: 9 } });
    expect(await checkResourceLimit(svc, "org-1", "projects", NOW)).not.toBeNull();
  });

  it("never blocks an unlimited resource", async () => {
    const svc = fakeService({
      subscription: { plan_code: "business", status: "active" },
      counts: { developer_tasks: 500000 },
    });
    expect(await checkResourceLimit(svc, "org-1", "active_tasks", NOW)).toBeNull();
  });

  it("enforces free limits on a cancelled org that used to be on Business", async () => {
    const svc = fakeService({
      subscription: { plan_code: "business", status: "canceled" },
      counts: { projects: 5 },
    });
    const blocked = await checkResourceLimit(svc, "org-1", "projects", NOW);
    expect(blocked).toMatchObject({ status: 402, limit: 2, planCode: "free" });
  });

  it("does not enforce a resource it does not know about", async () => {
    expect(await checkResourceLimit(fakeService(), "org-1", "unicorns", NOW)).toBeNull();
  });

  it("lets work through when counting itself fails", async () => {
    // A database hiccup must not read as "limit reached" and halt the product.
    const svc = fakeService({ failCount: true });
    expect(await checkResourceLimit(svc, "org-1", "projects", NOW)).toBeNull();
  });

  it("discounts a row the caller already wrote, so the last seat is sellable", async () => {
    // A route that checks AFTER inserting sees its own row in the count. Without
    // discounting it, a 3-seat plan refuses the 3rd seat it actually sells.
    const svc = fakeService({ counts: { developers: 3 } });
    expect(
      await checkResourceLimit(svc, "org-1", "developers", NOW, { alreadyCounted: 1 })
    ).toBeNull();
  });

  it("still blocks once the count is genuinely over, row already written or not", async () => {
    const svc = fakeService({ counts: { developers: 4 } });
    const blocked = await checkResourceLimit(svc, "org-1", "developers", NOW, {
      alreadyCounted: 1,
    });
    expect(blocked).toMatchObject({ status: 402, used: 3, limit: 3 });
  });
});

describe("seatResourcesForRole", () => {
  it("charges a developer to the developers meter, not only to employees", () => {
    // A developer row lands in `developers` AND in a non-client membership, so
    // both ceilings apply; metering it as an employee alone leaves the
    // developers limit unenforced against actual developers.
    expect(seatResourcesForRole("developer")).toEqual(["employees", "developers"]);
    expect(seatResourcesForRole("employee")).toEqual(["employees", "developers"]);
    expect(seatResourcesForRole("manager")).toEqual(["employees", "developers"]);
  });

  it("charges admin-like roles to employees only", () => {
    // owner/admin/hr land in admin_users — nothing the developers meter counts.
    for (const role of ["owner", "admin", "hr"]) {
      expect(seatResourcesForRole(role)).toEqual(["employees"]);
    }
  });

  it("charges a client to no seat meter at all", () => {
    // A client gets a `clients` row and a client-typed membership; neither
    // meter counts it, so billing it to `developers` was metering a fiction.
    expect(seatResourcesForRole("client")).toEqual([]);
  });

  it("falls back to employees for an unrecognised role rather than unmetered", () => {
    expect(seatResourcesForRole("wizard")).toEqual(["employees"]);
    expect(seatResourcesForRole(undefined)).toEqual(["employees"]);
  });
});

describe("checkSeatLimitForRole", () => {
  it("blocks a developer on the developers meter even when employees has room", async () => {
    // 1 non-client membership but 3 developer rows: the employees ceiling is
    // clear and the developers ceiling is not. Checking only one lets it past.
    const svc = fakeService({ counts: { memberships: 1, developers: 3 } });
    const blocked = await checkSeatLimitForRole(svc, "org-1", "developer", NOW);
    expect(blocked).toMatchObject({ status: 402, resource: "developers", limit: 3 });
  });

  it("blocks an admin on the employees meter", async () => {
    const svc = fakeService({ counts: { memberships: 3, developers: 0 } });
    const blocked = await checkSeatLimitForRole(svc, "org-1", "admin", NOW);
    expect(blocked).toMatchObject({ status: 402, resource: "employees" });
  });

  it("does not charge a client seat to the developer meter", async () => {
    // The old mapping refused this invitation because 3 developers filled a
    // meter a client never touches.
    const svc = fakeService({ counts: { memberships: 3, developers: 3 } });
    expect(await checkSeatLimitForRole(svc, "org-1", "client", NOW)).toBeNull();
  });

  it("allows a seat when every applicable meter has room", async () => {
    const svc = fakeService({ counts: { memberships: 1, developers: 1 } });
    expect(await checkSeatLimitForRole(svc, "org-1", "developer", NOW)).toBeNull();
  });
});

describe("checkFeatureAccess", () => {
  it("refuses a feature the plan does not grant", async () => {
    const blocked = await checkFeatureAccess(fakeService(), "org-1", "automation", "Automation", NOW);
    expect(blocked).toMatchObject({
      status: 402,
      feature: "automation",
      featureLocked: true,
      upgradeRequired: true,
      planCode: "free",
    });
  });

  it("allows a feature the plan grants", async () => {
    const svc = fakeService({ subscription: { plan_code: "business", status: "active" } });
    expect(await checkFeatureAccess(svc, "org-1", "automation", "Automation", NOW)).toBeNull();
  });

  it("refuses once the paid plan lapses, not only on free", async () => {
    const svc = fakeService({ subscription: { plan_code: "business", status: "canceled" } });
    const blocked = await checkFeatureAccess(svc, "org-1", "reports", "Reports", NOW);
    expect(blocked).toMatchObject({ status: 402, planCode: "free" });
  });

  it("treats a flag the plan never mentions as not granted", async () => {
    // Fail closed: a plan earns a feature by naming it, not by omitting it.
    const svc = fakeService({ subscription: { plan_code: "business", status: "active" } });
    const blocked = await checkFeatureAccess(svc, "org-1", "api_access", "API access", NOW);
    expect(blocked).toMatchObject({ status: 402, feature: "api_access" });
  });
});

/**
 * The lock (database/053 + src/utils/billingAccess.js).
 *
 * `entitled` and `locked` answer different questions: the first shrinks an
 * organization to free limits, the second closes it. These tests pin the
 * boundary between them, because collapsing the two in either direction is a
 * production incident — one gives the product away, the other takes a paying
 * customer's workspace off them.
 */
describe("the trial lock, as enforced by the limit checks", () => {
  const expiredTrial = { plan_code: "business", status: "trialing", trial_end: days(-1) };

  it("refuses a resource the plan would otherwise allow", async () => {
    const svc = fakeService({ subscription: expiredTrial, counts: { projects: 0 } });
    const blocked = await checkResourceLimit(svc, "org", "projects", NOW);
    expect(blocked).toBeTruthy();
    expect(blocked.status).toBe(402);
    expect(blocked.billingLocked).toBe(true);
    expect(blocked.lockReason).toBe("trial_expired");
  });

  it("refuses even where the lapsed plan's limit is UNLIMITED", async () => {
    // The regression this exists to catch: `active_tasks` is -1 on business, and
    // checkResourceLimit returns early for an unlimited limit. A lock checked
    // after that short-circuit would never fire for the most expensive plans.
    const svc = fakeService({ subscription: expiredTrial, counts: { developer_tasks: 5 } });
    const blocked = await checkResourceLimit(svc, "org", "active_tasks", NOW);
    expect(blocked?.billingLocked).toBe(true);

    // And the same resource on a LIVE business trial is allowed, so the
    // assertion above is about the lock and not about active_tasks being
    // refused for some unrelated reason.
    const live = fakeService({
      subscription: { plan_code: "business", status: "trialing", trial_end: days(3) },
      counts: { developer_tasks: 5 },
    });
    expect(await checkResourceLimit(live, "org", "active_tasks", NOW)).toBeNull();
  });

  it("refuses a seat, through the same path", async () => {
    const svc = fakeService({ subscription: expiredTrial, counts: { developers: 0 } });
    const blocked = await checkSeatLimitForRole(svc, "org", "developer", NOW);
    expect(blocked?.billingLocked).toBe(true);
  });

  it("refuses a feature the plan grants, because the workspace is shut", async () => {
    const svc = fakeService({ subscription: expiredTrial });
    const blocked = await checkFeatureAccess(svc, "org", "reports", "Reports", NOW);
    expect(blocked?.billingLocked).toBe(true);
  });

  it("does NOT lock the free plan, however long it has been expired", async () => {
    const svc = fakeService({
      subscription: { plan_code: "free", status: "trialing", trial_end: days(-400) },
      counts: { projects: 0 },
    });
    expect(await checkResourceLimit(svc, "org", "projects", NOW)).toBeNull();
  });

  it("does NOT lock a deliberately cancelled plan — it shrinks to free", async () => {
    // /api/billing/cancel promises on screen that the plan "reverts to Free".
    // A lock here would break that promise and punish the honest exit.
    const svc = fakeService({
      subscription: { plan_code: "business", status: "canceled" },
      counts: { projects: 0 },
    });
    const result = await checkResourceLimit(svc, "org", "projects", NOW);
    expect(result).toBeNull(); // 0 projects, free allows 2
  });

  it("still enforces the ordinary free limit after a cancellation", async () => {
    const svc = fakeService({
      subscription: { plan_code: "business", status: "canceled" },
      counts: { projects: 2 },
    });
    const blocked = await checkResourceLimit(svc, "org", "projects", NOW);
    expect(blocked?.limitReached).toBe(true);
    expect(blocked?.billingLocked).toBeUndefined();
  });

  it("does NOT lock an organization with no subscription row", async () => {
    const svc = fakeService({ subscription: null, counts: { projects: 0 } });
    expect(await checkResourceLimit(svc, "org", "projects", NOW)).toBeNull();
  });

  it("reports the countdown alongside the limits while a trial is running", async () => {
    const svc = fakeService({
      subscription: { plan_code: "business", status: "trialing", trial_end: days(6) },
    });
    const entitlement = await resolveEntitlement(svc, "org", NOW);
    expect(entitlement.locked).toBe(false);
    expect(entitlement.onTrial).toBe(true);
    expect(entitlement.daysRemaining).toBe(6);
    // Business limits, not free — a running trial is the full plan.
    expect(entitlement.limits.projects).toBe(150);
  });
});
