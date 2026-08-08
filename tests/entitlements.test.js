import { describe, it, expect } from "vitest";
import {
  isSubscriptionEntitled,
  trialDaysRemaining,
  resolveEntitlement,
  getUsage,
  checkResourceLimit,
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
});
