"use client";

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
 * THE GEOMETRY, which is the classic CSS-tree trick:
 *
 *   parent
 *     │        <Trunk/>            a centred vertical line under the parent
 *   ──┼──      <Branches>          one horizontal rail across the children
 *   │   │      each child's stub   a short vertical line up to the rail
 *   A   B
 *
 * The rail is drawn as three cases so it stops at the OUTER children rather
 * than sticking out past them: the first child draws from its own centre
 * rightwards, the last from its centre leftwards, the middles all the way
 * across. A lone child draws no rail at all — a horizontal line to nowhere is
 * the thing that makes a hand-made tree look broken.
 */

/** The vertical line joining one level to the next. */
export function Trunk({ className = "" }) {
  return (
    <span
      aria-hidden="true"
      className={`mx-auto block h-8 w-px bg-border ${className}`}
    />
  );
}

/**
 * A row of children, joined to their parent by one rail.
 *
 * `scroll` wraps the row so a wide level scrolls sideways instead of wrapping.
 * Wrapping would break the geometry — the rail is drawn across ONE row, and a
 * second row of children would sit under a rail that does not reach them.
 */
export function Branches({ children, className = "" }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : [children];
  const only = items.length === 1;

  return (
    <div className={`flex items-start justify-center ${className}`}>
      {items.map((child, i) => {
        const first = i === 0;
        const last = i === items.length - 1;
        // Where the rail runs for THIS child. See the note above.
        const rail = only
          ? null
          : first
          ? "left-1/2 right-0"
          : last
          ? "left-0 right-1/2"
          : "left-0 right-0";

        return (
          <div key={child?.key ?? i} className="relative flex flex-col items-center px-3 pt-8">
            {rail && <span aria-hidden="true" className={`absolute top-0 h-px bg-border ${rail}`} />}
            <span
              aria-hidden="true"
              className="absolute left-1/2 top-0 h-8 w-px -translate-x-1/2 bg-border"
            />
            {child}
          </div>
        );
      })}
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

export function Avatar({ person, size = "md" }) {
  const box =
    size === "lg" ? "h-12 w-12 text-base" : size === "sm" ? "h-7 w-7 text-[11px]" : "h-9 w-9 text-xs";
  return (
    <span
      aria-hidden="true"
      className={`${box} flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary`}
    >
      {initialsOf(person?.name, person?.email)}
    </span>
  );
}

/**
 * One person, as a node.
 *
 * `emphasis` makes the project manager read as a level of its own rather than
 * as the first of a list — the whole point of the chart is that the PM sits
 * between the project and everybody else.
 */
export function PersonNode({ person, emphasis = false, caption = null }) {
  const Icon = roleIcon(person.role);
  return (
    <div
      className={`flex w-44 flex-col items-center gap-2 rounded-xl border bg-card px-3 py-3 text-center shadow-card transition-shadow duration-150 motion-reduce:transition-none hover:shadow-elevated sm:w-48 ${
        emphasis ? "border-primary/40 ring-1 ring-primary/20" : "border-border"
      }`}
    >
      <Avatar person={person} size={emphasis ? "lg" : "md"} />
      <span className="min-w-0 w-full">
        <span className="block truncate text-sm font-semibold text-foreground" title={person.name}>
          {person.name}
        </span>
        <span className="mt-1 block">
          <Badge variant={roleVariant(person.role)} size="sm">
            <Icon className="h-3 w-3" aria-hidden="true" />
            {roleLabel(person.role)}
          </Badge>
        </span>
        {caption && (
          <span className="mt-1.5 block truncate text-xs text-muted-foreground">{caption}</span>
        )}
      </span>
    </div>
  );
}

/**
 * The node that stands in for a manager who does not exist.
 *
 * A gap in the chart would read as "still loading". This says what is wrong and
 * is styled as a warning, because an unmanaged project is the thing this screen
 * exists to surface.
 */
export function EmptyManagerNode() {
  return (
    <div className="flex w-44 flex-col items-center gap-2 rounded-xl border border-dashed border-warning/50 bg-warning/5 px-3 py-4 text-center sm:w-48">
      <span className="text-sm font-semibold text-foreground">No manager</span>
      <span className="text-xs text-muted-foreground">
        Set one in Project Hub so approvals have somewhere to go.
      </span>
    </div>
  );
}

/**
 * The project, at the top of its own chart.
 *
 * Wider than a person node on purpose: it is the root, and everything below is
 * read as belonging to it. The progress bar lives here rather than on the
 * people, because progress is a property of the work, not of who is doing it.
 */
export function ProjectNode({ project, status, health, expanded, onToggle, panelId, ChevronIcon, meta }) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(health.progress) || 0)));

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls={panelId}
      className="w-full max-w-2xl rounded-xl border border-border bg-card p-4 text-left shadow-card transition-shadow duration-150 motion-reduce:transition-none hover:shadow-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:p-5"
    >
      <span className="flex items-start gap-3">
        <ChevronIcon
          className={`mt-0.5 h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none ${
            expanded ? "rotate-90" : ""
          }`}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 space-y-3">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="truncate text-base font-semibold text-foreground">
              {project.name || "Untitled project"}
            </span>
            {status}
            {meta}
          </span>

          {/* The number is beside the bar, always. A bar alone is a shape
              somebody has to estimate, and "roughly three quarters" is not
              what anybody wants to report upward. */}
          <span className="flex items-center gap-3">
            <span
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${project.name || "Project"} progress`}
              className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
            >
              <span
                className="block h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="w-11 shrink-0 text-right text-sm font-semibold tabular-nums text-foreground">
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
 * The header is the node the rail attaches to; the people hang off a short
 * vertical line inside it. That keeps a team of twelve from making the chart
 * twelve columns wide, which is what turns an org chart back into a list.
 *
 * Collapsed past a handful, because the question this screen answers first is
 * "how many and what kind", and the names are the follow-up.
 */
export function RoleBranch({ role, people, limit = 4 }) {
  const Icon = roleIcon(role);
  const shown = people.slice(0, limit);
  const rest = people.length - shown.length;

  return (
    <div className="w-44 rounded-xl border border-border bg-card p-3 shadow-card sm:w-48">
      <p className="flex items-center justify-center gap-2 text-sm font-semibold text-foreground">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        {roleLabel(role)}
        <span className="text-muted-foreground tabular-nums">{people.length}</span>
      </p>

      <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
        {shown.map((p) => (
          <li key={p.key} className="flex items-center gap-2">
            <Avatar person={p} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-foreground" title={p.name}>
                {p.name}
              </span>
              {p.taskCount > 0 && (
                <span className="block text-[11px] text-muted-foreground tabular-nums">
                  {p.taskCount} {p.taskCount === 1 ? "task" : "tasks"}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>

      {rest > 0 && (
        // Says how many are hidden rather than just "…". A count somebody can
        // act on beats an ellipsis they have to click to understand.
        <p className="mt-2 text-center text-xs text-muted-foreground">
          +{rest} more {rest === 1 ? "person" : "people"}
        </p>
      )}
    </div>
  );
}
