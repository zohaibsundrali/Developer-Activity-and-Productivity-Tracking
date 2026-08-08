"use client";

// Shared presentational helpers for the Client Portal.
// Keeps the teal design system + rounded-card aesthetic consistent across
// every client component (spinner, empty state, error, status badge, etc.).

import {
  Loader2,
  Inbox,
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Megaphone,
  Flag,
  CheckSquare,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------- date helpers ----------

export function formatDate(dateString) {
  if (!dateString || dateString === "null" || dateString === "undefined") return "Not set";
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return "Not set";
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "Not set";
  }
}

export function formatDateTime(dateString) {
  if (!dateString || dateString === "null" || dateString === "undefined") return "Not set";
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return "Not set";
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Not set";
  }
}

export function deadlineLabel(dateString) {
  if (!dateString) return null;
  try {
    const deadline = new Date(dateString);
    const today = new Date();
    const diffDays = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));
    if (isNaN(diffDays)) return null;
    if (diffDays < 0) return "Overdue";
    if (diffDays === 0) return "Due today";
    if (diffDays === 1) return "1 day left";
    return `${diffDays} days left`;
  } catch {
    return null;
  }
}

// Ordered largest-first so the first unit that fits is the one a person would
// say out loud ("3 days ago", not "72 hours ago").
const RELATIVE_UNITS = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["week", 7 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

export function formatRelativeTime(dateString) {
  if (!dateString || dateString === "null" || dateString === "undefined") return "";
  const parsed = Date.parse(String(dateString));
  if (!Number.isFinite(parsed)) return "";

  const diff = Date.now() - parsed;
  // Clock skew between the browser and the server can put a just-created row a
  // few seconds in the future; "in 4 seconds" would read as a bug.
  if (diff < 60 * 1000) return "just now";

  for (const [unit, ms] of RELATIVE_UNITS) {
    if (diff >= ms) {
      const count = Math.floor(diff / ms);
      return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
    }
  }
  return "just now";
}

export function formatFileSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------- project health ----------

// The three values the contract derives server-side. Nothing else is mapped,
// so an unexpected value renders no badge rather than a misleading green one.
const HEALTH_META = {
  on_track: { label: "On track", icon: CheckCircle2, badge: "bg-success/10 text-success", barTone: "success" },
  at_risk: { label: "At risk", icon: AlertTriangle, badge: "bg-warning/10 text-warning", barTone: "warning" },
  overdue: { label: "Overdue", icon: CircleAlert, badge: "bg-destructive/10 text-destructive", barTone: "destructive" },
};

export function healthMeta(health) {
  return HEALTH_META[String(health || "").toLowerCase().trim()] || null;
}

export function HealthBadge({ health, className }) {
  const meta = healthMeta(health);
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold",
        meta.badge,
        className
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {meta.label}
    </span>
  );
}

// ---------- activity feed kinds ----------

// One icon and one tone per `kind` in the timeline contract. Shared with the
// overview's recent-activity list so the same event never changes appearance
// depending on which screen it lands on.
const KIND_META = {
  update: { label: "Update", icon: Megaphone, tone: "bg-info/10 text-info" },
  milestone: { label: "Milestone", icon: Flag, tone: "bg-success/10 text-success" },
  approval: { label: "Approval", icon: CheckSquare, tone: "bg-warning/10 text-warning" },
  comment: { label: "Comment", icon: MessageSquare, tone: "bg-primary/10 text-primary" },
  task_status: { label: "Task", icon: RefreshCw, tone: "bg-muted text-muted-foreground" },
};

const UNKNOWN_KIND = { label: "Activity", icon: Inbox, tone: "bg-muted text-muted-foreground" };

export function kindMeta(kind) {
  return KIND_META[String(kind || "").toLowerCase().trim()] || UNKNOWN_KIND;
}

// ---------- status badge ----------

const STATUS_STYLES = {
  active: "bg-green-100 text-green-800",
  in_progress: "bg-green-100 text-green-800",
  "in progress": "bg-green-100 text-green-800",
  ongoing: "bg-green-100 text-green-800",
  completed: "bg-info/10 text-info",
  done: "bg-info/10 text-info",
  approved: "bg-green-100 text-green-800",
  paid: "bg-green-100 text-green-800",
  resolved: "bg-info/10 text-info",
  pending: "bg-yellow-100 text-yellow-800",
  // Asking for a revision is neither an approval nor a rejection, so it gets
  // its own tone rather than borrowing the red one.
  changes_requested: "bg-warning/10 text-warning",
  assigned: "bg-yellow-100 text-yellow-800",
  awaiting: "bg-yellow-100 text-yellow-800",
  open: "bg-yellow-100 text-yellow-800",
  sent: "bg-info/10 text-info",
  issued: "bg-info/10 text-info",
  draft: "bg-muted text-foreground",
  rejected: "bg-red-100 text-red-800",
  declined: "bg-red-100 text-red-800",
  overdue: "bg-red-100 text-red-800",
  cancelled: "bg-muted text-foreground",
  closed: "bg-muted text-foreground",
};

export function humanize(value) {
  if (!value) return "";
  return String(value)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function StatusBadge({ status, className }) {
  const key = String(status || "").toLowerCase().trim();
  const style = STATUS_STYLES[key] || "bg-muted text-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap",
        style,
        className
      )}
    >
      {humanize(status) || "Unknown"}
    </span>
  );
}

// ---------- progress bar ----------

const BAR_TONES = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
};

export function ProgressBar({ value = 0, showLabel = true, tone = "primary", label = "Progress" }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div>
      {showLabel && (
        <div className="flex justify-between text-sm mb-1">
          <span className="text-foreground font-medium">{label}</span>
          <span className="font-bold text-primary">{pct}%</span>
        </div>
      )}
      <div
        className="w-full bg-muted rounded-full h-2"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn("h-2 rounded-full transition-all duration-500", BAR_TONES[tone] || BAR_TONES.primary)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ---------- loading / empty / error states ----------

export function Spinner({ label = "Loading…", className }) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-16 text-center", className)}>
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="mt-3 text-sm font-medium text-muted-foreground">{label}</p>
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title = "Nothing here yet", message, action }) {
  return (
    <div className="text-center py-16">
      <div className="inline-flex items-center justify-center w-20 h-20 bg-muted rounded-full mb-6">
        <Icon className="w-10 h-10 text-muted-foreground" />
      </div>
      <h3 className="text-xl font-semibold text-foreground mb-2">{title}</h3>
      {message && <p className="text-muted-foreground max-w-md mx-auto mb-6">{message}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message = "Something went wrong.", onRetry }) {
  return (
    <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-6">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-6 w-6 shrink-0 text-destructive" />
        <div>
          <h3 className="font-semibold text-destructive">Unable to load</h3>
          <p className="mt-1 text-sm text-destructive/90">{message}</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-4 rounded-lg bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Keyset paging control. The caller owns the cursor; this only reports intent
// and reflects the in-flight state so a slow page cannot be requested twice.
export function LoadMoreButton({ onClick, loading, label = "Load more" }) {
  return (
    <div className="flex justify-center pt-2">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="inline-flex items-center rounded-lg border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground shadow-card transition-colors hover:bg-muted disabled:opacity-60"
      >
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {loading ? "Loading…" : label}
      </button>
    </div>
  );
}

export function SectionHeader({ title, subtitle, right }) {
  return (
    <div className="mb-5 flex flex-col justify-between gap-3 md:flex-row md:items-center">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}
