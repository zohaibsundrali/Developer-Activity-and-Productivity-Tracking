"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Ban,
  Bell,
  CheckCircle2,
  CreditCard,
  Database,
  HelpCircle,
  Info,
  Mail,
  RefreshCw,
  ShieldAlert,
  Timer,
  XCircle,
  Zap,
} from "lucide-react";
import StatCard from "@/components/shell/StatCard";
import { authFetch } from "@/utils/authFetch";
// The page <h1> reads the same string the sidebar and topbar do.
import { sectionTitle } from "@/components/shell/navConfig";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Section,
  Skeleton,
  StatusPill,
  Toolbar,
} from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Admin → System Health.
 *
 * The read-only face of the server-side event log (migration 038). Everything
 * on this screen is reported by /api/admin/health, which derives each status
 * from real evidence — this component decides nothing about health, it only
 * renders what the server observed. That matters: a dashboard that computes its
 * own "ok" from a missing field is how monitoring starts lying.
 */

// ── Vocabulary ──────────────────────────────────────────────────────────────

/**
 * The four statuses the API reports, mapped onto the kit's StatusPill.
 *
 * StatusPill carries a distinct glyph SHAPE per status and always prints the
 * label, so none of this depends on colour: `ok` is a filled tick, `degraded` a
 * triangle, `down` a filled cross, `unknown` a hollow outlined question mark.
 *
 * `unknown` is the one that has to be got right. It does not mean "broken" — it
 * means the server has no evidence either way, usually because the subsystem
 * has not run yet on a young organization. So it is deliberately the ONLY
 * status drawn as an outline rather than a tint, it never inherits destructive
 * anything, its tile is dashed the way an unfilled placeholder is dashed, and
 * it is worded as an absence. A cron job that has never run and a cron job that
 * failed are different facts, and this screen is the place that must not
 * conflate them.
 */
const STATUS_META = {
  ok: {
    label: "Operational",
    pill: "success",
    ring: "border-border",
    tone: "success",
    headline: "All systems operational",
    blurb: "Every subsystem the server watches has reported in and looks healthy.",
  },
  degraded: {
    label: "Degraded",
    pill: "warning",
    ring: "border-warning/30",
    tone: "warning",
    headline: "Running degraded",
    blurb: "At least one subsystem is reporting problems. Details are on the tiles below.",
  },
  down: {
    label: "Down",
    pill: "error",
    ring: "border-destructive/30",
    tone: "destructive",
    headline: "A subsystem is down",
    blurb: "The server has evidence of failure. Details are on the tiles below.",
  },
  unknown: {
    label: "Not reported",
    pill: "unknown",
    // Dashed, not red: nothing has been written here yet, the way an unfilled
    // field is dashed rather than errored.
    ring: "border-dashed border-border",
    tone: "info",
    headline: "Nothing reported yet",
    blurb:
      "No subsystem has recorded anything for this organization. That is an absence of evidence, not a failure — tiles fill in as jobs, webhooks and sign-ins run.",
  },
};

function statusMeta(status) {
  return STATUS_META[status] || STATUS_META.unknown;
}

/**
 * Severity, as a four-step scale rather than four unrelated colours.
 *
 * `rank` drives a small four-segment meter on every row, so "critical vs
 * warning" is legible as a QUANTITY (how many segments are lit) before any
 * colour is read at all — and the row still ranks correctly in greyscale.
 */
const SEVERITY_META = {
  critical: { label: "Critical", variant: "destructive", rank: 4, icon: ShieldAlert },
  error: { label: "Error", variant: "destructive", rank: 3, icon: XCircle },
  warning: { label: "Warning", variant: "warning", rank: 2, icon: AlertTriangle },
  info: { label: "Info", variant: "info", rank: 1, icon: Info },
};

const SEVERITY_FILL = {
  4: "bg-destructive",
  3: "bg-destructive",
  2: "bg-warning",
  1: "bg-info",
  0: "bg-muted-foreground",
};

function severityMeta(severity) {
  return (
    SEVERITY_META[severity] || {
      label: severity || "Unknown",
      variant: "secondary",
      rank: 0,
      icon: HelpCircle,
    }
  );
}

/** Four segments, `rank` of them lit. The scale is the point, not the hue. */
function SeverityMeter({ rank, label }) {
  return (
    <span
      className="inline-flex shrink-0 items-end gap-0.5"
      role="img"
      aria-label={`Severity ${label}, ${rank} of 4`}
    >
      {[1, 2, 3, 4].map((step) => (
        <span
          key={step}
          className={cn(
            "w-1 rounded-sm",
            step === 1 && "h-1.5",
            step === 2 && "h-2",
            step === 3 && "h-2.5",
            step === 4 && "h-3",
            step <= rank ? SEVERITY_FILL[rank] || "bg-muted-foreground" : "bg-border"
          )}
        />
      ))}
    </span>
  );
}

// The five subsystems the API reports on, in the order they matter when
// something is wrong: the data layer first, then the jobs that write to it.
const CHECK_META = [
  { key: "database", label: "Database", icon: Database, blurb: "Reads and writes to Postgres" },
  { key: "cron", label: "Scheduled jobs", icon: Timer, blurb: "Reminders and recurring tasks" },
  { key: "automation", label: "Automation", icon: Zap, blurb: "Workflow rules" },
  { key: "email", label: "Email", icon: Mail, blurb: "Outbound notifications" },
  { key: "billing", label: "Billing", icon: CreditCard, blurb: "Stripe webhooks" },
];

const SOURCE_LABELS = {
  api: "API",
  cron: "Cron",
  automation: "Automation",
  email: "Email",
  auth: "Auth",
  database: "Database",
};

const SEVERITY_ORDER = ["critical", "error", "warning", "info"];

// ── Formatting ──────────────────────────────────────────────────────────────

/** "just now" / "12m ago" / "3h ago" / "2d ago", falling back to a date. */
function relativeTime(value) {
  if (!value) return null;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return null;

  const seconds = Math.round((Date.now() - t) / 1000);
  if (seconds < 0) return "just now";
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  if (seconds < 7 * 86400) return `${Math.round(seconds / 86400)}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function absoluteTime(value) {
  if (!value) return "";
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleString();
}

const selectClasses =
  "h-8 rounded-lg border border-border bg-card px-2.5 text-sm font-medium text-foreground transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50";

// ── Component ───────────────────────────────────────────────────────────────

export default function SystemHealth() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");

  const load = useCallback(async ({ silent = false } = {}) => {
    try {
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      const res = await authFetch("/api/admin/health");
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `Could not load system health (HTTP ${res.status}).`);
      }
      setData(json);
    } catch (e) {
      setError(e?.message || "Failed to load system health.");
      setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const events = useMemo(() => (Array.isArray(data?.events) ? data.events : []), [data]);
  const checks = data?.checks || null;

  // Tiles, in a fixed order, with anything the API did not report falling back
  // to `unknown` rather than being hidden.
  const checkTiles = useMemo(
    () =>
      CHECK_META.map((meta) => ({
        ...meta,
        ...(checks?.[meta.key] || { status: "unknown", detail: "Not reported.", lastRunAt: null }),
      })),
    [checks]
  );

  // Only offer a source in the filter if it actually appears in the feed —
  // a dropdown full of options that all yield nothing is a dead end.
  const sourceOptions = useMemo(() => {
    const seen = new Set(events.map((e) => e.source).filter(Boolean));
    return Object.keys(SOURCE_LABELS).filter((s) => seen.has(s));
  }, [events]);

  const severityOptions = useMemo(() => {
    const seen = new Set(events.map((e) => e.severity).filter(Boolean));
    return SEVERITY_ORDER.filter((s) => seen.has(s));
  }, [events]);

  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      if (sourceFilter !== "all" && e.source !== sourceFilter) return false;
      if (severityFilter !== "all" && e.severity !== severityFilter) return false;
      return true;
    });
  }, [events, sourceFilter, severityFilter]);

  // The worst status across the five checks, for the headline tile. `unknown`
  // never outranks a real signal — it means "no evidence", not "a problem".
  const overall = useMemo(() => {
    const statuses = checkTiles.map((c) => c.status);
    if (statuses.includes("down")) return "down";
    if (statuses.includes("degraded")) return "degraded";
    if (statuses.every((s) => s === "unknown")) return "unknown";
    return "ok";
  }, [checkTiles]);

  const counts = data?.counts || { errorsLast24h: 0, warningsLast24h: 0 };
  const filtersActive = sourceFilter !== "all" || severityFilter !== "all";
  const clearFilters = () => {
    setSourceFilter("all");
    setSeverityFilter("all");
  };

  // The one page header, shared by every state below so the screen always has
  // its <h1> — loading and error included.
  const header = (
    <PageHeader
      title={sectionTitle("system-health", "admin")}
      description={`What the server itself recorded — scheduled jobs, automations, email, billing and auth.${
        data?.checkedAt ? ` Checked ${relativeTime(data.checkedAt)}.` : ""
      }`}
      actions={
        <Button variant="outline" onClick={() => load({ silent: true })} disabled={refreshing || loading}>
          <RefreshCw
            className={cn(refreshing && "animate-spin motion-reduce:animate-none")}
            aria-hidden="true"
          />
          Refresh
        </Button>
      }
    />
  );

  // ── Loading ───────────────────────────────────────────────────────────────
  // Shaped like the screen it precedes: banner, three counters, five tiles and
  // an event list. Nothing here renders null while the fetch is out.
  if (loading) {
    return (
      <div role="status" aria-busy="true">
        <span className="sr-only">Checking system health…</span>

        {header}

        <div className="space-y-6">
          <Skeleton className="h-24 w-full rounded-xl" />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-32 w-full rounded-xl" />
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {CHECK_META.map((meta) => (
              <div key={meta.key} className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-card">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
                    <div className="space-y-2">
                      <Skeleton className="h-3.5 w-24" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                  </div>
                  <Skeleton className="h-6 w-24 rounded-full" />
                </div>
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-40" />
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-border bg-card shadow-card">
            <div className="border-b border-border px-5 py-4">
              <Skeleton className="h-4 w-40" />
            </div>
            <ul className="divide-y divide-border">
              {[0, 1, 2, 3, 4].map((i) => (
                <li key={i} className="flex gap-3 px-5 py-4">
                  <Skeleton className="h-3 w-4 shrink-0" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-56" />
                    <Skeleton className="h-3 w-3/4" />
                  </div>
                  <Skeleton className="h-3 w-12 shrink-0" />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div>
        {header}
        <ErrorState title="Couldn't load system health" description={error} onRetry={() => load()} />
      </div>
    );
  }

  const overallMeta = statusMeta(overall);

  return (
    <div>
      {header}

      <div className="space-y-6">

        {/* Overall verdict, in words. The pill carries the shape; the sentence
            carries the meaning — neither one is doing it with colour. */}
        <div
          className={cn(
            "flex flex-wrap items-start gap-4 rounded-xl border bg-card p-5 shadow-card",
            overallMeta.ring
          )}
        >
          <StatusPill status={overallMeta.pill} label={overallMeta.label} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">{overallMeta.headline}</p>
            <p className="mt-1 text-sm text-muted-foreground">{overallMeta.blurb}</p>
          </div>
        </div>

        {/* Headline numbers */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard
            title="Subsystems reporting"
            value={`${checkTiles.filter((c) => c.status !== "unknown").length} of ${checkTiles.length}`}
            icon={Activity}
            tone={overallMeta.tone}
          />
          <StatCard
            title="Errors (last 24h)"
            value={counts.errorsLast24h ?? 0}
            icon={XCircle}
            tone={counts.errorsLast24h > 0 ? "destructive" : "success"}
            badge={counts.errorsLast24h > 0 ? "Needs attention" : undefined}
            badgeTone="destructive"
          />
          <StatCard
            title="Warnings (last 24h)"
            value={counts.warningsLast24h ?? 0}
            icon={AlertTriangle}
            tone={counts.warningsLast24h > 0 ? "warning" : "success"}
          />
        </div>

        {/* Status tiles */}
        <Section
          title="Subsystems"
          description="Each tile shows the last thing the server recorded for that subsystem."
          contentClassName="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          {checkTiles.map((tile) => {
            const meta = statusMeta(tile.status);
            const TileIcon = tile.icon;
            const last = relativeTime(tile.lastRunAt);
            const isUnknown = tile.status === "unknown" || !STATUS_META[tile.status];
            return (
              <div
                key={tile.key}
                className={cn(
                  "flex flex-col rounded-xl border bg-card p-5 shadow-card transition-shadow duration-150 hover:shadow-elevated motion-reduce:transition-none",
                  meta.ring
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                      <TileIcon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold tracking-tight text-foreground">
                        {tile.label}
                      </h3>
                      <p className="truncate text-xs text-muted-foreground">{tile.blurb}</p>
                    </div>
                  </div>
                  <StatusPill status={meta.pill} label={meta.label} className="shrink-0" />
                </div>

                <p className="mt-4 flex-1 text-sm leading-relaxed text-muted-foreground">{tile.detail}</p>

                {/* Said in words on the tile itself, because "no data" is the one
                    state a glance is most likely to misread as "bad". */}
                {isUnknown && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    No signal either way — this is not a failure.
                  </p>
                )}

                <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
                  {last ? (
                    <>
                      Last activity{" "}
                      <span className="font-semibold text-foreground" title={absoluteTime(tile.lastRunAt)}>
                        {last}
                      </span>
                    </>
                  ) : (
                    "No activity recorded yet"
                  )}
                </p>
              </div>
            );
          })}
        </Section>

        {/* Event feed */}
        <section className="rounded-xl border border-border bg-card shadow-card">
          <div className="space-y-3 border-b border-border px-5 py-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Activity className="h-4 w-4 text-primary" aria-hidden="true" />
              Recent events
              <Badge variant="secondary" size="sm">
                {filteredEvents.length}
                {filtersActive ? ` of ${events.length}` : ""}
              </Badge>
            </h3>

            <Toolbar
              aria-label="Event filters"
              filters={
                <>
                  <label className="sr-only" htmlFor="health-source">
                    Filter by source
                  </label>
                  <select
                    id="health-source"
                    value={sourceFilter}
                    onChange={(e) => setSourceFilter(e.target.value)}
                    disabled={sourceOptions.length === 0}
                    className={selectClasses}
                  >
                    <option value="all">All sources</option>
                    {sourceOptions.map((s) => (
                      <option key={s} value={s}>
                        {SOURCE_LABELS[s] || s}
                      </option>
                    ))}
                  </select>

                  <label className="sr-only" htmlFor="health-severity">
                    Filter by severity
                  </label>
                  <select
                    id="health-severity"
                    value={severityFilter}
                    onChange={(e) => setSeverityFilter(e.target.value)}
                    disabled={severityOptions.length === 0}
                    className={selectClasses}
                  >
                    <option value="all">All severities</option>
                    {severityOptions.map((s) => (
                      <option key={s} value={s}>
                        {severityMeta(s).label}
                      </option>
                    ))}
                  </select>

                </>
              }
              actions={
                filtersActive ? (
                  <Button variant="ghost" size="sm" onClick={clearFilters}>
                    <Ban aria-hidden="true" />
                    Clear filters
                  </Button>
                ) : null
              }
            />
          </div>

          {/* Empty — nothing has ever been recorded. This is the good outcome, so
              it is worded as reassurance rather than as a missing-data error. */}
          {events.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={CheckCircle2}
                className="border-0 bg-transparent"
                title="No events recorded"
                description="Nothing on the server has reported a failure for this organization. Events appear here when a scheduled job, automation, webhook or sign-in attempt goes wrong."
              />
            </div>
          ) : filteredEvents.length === 0 ? (
            /* Empty — but only because of the filters. Different problem, different copy. */
            <div className="p-5">
              <EmptyState
                icon={Bell}
                className="border-0 bg-transparent"
                title="No events match these filters"
                description="Every event is still here — the two filters above are just hiding them."
                action={
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {filteredEvents.map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function EventRow({ event }) {
  const meta = severityMeta(event.severity);
  const SeverityIcon = meta.icon;
  const context = event.context && typeof event.context === "object" ? event.context : {};
  const contextEntries = Object.entries(context).filter(([, v]) => v !== null && v !== "");

  return (
    <li className="flex gap-3 px-5 py-4 transition-colors duration-150 hover:bg-muted/40 motion-reduce:transition-none">
      <span className="mt-1 shrink-0">
        <SeverityMeter rank={meta.rank} label={meta.label} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={meta.variant} size="sm">
            <SeverityIcon aria-hidden="true" />
            {meta.label}
          </Badge>
          <Badge variant="secondary" size="sm">
            {SOURCE_LABELS[event.source] || event.source}
          </Badge>
          <code className="truncate font-mono text-xs text-muted-foreground">{event.event_type}</code>
        </div>

        {event.message && <p className="mt-1.5 break-words text-sm text-foreground">{event.message}</p>}

        {contextEntries.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {contextEntries.map(([key, value]) => (
              <span
                key={key}
                className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
              >
                <span className="font-semibold">{key}</span>
                <span className="truncate">{String(value)}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <time
        className="shrink-0 whitespace-nowrap pt-0.5 text-xs text-muted-foreground"
        dateTime={event.created_at || undefined}
        title={absoluteTime(event.created_at)}
      >
        {relativeTime(event.created_at)}
      </time>
    </li>
  );
}
