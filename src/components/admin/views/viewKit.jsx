"use client";

/**
 * Shared presentation kit for the project-management surface.
 *
 * The six views (kanban, list, table, calendar, timeline, workload) plus the
 * standalone Project Board and Sprint Board used to hand-roll their own cards,
 * chips, column headers and empty states, which is why they read as six
 * different products. Everything visual that they have in common lives here so
 * there is exactly one definition of "a task card", "a board column",
 * "the row above a view" and "this view has nothing in it".
 *
 * This module is presentation only: it never fetches, never mutates and never
 * decides anything. Drag handlers, drop rules and permission checks stay in the
 * callers and are passed straight through.
 */

import { useState } from "react";
import { CalendarDays, GripVertical, Inbox } from "lucide-react";
import {
  Badge,
  EmptyState,
  ScrollStrip,
  Skeleton,
  SkeletonCard,
  SkeletonTable,
  StatusPill,
} from "@/components/ui";
import { STATUS_META, normalizeStatus } from "@/utils/pmData";

/* -------------------------------------------------------------------------- */
/*  Tone maps                                                                  */
/* -------------------------------------------------------------------------- */

// Board status -> the StatusPill vocabulary from the UI contract. A pill
// carries a glyph shape as well as a colour, so status never reads as colour
// alone. Mapped per status rather than per tone so each one lands on the glyph
// that actually describes it: To Do is a hollow ring, In Review is a clock
// (something is waiting on a person), Done is a tick, Rejected is a cross.
const STATUS_PILL_STATUS = {
  pending: "inactive",
  in_progress: "active",
  awaiting_approval: "pending",
  completed: "success",
  rejected: "error",
};

// STATUS_META.tone -> the dot beside a board column heading.
export const TONE_DOT_CLASS = {
  muted: "bg-muted-foreground",
  info: "bg-info",
  warning: "bg-warning",
  success: "bg-success",
  destructive: "bg-destructive",
};

const PRIORITY_VARIANT = {
  low: "outline",
  medium: "info",
  high: "warning",
  urgent: "destructive",
};

/* -------------------------------------------------------------------------- */
/*  Formatting helpers                                                         */
/* -------------------------------------------------------------------------- */

/** A short, stable reference for a task row (uuid tail), e.g. "#4F2A9C". */
export function taskRef(task) {
  const raw = task?.id;
  if (raw == null || raw === "") return "";
  const flat = String(raw).replace(/-/g, "");
  return `#${flat.slice(-6).toUpperCase()}`;
}

/** Labels may arrive as an array, a comma string, or under `tags`. */
export function taskLabels(task) {
  const raw = task?.labels ?? task?.tags;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean).map(String);
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export function formatDue(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Presentational urgency of a due date: overdue reads destructive, the next 48h
 * reads as a warning, everything else is quiet. Never used to decide anything.
 */
export function dueTone(value) {
  if (!value) return "muted";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "muted";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((day - startOfToday) / 86400000);
  if (diffDays < 0) return "overdue";
  if (diffDays <= 1) return "soon";
  return "muted";
}

const DUE_TONE_CLASS = {
  overdue: "text-destructive",
  soon: "text-warning",
  muted: "text-muted-foreground",
};

/** Deterministic initials for an avatar. */
function initialsOf(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* -------------------------------------------------------------------------- */
/*  Atoms                                                                      */
/* -------------------------------------------------------------------------- */

export function Avatar({ name, size = "sm", className = "" }) {
  const dim = size === "md" ? "h-7 w-7 text-[11px]" : "h-6 w-6 text-[10px]";
  const known = Boolean(String(name || "").trim());
  return (
    <span
      title={known ? name : "Unassigned"}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${dim} ${
        known ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
      } ${className}`}
    >
      <span aria-hidden="true">{known ? initialsOf(name) : "–"}</span>
      <span className="sr-only">{known ? name : "Unassigned"}</span>
    </span>
  );
}

export function TaskStatusPill({ status, className = "" }) {
  const key = normalizeStatus(status);
  const meta = STATUS_META[key] || STATUS_META.pending;
  return (
    <StatusPill
      status={STATUS_PILL_STATUS[key] || "unknown"}
      label={meta.label}
      className={className}
    />
  );
}

export function PriorityBadge({ priority, size = "sm" }) {
  const p = String(priority || "medium").toLowerCase();
  return (
    <Badge variant={PRIORITY_VARIANT[p] || "info"} size={size} className="capitalize">
      {p}
    </Badge>
  );
}

export function TypeBadge({ type, size = "sm" }) {
  if (!type) return null;
  return (
    <Badge variant="outline" size={size} className="capitalize">
      {String(type).replace(/_/g, " ")}
    </Badge>
  );
}

export function PointsBadge({ points, size = "sm" }) {
  if (points == null || points === "") return null;
  return (
    <Badge variant="secondary" size={size} className="tabular-nums" title="Story points">
      {points} pt
    </Badge>
  );
}

export function DueDate({ value, className = "" }) {
  const label = formatDue(value);
  if (!label) return null;
  const tone = dueTone(value);
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium tabular-nums ${DUE_TONE_CLASS[tone]} ${className}`}
      title={tone === "overdue" ? `Overdue — due ${label}` : `Due ${label}`}
    >
      <CalendarDays className="h-3 w-3" aria-hidden="true" />
      {label}
      {tone === "overdue" ? <span className="sr-only">(overdue)</span> : null}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Task card — one definition, used by every board on this surface            */
/* -------------------------------------------------------------------------- */

/**
 * Stable visual order, top to bottom:
 *   1. reference + priority
 *   2. title
 *   3. labels
 *   4. assignee avatar | due date + points
 */
export function TaskCard({
  task,
  assigneeName,
  onOpen,
  onDragStart,
  onDragEnd,
  draggable = true,
  showStatus = false,
}) {
  const labels = taskLabels(task);
  const due = task?.due_date || task?.end_date;
  const ref = taskRef(task);
  const interactive = typeof onOpen === "function";
  const open = () => interactive && onOpen(task);

  return (
    <article
      draggable={draggable}
      onDragStart={draggable && onDragStart ? (e) => onDragStart(e, task) : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      onClick={interactive ? open : undefined}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                open();
              }
            }
          : undefined
      }
      className={`group relative rounded-lg border border-border bg-card p-3 shadow-card transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
        interactive ? "hover:border-primary/40 hover:bg-accent/40" : ""
      } ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      {draggable ? (
        <GripVertical
          className="pointer-events-none absolute right-1.5 top-3 h-4 w-4 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          aria-hidden="true"
        />
      ) : null}

      {/* 1. reference + priority */}
      <div className="flex items-center gap-2 pr-5">
        {ref ? (
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            {ref}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-1.5">
          {showStatus ? <TaskStatusPill status={task?.status} /> : null}
          <PriorityBadge priority={task?.priority} />
        </span>
      </div>

      {/* 2. title */}
      <p className="mt-1.5 line-clamp-2 text-sm font-medium leading-snug text-foreground">
        {task?.task_title || "Untitled task"}
      </p>

      {/* 3. labels */}
      {labels.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {labels.slice(0, 2).map((label) => (
            <Badge key={label} variant="outline" size="sm">
              {label}
            </Badge>
          ))}
          {labels.length > 2 ? (
            <span className="text-[10px] font-medium text-muted-foreground">
              +{labels.length - 2}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* 4. assignee | due + points */}
      <div className="mt-3 flex items-center gap-2 border-t border-border pt-2.5">
        <Avatar name={assigneeName} />
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
          {assigneeName || "Unassigned"}
        </span>
        <DueDate value={due} />
        <PointsBadge points={task?.story_points} />
      </div>
    </article>
  );
}

export function TaskCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-card">
      <div className="flex items-center gap-2">
        <Skeleton className="h-3 w-14" />
        <Skeleton className="ml-auto h-4 w-14 rounded-full" />
      </div>
      <Skeleton className="mt-2 h-4 w-full" />
      <Skeleton className="mt-1.5 h-4 w-2/3" />
      <div className="mt-3 flex items-center gap-2 border-t border-border pt-2.5">
        <Skeleton className="h-6 w-6 rounded-full" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="ml-auto h-3 w-12" />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Board                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The board chrome shared by ProjectBoard, SprintBoard and the Kanban view.
 *
 * Each entry of `columns` is
 *   { id, label, count, tone, isOver, reviewOnly, dropProps, children, footer }
 * where `dropProps` are the caller's own drag handlers, passed through
 * untouched — this component decides nothing about what a drop does.
 *
 * Mobile behaviour is one column at a time behind a column switcher rather than
 * a horizontally overflowing row: a five-column board at 375px is otherwise
 * either unreadable (five 80px columns) or a horizontal scroller that fights
 * the page for every vertical swipe, and dragging a card between two columns
 * you cannot see at once does not work on touch at all. The switcher keeps the
 * per-column counts — the thing people actually read a board for — visible.
 *
 * On >= sm the columns become a single horizontal scroller. There is
 * deliberately no nested vertical scroller inside a column: that pairing is
 * what made trackpad scrolling on the old board swallow the page's vertical
 * gesture. Columns grow, the page scrolls.
 */
export function Board({ columns = [], ariaLabel = "Board" }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const safeIndex = Math.min(activeIndex, Math.max(0, columns.length - 1));

  return (
    <div className="space-y-3">
      {/* Mobile column switcher. Five chips do not fit in 375px, so the row
          scrolls inside a ScrollStrip: the edge fade is the only thing on
          screen saying the columns past the right edge exist at all. */}
      <ScrollStrip className="-mx-1 sm:hidden" viewportClassName="px-1 pb-1" fadeFrom="from-background">
        <div
          role="tablist"
          aria-label={`${ariaLabel} columns`}
          className="flex w-max items-center gap-1 rounded-lg border border-border bg-card p-1"
        >
          {columns.map((col, i) => {
            const active = i === safeIndex;
            return (
              <button
                key={col.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveIndex(i)}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {col.label}
                <span
                  className={`rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${
                    active ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {col.count}
                </span>
              </button>
            );
          })}
        </div>
      </ScrollStrip>

      <div className="flex gap-4 overflow-x-auto overscroll-x-contain pb-2">
        {columns.map((col, i) => (
          <div
            key={col.id}
            className={`${i === safeIndex ? "flex" : "hidden"} w-full shrink-0 sm:flex sm:w-80`}
          >
            <BoardColumn {...col} />
          </div>
        ))}
      </div>
    </div>
  );
}

function BoardColumn({
  label,
  count = 0,
  tone = "muted",
  isOver = false,
  reviewOnly = false,
  dropProps,
  children,
  footer,
}) {
  return (
    <section
      {...(dropProps || {})}
      aria-label={`${label} — ${count} task${count === 1 ? "" : "s"}`}
      className={`flex w-full flex-col rounded-xl border p-3 transition-colors duration-150 ${
        isOver
          ? "border-primary bg-primary/5 ring-2 ring-primary/30"
          : "border-border bg-muted/30"
      }`}
    >
      <header className="mb-3 flex items-center gap-2">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT_CLASS[tone] || TONE_DOT_CLASS.muted}`}
          aria-hidden="true"
        />
        <h3 className="truncate text-xs font-semibold uppercase tracking-wide text-foreground">
          {label}
        </h3>
        <Badge variant="secondary" size="sm" className="ml-auto tabular-nums">
          {count}
        </Badge>
      </header>

      {reviewOnly ? (
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Set in Task Reviews
        </p>
      ) : null}

      <div className="flex flex-1 flex-col gap-2">
        {children}

        {isOver ? (
          <p className="rounded-lg border-2 border-dashed border-primary bg-primary/10 py-6 text-center text-xs font-semibold text-primary">
            Drop here
          </p>
        ) : null}

        {count === 0 && !isOver ? (
          <p className="rounded-lg border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
            No tasks
          </p>
        ) : null}
      </div>

      {footer ? <div className="mt-2">{footer}</div> : null}
    </section>
  );
}

export function BoardSkeleton({ columns = 5 }) {
  return (
    <div className="flex gap-4 overflow-hidden pb-2">
      {Array.from({ length: columns }).map((_, i) => (
        <div
          key={i}
          className={`w-full shrink-0 rounded-xl border border-border bg-muted/30 p-3 sm:w-80 ${
            i === 0 ? "" : "hidden sm:block"
          }`}
        >
          <div className="mb-3 flex items-center gap-2">
            <Skeleton className="h-2 w-2 rounded-full" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="ml-auto h-4 w-6 rounded-full" />
          </div>
          <div className="flex flex-col gap-2">
            <TaskCardSkeleton />
            <TaskCardSkeleton />
          </div>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  View chrome — the frame every one of the five views sits in                */
/* -------------------------------------------------------------------------- */

/**
 * The row directly above a view's content. Every view uses this, so the
 * secondary controls (group-by, month navigation, a plain caption) all land at
 * the same height, in the same place, in the same type.
 */
export function ViewToolbar({ icon: Icon, title, description, children, className = "" }) {
  return (
    <div
      className={`flex min-h-[3.25rem] flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card px-4 py-2.5 shadow-card ${className}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        {Icon ? <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
        <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
        {description ? (
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">
            {description}
          </span>
        ) : null}
      </div>
      {children ? (
        <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
      ) : null}
    </div>
  );
}

/** The single empty state for the whole view surface. */
export function ViewEmpty({
  icon = Inbox,
  title = "No tasks match this view",
  description = "Adjust the filters above, or create a task to see it here.",
  action,
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-card">
      <EmptyState icon={icon} title={title} description={description} action={action} />
    </div>
  );
}

/** A card-framed block used by the calendar, timeline and workload views. */
export function ViewPanel({ children, className = "" }) {
  return (
    <div className={`rounded-xl border border-border bg-card p-4 shadow-card sm:p-5 ${className}`}>
      {children}
    </div>
  );
}

/**
 * The one native-select style on this surface. The UI kit has no Select
 * primitive, so rather than eleven hand-tuned `<select>`s this is the single
 * definition every filter and group-by control on the board uses.
 */
// h-8 matches the kit's Input and default Button, so a filter row lines up.
export const SELECT_CLASS =
  "h-8 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60";

/** Shared row height for every list-like view. */
export const VIEW_ROW_CLASS =
  "flex h-12 items-center gap-3 px-4 transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/**
 * Loading state per view, shaped like the content it replaces. Nothing on this
 * surface renders `null` while it loads.
 */
export function ViewSkeleton({ viewType = "kanban" }) {
  if (viewType === "kanban") return <BoardSkeleton />;

  if (viewType === "table") {
    return (
      <div className="rounded-xl border border-border bg-card shadow-card">
        <SkeletonTable rows={8} cols={6} />
      </div>
    );
  }

  if (viewType === "list") {
    return (
      <div className="space-y-4">
        {[0, 1].map((g) => (
          <div key={g} className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
            <div className="flex h-12 items-center gap-2 border-b border-border px-4">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="ml-auto h-4 w-6 rounded-full" />
            </div>
            {[0, 1, 2].map((r) => (
              <div key={r} className="flex h-12 items-center gap-3 border-b border-border px-4 last:border-0">
                <Skeleton className="h-2 w-2 rounded-full" />
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="ml-auto h-6 w-6 rounded-full" />
                <Skeleton className="h-3 w-14" />
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (viewType === "calendar") {
    return (
      <ViewPanel>
        <div className="mb-3 flex items-center gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="ml-auto h-8 w-40" />
        </div>
        <div className="grid grid-cols-7 gap-px">
          {Array.from({ length: 35 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-none" />
          ))}
        </div>
      </ViewPanel>
    );
  }

  if (viewType === "workload") {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <ViewPanel>
          <Skeleton className="mb-3 h-4 w-40" />
          <Skeleton className="h-64 w-full" />
        </ViewPanel>
      </div>
    );
  }

  // timeline (and any future chart-shaped view)
  return (
    <ViewPanel>
      <Skeleton className="mb-4 h-4 w-32" />
      <div className="space-y-3">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-3 w-32 shrink-0" />
            <Skeleton
              className="h-4 rounded-full"
              style={{ width: `${30 + ((i * 17) % 55)}%`, marginLeft: `${(i * 11) % 30}%` }}
            />
          </div>
        ))}
      </div>
    </ViewPanel>
  );
}
