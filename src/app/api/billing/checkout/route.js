import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { stripeClient, billingConfigured, appOrigin } from "@/utils/stripeServer";

export const dynamic = "force-dynamic";

// POST /api/billing/checkout
// Body: { planCode }
// Starts a hosted Checkout session for the caller's own organization and
// returns the redirect URL. Only an owner may commit the organization to a
// recurring charge — an admin can read the billing page but cannot buy.
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
      .select("stripe_customer_id")
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

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      success_url: `${origin}/admin/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/admin/billing?checkout=cancelled`,
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
