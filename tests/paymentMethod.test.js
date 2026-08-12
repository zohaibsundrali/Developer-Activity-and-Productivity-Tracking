import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The card on file.
 *
 * THE REQUEST WAS "card details should go in the database". This is the version
 * of that which is safe to build, and the distinction is the whole test file.
 *
 * NEVER STORED: the full card number (PAN) or the CVV. The CVV may not be
 * retained after authorisation by anyone under PCI-DSS 3.2 — there is no
 * compliant way to keep it. And a PAN in this table would put every backup,
 * every replica and every `select *` into PCI scope.
 *
 * STORED: brand, last four, expiry, funding, and Stripe's payment_method id —
 * which is a reference, not a credential.
 *
 * The guarantee is not a convention. `card_last4 ~ '^[0-9]{4}$'` means Postgres
 * refuses a card number in that column whatever the application believes it is
 * doing. Verified on postgres:16 against every smuggling shape: 16 digits,
 * spaced groups, 5 digits, 3 digits, letters and the empty string were all
 * rejected; '4242' was accepted.
 */

const root = path.resolve(__dirname, "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");
const code = (p) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("--"))
    .join("\n");

const MIGRATION = read("database/066_payment_method_on_file.sql");
const MIGRATION_CODE = code("database/066_payment_method_on_file.sql");
const WEBHOOK = code("src/app/api/billing/webhook/route.js");
const ROUTE = code("src/app/api/billing/subscription/route.js");
const SCREEN = code("src/components/admin/BillingSubscription.jsx");

// The regex the database enforces, applied here to the same inputs the Docker
// run used — so the JS-side reasoning and the SQL cannot drift apart.
const LAST4 = /^[0-9]{4}$/;

describe("what may never be stored", () => {
  it("has no column for a card number or a security code", () => {
    for (const forbidden of ["card_number", "pan", "cvv", "cvc", "security_code"]) {
      expect(MIGRATION_CODE.toLowerCase(), `066 adds ${forbidden}`).not.toMatch(
        new RegExp(`add column if not exists\\s+${forbidden}\\b`)
      );
    }
  });

  it("constrains last4 to exactly four digits", () => {
    expect(MIGRATION_CODE).toMatch(/card_last4 ~ '\^\[0-9\]\{4\}\$'/);
  });

  it("rejects every shape a card number could arrive in", () => {
    // The same cases proven against postgres:16.
    for (const bad of [
      "4242424242424242",
      "4242 4242 4242 4242",
      "42424",
      "424",
      "abcd",
      "",
      "42 4",
    ]) {
      expect(LAST4.test(bad), `${JSON.stringify(bad)} must be refused`).toBe(false);
    }
    expect(LAST4.test("4242")).toBe(true);
    expect(LAST4.test("0000")).toBe(true);
  });

  it("adds the constraint separately from the column", () => {
    // Re-running must not be able to leave the column present and the
    // constraint missing — the state where everything looks fine and nothing
    // is enforced.
    expect(MIGRATION_CODE).toMatch(/drop constraint if exists org_subscriptions_card_last4_check/);
    expect(MIGRATION_CODE).toMatch(/add constraint org_subscriptions_card_last4_check/);
  });

  it("bounds the expiry so a mis-mapped field cannot be stored", () => {
    // A silently stored 0/0 renders as "expires 0/0" on a billing screen
    // forever.
    expect(MIGRATION_CODE).toMatch(/card_exp_month between 1 and 12/);
    expect(MIGRATION_CODE).toMatch(/card_exp_year between 2000 and 2100/);
  });

  it("verifies on the COLUMN, not on the text of the definition", () => {
    // 063 once reported projects_task_plan_status_check as proof that `status`
    // was constrained — a false all-clear on a different column.
    expect(MIGRATION).toContain("unnest(con.conkey)");
    expect(MIGRATION_CODE).not.toMatch(/pg_get_constraintdef\(oid\) ilike/);
  });

  it("leaves every column nullable", () => {
    // An organization exists long before it has a card; requiring these would
    // refuse every free-plan signup.
    expect(MIGRATION_CODE).not.toMatch(/add column if not exists card_\w+ \w+ not null/i);
  });
});

describe("the webhook captures it without ever risking the subscription", () => {
  it("writes the card in the SAME upsert as the subscription", () => {
    // A second write is a second chance to fail, leaving the subscription
    // current and the card stale — a screen showing a card that is not being
    // billed.
    expect(WEBHOOK).toMatch(/Object\.assign\(row, await readCardFields\(subscription, terminal\)\)/);
  });

  it("never lets a failed Stripe read fail the event", () => {
    // Stripe would retry the whole event. A missing card is worth far less
    // than a subscription status that never lands.
    const fn = WEBHOOK.slice(
      WEBHOOK.indexOf("async function readCardFields"),
      WEBHOOK.indexOf("async function handlePaymentMethodDetached")
    );
    expect(fn).toMatch(/try \{[\s\S]*?\} catch/);
    expect(fn).not.toMatch(/throw/);
  });

  it("re-validates last4 and the expiry before writing", () => {
    // 066 would refuse a bad value, and a refused write fails the whole
    // subscription upsert. The card must never be why a status update is lost.
    const fn = WEBHOOK.slice(WEBHOOK.indexOf("async function readCardFields"));
    expect(fn).toMatch(/\/\^\[0-9\]\{4\}\$\/\.test/);
    expect(fn).toMatch(/month >= 1 && month <= 12/);
  });

  it("handles default_payment_method as an id AND as an expanded object", () => {
    const fn = WEBHOOK.slice(WEBHOOK.indexOf("async function readCardFields"));
    expect(fn).toMatch(/typeof pm === "object" && pm\.card/);
    expect(fn).toMatch(/paymentMethods\.retrieve\(pmId\)/);
  });

  it("clears the card when the subscription ends", () => {
    // A dead card lingering on the billing screen reads as an active payment
    // method.
    const fn = WEBHOOK.slice(WEBHOOK.indexOf("async function readCardFields"));
    expect(fn).toMatch(/if \(terminal\) \{[\s\S]*?card_last4: null/);
  });

  it("clears on detach ONLY for the card it is showing", () => {
    // A customer may hold several; detaching an old one must not blank the one
    // actually being billed.
    const fn = WEBHOOK.slice(WEBHOOK.indexOf("async function handlePaymentMethodDetached"));
    expect(fn).toMatch(/\.eq\("stripe_payment_method_id", pmId\)/);
    expect(fn).toMatch(/\.eq\("organization_id", organizationId\)/);
  });

  it("routes the detach event at all", () => {
    expect(WEBHOOK).toMatch(/case "payment_method\.detached":/);
  });
});

describe("what reaches the browser", () => {
  it("publishes the brand, last four and expiry", () => {
    expect(ROUTE).toMatch(/last4: sub\.card_last4/);
    expect(ROUTE).toMatch(/expMonth: sub\.card_exp_month/);
  });

  it("does NOT publish the Stripe payment_method id", () => {
    // Like the customer and subscription ids, it stays on the server.
    const payload = ROUTE.slice(ROUTE.indexOf("card: sub.card_last4"), ROUTE.indexOf("plan: entitlement.plan"));
    expect(payload).not.toContain("stripe_payment_method_id");
  });

  it("sends null rather than a half-card when there is none", () => {
    expect(ROUTE).toMatch(/card: sub\.card_last4\s*\?/);
  });
});

describe("the expiry boundary — the part that is easy to get wrong", () => {
  // A card expiring 04/2027 is valid through 30 April 2027 and dead on 1 May.
  // The screen computes `deadAt = new Date(expYear, expMonth, 1)`, which is the
  // 1st of the FOLLOWING month because JS months are zero-based. Comparing
  // against the 1st of the expiry month instead would call a perfectly good
  // card expired for its last thirty days.
  const stateAt = (now, expMonth, expYear) => {
    const deadAt = new Date(expYear, expMonth, 1);
    if (now >= deadAt) return "expired";
    const warnFrom = new Date(expYear, expMonth - 2, 1);
    return now >= warnFrom ? "soon" : null;
  };

  it("keeps a card valid through the whole of its expiry month", () => {
    expect(stateAt(new Date(2027, 3, 30), 4, 2027)).not.toBe("expired"); // 30 Apr
    expect(stateAt(new Date(2027, 3, 1), 4, 2027)).not.toBe("expired"); // 1 Apr
  });

  it("calls it expired on the first day of the next month", () => {
    expect(stateAt(new Date(2027, 4, 1), 4, 2027)).toBe("expired"); // 1 May
  });

  it("warns two months out, not one", () => {
    // A card dying at the end of next month gives somebody a fortnight to act.
    // Warning only in the final month means the first sign is a failed payment.
    expect(stateAt(new Date(2027, 2, 1), 4, 2027)).toBe("soon"); // 1 Mar
    expect(stateAt(new Date(2027, 1, 28), 4, 2027)).toBeNull(); // 28 Feb
  });

  it("says nothing when there is no expiry on file", () => {
    expect(SCREEN).toMatch(/if \(!card\?\.expMonth \|\| !card\?\.expYear\) return null;/);
  });

  it("uses the same rule the screen ships", () => {
    // The arithmetic above is only meaningful if it is the arithmetic running.
    expect(SCREEN).toMatch(/const deadAt = new Date\(card\.expYear, card\.expMonth, 1\)/);
    expect(SCREEN).toMatch(/const warnFrom = new Date\(card\.expYear, card\.expMonth - 2, 1\)/);
  });
});

describe("the screen", () => {
  it("gives the masked number a real accessible name", () => {
    // "•••• 4242" read aloud is four bullets and a number.
    expect(SCREEN).toMatch(/ending in \{card\.last4\}/);
    expect(SCREEN).toMatch(/aria-hidden="true">•••• •••• •••• \{card\.last4\}/);
  });

  it("says what is and is not stored, where somebody will read it", () => {
    expect(SCREEN).toMatch(/never the full number, and never the security code/);
  });

  it("offers the Stripe portal rather than a card form of its own", () => {
    // Collecting a card here is what would put this server in PCI scope.
    expect(SCREEN).toContain("openPortal");
    expect(SCREEN).not.toMatch(/name="cardNumber"|placeholder="Card number"/i);
  });
});
