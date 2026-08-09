import Stripe from "stripe";
import { BRAND_NAME } from "@/components/brand/brand";

/**
 * Server-only Stripe access.
 *
 * Nothing in this file may ever be imported from a client component. The secret
 * key and the webhook signing secret are read from the environment at call time
 * and are never returned, logged, or placed in a response body.
 *
 * There is no publishable key here on purpose: this integration uses hosted
 * Checkout and the hosted Customer Portal, so the browser only ever receives a
 * redirect URL that Stripe generated. No card data touches the app.
 */

let cached = null;

/** The configured Stripe client, or null when billing is not configured yet. */
export function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (cached) return cached;
  cached = new Stripe(key, {
    // Pinned so a Stripe-side API default change cannot alter behaviour silently.
    apiVersion: "2024-06-20",
    typescript: false,
    // Stripe `appInfo.name` — an integration label shown in Stripe's own
    // dashboards and request logs. NOT the card statement descriptor (that is
    // set on the Stripe product/account and is limited to 22 characters), so
    // renaming it here cannot change what a customer sees on a bank statement.
    appInfo: { name: `${BRAND_NAME} Billing` },
  });
  return cached;
}

/** True when the secret key is present. Used to fail with a clear message. */
export function billingConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/**
 * A test key starts `sk_test_`. Surfaced so the billing UI can show an
 * unmistakable badge — shipping a page that silently charges real cards
 * because someone pasted a live key into a staging environment is worse than
 * any bug in this file.
 */
export function stripeMode() {
  const key = process.env.STRIPE_SECRET_KEY || "";
  if (key.startsWith("sk_test_")) return "test";
  if (key.startsWith("sk_live_")) return "live";
  return "unconfigured";
}

/**
 * Absolute origin for Checkout return URLs. Stripe rejects relative URLs, and
 * deriving it from the request Host header would let a spoofed Host redirect a
 * paying customer somewhere else — so an explicit env var wins, with the
 * request origin only as a development convenience.
 */
export function appOrigin(request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/+$/, "");
  try {
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}

/**
 * Verify a webhook signature and return the parsed event.
 *
 * Throws on any failure. An unverified body is attacker-controlled input that
 * would otherwise be able to grant any organization any plan, so this is the
 * one place the webhook route may not shortcut.
 *
 * `rawBody` MUST be the exact bytes Stripe sent — parsing and re-serialising
 * the JSON changes the signature.
 */
export function verifyWebhook(rawBody, signatureHeader) {
  const stripe = stripeClient();
  if (!stripe) throw new Error("STRIPE_SECRET_KEY is not configured");

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  if (!signatureHeader) throw new Error("Missing stripe-signature header");

  return stripe.webhooks.constructEvent(rawBody, signatureHeader, secret);
}

/**
 * Map a Stripe subscription status onto the set migration 027 allows.
 * Unknown values become `incomplete` rather than being written through — the
 * CHECK constraint would reject them and lose the whole webhook.
 */
const KNOWN_STATUSES = new Set([
  "trialing",
  "active",
  "past_due",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "unpaid",
  "paused",
]);

export function normalizeStatus(stripeStatus) {
  const s = String(stripeStatus || "");
  return KNOWN_STATUSES.has(s) ? s : "incomplete";
}

/** Seconds-since-epoch (Stripe's format) to an ISO string, or null. */
export function toIso(unixSeconds) {
  if (!unixSeconds && unixSeconds !== 0) return null;
  const d = new Date(Number(unixSeconds) * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * How long a past_due organization keeps working while Stripe retries the card.
 * Configurable so it can be aligned with the Stripe dunning schedule without a
 * code change; defaults to a week.
 */
export function gracePeriodDays() {
  const configured = process.env.BILLING_GRACE_PERIOD_DAYS;
  // An empty or whitespace value means "not set". Number("") is 0, so reading
  // it straight would give an unset variable a ZERO-day grace period and cut a
  // paying customer off the instant one card retry failed — the opposite of
  // what a grace period is for.
  if (configured === undefined || String(configured).trim() === "") return 7;
  const raw = Number(configured);
  return Number.isFinite(raw) && raw >= 0 ? raw : 7;
}
