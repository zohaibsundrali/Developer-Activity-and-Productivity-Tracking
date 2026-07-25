"use client";

// Shared presentational helpers for the Client Portal.
// Keeps the teal design system + rounded-card aesthetic consistent across
// every client component (spinner, empty state, error, status badge, etc.).

import { Loader2, Inbox, AlertTriangle } from "lucide-react";
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

export function ProgressBar({ value = 0, showLabel = true }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div>
      {showLabel && (
        <div className="flex justify-between text-sm mb-1">
          <span className="text-foreground font-medium">Progress</span>
          <span className="font-bold text-primary">{pct}%</span>
        </div>
      )}
      <div className="w-full bg-muted rounded-full h-2">
        <div
          className="bg-primary h-2 rounded-full transition-all duration-500"
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
