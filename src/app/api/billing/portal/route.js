import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { requirePermission } from "@/utils/serverPermissions";
import { stripeClient, billingConfigured, appOrigin } from "@/utils/stripeServer";

export const dynamic = "force-dynamic";

// POST /api/billing/portal
// Opens the hosted Customer Portal so the owner can change card, download
// invoices, or cancel without any of that data passing through this app.
// Owner only: the portal can change what the organization pays.
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

    const svc = serviceClient();
    const { data: subscription, error: lookupError } = await svc
      .from("organization_subscriptions")
      .select("stripe_customer_id")
      .eq("organization_id", auth.orgId)
      .maybeSingle();

    if (lookupError) return NextResponse.json({ error: "Billing lookup unavailable. Please retry." }, { status: 503 });

    // A customer only exists once checkout has been started at least once.
    if (!subscription?.stripe_customer_id) {
      return NextResponse.json(
        { error: "No billing account yet. Choose a plan first." },
        { status: 400 }
      );
    }

    const deletion = await svc.rpc("organization_deletion_active", { p_org: auth.orgId });
    if (deletion.error || typeof deletion.data !== "boolean") return NextResponse.json({ error: "Organization state unavailable. Please retry." }, { status: 503 });
    if (deletion.data) return NextResponse.json({ error: "Organization deletion is in progress." }, { status: 409 });
    const customer = await stripe.customers.retrieve(subscription.stripe_customer_id);
    if (customer.deleted || customer.metadata?.organization_id !== auth.orgId) return NextResponse.json({ error: "Billing ownership needs review. Contact support." }, { status: 409 });
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      // The billing screen is a section of the admin dashboard, not a route of
      // its own; returning to /admin/billing would 404 on the way back.
      return_url: `${origin}/admin/dashboard?section=billing`,
    });

    const after = await svc.rpc("organization_deletion_active", { p_org: auth.orgId });
    if (after.error || typeof after.data !== "boolean") return NextResponse.json({ error: "Organization state unavailable. Please retry." }, { status: 503 });
    if (after.data) return NextResponse.json({ error: "Organization deletion is in progress." }, { status: 409 });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[billing/portal] Error:", err);
    return NextResponse.json({ error: "Failed to open billing portal" }, { status: 500 });
  }
}
