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

/**
 * Admin → Billing & Subscription.
 *
 * Read-only mirror of what the billing API reports plus the three write actions
 * Stripe owns (checkout, portal, cancel/resume). Nothing here decides
 * entitlement — the server is the only authority on limits, so this screen
 * renders `usage` as reported rather than recomputing it.
 */

// -1 is the seeded convention for "no ceiling" (see migration 027 limits jsonb).
const UNLIMITED = -1;

const STATUS_META = {
  active: { label: "Active", badge: "bg-success/10 text-success", icon: CheckCircle2 },
  trialing: { label: "Trial", badge: "bg-info/10 text-info", icon: Clock },
  past_due: { label: "Past due", badge: "bg-destructive/10 text-destructive", icon: AlertTriangle },
  unpaid: { label: "Unpaid", badge: "bg-destructive/10 text-destructive", icon: AlertTriangle },
  incomplete: { label: "Incomplete", badge: "bg-warning/10 text-warning", icon: AlertTriangle },
  incomplete_expired: { label: "Expired", badge: "bg-muted text-muted-foreground", icon: Ban },
  canceled: { label: "Canceled", badge: "bg-muted text-muted-foreground", icon: Ban },
  paused: { label: "Paused", badge: "bg-muted text-muted-foreground", icon: Ban },
};

function statusMeta(status) {
  return (
    STATUS_META[status] || {
      label: prettyLabel(status) || "Unknown",
      badge: "bg-muted text-muted-foreground",
      icon: Info,
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

function formatLimit(key, value) {
  if (value === UNLIMITED || value === null || value === undefined) return "Unlimited";
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  if (key === "storage_mb") return n >= 1000 ? `${(n / 1000).toLocaleString()} GB` : `${n.toLocaleString()} MB`;
  if (key === "tracking_history_days") return `${n.toLocaleString()} days`;
  return n.toLocaleString();
}

const inputlessButton =
  "inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50";

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
        near: !unlimited && pct >= 80,
      };
    });
  }, [usage]);

  const atLimitCount = useMemo(() => usageRows.filter((r) => r.exceeded).length, [usageRows]);

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
  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-10 shadow-card">
        <div className="flex flex-col items-center justify-center gap-3 py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary/30 border-t-primary" />
          <p className="text-sm text-muted-foreground">Loading billing…</p>
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
        <button type="button" onClick={load} className={inputlessButton}>
          <RefreshCw className="h-4 w-4" />
          Try again
        </button>
      </div>
    );
  }

  const status = subscription?.status || "active";
  const meta = statusMeta(status);
  const StatusIcon = meta.icon;
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
          <h2 className="text-xl font-bold tracking-tight text-foreground">Billing &amp; Subscription</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your plan, usage against its limits, and payment settings.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {testMode && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-warning">
              <FlaskConical className="h-3.5 w-3.5" />
              Stripe test mode
            </span>
          )}
          <button type="button" onClick={load} disabled={loading} className={inputlessButton}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Return from Stripe Checkout. The subscription itself is written by the
          webhook, which can land after this page does, so success is worded as
          "on its way" rather than promising the plan below is already updated. */}
      {checkoutOutcome === "success" && (
        <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/5 p-4 text-sm text-foreground">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <p>
            <span className="font-semibold">Checkout complete.</span> Stripe is confirming the
            payment with us now — if the plan below still shows the old one, give it a moment and
            hit Refresh.
          </p>
        </div>
      )}
      {checkoutOutcome === "changed" && (
        <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/5 p-4 text-sm text-foreground">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <p>
            <span className="font-semibold">Plan updated.</span> Your existing subscription was moved
            to the new plan and only the difference is charged. The change is confirmed by Stripe in
            the background — hit Refresh if the plan below hasn&rsquo;t caught up.
          </p>
        </div>
      )}
      {checkoutOutcome === "cancelled" && (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-4 text-sm text-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
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
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
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
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
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
          tone={atLimitCount > 0 ? "destructive" : "success"}
          badge={atLimitCount > 0 ? "Action needed" : undefined}
          badgeTone="destructive"
        />
      </div>

      {/* Current plan */}
      <section className="rounded-xl border border-border bg-card p-6 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-bold tracking-tight text-foreground">{plan?.name || "Free"}</h3>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${meta.badge}`}
              >
                <StatusIcon className="h-3.5 w-3.5" />
                {meta.label}
              </span>
              {cancelScheduled && (
                <span className="inline-flex rounded-full bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">
                  Cancels at period end
                </span>
              )}
            </div>
            {plan?.description && (
              <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>
            )}
            <div className="mt-3 flex items-baseline gap-1">
              <span className="text-3xl font-bold tracking-tight text-foreground tabular-nums">
                {formatMoney(plan?.amount_cents, plan?.currency)}
              </span>
              <span className="text-sm font-medium text-muted-foreground">
                {intervalSuffix(plan?.billing_interval)}
              </span>
            </div>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {cancelScheduled ? "Access ends" : "Renews on"}
                </dt>
                <dd className="mt-0.5 text-sm font-semibold text-foreground">{periodEnd || "—"}</dd>
              </div>
              {status === "trialing" && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
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
                  <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
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
              <button type="button" onClick={openPortal} disabled={busy === "portal"} className={inputlessButton}>
                {busy === "portal" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ExternalLink className="h-4 w-4" />
                )}
                Manage billing
              </button>
              {cancelScheduled ? (
                <button
                  type="button"
                  onClick={() => setCancellation(true)}
                  disabled={busy === "resume"}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {busy === "resume" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  Resume subscription
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setCancellation(false)}
                  // There is nothing to cancel until Stripe holds a customer for
                  // this org. The API reports that as a boolean; the customer id
                  // itself never crosses to the browser.
                  disabled={busy === "cancel" || !subscription?.hasStripeCustomer}
                  className="inline-flex items-center gap-2 rounded-lg border border-destructive/30 px-4 py-2 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                >
                  {busy === "cancel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                  Cancel subscription
                </button>
              )}
            </div>
          )}
        </div>

        {/* Past due — dunning band. The grace end is the number that matters:
            it is the moment the org actually loses its paid entitlements. */}
        {pastDue && (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
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
                <button
                  type="button"
                  onClick={openPortal}
                  disabled={busy === "portal"}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
                >
                  {busy === "portal" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CreditCard className="h-4 w-4" />
                  )}
                  Update payment method
                </button>
              )}
            </div>
          </div>
        )}

        {/* Scheduled cancellation — not an error, so it stays amber. */}
        {cancelScheduled && (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm text-foreground">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
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
                <button
                  type="button"
                  onClick={() => setCancellation(true)}
                  disabled={busy === "resume"}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {busy === "resume" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  Resume subscription
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Usage */}
      <section className="rounded-xl border border-border bg-card p-6 shadow-card">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Gauge className="h-4 w-4 text-primary" /> Usage this period
        </h3>
        {usageRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No usage data is available yet.</p>
        ) : (
          <div className="space-y-4">
            {usageRows.map((row) => (
              <div key={row.key}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {row.label}
                    {row.exceeded && (
                      <span className="ml-2 inline-flex rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
                        Over limit
                      </span>
                    )}
                  </span>
                  <span
                    className={`text-sm font-semibold tabular-nums ${
                      row.exceeded ? "text-destructive" : "text-muted-foreground"
                    }`}
                  >
                    {row.used.toLocaleString()}
                    {row.unlimited ? (
                      <span className="font-medium text-muted-foreground"> / Unlimited</span>
                    ) : (
                      <span className="font-medium"> / {Number(row.limit).toLocaleString()}</span>
                    )}
                  </span>
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full transition-all ${
                      row.exceeded ? "bg-destructive" : row.near ? "bg-warning" : "bg-primary"
                    }`}
                    style={{ width: row.unlimited ? "100%" : `${row.exceeded ? 100 : row.pct}%` }}
                  />
                </div>
                {!row.unlimited && !row.exceeded && typeof row.remaining === "number" && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.remaining.toLocaleString()} remaining
                  </p>
                )}
                {row.exceeded && (
                  <p className="mt-1 text-xs font-medium text-destructive">
                    Upgrade to add more — new {row.label.toLowerCase()} are blocked at this limit.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Plan comparison */}
      <section className="space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CreditCard className="h-4 w-4 text-primary" /> Plans
        </h3>
        {plans.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-card">
            No plans are available.
          </div>
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
      </section>

      {/* Invoices */}
      {invoices.length > 0 && (
        <section className="rounded-xl border border-border bg-card shadow-card">
          <h3 className="flex items-center gap-2 border-b border-border px-5 py-4 text-sm font-semibold text-foreground">
            <Receipt className="h-4 w-4 text-primary" /> Recent invoices
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="px-5 py-3">Date</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv, i) => {
                  const link = inv.hosted_invoice_url || inv.invoice_pdf_url || null;
                  return (
                    <tr
                      key={inv.stripe_invoice_id || i}
                      className="border-b border-border last:border-0 hover:bg-muted/40"
                    >
                      <td className="px-5 py-3 text-foreground">
                        {/* Issue date is the one a customer recognises from the
                            invoice itself; the row's own timestamps are only a
                            fallback for rows a webhook wrote before Stripe
                            finalised them. */}
                        {formatDate(inv.issued_at || inv.created_at || inv.period_start) || "—"}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-foreground">
                        {formatMoney(invoiceAmountCents(inv), inv.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                            inv.status === "paid"
                              ? "bg-success/10 text-success"
                              : inv.status === "open"
                              ? "bg-warning/10 text-warning"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {prettyLabel(inv.status) || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {link ? (
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                          >
                            View <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
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
      className={`flex flex-col rounded-xl border bg-card p-5 shadow-card transition-shadow hover:shadow-elevated ${
        current ? "border-primary ring-2 ring-primary/20" : "border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-base font-bold tracking-tight text-foreground">{plan?.name || plan?.code}</h4>
        {current && (
          <span className="inline-flex shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
            Current
          </span>
        )}
      </div>
      {plan?.description && <p className="mt-1 text-xs text-muted-foreground">{plan.description}</p>}

      <div className="mt-3 flex items-baseline gap-1">
        <span className="text-2xl font-bold tracking-tight text-foreground tabular-nums">
          {formatMoney(plan?.amount_cents, plan?.currency)}
        </span>
        <span className="text-xs font-medium text-muted-foreground">{intervalSuffix(plan?.billing_interval)}</span>
      </div>
      {Number(plan?.trial_days) > 0 && (
        <p className="mt-1 text-xs font-medium text-info">{plan.trial_days}-day free trial</p>
      )}

      {limitRows.length > 0 && (
        <dl className="mt-4 space-y-1.5 border-t border-border pt-4">
          {limitRows.map(([key, value]) => (
            <div key={key} className="flex items-center justify-between gap-2 text-xs">
              <dt className="text-muted-foreground">{LIMIT_LABELS[key] || prettyLabel(key)}</dt>
              <dd className="font-semibold tabular-nums text-foreground">{formatLimit(key, value)}</dd>
            </div>
          ))}
        </dl>
      )}

      {featureRows.length > 0 && (
        <ul className="mt-4 space-y-1.5 border-t border-border pt-4">
          {featureRows.map(([key, on]) => (
            <li key={key} className="flex items-center gap-2 text-xs">
              {on ? (
                <Check className="h-3.5 w-3.5 shrink-0 text-success" />
              ) : (
                <X className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
              )}
              <span className={on ? "text-foreground" : "text-muted-foreground/70 line-through"}>
                {FEATURE_LABELS[key] || prettyLabel(key)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 pt-1">
        {current ? (
          <div className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-muted px-4 py-2 text-sm font-semibold text-muted-foreground">
            <CheckCircle2 className="h-4 w-4" />
            Your plan
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={onSelect}
              disabled={disabled || busy || notPurchasable}
              title={blockedReason || undefined}
              className={`inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
                isUpgrade
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "border border-border bg-card text-foreground hover:bg-muted"
              }`}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {isUpgrade ? "Upgrade" : "Downgrade"}
            </button>
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
