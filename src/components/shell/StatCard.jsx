"use client";

import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Skeleton } from "@/components/ui";

// Icon chip tones. Only design tokens — there is no violet token in the
// palette, so the historic `violet` tone falls back to `accent` rather than
// reintroducing a literal colour.
const TONES = {
  primary: "bg-primary/10 text-primary",
  info: "bg-info/10 text-info",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  destructive: "bg-destructive/10 text-destructive",
  accent: "bg-accent text-accent-foreground",
  secondary: "bg-secondary text-secondary-foreground",
  muted: "bg-muted text-muted-foreground",
  violet: "bg-accent text-accent-foreground",
};

const BADGE_TONES = {
  destructive: "bg-destructive/10 text-destructive",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  info: "bg-info/10 text-info",
  muted: "bg-muted text-muted-foreground",
};

// A trend is never colour alone — each direction also carries its own glyph.
const TREND_DIRECTIONS = {
  up: { Icon: TrendingUp, good: "text-success", bad: "text-destructive", sr: "Up" },
  down: { Icon: TrendingDown, good: "text-success", bad: "text-destructive", sr: "Down" },
  flat: { Icon: Minus, good: "text-muted-foreground", bad: "text-muted-foreground", sr: "No change" },
};

function normalizeTrend(trend) {
  if (trend === null || trend === undefined || trend === false) return null;
  if (typeof trend === "number") {
    return {
      direction: trend > 0 ? "up" : trend < 0 ? "down" : "flat",
      value: `${trend > 0 ? "+" : ""}${trend}%`,
      label: undefined,
    };
  }
  if (typeof trend !== "object") return null;
  const direction =
    trend.direction ||
    (typeof trend.value === "number"
      ? trend.value > 0
        ? "up"
        : trend.value < 0
        ? "down"
        : "flat"
      : "flat");
  const value =
    typeof trend.value === "number"
      ? `${trend.value > 0 ? "+" : ""}${trend.value}%`
      : trend.value;
  return { direction, value, label: trend.label };
}

/**
 * Reusable metric tile for dashboard overviews.
 *
 * Used on nearly every dashboard, so it owns the whole tile contract:
 * consistent number/label hierarchy, tabular figures for the number, an
 * optional trend, a skeleton that matches the loaded shape, and a label that
 * wraps instead of overflowing when it is long.
 */
export default function StatCard({
  title,
  label,
  value,
  icon: Icon,
  tone = "primary",
  hint,
  badge,
  badgeTone = "muted",
  trend,
  // Set when a rise is bad (error counts, overdue tasks) so the trend colour
  // matches the meaning rather than the arrow direction.
  invertTrend = false,
  loading = false,
  className,
  ...props
}) {
  // `label` is accepted as an alias so older call sites keep working.
  const heading = title ?? label;
  const toneClasses = TONES[tone] || TONES.primary;
  const badgeClasses = BADGE_TONES[badgeTone] || BADGE_TONES.muted;
  const t = normalizeTrend(trend);

  const shell = cn(
    "rounded-xl border border-border bg-card p-4 shadow-card sm:p-5",
    "transition-shadow duration-150 motion-reduce:transition-none hover:shadow-elevated",
    className
  );

  if (loading) {
    return (
      <div className={shell} aria-busy="true" {...props}>
        <div className="flex items-start justify-between gap-3">
          <Skeleton className="h-11 w-11 rounded-xl" />
          {badge && <Skeleton className="h-6 w-20 rounded-full" />}
        </div>
        <div className="mt-4 space-y-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-4 w-32" />
        </div>
        {hint && (
          <div className="mt-4 border-t border-border pt-3">
            <Skeleton className="h-4 w-full" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={shell} {...props}>
      <div className="flex items-start justify-between gap-3">
        <div
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
            toneClasses
          )}
        >
          {Icon && <Icon className="h-5 w-5" aria-hidden="true" />}
        </div>
        {badge && (
          <span
            className={cn(
              "max-w-[60%] truncate rounded-full px-2.5 py-1 text-xs font-semibold",
              badgeClasses
            )}
          >
            {badge}
          </span>
        )}
      </div>

      <div className="mt-4">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <p className="text-3xl font-bold leading-none tracking-tight text-foreground tabular-nums">
            {value}
          </p>
          {t && (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-xs font-semibold tabular-nums",
                invertTrend
                  ? TREND_DIRECTIONS[t.direction]?.bad
                  : TREND_DIRECTIONS[t.direction]?.good
              )}
            >
              {(() => {
                const TrendIcon = TREND_DIRECTIONS[t.direction]?.Icon || Minus;
                return <TrendIcon className="h-4 w-4" aria-hidden="true" />;
              })()}
              <span className="sr-only">
                {TREND_DIRECTIONS[t.direction]?.sr || "No change"}:
              </span>
              {t.value}
            </span>
          )}
        </div>
        {/* Long labels wrap to a second line instead of pushing the tile wide;
            the full text stays available on hover. */}
        <p
          className="mt-1.5 line-clamp-2 break-words text-sm font-medium text-muted-foreground"
          title={typeof heading === "string" ? heading : undefined}
        >
          {heading}
        </p>
        {t?.label && (
          <p className="mt-1 truncate text-xs text-muted-foreground">{t.label}</p>
        )}
      </div>

      {hint && (
        <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3 text-sm">
          {hint}
        </div>
      )}
    </div>
  );
}
