import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { stripeClient, billingConfigured } from "@/utils/stripeServer";

export const dynamic = "force-dynamic";

// POST /api/billing/cancel
// Body: { resume?: boolean }
// Cancellation is scheduled for the end of the paid period rather than applied
// immediately — the organization already paid for the rest of the month, and
// deleting the subscription outright would take that away. Sending
// { resume: true } undoes a pending cancellation.
// Owner only, for the same reason checkout is.
export async function POST(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (auth.userType === "client" || auth.role !== "owner") {
      return NextResponse.json(
        { error: "Forbidden: only the organization owner can cancel a subscription." },
        { status: 403 }
      );
    }

    if (!billingConfigured()) {
      return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
    }
    const stripe = stripeClient();

    const { resume } = await request.json().catch(() => ({}));
    const cancelAtPeriodEnd = resume !== true;

    const svc = serviceClient();
    const { data: subscription } = await svc
      .from("organization_subscriptions")
      .select("stripe_subscription_id, status")
      .eq("organization_id", auth.orgId)
      .maybeSingle();

    if (!subscription?.stripe_subscription_id) {
      return NextResponse.json(
        { error: "No active subscription to change." },
        { status: 400 }
      );
    }

    const updated = await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      cancel_at_period_end: cancelAtPeriodEnd,
    });

    // Written through straight away so the page reflects the click without
    // waiting on a webhook; the webhook is still the source of truth and will
    // overwrite this with whatever Stripe actually recorded.
    await svc
      .from("organization_subscriptions")
      .update({
        cancel_at_period_end: cancelAtPeriodEnd,
        canceled_at: cancelAtPeriodEnd ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", auth.orgId);

    return NextResponse.json({
      // Same success flag the rest of the billing API uses; the page reads it to
      // tell a saved change from a failed one.
      success: true,
      cancelAtPeriodEnd: Boolean(updated.cancel_at_period_end),
    });
  } catch (err) {
    console.error("[billing/cancel] Error:", err);
    return NextResponse.json({ error: "Failed to update subscription" }, { status: 500 });
  }
}
