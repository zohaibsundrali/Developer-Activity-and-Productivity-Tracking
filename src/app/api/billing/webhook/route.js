import { NextResponse } from "next/server";
import { serviceClient } from "@/utils/serverAuth";
import {
  stripeClient,
  verifyWebhook,
  normalizeStatus,
  toIso,
  gracePeriodDays,
} from "@/utils/stripeServer";
import { recordEvent } from "@/utils/systemEvents";

// The Edge runtime cannot do the constant-time HMAC that signature
// verification needs, and this route must read raw bytes.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/billing/webhook
// PUBLIC by necessity — Stripe calls it with no session. The signature IS the
// authentication: an unverified body is anonymous input that would otherwise be
// able to hand any organization any plan, so nothing below runs until
// verifyWebhook has accepted the exact bytes Stripe sent.

const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "invoice.paid",
  "invoice.finalized",
]);

// Statuses a subscription does not come back from. Reaching one means the paid
// relationship is over, so the plan has to fall back to free — entitlement
// limits are keyed on plan_code alone, independently of status.
const TERMINAL_STATUSES = new Set([
  "canceled",
  "expired",
  "incomplete_expired",
  "unpaid",
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request) {
  // Raw text, never request.json(): parsing and re-serialising reorders keys
  // and rewrites whitespace, which changes the bytes the signature covers.
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  let event;
  try {
    event = verifyWebhook(rawBody, signature);
  } catch (err) {
    // Deliberately nothing is written and nothing is echoed back: the message
    // would tell a prober whether the secret is configured.
    console.error("[billing/webhook] Signature verification failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Every billing table denies writes under RLS by design; the verified webhook
  // is the only writer, and it writes as the service role.
  const svc = serviceClient();

  // ── Idempotency ───────────────────────────────────────
  // The insert happens before any work. billing_events.stripe_event_id is
  // UNIQUE, so a redelivery loses the race and is recognised here rather than
  // double-applying a plan change. Stripe redelivers by design, not only on
  // failure.
  const { error: insertError } = await svc.from("billing_events").insert({
    stripe_event_id: event.id,
    event_type: event.type,
    payload: event,
  });

  if (insertError && insertError.code !== "23505") {
    console.error("[billing/webhook] Failed to record event:", insertError.message);
    return NextResponse.json({ error: "Failed to record event" }, { status: 500 });
  }

  if (insertError) {
    // Seen before — but the ledger row proves only that the event ARRIVED, not
    // that it was applied. Recording happens before the work, so an attempt
    // that threw leaves the row behind with processed_at still NULL and answers
    // 500 precisely so Stripe retries. Treating every known id as a finished
    // duplicate would make that retry a no-op: the payment succeeded at Stripe,
    // the organization never left the free plan, and nothing surfaces it.
    // processed_at is therefore the completion marker, and only a row that
    // carries one short-circuits.
    const { data: seen, error: lookupError } = await svc
      .from("billing_events")
      .select("processed_at")
      .eq("stripe_event_id", event.id)
      .limit(1);

    if (lookupError) {
      // Unknown completion state. 500 asks for another delivery rather than
      // guessing, because guessing "done" drops the event permanently.
      console.error("[billing/webhook] Failed to read event ledger:", lookupError.message);
      return NextResponse.json({ error: "Failed to record event" }, { status: 500 });
    }

    if (seen?.[0]?.processed_at) {
      // The cheap path a genuine redelivery takes: one indexed lookup, no
      // Stripe calls and no writes.
      return NextResponse.json({ received: true, duplicate: true });
    }

    // Recorded but never completed, so this delivery is the retry that has to
    // finish it. Every handler below writes through an upsert keyed on the
    // organization or the Stripe id, so replaying a partially applied event
    // converges instead of double-charging.
    console.warn(
      `[billing/webhook] Reprocessing unfinished event ${event.id} (${event.type})`
    );
  }

  if (!HANDLED_EVENTS.has(event.type)) {
    await markProcessed(svc, event.id, null);
    return NextResponse.json({ received: true, ignored: true });
  }

  try {
    const organizationId = await resolveOrganizationId(svc, event);
    if (!organizationId) {
      // 200 on purpose: a retry cannot make an unlinked customer resolvable,
      // and the raw payload is in the ledger for a human to reconcile.
      await markProcessed(svc, event.id, null, "organization could not be resolved");
      return NextResponse.json({ received: true, unresolved: true });
    }

    await processEvent(svc, event, organizationId);
    await markProcessed(svc, event.id, organizationId);
    return NextResponse.json({ received: true });
  } catch (err) {
    // Non-2xx so Stripe retries. The reason is kept in the ledger; the response
    // stays generic because this endpoint is reachable by anyone.
    console.error("[billing/webhook] Processing error:", err);
    // Monitoring (best effort, never throws — see src/utils/systemEvents.js).
    // The ledger row below already carries the reason, but nothing surfaces it:
    // a payment that succeeded at Stripe while the plan never applied is
    // invisible until a customer complains. `critical` because money moved.
    // The org is resolved again here (cheaply, and only on the error path) so
    // the event lands in the affected tenant's own health view rather than in
    // the platform bucket no tenant can see; null when it cannot be resolved,
    // which is itself the reason the event exists.
    const failedOrgId = await resolveOrganizationId(svc, event).catch(() => null);
    await recordEvent({
      orgId: failedOrgId,
      type: "billing.webhook_failed",
      severity: "critical",
      source: "api",
      message: `Stripe webhook processing failed: ${String(err?.message || err)}`,
      context: { eventType: event.type, stripeEventId: event.id, route: "/api/billing/webhook" },
    });
    await svc
      .from("billing_events")
      .update({ processing_error: String(err?.message || err).slice(0, 500) })
      .eq("stripe_event_id", event.id);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}

// ── Routing ─────────────────────────────────────────────

async function processEvent(svc, event, organizationId) {
  const object = event.data?.object || {};

  // When Stripe generated the event, not when it reached us. Retries and
  // out-of-order deliveries both change arrival time; event.created is the only
  // value that orders two events against each other.
  const eventAt = toIso(event.created) || new Date().toISOString();

  switch (event.type) {
    case "checkout.session.completed":
      return handleCheckoutCompleted(svc, organizationId, object, eventAt);

    case "customer.subscription.created":
    case "customer.subscription.updated":
      return applySubscription(svc, organizationId, object, eventAt);

    case "customer.subscription.deleted":
      // The subscription no longer exists at Stripe, whatever status the
      // payload carries.
      return applySubscription(svc, organizationId, object, eventAt, { deleted: true });

    case "invoice.payment_failed":
      return handlePaymentFailed(svc, organizationId, object);

    case "invoice.payment_succeeded":
    case "invoice.paid":
      return handlePaymentSucceeded(svc, organizationId, object);

    case "invoice.finalized":
      return upsertInvoice(svc, organizationId, object);

    default:
      return undefined;
  }
}

// ── Organization resolution ─────────────────────────────
// Metadata is the fast path because checkout sets it on both the session and
// the subscription. The customer lookup is the fallback for anything created in
// the Stripe dashboard, where nobody remembered to add metadata.

async function resolveOrganizationId(svc, event) {
  const object = event.data?.object || {};

  const fromMetadata =
    object.metadata?.organization_id ||
    object.client_reference_id ||
    object.subscription_details?.metadata?.organization_id ||
    null;
  // A malformed id would fail the foreign key and turn a recoverable event into
  // a permanent retry loop, so it is discarded in favour of the lookup.
  if (fromMetadata && UUID_RE.test(String(fromMetadata))) return String(fromMetadata);

  const customerId = idOf(object.customer);
  if (customerId) {
    const { data } = await svc
      .from("organization_subscriptions")
      .select("organization_id")
      .eq("stripe_customer_id", customerId)
      .limit(1);
    if (data?.[0]?.organization_id) return data[0].organization_id;
  }

  const subscriptionId = idOf(object.subscription) || (object.object === "subscription" ? object.id : null);
  if (subscriptionId) {
    const { data } = await svc
      .from("organization_subscriptions")
      .select("organization_id")
      .eq("stripe_subscription_id", subscriptionId)
      .limit(1);
    if (data?.[0]?.organization_id) return data[0].organization_id;
  }

  return null;
}

// ── Handlers ────────────────────────────────────────────

async function handleCheckoutCompleted(svc, organizationId, session, eventAt) {
  const customerId = idOf(session.customer);
  const subscriptionId = idOf(session.subscription);

  // Bind the customer immediately so the portal and a later dashboard-created
  // subscription can both resolve back to this organization.
  if (customerId) {
    await svc.from("organization_subscriptions").upsert(
      {
        organization_id: organizationId,
        stripe_customer_id: customerId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id" }
    );
  }

  if (!subscriptionId) return;

  // The session carries only the subscription id, and customer.subscription.*
  // may arrive after this event, so the full object is fetched rather than
  // waiting for periods and trial dates to show up later.
  const stripe = stripeClient();
  if (!stripe) return;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  await applySubscription(svc, organizationId, subscription, eventAt, {
    fallbackPlanCode: session.metadata?.plan_code || null,
  });
}

async function applySubscription(
  svc,
  organizationId,
  subscription,
  eventAt,
  { fallbackPlanCode = null, deleted = false } = {}
) {
  const item = subscription.items?.data?.[0] || null;
  const priceId = item?.price?.id || idOf(subscription.plan?.id) || null;

  // Price id first: it is what Stripe actually bills, so it wins over metadata
  // that a plan change might have left stale.
  const planCode =
    (await planCodeForPrice(svc, priceId)) ||
    subscription.metadata?.plan_code ||
    fallbackPlanCode ||
    null;

  // A deleted subscription is gone regardless of the status on the payload, and
  // an unmapped status must not read as live either.
  const status = deleted ? "canceled" : normalizeStatus(subscription.status);
  const terminal = deleted || TERMINAL_STATUSES.has(status);

  const existing = await readSubscription(svc, organizationId);

  // Stripe guarantees delivery, never delivery ORDER. A `customer.subscription
  // .updated` carrying `active` can land after the `deleted` that ended the
  // subscription, and applying it blindly would revive the row — status back to
  // active, ended_at and canceled_at nulled — leaving the organization on paid
  // limits forever with nothing at Stripe to bill or cancel. So an event older
  // than the newest one already applied is dropped.
  if (isStaleEvent(existing, eventAt, terminal)) {
    console.warn(
      `[billing/webhook] Ignoring out-of-order subscription event for org ${organizationId}`
    );
    return;
  }

  const row = {
    organization_id: organizationId,
    status,
    last_event_at: eventAt,
    stripe_subscription_id: subscription.id,
    stripe_price_id: priceId,
    current_period_start: toIso(subscription.current_period_start ?? item?.current_period_start),
    current_period_end: toIso(subscription.current_period_end ?? item?.current_period_end),
    trial_start: toIso(subscription.trial_start),
    trial_end: toIso(subscription.trial_end),
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    canceled_at: toIso(subscription.canceled_at),
    ended_at: toIso(subscription.ended_at),
    updated_at: new Date().toISOString(),
  };

  const customerId = idOf(subscription.customer);
  if (customerId) row.stripe_customer_id = customerId;

  if (terminal) {
    // Entitlement limits are read from plan_code alone — the 028 trigger joins
    // billing_plans on it without consulting status — so a cancelled Business
    // organization would keep its 150-project ceiling for good. Nothing else in
    // the webhook ever writes plan_code back down: a cancellation carries no
    // price change, so only this reset ends the paid limits.
    row.plan_code = "free";
  } else if (planCode) {
    // Left out when unknown so an unrecognised price cannot demote a paying
    // organization to the column default.
    row.plan_code = planCode;
  }

  if (status === "past_due") {
    // A past_due row with no deadline is entitled forever: the expiry check is
    // skipped when grace_period_ends_at is null, so dunning that never resolves
    // reads as an open-ended paid subscription. Any existing deadline is kept
    // rather than refreshed, otherwise each dunning event would roll the window
    // forward and the grace period would never close.
    row.grace_period_ends_at = existing?.grace_period_ends_at || graceEndFromNow();
  } else if (status === "active" || status === "trialing") {
    // Dunning is over, so the deadline that belonged to it is cleared.
    row.grace_period_ends_at = null;
  }

  const { error } = await svc
    .from("organization_subscriptions")
    .upsert(row, { onConflict: "organization_id" });
  if (error) throw new Error(`subscription upsert failed: ${error.message}`);
}

async function handlePaymentFailed(svc, organizationId, invoice) {
  const existing = await readSubscription(svc, organizationId);

  const patch = {
    organization_id: organizationId,
    last_payment_status: "failed",
    updated_at: new Date().toISOString(),
  };

  // past_due keeps the organization working until the grace window closes —
  // locking a customer out on the first failed retry loses more than it saves.
  // A subscription that already ended is left alone: past_due is an ENTITLED
  // status, so moving a cancelled organization into it would hand it another
  // grace period of paid product.
  if (!TERMINAL_STATUSES.has(existing?.status)) {
    patch.status = "past_due";
    // Reusing the deadline already in flight keeps the window fixed from the
    // first failure instead of extending it on every retry Stripe makes.
    patch.grace_period_ends_at = existing?.grace_period_ends_at || graceEndFromNow();
  }

  const { error } = await svc
    .from("organization_subscriptions")
    .upsert(patch, { onConflict: "organization_id" });
  if (error) throw new Error(`past_due update failed: ${error.message}`);

  await upsertInvoice(svc, organizationId, invoice);
}

async function handlePaymentSucceeded(svc, organizationId, invoice) {
  const paidAt =
    toIso(invoice.status_transitions?.paid_at) || new Date().toISOString();

  const existing = await readSubscription(svc, organizationId);

  const patch = {
    organization_id: organizationId,
    grace_period_ends_at: null,
    last_payment_status: "paid",
    last_payment_at: paidAt,
    updated_at: new Date().toISOString(),
  };

  // Reinstating a dunning customer means leaving past_due, not just dropping
  // the deadline. Clearing grace_period_ends_at on its own produces the one
  // combination that never expires — past_due with no end — so a paid proration
  // would hand out unlimited free product instead of restoring the account.
  // Only past_due is rewritten: a payment on a cancelled subscription must not
  // resurrect it, and active or trialing rows are already correct.
  if (existing?.status === "past_due") patch.status = "active";

  const { error } = await svc
    .from("organization_subscriptions")
    .upsert(patch, { onConflict: "organization_id" });
  if (error) throw new Error(`payment update failed: ${error.message}`);

  await upsertInvoice(svc, organizationId, invoice);
}

// Mirrored so the billing page can list invoice history without calling Stripe
// on every render.
async function upsertInvoice(svc, organizationId, invoice) {
  if (!invoice?.id) return;

  const { error } = await svc.from("billing_invoices").upsert(
    {
      organization_id: organizationId,
      stripe_invoice_id: invoice.id,
      stripe_subscription_id:
        idOf(invoice.subscription) ||
        idOf(invoice.parent?.subscription_details?.subscription) ||
        null,
      status: invoice.status || null,
      amount_due_cents: numberOrNull(invoice.amount_due),
      amount_paid_cents: numberOrNull(invoice.amount_paid),
      currency: invoice.currency || "usd",
      hosted_invoice_url: invoice.hosted_invoice_url || null,
      invoice_pdf_url: invoice.invoice_pdf || null,
      period_start: toIso(invoice.period_start),
      period_end: toIso(invoice.period_end),
      issued_at: toIso(invoice.status_transitions?.finalized_at || invoice.created),
    },
    { onConflict: "stripe_invoice_id" }
  );
  if (error) throw new Error(`invoice upsert failed: ${error.message}`);
}

// ── Helpers ─────────────────────────────────────────────

async function readSubscription(svc, organizationId) {
  const { data, error } = await svc
    .from("organization_subscriptions")
    .select("status, grace_period_ends_at, last_event_at")
    .eq("organization_id", organizationId)
    .limit(1);
  // Reads that fail must not be read as "no row": that would look like a fresh
  // organization and let a stale event through the ordering guard below.
  if (error) throw new Error(`subscription read failed: ${error.message}`);
  return data?.[0] || null;
}

/**
 * True when this event predates the one already applied to the row.
 *
 * event.created has one-second resolution, so a cancellation and an update can
 * legitimately share a timestamp; a tie is therefore resolved in favour of the
 * terminal state rather than by arrival order, because reviving a cancelled
 * subscription is the expensive mistake and re-cancelling an active one is not.
 */
function isStaleEvent(existing, eventAt, incomingIsTerminal) {
  const appliedAt = existing?.last_event_at ? Date.parse(existing.last_event_at) : NaN;
  const incomingAt = Date.parse(eventAt);
  // Rows written before the column existed carry no watermark, and an
  // unparseable timestamp gives nothing to compare, so both apply normally.
  if (!Number.isFinite(appliedAt) || !Number.isFinite(incomingAt)) return false;

  if (incomingAt < appliedAt) return true;
  if (incomingAt > appliedAt) return false;
  return TERMINAL_STATUSES.has(existing?.status) && !incomingIsTerminal;
}

function graceEndFromNow() {
  return new Date(Date.now() + gracePeriodDays() * 24 * 60 * 60 * 1000).toISOString();
}

async function planCodeForPrice(svc, priceId) {
  if (!priceId) return null;
  const { data } = await svc
    .from("billing_plans")
    .select("code")
    .eq("stripe_price_id", priceId)
    .limit(1);
  return data?.[0]?.code || null;
}

async function markProcessed(svc, stripeEventId, organizationId, processingError = null) {
  await svc
    .from("billing_events")
    .update({
      processed_at: new Date().toISOString(),
      organization_id: organizationId,
      processing_error: processingError,
    })
    .eq("stripe_event_id", stripeEventId);
}

// Stripe fields are either an id string or an expanded object depending on the
// event and the account's expansion settings.
function idOf(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.id || null;
}

function numberOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}
