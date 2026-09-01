"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ArrowLeft, Lock, RefreshCw } from "lucide-react";

import { authFetch } from "@/utils/authFetch";
import { showError, showSuccess } from "@/utils/alerts";
import AuthShell, { BrandLockup, enterDelay } from "@/components/auth/AuthShell";
import {
  AuthCard,
  AuthError,
  AuthHeading,
  AuthNotice,
  SubmitButton,
} from "@/components/auth/AuthParts";
import { Button } from "@/components/ui";
import {
  DemoCardFields,
  PlanChoice,
  emptyCard,
  formatPrice,
  validateCard,
} from "@/components/billing/PlanChoice";

/**
 * /admin/upgrade — the way back in after a trial ends.
 *
 * WHY IT IS ITS OWN PAGE AND NOT PART OF THE BILLING SCREEN
 *  The billing screen lives inside the admin shell, and the admin shell is
 *  exactly what a locked organization cannot see. This is the one admin route
 *  BillingGate exempts, so it has to stand on its own — hence the auth shell,
 *  which is the same chrome the sign-in and registration screens use.
 *
 * IT IS REACHABLE WHEN NOT LOCKED, ON PURPOSE
 *  Someone six days into a trial who wants to settle up early follows the same
 *  link from the countdown pill. The page reads the current state and changes
 *  its own wording rather than refusing them.
 *
 * NO CARD DATA LEAVES THE BROWSER. Identical to registration — the fields are
 * validated here and a single boolean's worth of meaning is what reaches the
 * server. See the note at the top of src/components/billing/PlanChoice.jsx.
 */
export default function UpgradePage() {
  const router = useRouter();

  const [access, setAccess] = useState(null);
  const [plans, setPlans] = useState([]);
  const [demo, setDemo] = useState(true);
  const [loading, setLoading] = useState(true);

  const [selectedPlan, setSelectedPlan] = useState("");
  const [card, setCard] = useState(emptyCard);
  const [cardErrors, setCardErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Separate from `error` on purpose. `error` also carries submit failures, and
  // only a failed LOAD gets a Retry button — retrying a declined card by
  // re-fetching the plan list would be nonsense.
  const [loadFailed, setLoadFailed] = useState(false);

  /**
   * Load the plan list and the org's current billing state.
   *
   * THE DEAD END THIS FIXES. This function used to read `planRes` without ever
   * checking `planRes.ok`, and swallowed a bad body with `.catch(() => ({}))`.
   * So a 500 from /api/billing/plans produced `plans = []` and NO error at all
   * — the catch below could not fire, because nothing had thrown. `chosen` is
   * derived from `plans`, so it stayed null forever, and the page's only submit
   * button is `disabled={saving || loading || !chosen}`. A billing-locked admin
   * — who is REDIRECTED here by BillingGate and cannot see any other admin
   * screen — landed on a page with an empty plan list, no explanation and a
   * permanently greyed-out button. There was no way out of the product.
   *
   * Every failure now ends in the same place: a message saying what went wrong
   * and a Retry button that calls this again.
   */
  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    setError("");
    try {
      const [planRes, accessRes] = await Promise.all([
        fetch("/api/billing/plans"),
        authFetch("/api/billing/access"),
      ]);

      // A non-2xx is a failure even though fetch resolved. fetch only rejects
      // on a network error, which is exactly why the old `try` never caught
      // anything: an HTTP 500 is a perfectly successful promise.
      if (!planRes.ok) {
        throw new Error(`We couldn't load the plans (server said ${planRes.status}).`);
      }

      const planData = await planRes.json().catch(() => null);
      if (!planData || !Array.isArray(planData.plans)) {
        throw new Error("We couldn't read the plan list. Please try again.");
      }
      // An EMPTY list is a failure too, not an empty state: this page's whole
      // job is to let someone pick a plan, and nothing here can recover from
      // there being none. Rendering a bare page would be the same dead end with
      // better manners.
      if (planData.plans.length === 0) {
        throw new Error("No plans are available right now. Please try again, or contact support.");
      }

      const list = planData.plans;
      setPlans(list);
      setDemo(planData.demo !== false);

      if (accessRes.ok) {
        const accessData = await accessRes.json().catch(() => null);
        setAccess(accessData);
        // Pre-select what they were already on, so the common case — "carry on
        // with the plan I was trialling" — is one click.
        if (accessData?.planCode) setSelectedPlan(accessData.planCode);
      }

      // Fall back to the first paid plan, never to free: someone arriving here
      // is trying to pay, and pre-selecting Free would quietly downgrade them.
      setSelectedPlan((current) => {
        if (current && current !== "free") return current;
        const paid = list.find((p) => Number(p.amount_cents || 0) > 0);
        return paid?.code || current || "free";
      });
    } catch (err) {
      // Clear the list rather than leaving a half-loaded one behind: a retry
      // must not be able to submit against stale plans.
      setPlans([]);
      setLoadFailed(true);
      setError(err?.message || "We couldn't load the plans. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const chosen = plans.find((p) => p.code === selectedPlan) || null;
  const isPaid = Boolean(chosen) && Number(chosen.amount_cents || 0) > 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!chosen) {
      setError("Choose a plan to continue.");
      return;
    }

    // STRIPE IS LIVE: hand off to Checkout and never touch a card here.
    //
    // This branch used to be a comment claiming the handoff existed. It did
    // not: the page POSTed /api/billing/demo-activate unconditionally, and that
    // route answers 404 whenever Stripe is configured — so a real deployment
    // showed a card form, accepted a real number, and then dead-ended on
    // "Not found".
    if (isPaid && !demo) {
      setSaving(true);
      try {
        const res = await authFetch("/api/billing/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planCode: chosen.code }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.url) {
          throw new Error(data?.error || "We couldn't start checkout.");
        }
        // Stripe's own hosted page — the only place a real card may be typed.
        window.location.assign(data.url);
        return;
      } catch (err) {
        const message = err?.message || "We couldn't start checkout.";
        setError(message);
        showError("Could not start checkout", message);
        setSaving(false);
        return;
      }
    }

    if (isPaid) {
      const problems = validateCard(card, { demo });
      setCardErrors(problems);
      if (Object.keys(problems).length > 0) return;
    }

    setSaving(true);
    try {
      // Demo only — the branch above is what runs once Stripe is configured.
      const res = await authFetch("/api/billing/demo-activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planCode: chosen.code }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || "We couldn't activate that plan.");
      }

      await showSuccess(
        "You're all set",
        `${data.planName || chosen.name} is active. Taking you back to your dashboard.`
      );
      router.replace("/admin/dashboard");
    } catch (err) {
      const message = err?.message || "We couldn't activate that plan.";
      setError(message);
      showError("Could not activate the plan", message);
      setSaving(false);
    }
  };

  const locked = Boolean(access?.locked);

  return (
    <AuthShell panelTitle="Pick up where your team left off.">
      <div
        className="auth-enter mb-8 flex items-center justify-between gap-4"
        style={enterDelay(40)}
      >
        <BrandLockup className="lg:invisible" />
        {!locked && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => router.push("/admin/dashboard")}
            className="h-9 gap-1.5 px-2.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to dashboard
          </Button>
        )}
      </div>

      <AuthCard>
        {locked && (
          <div className="mb-6 flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3.5">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-warning-on-tint" aria-hidden="true" />
            <p className="text-sm leading-relaxed text-foreground">
              {access?.message || "Your trial has ended."}{" "}
              <span className="text-muted-foreground">
                Nothing has been deleted — your data is exactly where you left it.
              </span>
            </p>
          </div>
        )}

        <AuthHeading
          title={locked ? "Choose a plan to continue" : "Change your plan"}
          description={
            locked
              ? "Your workspace reopens as soon as a plan is active."
              : "Pick the plan you want. You can change it again whenever you like."
          }
        />

        {error && <AuthError message={error} className="mt-6" />}

        {/* The way out. Without this the only recovery from a failed plan load
            was for the user to know to reload the page — and a locked admin has
            nowhere else in the product to go. */}
        {loadFailed && (
          <Button
            type="button"
            variant="outline"
            onClick={load}
            disabled={loading}
            className="mt-4 w-full gap-2"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {loading ? "Retrying…" : "Try again"}
          </Button>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <PlanChoice
            plans={plans}
            value={selectedPlan}
            onChange={setSelectedPlan}
            loading={loading}
            disabled={saving}
          />

          {isPaid ? (
            <>
              <div className="flex items-baseline justify-between rounded-lg border border-border bg-muted/40 px-4 py-3">
                <span className="text-sm font-medium text-foreground">{chosen.name}</span>
                <span className="text-sm text-muted-foreground">
                  {formatPrice(chosen.amount_cents, chosen.currency)}/
                  {chosen.billing_interval || "month"}
                </span>
              </div>

              {/* Only in demo. With Stripe configured the card is typed on
                  Stripe's own hosted page, never here — see handleSubmit. */}
              {demo ? (
                <DemoCardFields
                  card={card}
                  onChange={setCard}
                  errors={cardErrors}
                  disabled={saving}
                  demo
                />
              ) : (
                <AuthNotice>
                  You&apos;ll enter your card on our payment provider&apos;s secure page.
                  We never see or store your card details.
                </AuthNotice>
              )}
            </>
          ) : (
            <AuthNotice>
              The Free plan has no time limit and needs no card. Your workspace reopens
              immediately, on the Free limits.
            </AuthNotice>
          )}

          <SubmitButton
            loading={saving}
            loadingLabel="Activating…"
            status={error ? "error" : "idle"}
            disabled={saving || loading || !chosen}
          >
            {isPaid ? `Activate ${chosen.name}` : "Continue on Free"}
          </SubmitButton>
        </form>

        <p
          className="auth-enter mt-7 border-t border-border pt-5 text-center text-sm text-muted-foreground"
          style={enterDelay(220)}
        >
          Need something else?{" "}
          <Link
            href="/login"
            className="font-medium text-primary underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Sign in as someone else
          </Link>
        </p>
      </AuthCard>
    </AuthShell>
  );
}
