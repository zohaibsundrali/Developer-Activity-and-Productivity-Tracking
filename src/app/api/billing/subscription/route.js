import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { resolveEntitlement, getUsage } from "@/utils/entitlements";
import { billingConfigured, stripeMode } from "@/utils/stripeServer";

export const dynamic = "force-dynamic";

// Billing is an account-level concern: only the two roles that can be held
// responsible for a bill may see one, and a client never can.
// Finance too: reading the subscription is the job, and it carries none of
// the monitoring access that making an accountant an admin used to.
const BILLING_ROLES = ["owner", "admin", "finance"];

// Columns of the plan catalogue that are safe to hand to a browser. The Stripe
// price id is withheld deliberately — Checkout resolves it server-side from the
// plan code, so shipping it would only invite a caller to send one back.
const PLAN_COLUMNS =
  "code, name, description, amount_cents, currency, billing_interval, trial_days, limits, features, sort_order, stripe_price_id";

// GET /api/billing/subscription
// The whole billing page in one call: current subscription, the plan actually
// in force, the purchasable catalogue, live usage against that plan's limits,
// and recent invoices.
export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (auth.userType === "client" || auth.role === "client" || !BILLING_ROLES.includes(auth.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Service role: RLS grants owner/admin read on these tables, but the usage
    // counts span tables a plain admin token cannot fully count. The org id
    // still comes from the verified JWT, never from the request.
    const svc = serviceClient();

    const entitlement = await resolveEntitlement(svc, auth.orgId);
    const usage = await getUsage(svc, auth.orgId, entitlement.limits);

    const { data: planRows } = await svc
      .from("billing_plans")
      .select(PLAN_COLUMNS)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    // A plan without a price id in Stripe cannot be checked out yet; the UI
    // needs to know that without being told what the id is.
    const plans = (planRows || []).map(({ stripe_price_id, ...plan }) => ({
      ...plan,
      checkoutReady: Boolean(stripe_price_id),
    }));

    const { data: invoices } = await svc
      .from("billing_invoices")
      .select(
        "stripe_invoice_id, status, amount_due_cents, amount_paid_cents, currency, hosted_invoice_url, invoice_pdf_url, period_start, period_end, issued_at, created_at"
      )
      .eq("organization_id", auth.orgId)
      .order("issued_at", { ascending: false, nullsFirst: false })
      .limit(20);

    const sub = entitlement.subscription;

    // The plan in force comes back from resolveEntitlement as a whole catalogue
    // row, Stripe identifiers included. Those are as unsafe to publish here as
    // they are in the `plans` list above, so they are dropped at the boundary
    // rather than upstream, where other callers rely on the full row.
    const { stripe_price_id: _priceId, stripe_product_id: _productId, ...planPublic } =
      entitlement.plan || {};

    return NextResponse.json({
      // The page treats a response without this flag as a failure, so every
      // successful payload has to carry it.
      success: true,
      // Stripe customer / subscription identifiers stay on the server. The page
      // only needs to know whether the links exist, to decide which buttons to
      // render.
      subscription: sub
        ? {
            plan_code: sub.plan_code,
            status: sub.status,
            current_period_start: sub.current_period_start,
            current_period_end: sub.current_period_end,
            trial_start: sub.trial_start,
            trial_end: sub.trial_end,
            cancel_at_period_end: sub.cancel_at_period_end,
            canceled_at: sub.canceled_at,
            ended_at: sub.ended_at,
            grace_period_ends_at: sub.grace_period_ends_at,
            last_payment_status: sub.last_payment_status,
            last_payment_at: sub.last_payment_at,
            hasStripeCustomer: Boolean(sub.stripe_customer_id),
            hasStripeSubscription: Boolean(sub.stripe_subscription_id),
            // The card on file. Brand, last four and expiry only — the number
            // and the CVV are never stored (migration 066), so there is
            // nothing here that would be dangerous to send. The Stripe
            // payment_method id is deliberately NOT published: like the
            // customer and subscription ids above, it stays on the server.
            card: sub.card_last4
              ? {
                  brand: sub.card_brand || null,
                  last4: sub.card_last4,
                  expMonth: sub.card_exp_month || null,
                  expYear: sub.card_exp_year || null,
                  funding: sub.card_funding || null,
                  updatedAt: sub.card_updated_at || null,
                }
              : null,
          }
        : null,
      // The plan in force right now, which is the free plan whenever the
      // subscription has lapsed — not whatever plan_code still says.
      plan: entitlement.plan ? planPublic : null,
      planCode: entitlement.planCode,
      entitled: entitlement.entitled,
      limits: entitlement.limits,
      features: entitlement.features,
      trialDaysRemaining: entitlement.trialDaysRemaining,
      usage,
      plans,
      invoices: invoices || [],
      billingConfigured: billingConfigured(),
      stripeMode: stripeMode(),
    });
  } catch (err) {
    console.error("[billing/subscription] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
