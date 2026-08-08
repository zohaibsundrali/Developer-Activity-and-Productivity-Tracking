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
  Server,
  ShieldAlert,
  Timer,
  XCircle,
  Zap,
} from "lucide-react";
import StatCard from "@/components/shell/StatCard";
import { authFetch } from "@/utils/authFetch";

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

const STATUS_META = {
  ok: {
    label: "Operational",
    tone: "text-success",
    badge: "bg-success/10 text-success",
    ring: "border-success/30",
    icon: CheckCircle2,
  },
  degraded: {
    label: "Degraded",
    tone: "text-warning",
    badge: "bg-warning/10 text-warning",
    ring: "border-warning/30",
    icon: AlertTriangle,
  },
  down: {
    label: "Down",
    tone: "text-destructive",
    badge: "bg-destructive/10 text-destructive",
    ring: "border-destructive/30",
    icon: XCircle,
  },
  unknown: {
    label: "Unknown",
    tone: "text-muted-foreground",
    badge: "bg-muted text-muted-foreground",
    ring: "border-border",
    icon: HelpCircle,
  },
};

function statusMeta(status) {
  return STATUS_META[status] || STATUS_META.unknown;
}

const SEVERITY_META = {
  critical: { label: "Critical", badge: "bg-destructive/15 text-destructive", dot: "bg-destructive", icon: ShieldAlert },
  error: { label: "Error", badge: "bg-destructive/10 text-destructive", dot: "bg-destructive", icon: XCircle },
  warning: { label: "Warning", badge: "bg-warning/10 text-warning", dot: "bg-warning", icon: AlertTriangle },
  info: { label: "Info", badge: "bg-info/10 text-info", dot: "bg-info", icon: Info },
};

function severityMeta(severity) {
  return (
    SEVERITY_META[severity] || {
      label: severity || "Unknown",
      badge: "bg-muted text-muted-foreground",
      dot: "bg-muted-foreground",
      icon: Info,
    }
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
  "rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30";

const ghostButton =
  "inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50";

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

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-10 shadow-card">
        <div className="flex flex-col items-center justify-center gap-3 py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary/30 border-t-primary" />
          <p className="text-sm text-muted-foreground">Checking system health…</p>
        </div>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
        <button type="button" onClick={() => load()} className={ghostButton}>
          <RefreshCw className="h-4 w-4" />
          Try again
        </button>
      </div>
    );
  }

  const overallMeta = statusMeta(overall);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">System Health</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            What the server itself recorded — scheduled jobs, automations, email, billing and auth.
            {data?.checkedAt ? ` Checked ${relativeTime(data.checkedAt)}.` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => load({ silent: true })}
          disabled={refreshing}
          className={ghostButton}
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Headline numbers */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          title="Overall status"
          value={overallMeta.label}
          icon={Server}
          tone={overall === "ok" ? "success" : overall === "degraded" ? "warning" : overall === "down" ? "destructive" : "info"}
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
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {checkTiles.map((tile) => {
          const meta = statusMeta(tile.status);
          const StatusIcon = meta.icon;
          const TileIcon = tile.icon;
          const last = relativeTime(tile.lastRunAt);
          return (
            <div
              key={tile.key}
              className={`flex flex-col rounded-xl border bg-card p-5 shadow-card transition-shadow hover:shadow-elevated ${meta.ring}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                    <TileIcon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-bold tracking-tight text-foreground">{tile.label}</h3>
                    <p className="truncate text-xs text-muted-foreground">{tile.blurb}</p>
                  </div>
                </div>
                <span
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${meta.badge}`}
                >
                  <StatusIcon className="h-3.5 w-3.5" />
                  {meta.label}
                </span>
              </div>

              <p className="mt-4 flex-1 text-sm leading-relaxed text-muted-foreground">{tile.detail}</p>

              <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
                {last ? (
                  <>
                    Last activity <span className="font-semibold text-foreground" title={absoluteTime(tile.lastRunAt)}>{last}</span>
                  </>
                ) : (
                  "No activity recorded yet"
                )}
              </p>
            </div>
          );
        })}
      </section>

      {/* Event feed */}
      <section className="rounded-xl border border-border bg-card shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Activity className="h-4 w-4 text-primary" />
            Recent events
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
              {filteredEvents.length}
              {filtersActive ? ` of ${events.length}` : ""}
            </span>
          </h3>

          <div className="flex flex-wrap items-center gap-2">
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

            {filtersActive && (
              <button
                type="button"
                onClick={() => {
                  setSourceFilter("all");
                  setSeverityFilter("all");
                }}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Ban className="h-3.5 w-3.5" />
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Empty — nothing has ever been recorded. This is the good outcome, so
            it is worded as reassurance rather than as a missing-data error. */}
        {events.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <p className="text-sm font-semibold text-foreground">No events recorded</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Nothing on the server has reported a failure for this organization. Events appear here
              when a scheduled job, automation, webhook or sign-in attempt goes wrong.
            </p>
          </div>
        ) : filteredEvents.length === 0 ? (
          /* Empty — but only because of the filters. Different problem, different copy. */
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Bell className="h-6 w-6" />
            </div>
            <p className="text-sm font-semibold text-foreground">No events match these filters</p>
            <button
              type="button"
              onClick={() => {
                setSourceFilter("all");
                setSeverityFilter("all");
              }}
              className="text-sm font-semibold text-primary hover:underline"
            >
              Clear filters
            </button>
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
  );
}

function EventRow({ event }) {
  const meta = severityMeta(event.severity);
  const SeverityIcon = meta.icon;
  const context = event.context && typeof event.context === "object" ? event.context : {};
  const contextEntries = Object.entries(context).filter(([, v]) => v !== null && v !== "");

  return (
    <li className="flex gap-3 px-5 py-4 transition-colors hover:bg-muted/40">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${meta.dot}`} aria-hidden="true" />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${meta.badge}`}
          >
            <SeverityIcon className="h-3 w-3" />
            {meta.label}
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
            {SOURCE_LABELS[event.source] || event.source}
          </span>
          <code className="truncate font-mono text-xs text-muted-foreground">{event.event_type}</code>
        </div>

        {event.message && (
          <p className="mt-1.5 break-words text-sm text-foreground">{event.message}</p>
        )}

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
