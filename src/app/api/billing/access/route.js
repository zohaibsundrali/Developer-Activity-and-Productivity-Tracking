import { NextResponse } from "next/server";
import { authCan } from "@/utils/serverPermissions";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { accessState, lockMessage } from "@/utils/billingAccess";

export const dynamic = "force-dynamic";

/**
 * GET /api/billing/access — "is this workspace open, and for how much longer?"
 *
 * Deliberately the cheapest call in the billing area: one row, no usage counts,
 * no plan catalogue, no invoices. It runs on every admin page load to drive the
 * trial banner and the lock redirect, so /api/billing/subscription — which
 * fans out across half a dozen tables to build the billing screen — would be
 * the wrong thing to poll.
 *
 * READABLE BY EVERY SIGNED-IN MEMBER, not just owner/admin.
 *  /api/billing/subscription is restricted to the two roles that can be held
 *  responsible for a bill, and that is right for prices, invoices and card
 *  details. This endpoint returns none of those. It answers whether the
 *  workspace is open — which a developer who has just been bounced to a "your
 *  trial ended" screen is entitled to be told, rather than being shown a 403
 *  and left guessing. The org id still comes from the verified JWT.
 *
 * THIS ENDPOINT IS NOT THE ENFORCEMENT.
 *  It exists so the UI can redirect politely. The real refusal lives in
 *  src/utils/entitlements.js, where checkResourceLimit / checkSeatLimitForRole
 *  / checkFeatureAccess consult the same lock — so deleting this route would
 *  cost a nice error screen and change nothing about what a locked
 *  organization is able to do.
 */
export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const svc = serviceClient();

    const { data: subscription } = await svc
      .from("organization_subscriptions")
      .select(
        "plan_code, status, trial_start, trial_end, grace_period_ends_at, current_period_end, last_payment_status"
      )
      .eq("organization_id", auth.orgId)
      .maybeSingle();

    const state = accessState(subscription);

    // The plan's display name, for the banner. Missing catalogue row is not an
    // error — the code is a perfectly usable fallback label.
    let planName = state.planCode;
    if (subscription?.plan_code) {
      const { data: plan } = await svc
        .from("billing_plans")
        .select("name")
        .eq("code", subscription.plan_code)
        .maybeSingle();
      if (plan?.name) planName = plan.name;
    }

    return NextResponse.json({
      planCode: state.planCode,
      planName,
      status: state.status,
      locked: state.locked,
      reason: state.reason,
      onTrial: state.onTrial,
      daysRemaining: state.daysRemaining,
      trialEndsAt: state.trialEnd,
      message: state.locked ? lockMessage(state) : null,
      // Whether THIS caller can do anything about it. A developer cannot enter
      // a card, so sending them to the payment screen would be a dead end —
      // the gate shows them "ask your admin" instead. Decided here because the
      // server already knows the role and the browser should not be the one
      // deciding who may pay.
      //
      // A BUG, NOT A TIDY-UP. This said ["owner","admin","finance"] — the
      // BILLING set — while /api/billing/checkout and /api/billing/cancel both
      // require `billing.purchase`, which is OWNER ONLY and deliberately so:
      // the catalogue argues at length that starting or cancelling a
      // subscription spends money and does not belong to admin.
      //
      // So an admin or a finance lead on a locked organization was told they
      // could pay, sent to /admin/upgrade, and refused by checkout when they
      // got there. That is exactly the dead end the comment above says this
      // field exists to prevent, and the field itself was causing it.
      //
      // Asking the same key checkout asks is the fix. It NARROWS what the UI
      // offers — admin and finance now see "ask your owner" instead of a button
      // that fails — and it makes the promise match what happens.
      canPay: authCan(auth, "billing.purchase"),
      // Where the UI should send a locked user who can pay. One place, so the
      // screen and the route cannot disagree about the destination.
      payUrl: "/admin/upgrade",
    });
  } catch (e) {
    // FAILS OPEN. If this route cannot answer, the correct behaviour is to let
    // people work: a database hiccup must never present itself as "your trial
    // ended". The enforcement in entitlements.js is unaffected either way.
    console.error("[billing/access]", e?.message || e);
    return NextResponse.json({
      planCode: "free",
      planName: "Free",
      status: "active",
      locked: false,
      reason: null,
      onTrial: false,
      daysRemaining: null,
      trialEndsAt: null,
      message: null,
      canPay: false,
      payUrl: "/admin/upgrade",
      degraded: true,
    });
  }
}
