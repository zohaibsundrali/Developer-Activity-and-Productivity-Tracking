import { NextResponse } from "next/server";
import { serviceClient } from "@/utils/serverAuth";
import {
  stripeClient,
  verifyWebhook,
  normalizeStatus,
  toIso,
  gracePeriodDays,
} from "@/utils/stripeServer";

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
  // UNIQUE, so a redelivery loses the race and is turned away here rather than
  // double-applying a plan change. Stripe redelivers by design, not only on
  // failure.
  const { error: insertError } = await svc.from("billing_events").insert({
    stripe_event_id: event.id,
    event_type: event.type,
    payload: event,
  });

  if (insertError) {
    if (insertError.code === "23505") {
      // Already seen. An event that previously failed keeps its
      // processing_error in the ledger for a human to replay deliberately;
      // silently retrying it here is how a duplicate charge gets applied.
      return NextResponse.json({ received: true, duplicate: true });
    }
    console.error("[billing/webhook] Failed to record event:", insertError.message);
    return NextResponse.json({ error: "Failed to record event" }, { status: 500 });
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

  switch (event.type) {
    case "checkout.session.completed":
      return handleCheckoutCompleted(svc, organizationId, object);

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return applySubscription(svc, organizationId, object);

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

async function handleCheckoutCompleted(svc, organizationId, session) {
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
  await applySubscription(svc, organizationId, subscription, session.metadata?.plan_code || null);
}

async function applySubscription(svc, organizationId, subscription, fallbackPlanCode = null) {
  const item = subscription.items?.data?.[0] || null;
  const priceId = item?.price?.id || idOf(subscription.plan?.id) || null;

  // Price id first: it is what Stripe actually bills, so it wins over metadata
  // that a plan change might have left stale.
  const planCode =
    (await planCodeForPrice(svc, priceId)) ||
    subscription.metadata?.plan_code ||
    fallbackPlanCode ||
    null;

  const row = {
    organization_id: organizationId,
    status: normalizeStatus(subscription.status),
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
  // Left out when unknown so an unrecognised price cannot demote a paying
  // organization to the column default.
  if (planCode) row.plan_code = planCode;

  const { error } = await svc
    .from("organization_subscriptions")
    .upsert(row, { onConflict: "organization_id" });
  if (error) throw new Error(`subscription upsert failed: ${error.message}`);
}

async function handlePaymentFailed(svc, organizationId, invoice) {
  const graceEnd = new Date(Date.now() + gracePeriodDays() * 24 * 60 * 60 * 1000).toISOString();

  // past_due keeps the organization working until the grace window closes —
  // locking a customer out on the first failed retry loses more than it saves.
  const { error } = await svc.from("organization_subscriptions").upsert(
    {
      organization_id: organizationId,
      status: "past_due",
      grace_period_ends_at: graceEnd,
      last_payment_status: "failed",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id" }
  );
  if (error) throw new Error(`past_due update failed: ${error.message}`);

  await upsertInvoice(svc, organizationId, invoice);
}

async function handlePaymentSucceeded(svc, organizationId, invoice) {
  const paidAt =
    toIso(invoice.status_transitions?.paid_at) || new Date().toISOString();

  // Clearing the grace period is what actually reinstates a dunning customer,
  // so it happens here rather than waiting for the next subscription event.
  const { error } = await svc.from("organization_subscriptions").upsert(
    {
      organization_id: organizationId,
      grace_period_ends_at: null,
      last_payment_status: "paid",
      last_payment_at: paidAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id" }
  );
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
