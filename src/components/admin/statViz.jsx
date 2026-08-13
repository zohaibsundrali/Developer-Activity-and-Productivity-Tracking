"use client";

import { cn } from "@/lib/utils";

/**
 * Two shapes that Team Stats and Capacity both needed, built once.
 *
 * WHAT WAS WRONG WITH WHAT THEY HAD
 *
 * Team Stats rendered FOUR consecutive sections of identical bar rows — role,
 * department, team performance, productivity. Four lists that look the same
 * read as one long list, and the eye has nothing to catch on: a share of a
 * whole and a ranking are different questions, and drawing them the same way
 * hides that.
 *
 *   ShareBar     "how is the whole divided" — one segmented bar, read at a
 *                glance, with a legend that carries the numbers.
 *   LeaderRow    "who is ahead" — a rank, a face and a value. A ranking has an
 *                order that matters, and a plain bar list does not show it.
 *
 * COLOUR RULE. Neither of these tints by meaning. ShareBar walks one neutral
 * ramp of the primary hue because its segments are categories, not statuses —
 * and the palette's status colours have to keep meaning status. Every segment
 * and every row carries its label and its number, so nothing here depends on
 * telling two shades apart.
 */

/** Percent of a total, guarded against a zero denominator. */
const pct = (value, total) => {
  const t = Number(total) || 0;
  if (t <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((Number(value) || 0) / t * 100)));
};

// One hue, five steps. Not five hues: these are slices of one quantity, and a
// rainbow would imply five unrelated things.
const RAMP = [
  "bg-primary",
  "bg-primary/75",
  "bg-primary/55",
  "bg-primary/40",
  "bg-primary/25",
];
const rampAt = (i) => RAMP[i % RAMP.length];

/**
 * A whole, divided.
 *
 * `rows` is [{ key, label, count }]. Segments narrower than a few percent are
 * still DRAWN — a role with one person in fifty must not vanish, because
 * "nobody is in that role" and "one person is" are different facts — so each
 * segment gets a floor width and the legend carries the true number.
 */
export function ShareBar({ rows, total, className }) {
  const items = (rows || []).filter((r) => Number(r.count) > 0);
  if (items.length === 0) return null;

  const sum = Number(total) || items.reduce((s, r) => s + (Number(r.count) || 0), 0);

  return (
    <div className={cn("space-y-4", className)}>
      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={items.map((r) => `${r.label}: ${r.count}`).join(", ")}
      >
        {items.map((r, i) => (
          <span
            key={r.key}
            className={cn("h-full transition-[width] duration-500 ease-out motion-reduce:transition-none", rampAt(i))}
            // minWidth, not a minimum percentage: a floor expressed in percent
            // would still round to nothing on a narrow container.
            style={{ width: `${pct(r.count, sum)}%`, minWidth: "0.375rem" }}
          />
        ))}
      </div>

      <ul className="flex flex-wrap gap-x-5 gap-y-2">
        {items.map((r, i) => (
          <li key={r.key} className="flex items-center gap-2 text-sm">
            <span aria-hidden="true" className={cn("h-2.5 w-2.5 shrink-0 rounded-sm", rampAt(i))} />
            <span className="text-muted-foreground">{r.label}</span>
            <span className="font-semibold tabular-nums text-foreground">{r.count}</span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {pct(r.count, sum)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One place in a ranking.
 *
 * The rank is shown as a number rather than implied by position, because a
 * filtered or re-sorted list makes position a lie — and because "3rd of 40" is
 * the fact somebody repeats out loud, not "third row down".
 *
 * The top three get a filled marker. Not a medal metaphor: just enough weight
 * that the head of the list is findable without reading it.
 */
export function LeaderRow({ rank, label, sublabel, value, unit, share, initials }) {
  const top = rank <= 3;

  return (
    <li className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors duration-150 motion-reduce:transition-none hover:bg-muted/50">
      <span
        aria-hidden="true"
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold tabular-nums",
          top ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
        )}
      >
        {rank}
      </span>

      {initials && (
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5 text-xs font-semibold text-primary"
        >
          {initials}
        </span>
      )}

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground" title={label}>
          {label}
        </span>
        {sublabel && (
          <span className="block truncate text-xs text-muted-foreground">{sublabel}</span>
        )}
        {share != null && (
          <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-primary/70 transition-[width] duration-500 ease-out motion-reduce:transition-none"
              style={{ width: `${Math.max(0, Math.min(100, share))}%` }}
            />
          </span>
        )}
      </span>

      <span className="shrink-0 text-right">
        <span className="block text-sm font-semibold tabular-nums tracking-tight text-foreground">
          {value}
        </span>
        {unit && <span className="block text-[11px] text-muted-foreground">{unit}</span>}
      </span>
    </li>
  );
}

/**
 * "Who is free, who is buried" — one strip, before any list.
 *
 * `levels` is [{ id, label, tone, count }]. The whole point is that a manager
 * about to assign work reads ONE line and knows whether there is room, without
 * scanning forty rows. Levels with nobody in them are dropped rather than shown
 * as zeros, for the same reason the Employees role tiles drop them: a row of
 * zeros is what makes the numbers that matter hard to find.
 *
 * This one DOES tint by meaning — free/heavy/overloaded are states, not
 * categories — so it uses the status tokens rather than the neutral ramp.
 */
const LEVEL_FILL = {
  muted: "bg-muted-foreground/40",
  success: "bg-success",
  info: "bg-info",
  warning: "bg-warning",
  error: "bg-destructive",
};

export function LoadStrip({ levels, total, className }) {
  const items = (levels || []).filter((l) => Number(l.count) > 0);
  if (items.length === 0) return null;
  const sum = Number(total) || items.reduce((s, l) => s + (Number(l.count) || 0), 0);

  return (
    <div className={cn("rounded-xl border border-border bg-card p-4 shadow-card sm:p-5", className)}>
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={items.map((l) => `${l.label}: ${l.count}`).join(", ")}
      >
        {items.map((l) => (
          <span
            key={l.id}
            className={cn(
              "h-full transition-[width] duration-500 ease-out motion-reduce:transition-none",
              LEVEL_FILL[l.tone] || LEVEL_FILL.muted
            )}
            style={{ width: `${pct(l.count, sum)}%`, minWidth: "0.375rem" }}
          />
        ))}
      </div>

      <ul className="mt-3.5 flex flex-wrap gap-x-5 gap-y-2">
        {items.map((l) => (
          <li key={l.id} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden="true"
              className={cn("h-2.5 w-2.5 shrink-0 rounded-full", LEVEL_FILL[l.tone] || LEVEL_FILL.muted)}
            />
            <span className="text-muted-foreground">{l.label}</span>
            <span className="font-semibold tabular-nums text-foreground">{l.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
