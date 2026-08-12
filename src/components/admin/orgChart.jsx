"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { roleIcon, roleLabel, roleVariant } from "@/components/shared/roleMeta";
import { Badge } from "@/components/ui";

/**
 * The pieces an org chart is drawn from: nodes, and the lines between them.
 *
 * WHY THE LINES ARE CSS AND NOT AN SVG OR A LIBRARY
 *
 * An SVG chart has to measure the DOM to know where to draw, which means it is
 * wrong on the first paint, wrong again when a font loads, and wrong on every
 * resize until an observer fires. A chart drawn with borders is laid out by the
 * same engine that lays out the boxes, so a line cannot end up somewhere the
 * box is not. It also reflows, prints and zooms without any of that machinery.
 *
 * THE GEOMETRY — rounded elbows, not square rails
 *
 *      parent
 *        │
 *   ╭────┴────╮        the outer children turn the corner
 *   │         │
 *   A         B
 *
 * Each outer child draws ONE element carrying both halves of its elbow: a top
 * border running back toward the centre and a side border running down to the
 * node, with the corner rounded. Two borders on one box cannot fall out of
 * alignment with each other, which is what a separately positioned rail and
 * stub eventually do at fractional zoom levels.
 *
 * Middle children get a straight crossbar plus a centre drop — a T-junction has
 * no corner to round.
 *
 * A LONE CHILD GETS NO CROSSBAR, only a straight drop. A horizontal line to
 * nowhere is the single thing that makes a hand-made tree look broken.
 */

const LINE = "border-border";

/** The vertical line joining one level to the next. */
export function Trunk({ className = "" }) {
  return (
    <span aria-hidden="true" className={`mx-auto block h-8 w-px bg-border ${className}`} />
  );
}

/** A row of children, joined to their parent by one set of elbows. */
export function Branches({ children, className = "" }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : [children];
  const only = items.length === 1;
  const last = items.length - 1;

  return (
    <div className={`flex items-stretch justify-center ${className}`}>
      {items.map((child, i) => (
        <div key={child?.key ?? i} className="relative flex flex-col items-center px-2 pt-10 sm:px-3">
          {only ? (
            // Straight drop. No corner, no crossbar.
            <span aria-hidden="true" className="absolute left-1/2 top-0 h-10 w-px -translate-x-1/2 bg-border" />
          ) : i === 0 ? (
            // First: crossbar to the right, corner turning down at my centre.
            <span
              aria-hidden="true"
              className={`absolute left-1/2 right-0 top-0 h-10 rounded-tl-xl border-l border-t ${LINE}`}
            />
          ) : i === last ? (
            // Last: crossbar to the left, corner turning down at my centre.
            <span
              aria-hidden="true"
              className={`absolute left-0 right-1/2 top-0 h-10 rounded-tr-xl border-r border-t ${LINE}`}
            />
          ) : (
            <>
              <span aria-hidden="true" className={`absolute left-0 right-0 top-0 border-t ${LINE}`} />
              <span aria-hidden="true" className="absolute left-1/2 top-0 h-10 w-px -translate-x-1/2 bg-border" />
            </>
          )}
          {child}
        </div>
      ))}
    </div>
  );
}

/** Initials, for somebody with no photo. */
function initialsOf(name, email) {
  const src = String(name || email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase() || "?";
}

export function Avatar({ person, size = "md", ring = "ring-card" }) {
  const box =
    size === "lg" ? "h-12 w-12 text-sm" : size === "sm" ? "h-7 w-7 text-[10px]" : "h-9 w-9 text-xs";
  return (
    <span
      aria-hidden="true"
      className={`${box} flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5 font-semibold tracking-tight text-primary ring-2 ${ring}`}
    >
      {initialsOf(person?.name, person?.email)}
    </span>
  );
}

// One shared shell so a manager, a lead and a role branch are recognisably the
// same family of object. Only the accent changes between them — three
// different card designs at three levels is what makes a chart look assembled
// rather than designed.
const NODE_SHELL =
  "group relative w-44 rounded-xl border bg-card shadow-card transition-all duration-200 ease-out motion-reduce:transition-none hover:-translate-y-0.5 hover:shadow-elevated sm:w-52";

const ACCENTS = {
  // The manager carries the only primary accent in the chart, because they are
  // the one node whose position IS the information.
  manager: "border-primary/40 ring-1 ring-primary/15",
  lead: "border-border ring-1 ring-border",
  plain: "border-border",
};

/**
 * One person, as a node.
 *
 * `tone` decides the accent only. The shell, spacing and type are identical at
 * every level so the eye reads position — not styling — as the hierarchy.
 */
export function PersonNode({ person, tone = "plain", caption = null, meta = null }) {
  const Icon = roleIcon(person.role);

  return (
    <div className={`${NODE_SHELL} ${ACCENTS[tone] || ACCENTS.plain}`}>
      {/* A hairline of accent along the top edge, which reads at a glance
          without tinting the whole card. */}
      {tone === "manager" && (
        <span
          aria-hidden="true"
          className="absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent"
        />
      )}

      <div className="flex flex-col items-center gap-2 px-3 py-4 text-center">
        <Avatar person={person} size={tone === "manager" ? "lg" : "md"} />

        <div className="min-w-0 w-full">
          {caption && (
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {caption}
            </p>
          )}
          <p className="truncate text-sm font-semibold leading-tight tracking-tight text-foreground" title={person.name}>
            {person.name}
          </p>
          <p className="mt-1.5">
            <Badge variant={roleVariant(person.role)} size="sm">
              <Icon className="h-3 w-3" aria-hidden="true" />
              {roleLabel(person.role)}
            </Badge>
          </p>
          {meta && <p className="mt-1.5 truncate text-xs text-muted-foreground">{meta}</p>}
        </div>
      </div>
    </div>
  );
}

/**
 * The node that stands in for a manager who does not exist.
 *
 * A gap in the chart would read as "still loading". This says what is wrong,
 * and is styled as a warning because an unmanaged project is the thing this
 * screen exists to surface.
 */
export function EmptyManagerNode() {
  return (
    <div className="w-44 rounded-xl border border-dashed border-warning/50 bg-warning/5 px-3 py-4 text-center sm:w-52">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        Project manager
      </p>
      <p className="mt-1 text-sm font-semibold text-foreground">Not assigned</p>
      <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
        Set one in Project Hub so approvals have somewhere to go.
      </p>
    </div>
  );
}

/**
 * The project, at the root of its own chart.
 *
 * Wider and quieter than the people below it: it is the thing they all belong
 * to, so it earns width rather than colour. Progress lives here because
 * progress is a property of the work, never of who is doing it.
 */
export function ProjectNode({ project, status, health, expanded, onToggle, panelId, ChevronIcon, facts }) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(health.progress) || 0)));

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls={panelId}
      className="group w-full max-w-2xl rounded-2xl border border-border bg-card p-5 text-left shadow-card transition-all duration-200 ease-out motion-reduce:transition-none hover:-translate-y-0.5 hover:shadow-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:p-6"
    >
      <span className="flex items-start gap-3">
        <ChevronIcon
          className={`mt-0.5 h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none ${
            expanded ? "rotate-90" : ""
          }`}
          aria-hidden="true"
        />

        <span className="min-w-0 flex-1 space-y-4">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="truncate text-lg font-semibold leading-tight tracking-tight text-foreground">
              {project.name || "Untitled project"}
            </span>
            {status}
          </span>

          {/* The facts, on one quiet line. Deliberately below the name and
              above the bar: they qualify the project, the bar answers it. */}
          <span className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            {facts}
          </span>

          {/* The number is beside the bar, always. A bar alone is a shape
              somebody has to estimate, and "roughly three quarters" is not
              what anybody wants to report upward. */}
          <span className="flex items-center gap-3 pt-0.5">
            <span
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${project.name || "Project"} progress`}
              className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
            >
              <span
                className="block h-full rounded-full bg-gradient-to-r from-primary/70 to-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="w-12 shrink-0 text-right text-base font-semibold tabular-nums tracking-tight text-foreground">
              {pct}%
            </span>
          </span>
        </span>
      </span>
    </button>
  );
}

/**
 * One role's people, as a branch.
 *
 * The header is the node the elbow attaches to; the people hang inside it. That
 * keeps a team of twelve from making the chart twelve columns wide, which is
 * what turns an org chart back into a list.
 *
 * COLLAPSED PAST FOUR, and the toggle is a real control rather than a count:
 * the first question this screen answers is "how many, and of what kind", and
 * the names are the follow-up. `useState` per branch so opening one large team
 * does not open every other.
 */
export function RoleBranch({ role, people, limit = 4 }) {
  const [open, setOpen] = useState(false);
  const Icon = roleIcon(role);
  const overflow = people.length - limit;
  const shown = open ? people : people.slice(0, limit);
  const listId = `role-branch-${role}`;

  return (
    <div className={`${NODE_SHELL} ${ACCENTS.plain} overflow-hidden`}>
      <div className="flex items-center gap-2.5 border-b border-border px-3 py-2.5">
        <span
          aria-hidden="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold leading-tight tracking-tight text-foreground">
            {roleLabel(role)}
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
          {people.length}
        </span>
      </div>

      <ul id={listId} className="space-y-0.5 p-2">
        {shown.map((p) => (
          <li
            key={p.key}
            className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 transition-colors duration-150 motion-reduce:transition-none hover:bg-muted/60"
          >
            <Avatar person={p} size="sm" ring="ring-transparent" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium leading-tight text-foreground" title={p.name}>
                {p.name}
              </span>
              {p.taskCount > 0 && (
                <span className="block text-[11px] leading-tight text-muted-foreground tabular-nums">
                  {p.taskCount} {p.taskCount === 1 ? "task" : "tasks"}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>

      {overflow > 0 && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={listId}
          className="flex w-full items-center justify-center gap-1 border-t border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors duration-150 motion-reduce:transition-none hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none ${
              open ? "rotate-180" : ""
            }`}
            aria-hidden="true"
          />
          {/* Says how many, not "…". A count somebody can act on beats an
              ellipsis they have to click to understand. */}
          {open ? "Show fewer" : `Show ${overflow} more`}
        </button>
      )}
    </div>
  );
}
