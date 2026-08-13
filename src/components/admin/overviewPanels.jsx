"use client";

import Link from "next/link";
import { ArrowRight, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { StatusPill } from "@/components/ui";

/**
 * The pieces every Overview panel is built from.
 *
 * ONE RULE RUNS THROUGH ALL OF THEM: every panel is a DOOR. A dashboard number
 * that cannot be opened is a number you have to go and find somewhere else, and
 * the screen that owns it is always better at explaining it. So each panel
 * carries a link to the section that owns its subject, and each row that stands
 * for one thing links to that thing.
 *
 * WHICH IS WHY LINKS ARE ROLE-FILTERED. `overview` is visible to every
 * admin-dashboard user — including HR, who cannot open All Projects, Board or
 * Reports (see ADMIN_SECTION_ROLES). An unconditional "View all" would hand HR
 * a link that bounces them, which reads as the product being broken rather than
 * as a permission. `PanelLink` renders nothing when the viewer cannot follow it;
 * the panel itself still shows, because seeing the count is not the same
 * permission as opening the screen.
 */

/**
 * A panel heading with an optional link to the section that owns the subject.
 *
 * @param {string} props.title
 * @param {string} [props.hint]      one line under the title
 * @param {string} [props.href]      where "View all" goes
 * @param {boolean} [props.canOpen]  false hides the link, keeps the panel
 */
export function PanelHead({ title, hint, href, canOpen = true, action, children }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h3 className="text-base font-semibold tracking-[-0.01em] text-foreground">{title}</h3>
        {hint && <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>}
      </div>
      {action}
      {href && canOpen ? (
        <Link
          href={href}
          className="group inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold text-primary transition-colors duration-200 motion-reduce:transition-none hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {children || "View all"}
          <ArrowRight
            className="h-4 w-4 transition-transform duration-200 ease-out motion-safe:group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </Link>
      ) : null}
    </div>
  );
}

/** The card every panel sits in. One definition, so they cannot drift apart. */
export function Panel({ className, children, ...rest }) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-card p-4 shadow-card sm:p-5",
        className
      )}
      {...rest}
    >
      {children}
    </section>
  );
}

/**
 * A progress bar that prints the number it is drawn to, beside it.
 *
 * The two cannot drift apart: `width` is computed once and is both the style
 * and the printed figure. A bar scaled to one thing beside a label claiming
 * another is a defect this codebase has already shipped and fixed once — see
 * tests/progressBarWidths.test.js.
 *
 * `aria-valuenow` is the PERCENTAGE, not a raw count against a max of 100.
 * Announcing "4 out of 100" for a bar drawn at 40% is the same bug wearing a
 * screen reader.
 */
export function Meter({ value, label, className }) {
  const width = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <span className={cn("flex items-center gap-3", className)}>
      <span
        className="block h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={label}
        aria-valuenow={width}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${width}%`}
      >
        <span
          className={cn(
            "block h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none",
            // Colour is a second reading of the same number, never the only
            // one — the figure to the right is what the row is actually read
            // from.
            width >= 70 ? "bg-success" : width >= 30 ? "bg-primary" : "bg-warning"
          )}
          style={{ width: `${width}%` }}
        />
      </span>
      <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums text-muted-foreground">
        {width}%
      </span>
    </span>
  );
}

/**
 * Priority, as a word rather than a colour.
 *
 * `priority` is free text on `projects` — it has no CHECK constraint — so an
 * unrecognised value is PRINTED rather than dropped. Silently hiding a priority
 * nobody thought of is how a row loses the only field that said it was urgent.
 */
const PRIORITY_TONES = {
  urgent: "bg-destructive/10 text-destructive ring-destructive/20",
  critical: "bg-destructive/10 text-destructive ring-destructive/20",
  high: "bg-warning/10 text-warning ring-warning/20",
  medium: "bg-info/10 text-info ring-info/20",
  normal: "bg-info/10 text-info ring-info/20",
  low: "bg-muted text-muted-foreground ring-border",
};

export function PriorityChip({ value }) {
  if (!value) return null;
  const key = String(value).toLowerCase();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset",
        PRIORITY_TONES[key] || "bg-muted text-muted-foreground ring-border"
      )}
    >
      {String(value).replace(/_/g, " ")}
    </span>
  );
}

/**
 * Why a row is at risk, spelled out.
 *
 * Not a red dot. A red dot says "something", and the reader has to open the
 * project to find out what — which is the trip this dashboard exists to save.
 */
export function RiskChip({ reasons }) {
  if (!reasons?.length) return null;
  const text = reasons.join(" · ");
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive ring-1 ring-inset ring-destructive/20"
      title={text}
    >
      <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{text}</span>
    </span>
  );
}

/** Initials for an avatar chip. Falls back to a dash rather than to "??". */
export function initialsOf(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** A person, small: initials, name, and their role underneath if there is room. */
export function PersonChip({ person, sublabel, className }) {
  if (!person) {
    return (
      <span className={cn("text-sm italic text-muted-foreground", className)}>
        No manager
      </span>
    );
  }
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <span
        aria-hidden="true"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5 text-[11px] font-semibold text-primary"
      >
        {initialsOf(person.name)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-foreground">{person.name}</span>
        {sublabel && (
          <span className="block truncate text-xs capitalize text-muted-foreground">
            {String(sublabel).replace(/_/g, " ")}
          </span>
        )}
      </span>
    </span>
  );
}

/** A project's status, through the shared vocabulary rather than a local map. */
export function ProjectStatus({ meta }) {
  if (!meta) return <StatusPill status="unknown" label="Unknown" size="sm" />;
  return <StatusPill status={meta.tone} label={meta.label} size="sm" />;
}

/**
 * A count with a word under it, used in the small bucket rows.
 *
 * A zero is SHOWN here, unlike in the distribution strips — "no overdue tasks"
 * is the answer the reader came for, and dropping the tile would leave them
 * unsure whether it was zero or unmeasured.
 */
export function BucketTile({ label, value, tone = "muted", href, canOpen = true }) {
  const tones = {
    muted: "bg-muted text-muted-foreground",
    primary: "bg-primary/10 text-primary",
    info: "bg-info/10 text-info",
    warning: "bg-warning/10 text-warning",
    error: "bg-destructive/10 text-destructive",
    success: "bg-success/10 text-success",
  };
  const body = (
    <>
      <span className="block text-2xl font-bold tabular-nums leading-none">{value}</span>
      <span className="mt-1.5 block text-xs font-medium">{label}</span>
    </>
  );
  const shell = cn(
    "block rounded-lg px-3 py-3 text-center transition-colors duration-200 motion-reduce:transition-none",
    tones[tone] || tones.muted
  );

  if (href && canOpen) {
    return (
      <Link
        href={href}
        className={cn(
          shell,
          "hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        )}
      >
        {body}
      </Link>
    );
  }
  return <span className={shell}>{body}</span>;
}

/** Relative time, short. "3d" beats a timestamp in a feed. */
export function ago(value) {
  const t = Date.parse(value || "");
  if (!Number.isFinite(t)) return "";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(t).toLocaleDateString();
}

/** A deadline, with the urgency said in words rather than implied by colour. */
export function Deadline({ date, daysLeft }) {
  if (!date) return <span className="text-sm text-muted-foreground">No deadline</span>;
  const when = new Date(date).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  if (daysLeft == null) return <span className="text-sm text-foreground">{when}</span>;

  const late = daysLeft < 0;
  const soon = daysLeft >= 0 && daysLeft <= 7;
  return (
    <span className="whitespace-nowrap text-sm">
      <span className="text-foreground">{when}</span>
      <span
        className={cn(
          "ml-1.5 text-xs font-semibold",
          late ? "text-destructive" : soon ? "text-warning" : "text-muted-foreground"
        )}
      >
        {late
          ? `${Math.abs(daysLeft)}d late`
          : daysLeft === 0
            ? "today"
            : `${daysLeft}d left`}
      </span>
    </span>
  );
}
