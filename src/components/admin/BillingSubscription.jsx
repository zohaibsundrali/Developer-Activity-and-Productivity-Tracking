"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CreditCard,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Info,
  Check,
  X,
  ExternalLink,
  Gauge,
  Receipt,
  FlaskConical,
  Loader2,
  Ban,
} from "lucide-react";
import StatCard from "@/components/shell/StatCard";
import { authFetch } from "@/utils/authFetch";
import { showConfirm, showError } from "@/utils/alerts";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Section,
  Skeleton,
  StatusPill,
} from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Admin → Billing & Subscription.
 *
 * Read-only mirror of what the billing API reports plus the three write actions
 * Stripe owns (checkout, portal, cancel/resume). Nothing here decides
 * entitlement — the server is the only authority on limits, so this screen
 * renders `usage` as reported rather than recomputing it.
 *
 * Every price, plan name, limit and date on this screen comes out of that
 * response. Where the response says nothing, the screen says nothing (or the
 * Free-plan fallback the API itself documents) — an invented number on a
 * billing screen is the one bug a customer will never forgive.
 */

// -1 is the seeded convention for "no ceiling" (see migration 027 limits jsonb).
const UNLIMITED = -1;

// The bar turns amber here — far enough ahead of the wall to do something
// about it. Same number drives the tick mark and the "Near limit" chip.
const NEAR_LIMIT_PCT = 80;

/**
 * Subscription status → StatusPill. The pill carries a distinct glyph shape and
 * always prints its label, so none of these states is told by colour alone.
 */
const STATUS_META = {
  active: { label: "Active", pill: "active" },
  trialing: { label: "Trial", pill: "pending" },
  past_due: { label: "Past due", pill: "error" },
  unpaid: { label: "Unpaid", pill: "error" },
  incomplete: { label: "Incomplete", pill: "warning" },
  incomplete_expired: { label: "Expired", pill: "inactive" },
  canceled: { label: "Canceled", pill: "inactive" },
  paused: { label: "Paused", pill: "inactive" },
};

function statusMeta(status) {
  return (
    STATUS_META[status] || {
      label: prettyLabel(status) || "Unknown",
      pill: "unknown",
    }
  );
}

// snake_case / lowercase → "Pretty Label"
const prettyLabel = (s) =>
  String(s || "")
    .split("_")
    .map((w) => (w[0]?.toUpperCase() || "") + w.slice(1))
    .join(" ");

const INTERVAL_SUFFIX = { month: "/mo", year: "/yr", week: "/wk", day: "/day" };

function formatMoney(amountCents, currency) {
  const amount = (Number(amountCents) || 0) / 100;
  const code = String(currency || "usd").toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      // Whole-dollar plan prices read better without the trailing ".00".
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(2)}`;
  }
}

// An invoice records what was billed and, separately, what has been collected.
// A still-open invoice has collected nothing, so reading the paid column for it
// would report every outstanding bill as zero.
function invoiceAmountCents(inv) {
  const paid = inv?.amount_paid_cents;
  const due = inv?.amount_due_cents;
  if (inv?.status === "paid" && paid !== null && paid !== undefined) return paid;
  return due ?? paid ?? 0;
}

function invoiceStatusPill(status) {
  if (status === "paid") return "success";
  if (status === "open") return "pending";
  if (status === "void" || status === "uncollectible") return "inactive";
  return "unknown";
}

function intervalSuffix(interval) {
  const key = String(interval || "month");
  return INTERVAL_SUFFIX[key] || `/${key}`;
}

function formatDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const FEATURE_LABELS = {
  reports: "Reports & analytics",
  automation: "Workflow automation",
  client_portal: "Client portal",
  api_access: "API access",
};

const LIMIT_LABELS = {
  employees: "Employees",
  developers: "Developers",
  projects: "Projects",
  active_tasks: "Active tasks",
  screenshots: "Screenshots",
  storage_mb: "Storage",
  tracking_history_days: "Tracking history",
};

/**
 * Catalogue keys that are seeded in `billing_plans` but that NOTHING in the
 * product actually enforces. Rendering them the same way as a live limit — a
 * number in a plan card, a green tick next to a feature — tells a paying
 * customer they are buying a boundary that does not exist, and tells a Free
 * customer they are missing something they in fact have.
 *
 * Verified against every call site of src/utils/entitlements.js and against
 * database/028_plan_limit_triggers.sql:
 *   storage_mb ............. no byte accounting exists anywhere
 *   screenshots ............ counted for display only; checkResourceLimit is
 *                            never called for it and /api/upload-screenshot has
 *                            no plan check
 *   tracking_history_days .. nothing prunes history; the daily worker in
 *                            /api/cron does reminders and recurring tasks only
 *   reports ................ the Reports section is gated by ROLE, not by plan
 *                            (src/components/shell/navConfig.js)
 *   api_access ............. there is no public API to grant or withhold
 *
 * `automation` and `client_portal` are NOT listed here — both are consulted by
 * checkFeatureAccess — but neither is a whole-feature gate either, so each
 * carries its own note below.
 *
 * Remove a key from here the day it gains real enforcement, not before.
 */
const UNENFORCED = {
  storage_mb: "Not enforced yet — nothing measures storage, so this number is a catalogue value.",
  screenshots: "Not enforced yet — screenshots are counted here but never blocked.",
  tracking_history_days: "Not enforced yet — no tracking history is pruned on any plan.",
  reports: "Reports are available on every plan today — access follows your role, not your plan.",
  api_access: "There is no public API yet, so this grants nothing.",
};

/**
 * Gated features whose gate is narrower than the label suggests. Shown with the
 * tick, because the gate is real — but with the scope spelled out, because the
 * label alone overstates it.
 */
const PARTIAL_FEATURES = {
  automation:
    "Rules run on every plan. What a paid plan adds is the email action — the rest (assign, status, priority, label, notify) is not gated.",
  client_portal:
    "Checked when a client is invited or accepts. Clients who already have a login keep it if the plan lapses.",
};

function formatLimit(key, value) {
  if (value === UNLIMITED || value === null || value === undefined) return "Unlimited";
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  if (key === "storage_mb") return n >= 1000 ? `${(n / 1000).toLocaleString()} GB` : `${n.toLocaleString()} MB`;
  if (key === "tracking_history_days") return `${n.toLocaleString()} days`;
  return n.toLocaleString();
}

export default function BillingSubscription() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Which write action is in flight — one at a time, so a single id is enough.
  const [busy, setBusy] = useState(null);
  // How the last billing round trip ended. Stripe Checkout comes back with
  // ?checkout=success|cancelled; an in-place plan change never leaves the app
  // and comes back with ?plan=changed instead.
  const [checkoutOutcome, setCheckoutOutcome] = useState(null);

  // The outcome is captured once and then cleared from the URL: it describes a
  // single round trip, and leaving it in place would re-announce a months-old
  // purchase every time the section is bookmarked or refreshed.
  useEffect(() => {
    const outcome =
      searchParams?.get("plan") === "changed" ? "changed" : searchParams?.get("checkout");
    if (!outcome) return;
    setCheckoutOutcome(outcome);
    router.replace("/admin/dashboard?section=billing", { scroll: false });
  }, [searchParams, router]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await authFetch("/api/billing/subscription");
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `Could not load billing (HTTP ${res.status}).`);
      }
      setData(json);
    } catch (e) {
      setError(e?.message || "Failed to load billing information.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const subscription = data?.subscription || null;
  const plan = data?.plan || null;
  const usage = data?.usage || null;
  const stripeMode = data?.stripeMode || "unconfigured";
  // Either signal is enough to know Stripe cannot complete a redirect flow.
  const unconfigured = stripeMode === "unconfigured" || data?.billingConfigured === false;
  const testMode = stripeMode === "test";

  const plans = useMemo(() => (Array.isArray(data?.plans) ? data.plans : []), [data]);
  const invoices = useMemo(() => (Array.isArray(data?.invoices) ? data.invoices : []), [data]);

  // The usage object is keyed by resource; the API already orders nothing, so
  // fix a stable display order and let unknown keys fall in behind it.
  const usageRows = useMemo(() => {
    if (!usage || typeof usage !== "object") return [];
    const preferred = ["employees", "developers", "projects", "active_tasks", "screenshots"];
    const keys = Object.keys(usage);
    const ordered = [
      ...preferred.filter((k) => keys.includes(k)),
      ...keys.filter((k) => !preferred.includes(k)),
    ];
    return ordered.map((key) => {
      const row = usage[key] || {};
      const used = Number(row.used) || 0;
      const limit = Number(row.limit);
      const unlimited = Boolean(row.unlimited) || limit === UNLIMITED;
      const pct = unlimited || !limit || limit <= 0 ? 0 : Math.min(100, Math.round((used / limit) * 100));
      return {
        key,
        label: row.label || LIMIT_LABELS[key] || prettyLabel(key),
        used,
        limit,
        unlimited,
        exceeded: Boolean(row.exceeded),
        remaining: row.remaining,
        pct,
        // Amber before the wall, red at it — a bar that only changes on failure
        // gives no warning that a limit is coming.
        near: !unlimited && pct >= NEAR_LIMIT_PCT,
      };
    });
  }, [usage]);

  // "Resources at limit" has to mean "creation is actually refused". A meter
  // nothing enforces — `screenshots` is counted but never blocked — would
  // otherwise raise "Action needed" for a wall that does not exist.
  const atLimitCount = useMemo(
    () => usageRows.filter((r) => r.exceeded && !UNENFORCED[r.key]).length,
    [usageRows]
  );
  const nearLimitCount = useMemo(
    () => usageRows.filter((r) => r.near && !r.exceeded && !UNENFORCED[r.key]).length,
    [usageRows]
  );

  const redirectTo = useCallback(async (path, body, actionId) => {
    try {
      setBusy(actionId);
      const res = await authFetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.url) {
        throw new Error(json?.error || "Could not start the billing session.");
      }
      // Stripe-hosted pages must be a full navigation, not a client route push.
      window.location.href = json.url;
    } catch (e) {
      showError("Billing unavailable", e?.message || "Could not reach Stripe.");
      setBusy(null);
    }
  }, []);

  const startCheckout = useCallback(
    (planCode) => redirectTo("/api/billing/checkout", { planCode }, `checkout:${planCode}`),
    [redirectTo]
  );

  const openPortal = useCallback(() => redirectTo("/api/billing/portal", {}, "portal"), [redirectTo]);

  const setCancellation = useCallback(
    async (resume) => {
      const confirmed = await showConfirm(
        resume ? "Resume subscription?" : "Cancel subscription?",
        resume
          ? "Billing will continue as normal and your plan will renew."
          : "Your plan stays active until the end of the current period, then reverts to Free.",
        { confirmButtonText: resume ? "Resume" : "Cancel subscription", cancelButtonText: "Keep as is" }
      );
      if (!confirmed) return;
      try {
        setBusy(resume ? "resume" : "cancel");
        const res = await authFetch("/api/billing/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(resume ? { resume: true } : {}),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          throw new Error(json?.error || "The change could not be saved.");
        }
        await load();
      } catch (e) {
        showError(resume ? "Resume failed" : "Cancellation failed", e?.message || "Please try again.");
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  // ── Loading state ──────────────────────────────────────────────────────────
  // Shaped like the screen: four counters, the plan anchor, the usage bars, the
  // plan grid and the invoice table. Never a spinner on a blank panel.
  if (loading) {
    return (
      <div className="space-y-6" role="status" aria-busy="true">
        <span className="sr-only">Loading billing…</span>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-80" />
          </div>
          <Skeleton className="h-8 w-24" />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>

        <div className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-card">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
          <Skeleton className="h-9 w-40" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>

        <div className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-card">
          <Skeleton className="h-4 w-40" />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <div className="flex items-center justify-between">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3.5 w-16" />
              </div>
              <Skeleton className="h-2 w-full rounded-full" />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-72 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (error) {
    return <ErrorState title="Couldn't load billing" description={error} onRetry={load} />;
  }

  const status = subscription?.status || "active";
  const meta = statusMeta(status);
  const cancelScheduled = Boolean(subscription?.cancel_at_period_end);
  const pastDue = status === "past_due" || status === "unpaid";
  const periodEnd = formatDate(subscription?.current_period_end);
  const graceEnd = formatDate(subscription?.grace_period_ends_at);
  const trialDays = data?.trialDaysRemaining;
  const currentPlanCode = plan?.code || subscription?.plan_code || null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            Billing &amp; Subscription
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your plan, usage against its limits, and payment settings.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {testMode && (
            <Badge variant="warning" size="md">
              <FlaskConical aria-hidden="true" />
              Stripe test mode
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw
              className={cn(loading && "animate-spin motion-reduce:animate-none")}
              aria-hidden="true"
            />
            Refresh
          </Button>
        </div>
      </div>

      {/* Return from Stripe Checkout. The subscription itself is written by the
          webhook, which can land after this page does, so success is worded as
          "on its way" rather than promising the plan below is already updated. */}
      {checkoutOutcome === "success" && (
        <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/5 p-4 text-sm text-foreground">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
          <p>
            <span className="font-semibold">Checkout complete.</span> Stripe is confirming the
            payment with us now — if the plan below still shows the old one, give it a moment and
            hit Refresh.
          </p>
        </div>
      )}
      {checkoutOutcome === "changed" && (
        <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/5 p-4 text-sm text-foreground">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
          <p>
            <span className="font-semibold">Plan updated.</span> Your existing subscription was moved
            to the new plan and only the difference is charged. The change is confirmed by Stripe in
            the background — hit Refresh if the plan below hasn&rsquo;t caught up.
          </p>
        </div>
      )}
      {checkoutOutcome === "cancelled" && (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-4 text-sm text-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p>
            <span className="font-semibold">Checkout cancelled.</span> Nothing was charged and your
            plan is unchanged.
          </p>
        </div>
      )}

      {/* Test-mode banner — a badge alone is too easy to miss before someone
          types a card number into a checkout that will never charge them. */}
      {testMode && (
        <div className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm text-foreground">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <p>
            <span className="font-semibold">Stripe is in test mode.</span> No real charges occur and no
            real card is accepted — use Stripe&rsquo;s test card numbers. Switch to live keys before
            billing real customers.
          </p>
        </div>
      )}

      {/* Stripe not configured — explain rather than offer buttons that fail. */}
      {unconfigured && (
        <div className="flex items-start gap-3 rounded-xl border border-info/30 bg-info/5 p-4 text-sm text-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
          <p>
            <span className="font-semibold">Billing isn&rsquo;t connected yet.</span> Stripe keys
            haven&rsquo;t been configured for this deployment, so checkout and the customer portal are
            unavailable. Your plan and usage below are still accurate — every organization runs on the
            Free plan until billing is switched on.
          </p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Current plan" value={plan?.name || "Free"} icon={CreditCard} tone="primary" />
        <StatCard
          title={plan?.billing_interval === "year" ? "Yearly cost" : "Monthly cost"}
          value={formatMoney(plan?.amount_cents, plan?.currency)}
          icon={Receipt}
          tone="info"
        />
        <StatCard
          title={cancelScheduled ? "Access ends" : "Next renewal"}
          value={periodEnd || "—"}
          icon={Clock}
          tone={cancelScheduled ? "warning" : "success"}
        />
        <StatCard
          title="Resources at limit"
          value={atLimitCount}
          icon={Gauge}
          tone={atLimitCount > 0 ? "destructive" : nearLimitCount > 0 ? "warning" : "success"}
          badge={
            atLimitCount > 0
              ? "Action needed"
              : nearLimitCount > 0
              ? `${nearLimitCount} near limit`
              : undefined
          }
          badgeTone={atLimitCount > 0 ? "destructive" : "muted"}
        />
      </div>

      {/* Current plan — the anchor of this screen. It gets the primary ring so
          the eye lands on "what am I on, and until when" before anything else. */}
      <section className="rounded-xl border border-primary/30 bg-card p-5 shadow-card ring-1 ring-primary/10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold tracking-tight text-foreground">
                {plan?.name || "Free"}
              </h3>
              <StatusPill status={meta.pill} label={meta.label} />
              {cancelScheduled && (
                <Badge variant="warning" size="md">
                  <Clock aria-hidden="true" />
                  Cancels at period end
                </Badge>
              )}
            </div>
            {plan?.description && <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>}
            <div className="mt-3 flex items-baseline gap-1">
              <span className="text-3xl font-semibold tracking-tight text-foreground tabular-nums">
                {formatMoney(plan?.amount_cents, plan?.currency)}
              </span>
              <span className="text-sm font-medium text-muted-foreground">
                {intervalSuffix(plan?.billing_interval)}
              </span>
            </div>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {cancelScheduled ? "Access ends" : "Renews on"}
                </dt>
                <dd className="mt-0.5 text-sm font-semibold text-foreground">{periodEnd || "—"}</dd>
              </div>
              {status === "trialing" && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Trial remaining
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold text-foreground">
                    {typeof trialDays === "number"
                      ? `${trialDays} ${trialDays === 1 ? "day" : "days"}`
                      : "—"}
                    {formatDate(subscription?.trial_end) ? (
                      <span className="ml-1 font-normal text-muted-foreground">
                        (ends {formatDate(subscription.trial_end)})
                      </span>
                    ) : null}
                  </dd>
                </div>
              )}
              {subscription?.last_payment_status && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Last payment
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold text-foreground">
                    {prettyLabel(subscription.last_payment_status)}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* Actions */}
          {!unconfigured && (
            <div className="flex flex-col gap-2">
              <Button variant="outline" size="lg" onClick={openPortal} disabled={busy === "portal"}>
                {busy === "portal" ? (
                  <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                ) : (
                  <ExternalLink aria-hidden="true" />
                )}
                Manage billing
              </Button>
              {cancelScheduled ? (
                <Button size="lg" onClick={() => setCancellation(true)} disabled={busy === "resume"}>
                  {busy === "resume" ? (
                    <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  ) : (
                    <RefreshCw aria-hidden="true" />
                  )}
                  Resume subscription
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  size="lg"
                  onClick={() => setCancellation(false)}
                  // There is nothing to cancel until Stripe holds a customer for
                  // this org. The API reports that as a boolean; the customer id
                  // itself never crosses to the browser.
                  disabled={busy === "cancel" || !subscription?.hasStripeCustomer}
                >
                  {busy === "cancel" ? (
                    <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  ) : (
                    <Ban aria-hidden="true" />
                  )}
                  Cancel subscription
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Past due — dunning band. The grace end is the number that matters:
            it is the moment the org actually loses its paid entitlements. */}
        {pastDue && (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            <div>
              <p className="font-semibold text-destructive">Payment failed</p>
              <p className="mt-1">
                We couldn&rsquo;t charge your card. Your plan keeps working
                {graceEnd ? (
                  <>
                    {" "}
                    until <span className="font-semibold">{graceEnd}</span>
                  </>
                ) : (
                  " for a short grace period"
                )}
                , after which this organization drops to the Free plan limits.
              </p>
              {!unconfigured && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="mt-3"
                  onClick={openPortal}
                  disabled={busy === "portal"}
                >
                  {busy === "portal" ? (
                    <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  ) : (
                    <CreditCard aria-hidden="true" />
                  )}
                  Update payment method
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Scheduled cancellation — not an error, so it stays amber. */}
        {cancelScheduled && (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm text-foreground">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            <div>
              <p className="font-semibold text-warning">Subscription ends soon</p>
              <p className="mt-1">
                {subscription?.canceled_at ? `Cancelled on ${formatDate(subscription.canceled_at)}. ` : ""}
                You keep {plan?.name || "your plan"} access
                {periodEnd ? (
                  <>
                    {" "}
                    until <span className="font-semibold">{periodEnd}</span>
                  </>
                ) : (
                  " until the end of the current period"
                )}
                , then this organization reverts to the Free plan.
              </p>
              {!unconfigured && (
                <Button
                  size="sm"
                  className="mt-3"
                  onClick={() => setCancellation(true)}
                  disabled={busy === "resume"}
                >
                  {busy === "resume" ? (
                    <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  ) : (
                    <RefreshCw aria-hidden="true" />
                  )}
                  Resume subscription
                </Button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Usage */}
      <Section
        title="Usage this period"
        description="Counts and limits are reported by the server, which is the only authority on them. Anything marked “not enforced” is counted for information — it will not block you."
      >
        <div className="rounded-xl border border-border bg-card p-5 shadow-card">
          {usageRows.length === 0 ? (
            <EmptyState
              icon={Gauge}
              className="border-0 bg-transparent"
              title="No usage data yet"
              description="Nothing has been counted against this plan's limits so far. Numbers appear as people, projects and tasks are added."
            />
          ) : (
            <div className="space-y-5">
              {usageRows.map((row) => (
                <UsageBar key={row.key} row={row} />
              ))}
            </div>
          )}
        </div>
      </Section>

      {/* Plan comparison */}
      <Section
        title="Plans"
        description={
          unconfigured
            ? "Prices come from the billing API. Checkout is unavailable until Stripe is connected."
            : "Every price and limit below is the one the billing API reports for that plan."
        }
      >
        {plans.length === 0 ? (
          <EmptyState
            icon={CreditCard}
            title="No plans available"
            description="The billing API returned no plans for this deployment, so there is nothing to compare or switch to."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {plans.map((p) => (
              <PlanCard
                key={p.code}
                plan={p}
                current={p.code === currentPlanCode}
                currentAmount={plan?.amount_cents}
                disabled={unconfigured}
                busy={busy === `checkout:${p.code}`}
                onSelect={() => startCheckout(p.code)}
              />
            ))}
          </div>
        )}
      </Section>

      {/* Invoices */}
      <Section title="Billing history" description="Invoices Stripe has issued to this organization.">
        <DataTable
          keyField="stripe_invoice_id"
          rows={invoices}
          empty={
            <EmptyState
              icon={Receipt}
              title="No invoices yet"
              description="Stripe hasn't issued an invoice for this organization. Paid periods appear here as soon as one is finalised."
            />
          }
          columns={[
            {
              key: "date",
              header: "Date",
              // Issue date is the one a customer recognises from the invoice
              // itself; the row's own timestamps are only a fallback for rows a
              // webhook wrote before Stripe finalised them.
              render: (inv) =>
                formatDate(inv.issued_at || inv.created_at || inv.period_start) || "—",
            },
            {
              key: "amount",
              header: "Amount",
              align: "right",
              cellClassName: "tabular-nums",
              render: (inv) => formatMoney(invoiceAmountCents(inv), inv.currency),
            },
            {
              key: "status",
              header: "Status",
              render: (inv) => (
                <StatusPill
                  status={invoiceStatusPill(inv.status)}
                  label={prettyLabel(inv.status) || "Unknown"}
                  size="sm"
                />
              ),
            },
            {
              key: "receipt",
              header: "Receipt",
              align: "right",
              render: (inv) => {
                const link = inv.hosted_invoice_url || inv.invoice_pdf_url || null;
                if (!link) return <span className="text-xs text-muted-foreground">—</span>;
                return (
                  <a
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md text-xs font-semibold text-primary transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none"
                  >
                    View <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                );
              },
            },
          ]}
        />
      </Section>
    </div>
  );
}

/**
 * One resource against its limit.
 *
 * The bar is the warning system: a tick at 80% is drawn on every bounded bar,
 * so a fill approaching it reads as "coming up" rather than as a surprise the
 * day it turns red. Colour is backed by a chip in words at both thresholds.
 */
function UsageBar({ row }) {
  const width = row.unlimited ? 100 : row.exceeded ? 100 : row.pct;
  const unenforcedNote = UNENFORCED[row.key];

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          {row.label}
          {unenforcedNote ? (
            <Badge variant="warning" size="sm">
              Not enforced
            </Badge>
          ) : row.exceeded ? (
            <Badge variant="destructive" size="sm">
              Over limit
            </Badge>
          ) : row.near ? (
            <Badge variant="warning" size="sm">
              Near limit
            </Badge>
          ) : null}
        </span>
        <span
          className={cn(
            "text-sm font-semibold tabular-nums",
            unenforcedNote
              ? "text-muted-foreground"
              : row.exceeded
              ? "text-destructive"
              : row.near
              ? "text-warning"
              : "text-muted-foreground"
          )}
        >
          {row.used.toLocaleString()}
          {row.unlimited ? (
            <span className="font-medium text-muted-foreground"> / Unlimited</span>
          ) : (
            <span className="font-medium"> / {Number(row.limit).toLocaleString()}</span>
          )}
        </span>
      </div>

      <div
        className="relative mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={`${row.label} usage`}
        aria-valuemin={0}
        aria-valuemax={row.unlimited ? undefined : 100}
        aria-valuenow={row.unlimited ? undefined : width}
        aria-valuetext={
          row.unlimited
            ? `${row.used.toLocaleString()} used, no limit`
            : `${row.used.toLocaleString()} of ${Number(row.limit).toLocaleString()} used`
        }
      >
        <div
          className={cn(
            "h-full rounded-full transition-all duration-150 motion-reduce:transition-none",
            unenforcedNote
              ? "bg-muted-foreground/40"
              : row.exceeded
              ? "bg-destructive"
              : row.near
              ? "bg-warning"
              : "bg-primary"
          )}
          style={{ width: `${width}%` }}
        />
        {/* The warning line. Present before anything is wrong, which is the
            whole point — you can see the wall coming. */}
        {!row.unlimited && (
          <span
            aria-hidden="true"
            className="absolute inset-y-0 w-px bg-foreground/30"
            style={{ left: `${NEAR_LIMIT_PCT}%` }}
          />
        )}
      </div>

      {/* Only say "blocked" about a meter that actually blocks. `screenshots` is
          counted here for information but never enforced — checkResourceLimit is
          never called for it and the ingest route has no plan check — so the
          usual copy would announce a wall that isn't there. */}
      {unenforcedNote ? (
        <p className="mt-1 text-xs text-muted-foreground">
          <span className="font-medium text-warning">Not enforced.</span> {unenforcedNote}
        </p>
      ) : (
        <>
          {!row.unlimited && !row.exceeded && typeof row.remaining === "number" && (
            <p
              className={cn(
                "mt-1 text-xs",
                row.near ? "font-medium text-warning" : "text-muted-foreground"
              )}
            >
              {row.remaining.toLocaleString()} remaining
              {row.near ? " — you're close to this plan's limit" : ""}
            </p>
          )}
          {row.exceeded && (
            <p className="mt-1 text-xs font-medium text-destructive">
              Upgrade to add more — new {row.label.toLowerCase()} are blocked at this limit.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function PlanCard({ plan, current, currentAmount, disabled, busy, onSelect }) {
  const limits = plan?.limits && typeof plan.limits === "object" ? plan.limits : {};
  const features = plan?.features && typeof plan.features === "object" ? plan.features : {};
  const limitRows = Object.entries(limits);
  const featureRows = Object.entries(features);
  // Direction is judged on price because plan codes carry no ordering.
  const isUpgrade = (Number(plan?.amount_cents) || 0) >= (Number(currentAmount) || 0);
  // The API reports whether a plan can actually reach Checkout. Without this a
  // freshly installed deployment — where no plan has a Stripe price yet — offers
  // four live buttons that all come back 400.
  const notPurchasable = plan?.checkoutReady === false;
  const blockedReason = disabled
    ? "Billing isn't connected yet"
    : notPurchasable
    ? Number(plan?.amount_cents) === 0
      ? "The Free plan isn't bought — cancel your current plan to return to it"
      : "This plan has no Stripe price configured yet"
    : null;

  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border bg-card p-5 shadow-card transition-shadow duration-150 hover:shadow-elevated motion-reduce:transition-none",
        current ? "border-primary ring-2 ring-primary/20" : "border-border"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-base font-semibold tracking-tight text-foreground">
          {plan?.name || plan?.code}
        </h4>
        {current && (
          <Badge variant="default" size="sm" className="shrink-0">
            Current
          </Badge>
        )}
      </div>
      {plan?.description && <p className="mt-1 text-xs text-muted-foreground">{plan.description}</p>}

      <div className="mt-3 flex items-baseline gap-1">
        <span className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">
          {formatMoney(plan?.amount_cents, plan?.currency)}
        </span>
        <span className="text-xs font-medium text-muted-foreground">
          {intervalSuffix(plan?.billing_interval)}
        </span>
      </div>
      {/* The trial is real only for a plan that can actually be bought: Checkout
          passes trial_period_days to Stripe. The Free plan is never checked out
          — signup writes no subscription row at all — so its seeded trial_days
          would promise a countdown that never starts. */}
      {Number(plan?.trial_days) > 0 && !notPurchasable && (
        <p className="mt-1 text-xs font-medium text-info">{plan.trial_days}-day free trial</p>
      )}

      {limitRows.length > 0 && (
        <dl className="mt-4 space-y-1.5 border-t border-border pt-4">
          {limitRows.map(([key, value]) => {
            // An unenforced number still belongs on the card — it is what the
            // catalogue says — but it must not read as a ceiling that bites.
            const note = UNENFORCED[key];
            return (
              <div key={key} className="flex items-start justify-between gap-2 text-xs">
                <dt className="text-muted-foreground">
                  {LIMIT_LABELS[key] || prettyLabel(key)}
                  {note && (
                    <span className="ml-1 font-medium text-warning" title={note}>
                      (not enforced)
                    </span>
                  )}
                </dt>
                <dd
                  className={cn(
                    "shrink-0 font-semibold tabular-nums",
                    note ? "text-muted-foreground line-through" : "text-foreground"
                  )}
                >
                  {formatLimit(key, value)}
                </dd>
                {note && <span className="sr-only">{note}</span>}
              </div>
            );
          })}
        </dl>
      )}

      {featureRows.length > 0 && (
        <ul className="mt-4 space-y-1.5 border-t border-border pt-4">
          {featureRows.map(([key, on]) => {
            const label = FEATURE_LABELS[key] || prettyLabel(key);
            const unenforced = UNENFORCED[key];
            const partial = PARTIAL_FEATURES[key];

            // A flag nothing checks is neither included nor withheld. Ticking
            // it sells something that does not exist; striking it through
            // withholds something the customer already has. Say so instead.
            if (unenforced) {
              return (
                <li key={key} className="flex items-start gap-2 text-xs">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="text-muted-foreground">
                    {label} — <span className="font-medium text-warning">not enforced</span>. {unenforced}
                  </span>
                </li>
              );
            }

            return (
              <li key={key} className="flex items-start gap-2 text-xs">
                {on ? (
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
                ) : (
                  <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
                <span className={on ? "text-foreground" : "text-muted-foreground"}>
                  <span className={on ? undefined : "line-through"}>{label}</span>
                  {partial && <span className="ml-1 text-muted-foreground">({partial})</span>}
                </span>
                <span className="sr-only">{on ? " included" : " not included"}</span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-auto pt-5">
        {current ? (
          <div className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-muted px-4 py-2 text-sm font-medium text-muted-foreground">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Your plan
          </div>
        ) : (
          <>
            <Button
              variant={isUpgrade ? "default" : "outline"}
              size="lg"
              className="w-full"
              onClick={onSelect}
              disabled={disabled || busy || notPurchasable}
              title={blockedReason || undefined}
            >
              {busy && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {isUpgrade ? "Upgrade" : "Downgrade"}
            </Button>
            {/* A greyed-out button with no explanation reads as a broken page;
                the unconnected-Stripe case already has its own banner above. */}
            {!disabled && notPurchasable && (
              <p className="mt-2 text-xs text-muted-foreground">{blockedReason}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
