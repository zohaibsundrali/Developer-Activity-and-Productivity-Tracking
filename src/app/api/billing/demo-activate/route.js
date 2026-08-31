import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { requirePermission } from "@/utils/serverPermissions";
import { billingConfigured } from "@/utils/stripeServer";
import { recordEvent } from "@/utils/systemEvents";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/demo-activate — complete a payment without taking one.
 *
 * WHY THIS EXISTS
 *  The trial gate closes a workspace after 7 days. Something has to be able to
 *  re-open it, and until Stripe is connected there is nothing: the plans have
 *  no `stripe_price_id`, so /api/billing/checkout cannot mint a session. Ship
 *  the gate without this and the first organization whose trial ends is bricked
 *  with no route back in.
 *
 * IT TURNS ITSELF OFF
 *  The only condition under which this route does anything is
 *  `billingConfigured() === false` — no STRIPE_SECRET_KEY in the environment.
 *  The moment a real key is added, this returns 404 and Stripe Checkout is the
 *  only way to pay. That is deliberately not an env flag of its own: a flag
 *  someone has to remember to unset is a flag that stays set, and "the demo
 *  payment button still works in production" is not a thing to leave to memory.
 *
 * WHAT IT DOES NOT DO
 *  It takes no card details, because none reach this server — see the note in
 *  src/app/api/auth/signup/route.js. It creates no invoice and no Stripe
 *  customer. It records `last_payment_status = 'demo_paid'`, which is a string
 *  no real payment path ever writes, so a demo activation is always
 *  distinguishable from a real one in the data.
 *
 * WHO MAY CALL IT
 *  THE OWNER, and nobody else — `billing.purchase`, the same key that guards
 *  /checkout, /cancel and /portal.
 *
 *  It used to be `billing.manage`, which is owner + admin + FINANCE. That is
 *  the key for looking after an existing subscription, not for committing to
 *  one, and permissionCatalogue.js says so at the definition of
 *  `billing.purchase`: it was split out precisely so that starting a
 *  subscription "would not be handed to admin and finance under cover of a
 *  refactor". This route is the one place that happened — and since it grants
 *  a plan for free, it was the worst place for it. A finance user could put
 *  the organization on Enterprise.
 */


// One month, matching the `billing_interval` on every seeded plan. The demo
// grant is a period like any other rather than an unbounded one, so a demo
// deployment still exercises renewal instead of quietly becoming permanent.
//
// THAT SENTENCE WAS ASPIRATIONAL UNTIL NOW. `current_period_end` was written
// here and never compared anywhere — it appeared only in display payloads — so
// a demo activation did become permanent. isSubscriptionEntitled() now reads it
// back for rows marked `demo_paid`, which is why that marker matters beyond
// bookkeeping.
const DEMO_PERIOD_DAYS = 30;

export async function POST(request) {
  try {
    // Checked first, so an unauthenticated caller cannot even learn whether
    // demo billing is available on this deployment.
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Permission, not a role list. See utils/permissionCatalogue.js — the
    // hand-typed array this replaces was one of fifteen, and roles added to the
    // product reached some of them and not others.
    const denied = requirePermission(auth, "billing.purchase");
    if (denied) return denied;

    if (billingConfigured()) {
      // Stripe is live on this deployment. There is nothing to demo, and
      // pretending otherwise would be a way to get a paid plan for free.
      return NextResponse.json(
        { error: "Not found" },
        { status: 404 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const requested = String(body?.planCode || "").trim().toLowerCase();

    const svc = serviceClient();

    // The plan comes from the catalogue, never from the request. Without this
    // lookup, `{"planCode":"enterprise"}` is a free upgrade to unlimited.
    const { data: plan } = await svc
      .from("billing_plans")
      .select("code, name, amount_cents")
      .eq("code", requested)
      .eq("is_active", true)
      .maybeSingle();

    if (!plan) {
      return NextResponse.json({ error: "Unknown plan." }, { status: 400 });
    }

    const now = new Date();
    const periodEnd = new Date(now.getTime() + DEMO_PERIOD_DAYS * 24 * 60 * 60 * 1000);

    // Trial columns are cleared, not kept: leaving a past `trial_end` on an
    // active row is how a future refactor accidentally re-locks a paying
    // customer. `status = 'active'` with no trial is the unambiguous state.
    // UPSERT, not update. An `.update()` that matches no row is not an error in
    // PostgREST — it succeeds having changed nothing — so this route used to
    // answer `{ok:true}` and the screen said "You're all set" while the
    // database was untouched. That is reachable whenever the signup insert
    // failed (it is best-effort) or 053 PART 2 was never run for an org.
    //
    // `organization_id` carries a unique constraint (027), which is what makes
    // it a safe conflict target.
    const { data: updated, error } = await svc
      .from("organization_subscriptions")
      .upsert({
        organization_id: auth.orgId,
        plan_code: plan.code,
        status: "active",
        trial_start: null,
        trial_end: null,
        grace_period_ends_at: null,
        canceled_at: null,
        ended_at: null,
        cancel_at_period_end: false,
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
        last_payment_status: "demo_paid",
        last_payment_at: now.toISOString(),
        updated_at: now.toISOString(),
      }, { onConflict: "organization_id" })
      .select("organization_id");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Belt and braces: never report success for a write that touched nothing.
    if (!updated || updated.length === 0) {
      console.error("[billing/demo-activate] upsert affected no rows", auth.orgId);
      return NextResponse.json(
        { error: "Could not activate the plan. Please try again." },
        { status: 500 }
      );
    }

    // A durable record. "Who gave this organization a paid plan without paying"
    // is a question worth being able to answer later, and the answer must not
    // depend on someone having tailed the logs that day.
    await recordEvent({
      orgId: auth.orgId,
      type: "billing.demo_activated",
      severity: "warning",
      source: "billing",
      message: `Demo activation: ${plan.name} without a real payment.`,
      context: { planCode: plan.code, amountCents: plan.amount_cents, byRole: auth.role },
    });

    return NextResponse.json({
      ok: true,
      demo: true,
      planCode: plan.code,
      planName: plan.name,
      currentPeriodEnd: periodEnd.toISOString(),
    });
  } catch (e) {
    console.error("[billing/demo-activate]", e?.message || e);
    return NextResponse.json({ error: "Could not activate the plan." }, { status: 500 });
  }
}
