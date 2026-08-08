import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
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
    if (auth.userType === "client" || auth.role !== "owner") {
      return NextResponse.json(
        { error: "Forbidden: only the organization owner can manage billing." },
        { status: 403 }
      );
    }

    if (!billingConfigured()) {
      return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
    }
    const stripe = stripeClient();

    const svc = serviceClient();
    const { data: subscription } = await svc
      .from("organization_subscriptions")
      .select("stripe_customer_id")
      .eq("organization_id", auth.orgId)
      .maybeSingle();

    // A customer only exists once checkout has been started at least once.
    if (!subscription?.stripe_customer_id) {
      return NextResponse.json(
        { error: "No billing account yet. Choose a plan first." },
        { status: 400 }
      );
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: `${appOrigin(request)}/admin/billing`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[billing/portal] Error:", err);
    return NextResponse.json({ error: "Failed to open billing portal" }, { status: 500 });
  }
}
