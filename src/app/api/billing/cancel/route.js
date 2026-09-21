import { billingAuthority } from '@/utils/accountBilling';
import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { requirePermission } from "@/utils/serverPermissions";
import { stripeClient, billingConfigured, toIso } from "@/utils/stripeServer";

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
    // Permission, not an inline role comparison. `billing.purchase` and NOT
    // `billing.manage`: that one includes finance, and committing the
    // organization to a recurring charge is the owner's decision alone.
    const denied = requirePermission(auth, "billing.purchase");
    if (denied) return denied;

    if (!billingConfigured()) {
      return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
    }
    const stripe = stripeClient();

    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
    if (!body || Array.isArray(body) || typeof body !== "object" || (body.resume !== undefined && typeof body.resume !== "boolean")) {
      return NextResponse.json({ error: "resume must be a boolean." }, { status: 400 });
    }
    const { resume } = body;
    const cancelAtPeriodEnd = resume !== true;

    const svc = serviceClient();
    const account = await billingAuthority(svc, auth, { purchase: true });
    if (account.denied) return NextResponse.json({ error: 'Only the billing account owner can manage this shared plan. Open the original organization for delegated billing access.' }, { status: 403 });
    const billingOrgId = account.scope.accountId;
    const { data: subscription, error: lookupError } = await svc
      .from("organization_subscriptions")
      .select("stripe_subscription_id, stripe_customer_id, status, updated_at")
      .eq("organization_id", billingOrgId)
      .maybeSingle();

    if (lookupError) return NextResponse.json({ error: "Subscription lookup unavailable. Please retry." }, { status: 503 });
    if (!subscription?.stripe_subscription_id) {
      return NextResponse.json(
        { error: "No active subscription to change." },
        { status: 400 }
      );
    }

    const deletion = await svc.rpc("organization_deletion_active", { p_org: billingOrgId });
    if (deletion.error || typeof deletion.data !== "boolean") return NextResponse.json({ error: "Organization state unavailable. Please retry." }, { status: 503 });
    if (deletion.data) return NextResponse.json({ error: "Organization deletion is in progress." }, { status: 409 });
    const current = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
    const customerId = typeof current.customer === "string" ? current.customer : current.customer?.id;
    if (!subscription.stripe_customer_id || customerId !== subscription.stripe_customer_id || current.metadata?.organization_id !== billingOrgId) {
      return NextResponse.json({ error: "Billing ownership needs review. Contact support." }, { status: 409 });
    }
    const updated = await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      cancel_at_period_end: cancelAtPeriodEnd,
    });

    const after = await svc.rpc("organization_deletion_active", { p_org: billingOrgId });
    if (after.error || typeof after.data !== "boolean") return NextResponse.json({ error: "Stripe accepted the change; organization state could not be verified. Refresh shortly." }, { status: 503 });
    if (after.data) return NextResponse.json({ error: "Organization deletion is in progress; cleanup will reconcile billing." }, { status: 409 });

    // Written through straight away so the page reflects the click without
    // waiting on a webhook; the webhook is still the source of truth and will
    // overwrite this with whatever Stripe actually recorded.
    const { data: saved, error: saveError } = await svc
      .from("organization_subscriptions")
      .update({
        cancel_at_period_end: Boolean(updated.cancel_at_period_end),
        canceled_at: toIso(updated.canceled_at),
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", billingOrgId)
      .eq("stripe_subscription_id", subscription.stripe_subscription_id)
      .eq("updated_at", subscription.updated_at)
      .select("organization_id");
    if (saveError || !saved?.length) return NextResponse.json({ error: "Stripe accepted the change; billing synchronization is pending. Refresh shortly." }, { status: 503 });

    return NextResponse.json({
      // Same success flag the rest of the billing API uses; the page reads it to
      // tell a saved change from a failed one.
      success: true,
      cancelAtPeriodEnd: Boolean(updated.cancel_at_period_end),
    });
  } catch (err) {
    console.error("[billing/cancel] Error:", err);
    return NextResponse.json({ error: "Failed to update subscription" }, { status: err.status === 503 ? 503 : 500 });
  }
}
