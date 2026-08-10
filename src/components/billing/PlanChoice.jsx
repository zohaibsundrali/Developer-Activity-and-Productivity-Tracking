"use client";

import { Check, CreditCard, Loader2, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import { Field, Input } from "@/components/ui";

/**
 * The plan picker and the card form used during registration.
 *
 * Both live here rather than in the 1,200-line registration page so the page
 * keeps being about the registration flow, and so the billing screen can reuse
 * the same cards later without a second implementation of "what a plan looks
 * like".
 */

// ── Card handling ────────────────────────────────────────────────────
//
// READ THIS BEFORE CHANGING ANYTHING IN THIS SECTION.
//
// No card number, expiry or CVC ever leaves the browser. The form validates
// locally and the registration request sends a single boolean,
// `paymentMethodProvided: true` — see the note in src/app/api/auth/signup/
// route.js. Nothing is POSTed, nothing is logged, nothing is stored.
//
// And while this is a demo, only KNOWN TEST CARD NUMBERS are accepted. That is
// not a limitation, it is the point:
//
//   * a form that accepts a real card while taking no payment teaches somebody
//     they have paid when they have not, and the first they hear otherwise is
//     when their workspace locks;
//   * a real PAN typed into a page that is not PCI-scoped is a problem the
//     moment it exists, even if this code never transmits it — browser
//     autofill, extensions, and screen recording all see the field.
//
// When Stripe is switched on, this whole component is replaced by Stripe
// Elements, where the input is an iframe on Stripe's origin and our JavaScript
// cannot read it either.

/** Stripe's published test numbers. Nothing else is accepted while in demo. */
const TEST_CARDS = {
  "4242424242424242": "Visa",
  "4000056655665556": "Visa (debit)",
  "5555555555554444": "Mastercard",
  "5200828282828210": "Mastercard (debit)",
  "378282246310005": "American Express",
  "6011111111111117": "Discover",
};

/** The one shown in the placeholder and the hint. */
export const SAMPLE_TEST_CARD = "4242 4242 4242 4242";

export function digitsOnly(value) {
  return String(value ?? "").replace(/\D/g, "");
}

/** Groups digits the way the brand does: 4-6-5 for Amex, 4-4-4-4 otherwise. */
export function formatCardNumber(value) {
  const d = digitsOnly(value).slice(0, 19);
  const amex = /^3[47]/.test(d);
  const groups = amex ? [4, 6, 5] : [4, 4, 4, 4, 3];
  const out = [];
  let i = 0;
  for (const size of groups) {
    if (i >= d.length) break;
    out.push(d.slice(i, i + size));
    i += size;
  }
  return out.join(" ");
}

/** MM/YY, and it will not let a second slash be typed. */
export function formatExpiry(value) {
  const d = digitsOnly(value).slice(0, 4);
  if (d.length <= 2) return d;
  return `${d.slice(0, 2)}/${d.slice(2)}`;
}

/**
 * Validate the card fields. Returns an object of field → message; empty means
 * valid. `demo` true restricts the number to the test cards above.
 */
export function validateCard({ number, expiry, cvc, name }, { demo = true, now = new Date() } = {}) {
  const errors = {};
  const pan = digitsOnly(number);

  if (!String(name || "").trim()) {
    errors.name = "Enter the name printed on the card.";
  }

  // TEST CARDS ONLY, IN EVERY MODE.
  //
  // This used to relax to a length check when `demo` was false — which is to
  // say it accepted any 13-19 digits, with no Luhn check, in exactly the
  // configuration where somebody would type a REAL card. And nothing charged
  // it: there is no Stripe Elements or Checkout handoff on either screen, so
  // the real number would have been entered, autofilled and left in React
  // state for nothing.
  //
  // Until a real payment integration exists, these fields must never accept a
  // real card. The screens now hide this form entirely when Stripe is
  // configured and hand off to Checkout instead; this is the second line of
  // defence for the case where one of them forgets.
  if (!pan) {
    errors.number = "Enter a card number.";
  } else if (!TEST_CARDS[pan]) {
    errors.number = `Only test cards are accepted here. Use ${SAMPLE_TEST_CARD}.`;
  }

  const exp = digitsOnly(expiry);
  if (exp.length !== 4) {
    errors.expiry = "Enter the expiry as MM/YY.";
  } else {
    const month = Number(exp.slice(0, 2));
    const year = 2000 + Number(exp.slice(2));
    if (month < 1 || month > 12) {
      errors.expiry = "That is not a month.";
    } else {
      // Valid through the LAST day of the printed month — a card marked 08/26
      // works for all of August 2026. `new Date(y, m, 1)` with an unadjusted
      // month is the first day of the NEXT month, which is exactly the instant
      // it stops being valid.
      const expiresAt = new Date(year, month, 1);
      if (expiresAt <= now) errors.expiry = "That card has expired.";
    }
  }

  const code = digitsOnly(cvc);
  const amex = /^3[47]/.test(pan);
  if (code.length !== (amex ? 4 : 3)) {
    errors.cvc = amex ? "Amex security codes are 4 digits." : "The security code is 3 digits.";
  }

  return errors;
}

/** The brand name for a number, or "" when it is not one we recognise. */
export function cardBrand(number) {
  return TEST_CARDS[digitsOnly(number)] || "";
}

// ── Money ────────────────────────────────────────────────────────────

export function formatPrice(amountCents, currency = "usd") {
  const amount = Number(amountCents || 0) / 100;
  const symbol = String(currency).toLowerCase() === "usd" ? "$" : "";
  // Whole-dollar prices read better without the trailing ".00" — the same
  // choice BillingSubscription.jsx already makes.
  const shown = Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(2);
  return `${symbol}${shown}`;
}

/** The handful of limits worth showing on a plan card. -1 means unlimited. */
const HEADLINE_LIMITS = [
  ["developers", "developers"],
  ["projects", "projects"],
  ["active_tasks", "active tasks"],
];

function limitLine(limits, key, label) {
  const value = limits?.[key];
  if (value === undefined || value === null) return null;
  if (value === -1) return `Unlimited ${label}`;
  return `${Number(value).toLocaleString()} ${label}`;
}

// ── Plan picker ──────────────────────────────────────────────────────

/**
 * One selectable card per plan.
 *
 * Radio inputs, not buttons: this is a single choice from a set, so the native
 * control is what gives arrow-key navigation, a real focus ring and the right
 * announcement — all of which would have to be rebuilt by hand on a div.
 */
export function PlanChoice({ plans = [], value, onChange, disabled = false, loading = false }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-muted/40 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        Loading plans…
      </div>
    );
  }

  if (!plans.length) {
    // Honest rather than blank. The catalogue is empty until database/053 has
    // been run, and "no plans" with no explanation reads as a broken page.
    return (
      <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        No plans are available right now, so your workspace will start on the Free
        plan. You can choose a plan later from Billing.
      </div>
    );
  }

  return (
    <div role="radiogroup" aria-label="Choose a plan" className="grid gap-3 sm:grid-cols-2">
      {plans.map((plan) => {
        const selected = value === plan.code;
        const free = Number(plan.amount_cents || 0) === 0;
        const trial = Number(plan.trial_days || 0);

        return (
          <label
            key={plan.code}
            className={cn(
              "relative flex cursor-pointer flex-col rounded-xl border p-4 transition-colors duration-150",
              selected
                ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                : "border-border bg-card hover:border-primary/40",
              disabled && "cursor-not-allowed opacity-60"
            )}
          >
            <input
              type="radio"
              name="plan"
              value={plan.code}
              checked={selected}
              disabled={disabled}
              onChange={() => onChange?.(plan.code)}
              className="sr-only"
            />

            <span className="flex items-baseline justify-between gap-2">
              <span className="font-semibold text-foreground">{plan.name}</span>
              <span className="text-sm font-medium text-foreground">
                {free ? "Free" : (
                  <>
                    {formatPrice(plan.amount_cents, plan.currency)}
                    <span className="text-muted-foreground">/{plan.billing_interval || "month"}</span>
                  </>
                )}
              </span>
            </span>

            {plan.description && (
              <span className="mt-1 text-sm text-muted-foreground">{plan.description}</span>
            )}

            <span className="mt-3 space-y-1">
              {HEADLINE_LIMITS.map(([key, label]) => {
                const line = limitLine(plan.limits, key, label);
                if (!line) return null;
                return (
                  <span key={key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Check className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
                    {line}
                  </span>
                );
              })}
            </span>

            {trial > 0 && (
              <span className="mt-3 inline-flex w-fit items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {trial}-day free trial
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}

// ── Card form ────────────────────────────────────────────────────────

/**
 * The card fields. Controlled by the caller so the caller owns the values and
 * can be certain — by reading its own submit handler — that they are not sent.
 */
export function DemoCardFields({ card, onChange, errors = {}, disabled = false, demo = true }) {
  const set = (key) => (event) => {
    const raw = event.target.value;
    const value =
      key === "number" ? formatCardNumber(raw)
      : key === "expiry" ? formatExpiry(raw)
      : key === "cvc" ? digitsOnly(raw).slice(0, 4)
      : raw;
    onChange({ ...card, [key]: value });
  };

  const brand = cardBrand(card.number);

  return (
    <div className="space-y-5">
      {demo && (
        <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3.5">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-warning-on-tint" aria-hidden="true" />
          <p className="text-sm leading-relaxed text-foreground">
            <span className="font-medium">Demo checkout — no money moves.</span> Use the test
            card <span className="font-mono">{SAMPLE_TEST_CARD}</span>, any future expiry and
            any 3 digits. Your card details are checked in this tab and are never sent to us
            or stored anywhere.
          </p>
        </div>
      )}

      <Field label="Name on card" htmlFor="card-name" error={errors.name} required>
        <Input
          id="card-name"
          value={card.name}
          onChange={set("name")}
          placeholder="As printed on the card"
          autoComplete="cc-name"
          disabled={disabled}
          required
        />
      </Field>

      <Field label="Card number" htmlFor="card-number" error={errors.number} required>
        <div className="relative">
          <Input
            id="card-number"
            value={card.number}
            onChange={set("number")}
            placeholder={SAMPLE_TEST_CARD}
            inputMode="numeric"
            autoComplete="cc-number"
            className="pr-24 font-mono"
            disabled={disabled}
            required
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            {brand || <CreditCard className="h-4 w-4" aria-hidden="true" />}
          </span>
        </div>
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Expiry" htmlFor="card-expiry" error={errors.expiry} required>
          <Input
            id="card-expiry"
            value={card.expiry}
            onChange={set("expiry")}
            placeholder="MM/YY"
            inputMode="numeric"
            autoComplete="cc-exp"
            className="font-mono"
            disabled={disabled}
            required
          />
        </Field>

        <Field label="Security code" htmlFor="card-cvc" error={errors.cvc} required>
          <Input
            id="card-cvc"
            value={card.cvc}
            onChange={set("cvc")}
            placeholder="123"
            inputMode="numeric"
            autoComplete="cc-csc"
            className="font-mono"
            disabled={disabled}
            required
          />
        </Field>
      </div>
    </div>
  );
}

export const emptyCard = () => ({ name: "", number: "", expiry: "", cvc: "" });
