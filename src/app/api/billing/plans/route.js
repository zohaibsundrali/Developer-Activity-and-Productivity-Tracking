import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { billingConfigured } from "@/utils/stripeServer";

export const dynamic = "force-dynamic";

/**
 * GET /api/billing/plans — the purchasable catalogue, for people who are not
 * signed in yet.
 *
 * WHY A SECOND PLANS ENDPOINT
 *  /api/billing/subscription already returns the catalogue, but it requires a
 *  bearer token and an owner/admin role — correct for a billing screen, useless
 *  during registration, where by definition nobody has an account yet. Rather
 *  than weaken that route's guard, this one exposes only the half that is
 *  public anyway.
 *
 * WHAT IS AND IS NOT RETURNED
 *  Prices, names, descriptions, trial length, limits and feature flags: all of
 *  it is marketing copy that belongs on a pricing page.
 *
 *  `stripe_price_id` is NOT returned, deliberately, exactly as in
 *  /api/billing/subscription. Checkout resolves the price from the plan code on
 *  the server; shipping the id to a browser would only invite a caller to send
 *  a different one back.
 *
 *  Nothing here is org-scoped, so there is nothing to leak between tenants —
 *  this reads one global table that migration 027 already exposes to every
 *  authenticated user via RLS.
 *
 *  It runs with the SERVICE ROLE, and the reason is worth stating because the
 *  instinct is the opposite: the RLS policy 027 puts on `billing_plans` is
 *  `to authenticated`, and this route exists precisely to serve people who are
 *  not signed in. The alternative is adding an anon grant to the table, which
 *  widens the policy for every caller for ever, where this widens it for one
 *  fixed column list on one route that reads a single global catalogue. No
 *  org-scoped table is touched and no request input reaches the query.
 */

const PLAN_COLUMNS =
  "code, name, description, amount_cents, currency, billing_interval, trial_days, limits, features, sort_order";

export async function GET() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      return NextResponse.json({ plans: [], demo: !billingConfigured() });
    }

    const svc = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await svc
      .from("billing_plans")
      .select(PLAN_COLUMNS)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (error) {
      console.error("[billing/plans]", error.message);
      return NextResponse.json({ plans: [], demo: !billingConfigured() });
    }

    return NextResponse.json({
      plans: data || [],
      // True when no Stripe key is configured, which is what makes the card
      // step a demo. The registration screen says so on the card form rather
      // than letting someone believe they have just paid.
      demo: !billingConfigured(),
    });
  } catch (e) {
    console.error("[billing/plans]", e?.message || e);
    return NextResponse.json({ plans: [], demo: true });
  }
}
