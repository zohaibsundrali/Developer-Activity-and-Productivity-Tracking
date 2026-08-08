import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { stripeClient, billingConfigured, appOrigin } from "@/utils/stripeServer";

export const dynamic = "force-dynamic";

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
    if (auth.userType === "client" || auth.role !== "owner") {
      return NextResponse.json(
        { error: "Forbidden: only the organization owner can start a subscription." },
        { status: 403 }
      );
    }

    if (!billingConfigured()) {
      return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
    }
    const stripe = stripeClient();

    const { planCode } = await request.json().catch(() => ({}));
    if (!planCode || typeof planCode !== "string") {
      return NextResponse.json({ error: "planCode is required" }, { status: 400 });
    }

    const svc = serviceClient();

    // The price is looked up from the catalogue by plan code. Accepting a price
    // id from the body would let a caller pay for the cheapest plan while
    // subscribing to the most expensive one.
    const { data: plan } = await svc
      .from("billing_plans")
      .select("code, name, stripe_price_id, trial_days, amount_cents, is_active")
      .eq("code", planCode)
      .maybeSingle();

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

    const { data: existing } = await svc
      .from("organization_subscriptions")
      .select("stripe_customer_id, stripe_subscription_id, plan_code, status")
      .eq("organization_id", organizationId)
      .maybeSingle();

    // Reusing the customer keeps one payment-method and invoice history per
    // organization; creating a second customer would silently split them.
    let customerId = existing?.stripe_customer_id || null;
    if (!customerId) {
      const { data: org } = await svc
        .from("organizations")
        .select("name")
        .eq("id", organizationId)
        .maybeSingle();

      const customer = await stripe.customers.create({
        email: auth.email || undefined,
        name: org?.name || undefined,
        // The webhook falls back to this when an event carries no metadata of
        // its own, so it must be set at creation time.
        metadata: { organization_id: organizationId },
      });
      customerId = customer.id;

      await svc
        .from("organization_subscriptions")
        .upsert(
          {
            organization_id: organizationId,
            stripe_customer_id: customerId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "organization_id" }
        );
    }

    const origin = appOrigin(request);
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
      } catch {
        // Missing at Stripe (deleted, or an id from another account): fall
        // through and sell them a subscription rather than failing the click.
        liveSubscription = null;
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
      if (!alreadyOnPlan) {
        await stripe.subscriptions.update(liveSubscription.id, {
          items: [{ id: currentItem.id, price: plan.stripe_price_id }],
          // The customer is charged (or credited) only for the difference, so
          // an upgrade mid-cycle is not a second full month and a downgrade
          // does not quietly forfeit what was already paid.
          proration_behavior: "create_prorations",
          metadata,
        });
      }

      // The webhook records the authoritative state; this write only keeps the
      // billing screen from showing the old plan until that event lands.
      await svc
        .from("organization_subscriptions")
        .upsert(
          {
            organization_id: organizationId,
            stripe_customer_id: customerId,
            stripe_subscription_id: liveSubscription.id,
            plan_code: plan.code,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "organization_id" }
        );

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
    });

    // Only the redirect URL crosses back to the browser.
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[billing/checkout] Error:", err);
    return NextResponse.json({ error: "Failed to start checkout" }, { status: 500 });
  }
}
