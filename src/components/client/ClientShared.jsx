"use client";

// Shared presentational surface for the Client Portal.
//
// Everything visual that more than one client screen needs lives here, built on
// the shared UI kit (`@/components/ui`). Nothing in this file is a new
// primitive: each export is either a pure formatter, a token/tone lookup, or a
// composition of kit primitives tuned to the client portal's calmer scale.
//
// The client portal is deliberately quieter than the internal admin portal:
//   · one page-level heading, no toolbars, no filter rows
//   · body copy at `text-[15px] leading-relaxed`, meta at `text-sm` (admin: xs)
//   · card padding `p-6` (admin: p-4/p-5), block rhythm `space-y-8` (admin: 4/6)
//   · a constrained measure instead of the admin shell's full 1400px
//   · motion limited to `transition-colors` — no lift, no bounce
// Change those decisions here, once, rather than in the eleven screens.

import {
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
import {
  PageHeader,
  Badge,
  StatusPill,
  Skeleton,
  EmptyState as UiEmptyState,
  ErrorState as UiErrorState,
  Button,
} from "@/components/ui";
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

export function humanize(value) {
  if (!value) return "";
  return String(value)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------- page frame ----------

// One heading per screen, a constrained measure, and generous vertical rhythm.
// `width="wide"` is for the dashboard grid; everything a client reads rather
// than scans stays narrow enough to be comfortable.
const PAGE_WIDTHS = {
  default: "max-w-5xl",
  wide: "max-w-6xl",
};

export function ClientPage({ title, description, actions, width = "default", className, children }) {
  return (
    <div className={cn("w-full", PAGE_WIDTHS[width] || PAGE_WIDTHS.default, className)}>
      {title && (
        <PageHeader
          title={title}
          description={description}
          actions={actions}
          // The kit's pb-6 is the admin rhythm; the client portal breathes more.
          className="pb-8 [&_[data-slot=page-header-description]]:text-base"
        />
      )}
      <div className="space-y-8">{children}</div>
    </div>
  );
}

// The card recipe from the UI kit contract, at the client portal's roomier
// padding. Used for the repeated list rows (a comment, a milestone, a file)
// where a full Card/CardHeader/CardContent stack would only add nesting.
export const surface = "rounded-xl border border-border bg-card shadow-card";

export function Panel({ as: Tag = "div", className, children, ...props }) {
  return (
    <Tag className={cn(surface, "p-5 sm:p-6", className)} {...props}>
      {children}
    </Tag>
  );
}

// ---------- project health ----------

// The three values the contract derives server-side. Nothing else is mapped,
// so an unexpected value renders no badge rather than a misleading green one.
const HEALTH_META = {
  on_track: { label: "On track", icon: CheckCircle2, variant: "success", barTone: "success" },
  at_risk: { label: "At risk", icon: AlertTriangle, variant: "warning", barTone: "warning" },
  overdue: { label: "Overdue", icon: CircleAlert, variant: "destructive", barTone: "destructive" },
};

export function healthMeta(health) {
  return HEALTH_META[String(health || "").toLowerCase().trim()] || null;
}

export function HealthBadge({ health, className }) {
  const meta = healthMeta(health);
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <Badge variant={meta.variant} className={cn("gap-1.5", className)}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {meta.label}
    </Badge>
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

// ---------- status ----------

// Every free-form status the client routes can send, mapped onto the seven
// shapes StatusPill knows. Colour is never the only signal — StatusPill carries
// a shape as well, and the humanised word is always spelled out.
const STATUS_SHAPES = {
  active: "active",
  in_progress: "active",
  "in progress": "active",
  ongoing: "active",
  completed: "success",
  done: "success",
  approved: "success",
  paid: "success",
  resolved: "success",
  pending: "pending",
  // Asking for a revision is neither an approval nor a rejection, so it gets
  // its own tone rather than borrowing the red one.
  changes_requested: "warning",
  assigned: "pending",
  awaiting: "pending",
  open: "pending",
  sent: "pending",
  issued: "pending",
  draft: "inactive",
  rejected: "error",
  declined: "error",
  overdue: "error",
  cancelled: "inactive",
  closed: "inactive",
};

function statusShape(status) {
  return STATUS_SHAPES[String(status || "").toLowerCase().trim()] || "unknown";
}

export function StatusBadge({ status, className }) {
  return (
    <StatusPill
      status={statusShape(status)}
      label={humanize(status) || "Unknown"}
      className={cn("whitespace-nowrap", className)}
    />
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
        <div className="mb-2 flex items-baseline justify-between gap-3 text-sm">
          <span className="font-medium text-muted-foreground">{label}</span>
          <span className="text-base font-semibold tabular-nums text-foreground">{pct}%</span>
        </div>
      )}
      <div
        className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={cn("h-full rounded-full transition-all duration-500 motion-reduce:transition-none", BAR_TONES[tone] || BAR_TONES.primary)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ---------- empty / error ----------

// Thin adapters over the kit so all eleven screens keep calling with `message`,
// and so the client portal's roomier empty states are tuned in one place.
export function EmptyState({ icon = Inbox, title = "Nothing here yet", message, action }) {
  return (
    <UiEmptyState
      icon={icon}
      title={title}
      description={message}
      action={action}
      // Roomier, and one step up the type scale: a client meeting an empty
      // screen should get a sentence they can read, not a caption.
      className="gap-4 py-16 [&_p]:text-base"
    />
  );
}

export function ErrorState({ message = "Something went wrong.", onRetry }) {
  return (
    <UiErrorState
      title="We couldn't load this"
      description={message}
      onRetry={onRetry}
      className="gap-4 py-12 [&_p]:text-base"
    />
  );
}

// Keyset paging control. The caller owns the cursor; this only reports intent
// and reflects the in-flight state so a slow page cannot be requested twice.
export function LoadMoreButton({ onClick, loading, label = "Load more" }) {
  return (
    <div className="flex justify-center pt-2">
      <Button type="button" variant="outline" size="lg" onClick={onClick} disabled={loading}>
        {loading ? "Loading…" : label}
      </Button>
    </div>
  );
}

// ---------- loading skeletons ----------
//
// Every async surface in the portal loads into a shape that matches what will
// arrive, so nothing jumps when the data lands. A spinner on a blank panel is
// not a loading state here.

export function CardsSkeleton({ count = 6, className }) {
  return (
    <div className={cn("grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3", className)} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={cn(surface, "space-y-4 p-6")}>
          <div className="flex items-start justify-between gap-3">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-2.5 w-full rounded-full" />
          <div className="flex items-center justify-between gap-3 pt-2">
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function RowsSkeleton({ count = 4, className }) {
  return (
    <div className={cn("space-y-4", className)} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={cn(surface, "space-y-3 p-6")}>
          <div className="flex items-start justify-between gap-4">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      ))}
    </div>
  );
}

export function TimelineSkeleton({ count = 4 }) {
  return (
    <div className="relative space-y-5 border-l border-border pl-6" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="relative">
          <Skeleton className="absolute -left-[34px] top-4 h-6 w-6 rounded-full" />
          <div className={cn(surface, "space-y-3 p-6")}>
            <div className="flex items-start justify-between gap-4">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className="h-4 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ConversationSkeleton({ count = 3 }) {
  return (
    <div className="space-y-5" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={cn(surface, "p-6")}>
          <div className="flex items-start gap-4">
            <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-3">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function TilesSkeleton({ count = 4, className }) {
  return (
    <div className={cn("grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4", className)} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={cn(surface, "space-y-4 p-6")}>
          <Skeleton className="h-11 w-11 rounded-xl" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-4 w-28" />
        </div>
      ))}
    </div>
  );
}

// A hero + body pair: what both detail screens (project, task) load into.
export function DetailSkeleton() {
  return (
    <div className="space-y-8" aria-hidden="true">
      <Skeleton className="h-10 w-40 rounded-lg" />
      <div className={cn(surface, "overflow-hidden")}>
        <div className="space-y-4 bg-muted p-6 sm:p-8">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="space-y-6 p-6">
          <Skeleton className="h-24 w-full rounded-xl" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    </div>
  );
}
