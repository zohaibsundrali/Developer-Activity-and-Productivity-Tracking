import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { meta as termsMeta } from "@/content/legal/terms";
import { FREE_PLAN_CODE, trialEndFor } from "@/utils/billingAccess";
import { normalizeEmail, VERIFIED_WINDOW_MINUTES } from "@/utils/verificationCodes";

// Server-side admin signup — creates the admin_users row, the organization, the
// owner membership, and the Supabase Auth account, all with the service_role
// key (bypasses RLS so signup works even after RLS is enabled).

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Which version of the Terms this signup binds the new organization to.
//
// src/content/legal/terms.js carries no `version` field, so `lastUpdated` is
// the only identifier the document actually has — and it is the same value the
// rendered page shows the reader, which is what makes it usable as evidence.
// The `meta.version` fallback is first so that if a real version is added to
// that module later this picks it up without a change here.
//
// It is read on the SERVER, never taken from the request. A client that could
// name the version it accepted could claim to have accepted any of them.
const TERMS_DOCUMENT = "terms_of_service";
const TERMS_VERSION = termsMeta.version || termsMeta.lastUpdated;

// The address the acceptance arrived from, read off the request we already
// have — same two headers src/app/api/send-verification/route.js uses. No new
// request plumbing, and nothing else about the request is captured.
//
// The column is `inet`, so a malformed value would abort the insert. Anything
// that is not a syntactically valid address is therefore stored as NULL rather
// than as junk: a missing IP weakens the record slightly, a failed insert would
// lose it entirely.
function acceptanceIp(request) {
  const raw =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "";
  const value = raw.trim();
  if (!value) return null;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (v4) return v4.slice(1).every((octet) => Number(octet) <= 255) ? value : null;
  const compressions = (value.match(/::/g) || []).length;
  if (compressions <= 1 && /^[0-9a-fA-F]{0,4}(:[0-9a-fA-F]{0,4}){2,7}$/.test(value)) return value;
  return null;
}

/**
 * Resolve the plan this signup is actually allowed to start on.
 *
 * THE CODE FROM THE BROWSER IS A REQUEST, NOT A DECISION. It is looked up in
 * `billing_plans` and must be active; anything unknown, inactive or absent
 * falls back to free. Trusting it would let a caller POST
 * `{"planCode":"enterprise"}` and hand themselves the unlimited plan.
 *
 * `trial_days` is read from the row rather than from a constant, so changing
 * the trial length is one UPDATE and not a deploy. Free never gets a trial —
 * it is a plan you can stay on, and a free tier that expires is not free.
 *
 * Returns the row shape to insert, so the caller does no billing arithmetic.
 */
async function resolvePlanForSignup(admin, requestedCode, hasPaymentMethod) {
  const requested = String(requestedCode || "").trim().toLowerCase();

  let plan = null;
  if (requested && requested !== FREE_PLAN_CODE) {
    const { data } = await admin
      .from("billing_plans")
      .select("code, name, trial_days, is_active")
      .eq("code", requested)
      .eq("is_active", true)
      .maybeSingle();
    plan = data || null;
  }

  // A PAID PLAN WITH NO TRIAL IS NOT SELF-SERVE, AND MUST NOT BE GRANTED HERE.
  //
  // `trial_days = 0` is how database/053 marks Enterprise: sold, not signed up
  // for. Without this check the plan was reachable anyway — `trialEndFor`
  // treats 0 as a nonsensical value and falls back to the 7-day default, so
  // POSTing {"planCode":"enterprise"} (or simply clicking the Enterprise card,
  // which /api/billing/plans happily returns) minted a 7-day trial of the
  // unlimited plan with every feature on and no payment of any kind.
  //
  // Falling back to free is the conservative direction: the person gets a
  // working workspace and has to talk to somebody to get Enterprise.
  if (plan && !(Number(plan.trial_days) > 0)) {
    console.warn("[signup] plan %s has no self-serve trial; starting on free", plan.code);
    plan = null;
  }

  if (!plan) {
    return { plan_code: FREE_PLAN_CODE, status: "active" };
  }

  const now = new Date();
  return {
    plan_code: plan.code,
    status: "trialing",
    trial_start: now.toISOString(),
    trial_end: trialEndFor(plan.trial_days, now).toISOString(),
    // A marker, not a credential. See the note in the route below: no card
    // number, expiry or CVC reaches this server, so there is nothing else to
    // record and nothing here worth stealing.
    last_payment_status: hasPaymentMethod ? "demo_card_on_file" : null,
  };
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { fullName, company, industry, companySize, country, email, password, timezone, termsAccepted } = body;

    // BILLING INPUT — the only two billing values this route reads.
    //
    // `planCode` is validated against the catalogue by resolvePlanForSignup.
    //
    // `paymentMethodProvided` is a BOOLEAN, deliberately. The registration
    // screen shows a card form and validates it in the browser, but the card
    // number, expiry and CVC never leave the tab: they are not sent here, not
    // logged, and not stored. That is what keeps this server out of PCI scope
    // while the flow is still a demo — the only thing recorded is THAT a card
    // step was completed, which is all the demo needs to mean.
    //
    // When real payments are switched on, this is replaced by a Stripe
    // Checkout session or a PaymentMethod id minted by Stripe Elements in the
    // browser. Neither of those is a card number either.
    const planCode = typeof body.planCode === "string" ? body.planCode : "";
    const paymentMethodProvided = body.paymentMethodProvided === true;
    if (!email || !password) {
      return NextResponse.json({ error: "email and password are required" }, { status: 400 });
    }

    // THE GATE. An unticked checkbox disables a button; it does not stop anyone
    // POSTing here directly, and a Terms nobody is recorded as accepting is
    // browsewrap — the weakest form of assent there is. This refusal is what
    // makes the acceptance real, and it deliberately runs BEFORE anything is
    // created, so a request without consent leaves no admin_users row, no
    // organization, no membership and no auth account behind.
    //
    // `!== true` rather than a truthiness test on purpose: "yes", 1 and {} are
    // all truthy, and none of them is a person ticking a box.
    if (termsAccepted !== true) {
      return NextResponse.json(
        { error: "You must accept the Terms of Service to create an account." },
        { status: 400 }
      );
    }

    // THE SECOND GATE: the address must actually have been verified.
    //
    // Same shape of problem as the Terms checkbox above. The registration
    // screen shows a verification-code step, but until now the code was
    // generated by the browser, kept in React state and compared by the
    // browser — so this route created organizations for addresses nobody had
    // ever proven they could read. POSTing here directly skipped the step
    // entirely.
    //
    // Consumed here, not at verify time, and in the same breath as the check:
    // `.is("consumed_at", null)` inside the update is what makes two
    // simultaneous signups on one verified code resolve to one winner. The
    // loser sees no row updated and is refused. Doing the read and the write as
    // separate steps would leave exactly that race open.
    const verifiedSince = new Date(
      Date.now() - VERIFIED_WINDOW_MINUTES * 60_000
    ).toISOString();

    const { data: consumed, error: consumeErr } = await admin
      .from("email_verifications")
      .update({ consumed_at: new Date().toISOString() })
      .eq("email", normalizeEmail(email))
      .is("consumed_at", null)
      .not("verified_at", "is", null)
      .gte("verified_at", verifiedSince)
      .select("id");

    if (consumeErr) {
      console.error("[signup] verification lookup failed:", consumeErr.message);
      return NextResponse.json(
        { error: "Could not confirm your email verification. Please try again." },
        { status: 503 }
      );
    }

    if (!consumed || consumed.length === 0) {
      return NextResponse.json(
        {
          error:
            "Please verify your email address before creating your organization.",
          code: "email_not_verified",
        },
        { status: 403 }
      );
    }

    // 1) admin_users row
    //
    // NO `password` COLUMN. It used to be written here "for the legacy login
    // fallback" in src/app/login/page.js — that fallback is gone (it could only
    // run for an anon caller, and no policy on admin_users grants anon a read,
    // so it never authenticated anybody). The only remaining reader of the
    // column is GET /api/admin/legacy-auth-audit, which counts rows rather than
    // using the value. The credential is created in step 4 below, by Supabase
    // Auth, which stores it hashed.
    const { data: adminRows, error: adminErr } = await admin
      .from("admin_users")
      .insert([{
        full_name: fullName || null,
        company: company || null,
        email,
        is_verified: true,
        role: "admin",
        created_at: new Date().toISOString(),
      }])
      .select()
      .single();

    if (adminErr) {
      if (adminErr.code === "23505") return NextResponse.json({ error: "This email is already registered." }, { status: 409 });
      return NextResponse.json({ error: adminErr.message }, { status: 400 });
    }
    const newAdmin = adminRows;

    // 2) organization
    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .insert([{
        name: (company || "").trim() || `${fullName || "My"}'s Organization`,
        owner_id: newAdmin.id,
        industry: industry || null,
        company_size: companySize || null,
        country: (country || "").trim() || null,
        timezone: timezone || "UTC",
      }])
      .select("id, name")
      .single();

    const orgId = org?.id || null;

    // If the organization could not be created, roll back the admin row so we
    // don't leave an orphaned admin with no org, and surface the real error.
    if (orgErr || !orgId) {
      await admin.from("admin_users").delete().eq("id", newAdmin.id);
      return NextResponse.json(
        { error: orgErr?.message || "Failed to create organization." },
        { status: 500 }
      );
    }

    // 3) link admin + owner membership
    await admin.from("admin_users").update({ organization_id: orgId }).eq("id", newAdmin.id);
    await admin.from("memberships").insert([{
      organization_id: orgId, user_id: newAdmin.id, user_type: "admin",
      email: newAdmin.email, role: "owner", status: "active",
    }]);

    // 3a) the subscription.
    //
    // EVERY organization gets a row, including free ones. `resolveEntitlement`
    // treats a missing row as "free, always usable", so an org without one is
    // not broken — but it is also invisible to the trial reminder job and to
    // the billing screen, and it means the shape of the data depends on when
    // the account was made. One row per organization, always.
    //
    // A failure here does NOT fail the signup: falling back to no row lands
    // exactly on that already-safe default, and refusing to create an account
    // because a billing row could not be written would be a worse trade. It is
    // logged so the gap is findable.
    const subscriptionRow = await resolvePlanForSignup(admin, planCode, paymentMethodProvided);
    const { error: subErr } = await admin
      .from("organization_subscriptions")
      .insert([{ organization_id: orgId, ...subscriptionRow }]);
    if (subErr) {
      console.error("[signup] subscription not created", orgId, subErr.message);
    }
    // What the response is allowed to claim. If the insert failed there is no
    // subscription, so reporting the trial we MEANT to create would tell
    // someone "you're on a Professional trial until 17 August" and then hand
    // them free limits — they would hit "your free plan allows 3 employees" on
    // day one with no idea why.
    const subscriptionCreated = !subErr;

    // 3b) record the acceptance — see database/039_terms_acceptance.sql.
    //
    // The version, not a boolean: "terms_accepted: true" cannot answer "who
    // agreed to the version that contained clause 3.5", which is the only
    // question that matters once the document is revised. Written with the
    // service role, which is the only writer RLS permits.
    //
    // A failure here is logged and does not fail the signup. By this point the
    // admin, the organization, the membership and (next) the auth account all
    // exist; returning an error would hand the user a "registration failed"
    // message for an account that does in fact exist, and their retry would
    // collide on the unique email. The load-bearing half of this feature is the
    // refusal above, which happens before anything is created.
    const { error: termsErr } = await admin.from("terms_acceptances").insert([{
      organization_id: orgId,
      user_id: newAdmin.id,
      user_type: "admin",
      email: newAdmin.email,
      document: TERMS_DOCUMENT,
      document_version: TERMS_VERSION,
      entry_point: "signup",
      accepted_at: new Date().toISOString(),
      ip: acceptanceIp(request),
    }]);
    if (termsErr) {
      console.error("[signup] terms acceptance not recorded", newAdmin.id, termsErr.message);
    }

    // 4) Supabase Auth account (with org claim)
    let authUserId = null;
    const { data: au, error: auErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      app_metadata: { organization_id: orgId, role: "owner", user_type: "admin", app_user_id: newAdmin.id },
    });
    // A failure here used to be swallowed: the route returned success, the
    // screen said the account was created, and `auth_user_id` stayed null.
    //
    // The common cause is an email that already has a Supabase Auth account —
    // from an earlier signup, or one whose profile rows were removed without
    // the Auth user. What the person then gets is an organization with no
    // credential attached to it, while their old Auth account still signs them
    // in and still carries the OLD organization in its JWT claim. Every write
    // afterwards is rejected by RLS with "new row violates row-level security
    // policy", because auth_org() and the org the app is holding are two
    // different organizations. That is a genuinely baffling failure, and it is
    // reported as a permissions bug rather than the duplicate signup it is.
    //
    // So: fail loudly, and roll back everything this request created. Same
    // shape as the organization rollback above — a half-made account is worse
    // than no account, because nothing tells the user which half is missing.
    if (auErr || !au?.user?.id) {
      await admin.from("memberships").delete().eq("user_id", newAdmin.id);
      // Deleted explicitly, before the organization. `organization_subscriptions`
      // is ON DELETE CASCADE so the row would go anyway — but the rollback must
      // not depend on a constraint declared in another file to be correct.
      await admin.from("organization_subscriptions").delete().eq("organization_id", orgId);
      await admin.from("organizations").delete().eq("id", orgId);
      await admin.from("admin_users").delete().eq("id", newAdmin.id);

      const duplicate =
        auErr?.status === 422 ||
        /already (been )?registered|already exists|duplicate/i.test(auErr?.message || "");

      return NextResponse.json(
        {
          error: duplicate
            ? "An account with this email already exists. Sign in instead, or use a different email address."
            : auErr?.message || "Could not create the sign-in account.",
        },
        { status: duplicate ? 409 : 500 }
      );
    }

    authUserId = au.user.id;
    await admin.from("admin_users").update({ auth_user_id: authUserId }).eq("id", newAdmin.id);

    return NextResponse.json({
      success: true,
      admin: newAdmin,
      organizationId: orgId,
      organizationName: org?.name || null,
      // What the account actually started on — the resolved plan, not the one
      // that was asked for. The two differ whenever the browser sent something
      // unknown, and the screen must show what is true.
      plan: subscriptionCreated
        ? {
            code: subscriptionRow.plan_code,
            status: subscriptionRow.status,
            trialEndsAt: subscriptionRow.trial_end || null,
          }
        : // No row was written. `resolveEntitlement` treats a missing
          // subscription as free-and-usable, so that is what to report.
          { code: FREE_PLAN_CODE, status: "active", trialEndsAt: null },
    });
  } catch (e) {
    return NextResponse.json({ error: "Signup failed" }, { status: 500 });
  }
}
