import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { requirePermission } from "@/utils/serverPermissions";
import { stripeClient, billingConfigured, appOrigin } from "@/utils/stripeServer";

export const dynamic = "force-dynamic";
async function deletionStarted(svc, orgId) {
  const result = await svc.rpc('organization_deletion_active', { p_org: orgId });
  if (result.error || typeof result.data !== 'boolean') throw new Error('Organization deletion state unavailable');
  return result.data;
}
const deletionResponse = () => NextResponse.json({ error: 'Organization deletion is in progress; billing changes are disabled.' }, { status: 409 });


// POST /api/billing/checkout
// Body: { planCode }
// Moves the caller's own organization onto a plan. An organization with no live
// subscription gets a hosted Checkout session ({ url } to redirect to); one that
// already subscribes has its existing subscription re-priced in place
// ({ planChanged: true, ... }), because a second Checkout would mean a second
// live subscription billing alongside the first.
// Only an owner may commit the organization to a recurring charge — an admin can
// read the billing page but cannot buy.
export async function POST(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Permission, not an inline role comparison. `billing.purchase` and NOT
    // `billing.manage`: that one includes finance, and committing the
    // organization to a recurring charge is the owner's decision alone.
    const denied = requirePermission(auth, "billing.purchase");
    if (denied) return denied;

    if (!billingConfigured()) {
      return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
    }
    const origin = appOrigin(request);
    if (!origin) return NextResponse.json({ error: "Billing return URL is not configured correctly." }, { status: 503 });
    const stripe = stripeClient();

    const { planCode } = await request.json().catch(() => ({}));
    if (!planCode || typeof planCode !== "string") {
      return NextResponse.json({ error: "planCode is required" }, { status: 400 });
    }

    const svc = serviceClient();

    // The price is looked up from the catalogue by plan code. Accepting a price
    // id from the body would let a caller pay for the cheapest plan while
    // subscribing to the most expensive one.
    const { data: plan, error: planError } = await svc
      .from("billing_plans")
      .select("code, name, stripe_price_id, trial_days, amount_cents, is_active")
      .eq("code", planCode)
      .maybeSingle();

    if (planError) return NextResponse.json({ error: "Plan lookup unavailable. Please retry." }, { status: 503 });

    if (!plan || !plan.is_active) {
      return NextResponse.json({ error: "Unknown plan." }, { status: 400 });
    }
    if (plan.amount_cents === 0) {
      return NextResponse.json(
        { error: `The ${plan.name} plan is free and does not require checkout.` },
        { status: 400 }
      );
    }
    if (!plan.stripe_price_id) {
      return NextResponse.json(
        { error: `The ${plan.name} plan has no Stripe price configured yet.` },
        { status: 400 }
      );
    }

    // Org id comes from the verified JWT. Anything the body says about which
    // organization is being billed is ignored.
    const organizationId = auth.orgId;
    if (await deletionStarted(svc, organizationId)) return deletionResponse();

    const { data: existing, error: subscriptionError } = await svc
      .from("organization_subscriptions")
      .select("stripe_customer_id, stripe_subscription_id, plan_code, status, updated_at")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (subscriptionError) return NextResponse.json({ error: "Subscription lookup unavailable. Please retry." }, { status: 503 });

    // Reusing the customer keeps one payment-method and invoice history per
    // organization; creating a second customer would silently split them.
    let customerId = existing?.stripe_customer_id || null;
    if (!customerId) {
      const { data: org, error: orgError } = await svc
        .from("organizations")
        .select("name")
        .eq("id", organizationId)
        .maybeSingle();

      if (orgError || !org) return NextResponse.json({ error: "Organization lookup unavailable." }, { status: 503 });

      if (await deletionStarted(svc, organizationId)) return deletionResponse();
      const customer = await stripe.customers.create({
        email: auth.email || undefined,
        name: org?.name || undefined,
        // The webhook falls back to this when an event carries no metadata of
        // its own, so it must be set at creation time.
        metadata: { organization_id: organizationId },
      }, { idempotencyKey: `organization-customer-${organizationId}` });
      customerId = customer.id;
      if (await deletionStarted(svc, organizationId)) return deletionResponse();

      const { error: customerSaveError } = await svc
        .from("organization_subscriptions")
        .upsert(
          {
            organization_id: organizationId,
            stripe_customer_id: customerId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "organization_id" }
        );
      if (customerSaveError) return NextResponse.json({ error: "Could not save billing customer. Please retry." }, { status: 503 });
    }

    const trialDays = Number(plan.trial_days) > 0 ? Number(plan.trial_days) : null;
    // Carried on the session AND on the subscription: a subscription.updated
    // event arriving months later has no session attached to look at.
    const metadata = { organization_id: organizationId, plan_code: plan.code };

    // ── An organization that already pays changes its plan IN PLACE ──
    //
    // Checkout in `subscription` mode always creates a NEW subscription. Sending
    // an already-subscribed organization through it a second time leaves two
    // live subscriptions on one customer, both billing, and the stored
    // subscription id is overwritten by whichever finished last — so the first
    // one keeps charging where nobody can see it. Every plan card on the billing
    // screen posts here, including the ones labelled "Downgrade", so this is the
    // ordinary path for an existing customer, not an edge case.
    //
    // Stripe is asked for the subscription rather than trusting the stored
    // status: the row can lag a cancellation by a webhook.
    let liveSubscription = null;
    if (existing?.stripe_subscription_id) {
      try {
        const sub = await stripe.subscriptions.retrieve(existing.stripe_subscription_id);
        // Only a subscription that can still be modified counts. A canceled or
        // never-completed one has to be replaced by real Checkout.
        if (sub && ["active", "trialing", "past_due", "unpaid"].includes(sub.status)) {
          liveSubscription = sub;
        }
      } catch (error) {
        // A timeout, invalid API key or stale account reference is not evidence
        // that no subscription exists. Never open a second checkout on failure.
        return NextResponse.json({ error: "Could not verify your existing subscription. Please retry or contact support." }, { status: 503 });
      }
    }

    // Webhooks may not have stored a newly completed subscription yet.
    // Check Stripe's customer before deciding that a new purchase is safe.
    if (!liveSubscription) {
      try {
        const subscriptions = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 });
        if (subscriptions.has_more) return NextResponse.json({ error: "Billing history needs review. Contact support." }, { status: 409 });
        const current = subscriptions.data.filter(sub => !["canceled", "incomplete_expired"].includes(sub.status));
        if (current.length > 1) return NextResponse.json({ error: "Multiple subscriptions need review in the billing portal." }, { status: 409 });
        if (current.length === 1) {
          if (!["active", "trialing", "past_due", "unpaid"].includes(current[0].status)) {
            return NextResponse.json({ error: "Complete or resolve your pending subscription in the billing portal first." }, { status: 409 });
          }
          liveSubscription = current[0];
        }
      } catch {
        return NextResponse.json({ error: "Could not verify billing history. Please retry." }, { status: 503 });
      }
    }

    if (liveSubscription) {
      const items = liveSubscription.items?.data || [];
      const currentItem = items[0] || null;
      if (!currentItem) {
        return NextResponse.json(
          { error: "Your subscription has no billable item to change. Contact support." },
          { status: 409 }
        );
      }
      // More than one item means a shape this route did not create; swapping
      // the first price would silently drop the rest.
      if (items.length > 1) {
        return NextResponse.json(
          { error: "Your subscription has multiple items and must be changed from the billing portal." },
          { status: 409 }
        );
      }

      const alreadyOnPlan = currentItem.price?.id === plan.stripe_price_id;
      if (await deletionStarted(svc, organizationId)) return deletionResponse();
      if (!alreadyOnPlan) {
        await stripe.subscriptions.update(liveSubscription.id, {
          items: [{ id: currentItem.id, price: plan.stripe_price_id }],
          // The customer is charged (or credited) only for the difference, so
          // an upgrade mid-cycle is not a second full month and a downgrade
          // does not quietly forfeit what was already paid.
          proration_behavior: "create_prorations",
          // Preserve the existing next-invoice proration policy, but if Stripe
          // requires a charge now, do not apply a change whose payment fails.
          payment_behavior: "error_if_incomplete",
          metadata,
        });
      }

      if (await deletionStarted(svc, organizationId)) {
        const verifiedCustomer = typeof liveSubscription.customer === 'string' ? liveSubscription.customer : liveSubscription.customer?.id;
        if (verifiedCustomer !== customerId || liveSubscription.metadata?.organization_id !== organizationId)
          throw new Error('Cannot safely compensate unverified subscription identity');
        await stripe.subscriptions.cancel(liveSubscription.id, { invoice_now: false, prorate: false });
        return deletionResponse();
      }

      // The webhook records the authoritative state; this write only keeps the
      // billing screen from showing the old plan until that event lands.
      // A webhook or another plan request may have committed after our read.
      // Never replace that newer state with this request's older plan choice.
      if (!existing?.updated_at) return NextResponse.json({ error: "Stripe accepted the change; billing synchronization is pending. Refresh shortly." }, { status: 503 });
      const { data: savedPlan, error: planSaveError } = await svc
        .from("organization_subscriptions")
        .update({
          stripe_customer_id: customerId,
          stripe_subscription_id: liveSubscription.id,
          plan_code: plan.code,
          updated_at: new Date().toISOString(),
        })
        .eq("organization_id", organizationId)
        .eq("updated_at", existing.updated_at)
        .select("organization_id");
      if (planSaveError || !savedPlan?.length) return NextResponse.json({ error: "Stripe accepted the change; billing synchronization is pending. Refresh shortly." }, { status: 503 });

      // No Stripe-hosted page is involved, so there is nothing to redirect to
      // for payment. `url` points back at the billing screen because the caller
      // navigates to whatever `url` holds; `planChanged` is what tells a caller
      // that knows about in-place changes to refresh in place instead.
      return NextResponse.json({
        planChanged: true,
        changed: !alreadyOnPlan,
        planCode: plan.code,
        planName: plan.name,
        subscriptionId: liveSubscription.id,
        url: `${origin}/admin/dashboard?section=billing&plan=changed`,
      });
    }

    let previousSession = null;
    try {
      const sessions = await stripe.checkout.sessions.list({ customer: customerId, limit: 1 });
      previousSession = sessions.data[0] || null;
      if (previousSession?.status === "complete") {
        // A completion can race the subscription-list lookup above. Resolve
        // its subscription again rather than opening a second purchase.
        const subscriptionId = typeof previousSession.subscription === "string" ? previousSession.subscription : previousSession.subscription?.id;
        if (!subscriptionId) return NextResponse.json({ error: "Your completed checkout is still processing. Refresh shortly." }, { status: 409 });
        const completed = await stripe.subscriptions.retrieve(subscriptionId);
        if (!["canceled", "incomplete_expired"].includes(completed.status)) {
          return NextResponse.json({ error: "Your subscription is synchronizing. Refresh before changing plans." }, { status: 409 });
        }
      }
      if (previousSession?.status === "open") {
        if (previousSession.metadata?.plan_code === plan.code && previousSession.url) {
          if (await deletionStarted(svc, organizationId)) { await stripe.checkout.sessions.expire(previousSession.id); return deletionResponse(); }
          return NextResponse.json({ url: previousSession.url });
        }
        await stripe.checkout.sessions.expire(previousSession.id, {}, { idempotencyKey: `expire-checkout-${previousSession.id}` });
      }
    } catch {
      return NextResponse.json({ error: "Could not safely resume checkout. Please retry." }, { status: 503 });
    }

    if (await deletionStarted(svc, organizationId)) return deletionResponse();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      // The billing screen is a section of the admin dashboard, not a route of
      // its own — sending a paying customer anywhere else lands them on a 404.
      // `checkout` is read by that screen; the Stripe session id is not carried
      // back because the webhook, not the browser, records what was bought.
      success_url: `${origin}/admin/dashboard?section=billing&checkout=success`,
      cancel_url: `${origin}/admin/dashboard?section=billing&checkout=cancelled`,
      client_reference_id: organizationId,
      allow_promotion_codes: true,
      metadata,
      subscription_data: {
        metadata,
        ...(trialDays ? { trial_period_days: trialDays } : {}),
      },
    }, { idempotencyKey: `organization-checkout-${organizationId}-${previousSession?.id || "first"}` });

    let deletion;
    try { deletion = await deletionStarted(svc, organizationId); }
    catch (error) {
      // A lost post-provider check must not return an independently payable URL.
      await stripe.checkout.sessions.expire(session.id);
      throw error;
    }
    if (deletion) {
      await stripe.checkout.sessions.expire(session.id);
      return deletionResponse();
    }

    // The key deliberately excludes the target plan: racing plan choices must
    // conflict at Stripe, not create two independently payable subscriptions.
    // Only the redirect URL crosses back to the browser.
    return NextResponse.json({ url: session.url });
  } catch (err) {
    if (err?.type === "StripeIdempotencyError" || err?.code === "idempotency_key_in_use") return NextResponse.json({ error: "Another checkout request is processing. Refresh and retry." }, { status: 409 });
    if (err?.type === "StripeCardError" || err?.statusCode === 402) {
      return NextResponse.json({ error: "Payment requires attention. Update your payment method in the billing portal and retry." }, { status: 402 });
    }
    console.error("[billing/checkout] Error:", err);
    return NextResponse.json({ error: "Failed to start checkout" }, { status: 500 });
  }
}
