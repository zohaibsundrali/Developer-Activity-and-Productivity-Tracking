/**
 * Trial state and the lock that follows it.
 *
 * WHY THIS IS SEPARATE FROM entitlements.js
 *  `entitlements.js` answers "which limits apply?". When a plan lapses it
 *  answers "free limits" — the organization keeps working, smaller. That is the
 *  right answer for a downgrade and the wrong one for a trial that ran out
 *  without payment, where the product decision is that the workspace closes
 *  until somebody pays.
 *
 *  So there are two different questions and this module owns the second one:
 *
 *    entitled  →  how much can they do            (entitlements.js)
 *    locked    →  may they do anything at all     (here)
 *
 * WHAT LOCKS, AND WHAT DELIBERATELY DOES NOT
 *
 *   locks    a paid plan whose 7-day trial ended with no payment
 *   locks    past_due once the grace period has also elapsed
 *   locks    unpaid — the card failed every retry
 *
 *   never    the free plan, under any status. Free is a destination, not a
 *            countdown; an expiring free tier is not a free tier.
 *   never    an organization with no subscription row. Every org gets one in
 *            database/053, but a missing row must fail OPEN — a lock is the
 *            most destructive thing this file can do and it should never be
 *            reachable by a row simply being absent.
 *   never    `canceled` or `expired`. Someone who deliberately cancelled chose
 *            to stop paying; the existing behaviour reverts them to free limits
 *            and /api/billing/cancel promises exactly that on screen. Locking
 *            them out would break that promise and punish the honest exit.
 *
 * Pure functions over a subscription row: no database, no clock of its own, no
 * imports. `now` is always a parameter so the whole thing is testable without
 * waiting seven days.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The plan that can never lock. Matches FREE_PLAN_CODE in entitlements.js. */
export const FREE_PLAN_CODE = "free";

/**
 * How long a paid plan's self-serve trial runs. Stated here so the signup route
 * and the copy agree, but it is only a FALLBACK: the real number is
 * `billing_plans.trial_days` (seeded to 7 by database/053), because a trial
 * length that lives in code cannot be changed without a deploy.
 */
export const DEFAULT_TRIAL_DAYS = 7;

/** Days remaining at which the daily reminder starts caring. */
export const REMINDER_FROM_DAYS = 7;

function toDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Whole days from `now` until `end`, rounded UP, never below zero.
 *
 * Rounded up on purpose: with 6.2 days left a person should be told "7 days",
 * not "6". Rounding down would show "0 days remaining" for the entire final
 * day, while the workspace still works — which reads as a bug, and worse,
 * teaches people to ignore the number.
 */
export function daysUntil(end, now = new Date()) {
  const target = toDate(end);
  if (!target) return null;
  const ms = target.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / MS_PER_DAY);
}

/**
 * The whole access picture for one organization.
 *
 * @param {object|null} subscription  a row from organization_subscriptions
 * @param {Date} now
 * @returns {{
 *   planCode: string,
 *   status: string,
 *   locked: boolean,
 *   reason: null|"trial_expired"|"grace_expired"|"unpaid",
 *   onTrial: boolean,
 *   daysRemaining: number|null,
 *   trialEnd: string|null,
 * }}
 */
export function accessState(subscription, now = new Date()) {
  const planCode = subscription?.plan_code || FREE_PLAN_CODE;
  const status = String(subscription?.status || "active");

  const base = {
    planCode,
    status,
    locked: false,
    reason: null,
    onTrial: false,
    daysRemaining: null,
    trialEnd: subscription?.trial_end || null,
  };

  // Fail open: no row at all, or the free plan, is never a lock.
  if (!subscription) return base;
  if (planCode === FREE_PLAN_CODE) return base;

  if (status === "trialing") {
    const trialEnd = toDate(subscription.trial_end);
    // A trialing row with no end date is a deliberate open-ended grant — see
    // PART 3 of database/053, which is how the owner's own organization is
    // held on enterprise without a countdown.
    if (!trialEnd) return base;

    if (now > trialEnd) {
      return { ...base, locked: true, reason: "trial_expired", daysRemaining: 0 };
    }
    return { ...base, onTrial: true, daysRemaining: daysUntil(trialEnd, now) };
  }

  if (status === "past_due") {
    const graceEnd = toDate(subscription.grace_period_ends_at);
    if (graceEnd && now > graceEnd) {
      return { ...base, locked: true, reason: "grace_expired", daysRemaining: 0 };
    }
    return { ...base, daysRemaining: graceEnd ? daysUntil(graceEnd, now) : null };
  }

  if (status === "unpaid") {
    return { ...base, locked: true, reason: "unpaid", daysRemaining: 0 };
  }

  return base;
}

/** Convenience: is this organization shut out right now? */
export function isLocked(subscription, now = new Date()) {
  return accessState(subscription, now).locked;
}

/** The sentence shown to a locked admin. One place, so it cannot drift. */
export function lockMessage(state) {
  switch (state?.reason) {
    case "trial_expired":
      return "Your 7-day trial has ended. Add a payment method to keep using your workspace.";
    case "grace_expired":
      return "We could not take payment for your last invoice. Update your payment method to restore access.";
    case "unpaid":
      return "Your subscription is unpaid. Update your payment method to restore access.";
    default:
      return "Your subscription needs attention before you can continue.";
  }
}

/**
 * The daily reminder line. `days` is whole days remaining.
 *
 * Written to read naturally at both ends of the range — "1 day remaining" and
 * "ends today" rather than "1 days" and "0 days remaining".
 */
export function reminderMessage(planName, days) {
  const plan = planName || "your plan";
  if (days <= 0) return `Your ${plan} trial ends today. Add a payment method to keep your workspace open.`;
  if (days === 1) return `1 day left on your ${plan} trial. Add a payment method to avoid losing access tomorrow.`;
  return `${days} days left on your ${plan} trial. Add a payment method before it ends.`;
}

/**
 * When the trial for a plan should end, counted from `startedAt`.
 * `trialDays` comes from billing_plans; anything absent or nonsensical falls
 * back to DEFAULT_TRIAL_DAYS rather than to zero, because a zero here would
 * mint a subscription that is already expired.
 */
export function trialEndFor(trialDays, startedAt = new Date()) {
  const days = Number(trialDays);
  const n = Number.isFinite(days) && days > 0 ? Math.round(days) : DEFAULT_TRIAL_DAYS;
  return new Date(startedAt.getTime() + n * MS_PER_DAY);
}
