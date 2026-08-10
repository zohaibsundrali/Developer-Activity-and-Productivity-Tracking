import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  accessState,
  isLocked,
  daysUntil,
  trialEndFor,
  lockMessage,
  reminderMessage,
  DEFAULT_TRIAL_DAYS,
} from "@/utils/billingAccess";

/**
 * The trial gate.
 *
 * This is the one piece of billing that can take a paying customer's workspace
 * away from them, so the tests are weighted towards everything that must NOT
 * lock. A false negative here costs a signup; a false positive locks a real
 * company out of its own data, which is not a bug you get to fix quietly.
 */

const root = path.resolve(__dirname, "..");
const NOW = new Date("2026-08-10T12:00:00Z");
const days = (n) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

describe("what must never lock", () => {
  it("an organization with no subscription row at all", () => {
    // Fails OPEN. Every org gets a row in database/053, but a missing one must
    // not be reachable as a lock — absence is not evidence of non-payment.
    expect(isLocked(null, NOW)).toBe(false);
    expect(isLocked(undefined, NOW)).toBe(false);
  });

  it("the free plan, under every status there is", () => {
    for (const status of [
      "trialing", "active", "past_due", "canceled",
      "expired", "incomplete", "incomplete_expired", "unpaid", "paused",
    ]) {
      const sub = {
        plan_code: "free",
        status,
        trial_end: days(-100),
        grace_period_ends_at: days(-100),
      };
      expect(isLocked(sub, NOW), `free/${status}`).toBe(false);
    }
  });

  it("a paid plan that was deliberately cancelled", () => {
    // /api/billing/cancel tells the user on screen that their plan "stays
    // active until the end of the current period, then reverts to Free".
    // Locking them would break a promise the product already made.
    const sub = { plan_code: "business", status: "canceled", trial_end: days(-30) };
    expect(isLocked(sub, NOW)).toBe(false);
  });

  it("a paid plan whose trial has no end date — the open-ended grant", () => {
    // This is how PART 3 of database/053 holds the owner's own organization on
    // enterprise permanently. A null trial_end must read as "no countdown",
    // never as "expired at the epoch".
    const sub = { plan_code: "enterprise", status: "trialing", trial_end: null };
    expect(isLocked(sub, NOW)).toBe(false);
  });

  it("a trial with time left, right down to the final second", () => {
    const sub = { plan_code: "business", status: "trialing", trial_end: new Date(NOW.getTime() + 1000) };
    expect(isLocked(sub, NOW)).toBe(false);
    expect(accessState(sub, NOW).onTrial).toBe(true);
  });

  it("past_due while the grace period is still running", () => {
    const sub = { plan_code: "business", status: "past_due", grace_period_ends_at: days(3) };
    expect(isLocked(sub, NOW)).toBe(false);
  });

  it("past_due with no grace date recorded", () => {
    // Missing data must not become a lock.
    const sub = { plan_code: "business", status: "past_due", grace_period_ends_at: null };
    expect(isLocked(sub, NOW)).toBe(false);
  });

  it("a malformed trial_end", () => {
    const sub = { plan_code: "business", status: "trialing", trial_end: "not-a-date" };
    expect(isLocked(sub, NOW)).toBe(false);
  });
});

describe("what does lock", () => {
  it("a paid trial that ended without payment", () => {
    const sub = { plan_code: "business", status: "trialing", trial_end: days(-1) };
    const state = accessState(sub, NOW);
    expect(state.locked).toBe(true);
    expect(state.reason).toBe("trial_expired");
    expect(state.daysRemaining).toBe(0);
  });

  it("past_due once the grace period has also elapsed", () => {
    const sub = { plan_code: "professional", status: "past_due", grace_period_ends_at: days(-1) };
    expect(accessState(sub, NOW).reason).toBe("grace_expired");
  });

  it("unpaid — every retry failed", () => {
    const sub = { plan_code: "professional", status: "unpaid" };
    expect(accessState(sub, NOW).reason).toBe("unpaid");
  });
});

describe("the countdown", () => {
  it("rounds up, so a part-day still reads as a whole day", () => {
    // 6.2 days left must say 7, not 6. Rounding down would show "0 days
    // remaining" for the whole of the final day while the workspace still
    // works, which teaches people the number is meaningless.
    const sub = {
      plan_code: "business",
      status: "trialing",
      trial_end: new Date(NOW.getTime() + 6.2 * 24 * 60 * 60 * 1000),
    };
    expect(accessState(sub, NOW).daysRemaining).toBe(7);
  });

  it("counts a fresh 7-day trial as 7", () => {
    const sub = { plan_code: "business", status: "trialing", trial_end: days(7) };
    expect(accessState(sub, NOW).daysRemaining).toBe(7);
  });

  it("never goes negative", () => {
    expect(daysUntil(days(-40), NOW)).toBe(0);
  });

  it("returns null for a date it cannot read", () => {
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil("rubbish", NOW)).toBeNull();
  });
});

describe("trialEndFor", () => {
  it("uses the plan's own trial_days", () => {
    expect(trialEndFor(7, NOW).toISOString()).toBe(days(7).toISOString());
    expect(trialEndFor(30, NOW).toISOString()).toBe(days(30).toISOString());
  });

  it("falls back to the default rather than to zero", () => {
    // A zero here would mint a subscription that is already expired — the user
    // would be locked out by the same request that created their account.
    for (const bad of [0, -5, null, undefined, "", "abc", NaN]) {
      expect(trialEndFor(bad, NOW).toISOString(), String(bad)).toBe(
        days(DEFAULT_TRIAL_DAYS).toISOString()
      );
    }
  });

  it("the default is 7 days, matching database/053", () => {
    expect(DEFAULT_TRIAL_DAYS).toBe(7);
    const sql = readFileSync(path.join(root, "database/053_billing_plans_and_trials.sql"), "utf8");
    // The two paid, self-serve plans carry a 7-day trial in the seed.
    expect(sql).toMatch(/'professional'[^\n]*'month', 7,/);
    expect(sql).toMatch(/'business'[^\n]*'month', 7,/);
    // Free is 0 — free is a destination, not a countdown.
    expect(sql).toMatch(/'free'[^\n]*'month', 0,/);
  });
});

describe("the words shown to people", () => {
  it("names the actual reason, so the fix is obvious", () => {
    expect(lockMessage({ reason: "trial_expired" })).toMatch(/trial has ended/i);
    expect(lockMessage({ reason: "grace_expired" })).toMatch(/payment/i);
    expect(lockMessage({ reason: "unpaid" })).toMatch(/unpaid/i);
    expect(lockMessage(null)).toMatch(/subscription/i);
  });

  it("counts in grammatical English at both ends", () => {
    expect(reminderMessage("Business", 6)).toBe(
      "6 days left on your Business trial. Add a payment method before it ends."
    );
    expect(reminderMessage("Business", 1)).toMatch(/^1 day left/);
    expect(reminderMessage("Business", 0)).toMatch(/ends today/);
    // No "1 days", no "0 days remaining".
    expect(reminderMessage("Business", 1)).not.toMatch(/1 days/);
    expect(reminderMessage("Business", 0)).not.toMatch(/0 days/);
  });
});

describe("database/053", () => {
  const sql = readFileSync(path.join(root, "database/053_billing_plans_and_trials.sql"), "utf8");
  const statements = sql
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("--"));

  it("obeys the migration format rules", () => {
    expect(sql).not.toMatch(/\bDO\s*\$\$/i);
    expect(sql).not.toMatch(/\$\$/);
    // One statement per physical line.
    for (const line of statements) {
      expect(line.trim().endsWith(";"), line.slice(0, 70)).toBe(true);
    }
  });

  it("backfills existing organizations onto free and ACTIVE, never a trial", () => {
    // The statement that decides whether shipping the gate locks existing
    // customers out. 'active' on free can never expire.
    expect(sql).toMatch(/insert into public\.organization_subscriptions[^\n]*'free', 'active'/);
    expect(sql).toMatch(/where not exists \(select 1 from public\.organization_subscriptions/);
  });

  it("advertises no API on any plan, because there is no API", () => {
    expect(sql).not.toMatch(/"api_access": true/);
    expect((sql.match(/"api_access": false/g) || []).length).toBe(4);
  });

  it("converges on re-run instead of skipping like 027 did", () => {
    // 027 used `on conflict do nothing`, which is why its partially-applied
    // seed could never be corrected by running it again.
    // Counted over statements, not the whole file — the comment above them
    // names both forms while explaining why one was chosen.
    const body = statements.join("\n");
    expect(body).not.toMatch(/on conflict \(code\) do nothing/);
    expect((body.match(/on conflict \(code\) do update/g) || []).length).toBe(4);
  });
});

describe("the daily trial reminder (cron job 3)", () => {
  const cron = readFileSync(path.join(root, "src/app/api/cron/route.js"), "utf8");

  it("addresses admins with admin_id/admin_email, not developer_id", () => {
    // It was written with `developer_id`, copied from job 1 — but job 3's
    // recipients are owners and admins, whose memberships.user_id is an
    // admin_users.id. Two things went wrong: notifications.developer_id
    // references developers(id), so the whole batch insert failed the foreign
    // key while the route still answered 200; and the admin bell queries
    // admin_id/admin_email, so even a successful insert was invisible for ever.
    const job = cron.slice(cron.indexOf("3. Trial reminders"));
    expect(job).toMatch(/admin_id: member\.user_id/);
    expect(job).toMatch(/admin_email: member\.email/);
    expect(job).not.toMatch(/developer_id: member\.user_id/);
  });

  it("only notifies roles that can actually pay", () => {
    expect(cron).toMatch(/TRIAL_NOTIFY_ROLES = \["owner", "admin"\]/);
  });

  it("never reminds a free organization — it has no trial to lose", () => {
    const job = cron.slice(cron.indexOf("3. Trial reminders"));
    expect(job).toMatch(/\.neq\("plan_code", "free"\)/);
  });

  it("scopes and bounds the dedupe read", () => {
    // Unscoped and unbounded, PostgREST's default row cap could silently
    // truncate the result on a large deployment — which reads as "nothing sent
    // today" and re-sends the warning.
    const job = cron.slice(cron.indexOf("3. Trial reminders"));
    expect(job).toMatch(/\.in\("organization_id", orgIds\)/);
    expect(job).toMatch(/\.limit\(\d+\)/);
  });
});

describe("the gate is mounted on every area, not just /admin", () => {
  const read = (rel) => readFileSync(path.join(root, rel), "utf8");

  it("covers admin, developer and client", () => {
    // Mounted only on /admin at first, which made the lock trivial to
    // side-step: middleware lets userType 'admin' into /developer, so a locked
    // admin could just navigate there — as could every developer, who was
    // never redirected at all.
    for (const layout of [
      "src/app/admin/layout.js",
      "src/app/developer/layout.js",
      "src/app/client/layout.js",
    ]) {
      expect(read(layout), layout).toMatch(/<BillingGate>/);
    }
  });

  it("holds the children until the first answer, instead of flashing them", () => {
    const gate = read("src/components/billing/BillingGate.jsx");
    expect(gate).toMatch(/const \[checked, setChecked\] = useState\(false\)/);
    expect(gate).toMatch(/if \(!checked\)/);
    // Released in `finally`, so a failure cannot hold the app shut.
    expect(gate).toMatch(/finally \{[\s\S]{0,220}setChecked\(true\)/);
  });
});

describe("write routes with no plan meter still refuse a locked workspace", () => {
  const read = (rel) => readFileSync(path.join(root, rel), "utf8");

  it.each([
    "src/app/api/task-submission/route.js",
    "src/app/api/task-plan/submit/route.js",
    "src/app/api/admin-review/route.js",
    "src/app/api/ai-generate-tasks/route.js",
  ])("%s calls requireUnlocked", (file) => {
    const source = read(file);
    expect(source).toMatch(/import \{ requireUnlocked \} from '@\/utils\/entitlements'/);
    expect(source).toMatch(/requireUnlocked\(serviceClient\(\), auth\.orgId\)/);
  });
});
