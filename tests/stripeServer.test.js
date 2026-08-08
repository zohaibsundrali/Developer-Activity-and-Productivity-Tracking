import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  normalizeStatus,
  toIso,
  gracePeriodDays,
  stripeMode,
  billingConfigured,
  appOrigin,
} from "@/utils/stripeServer";

/**
 * The pure half of the Stripe integration — the part that can be verified
 * without touching Stripe. The interesting cases are the ones where a bad
 * value must not reach the database: `organization_subscriptions.status` has a
 * CHECK constraint, so an unrecognised Stripe status written straight through
 * would fail the insert and lose the whole webhook.
 */

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("normalizeStatus", () => {
  it.each([
    "trialing",
    "active",
    "past_due",
    "canceled",
    "incomplete",
    "incomplete_expired",
    "unpaid",
    "paused",
  ])("passes through the known status %s", (s) => {
    expect(normalizeStatus(s)).toBe(s);
  });

  it("maps anything unrecognised to incomplete rather than writing it through", () => {
    // The column has a CHECK constraint; an unknown value would abort the
    // webhook's whole transaction and the event would be lost.
    for (const v of ["something_new", "", null, undefined, 42, "ACTIVE"]) {
      expect(normalizeStatus(v)).toBe("incomplete");
    }
  });
});

describe("toIso", () => {
  it("converts Stripe's seconds-since-epoch to ISO", () => {
    expect(toIso(1718452800)).toBe("2024-06-15T12:00:00.000Z");
  });

  it("handles epoch zero rather than treating it as absent", () => {
    expect(toIso(0)).toBe("1970-01-01T00:00:00.000Z");
  });

  it("returns null for missing or unparseable values", () => {
    for (const v of [null, undefined, "", "not-a-number", NaN]) {
      expect(toIso(v)).toBeNull();
    }
  });
});

describe("gracePeriodDays", () => {
  it("defaults to a week when unset", () => {
    vi.stubEnv("BILLING_GRACE_PERIOD_DAYS", "");
    expect(gracePeriodDays()).toBe(7);
  });

  it("honours a configured value", () => {
    vi.stubEnv("BILLING_GRACE_PERIOD_DAYS", "3");
    expect(gracePeriodDays()).toBe(3);
  });

  it("allows zero, meaning cut off immediately", () => {
    vi.stubEnv("BILLING_GRACE_PERIOD_DAYS", "0");
    expect(gracePeriodDays()).toBe(0);
  });

  it("falls back to the default on nonsense rather than to zero", () => {
    // Falling back to 0 would cut off a paying customer the instant a card
    // retry failed, which is the opposite of what a grace period is for.
    for (const v of ["abc", "-5", "NaN"]) {
      vi.stubEnv("BILLING_GRACE_PERIOD_DAYS", v);
      expect(gracePeriodDays()).toBe(7);
    }
  });
});

describe("stripeMode", () => {
  it("reports test mode for a test key", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_abc123");
    expect(stripeMode()).toBe("test");
    expect(billingConfigured()).toBe(true);
  });

  it("reports live mode for a live key", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_abc123");
    expect(stripeMode()).toBe("live");
  });

  it("reports unconfigured when there is no key", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect(stripeMode()).toBe("unconfigured");
    expect(billingConfigured()).toBe(false);
  });

  it("does not guess for a key of an unexpected shape", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "rk_test_restricted");
    expect(stripeMode()).toBe("unconfigured");
  });
});

describe("appOrigin", () => {
  it("prefers the configured URL over the request", () => {
    // Deriving the return URL from the request Host would let a spoofed Host
    // send a paying customer somewhere else after checkout.
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com");
    expect(appOrigin({ url: "https://attacker.test/api/billing/checkout" })).toBe(
      "https://app.example.com"
    );
  });

  it("strips trailing slashes so the built URL has no double slash", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.com///");
    expect(appOrigin({ url: "https://x.test/y" })).toBe("https://app.example.com");
  });

  it("falls back to the request origin when nothing is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(appOrigin({ url: "https://local.test/api/billing/checkout" })).toBe(
      "https://local.test"
    );
  });

  it("returns an empty string rather than throwing on an unusable request", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(appOrigin({ url: "not a url" })).toBe("");
  });
});
