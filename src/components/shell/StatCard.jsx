"use client";

import { cn } from "@/lib/utils";

const TONES = {
  primary: "bg-primary/10 text-primary",
  info: "bg-info/10 text-info",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  destructive: "bg-destructive/10 text-destructive",
  violet: "bg-violet-500/10 text-violet-600",
};

/**
 * Reusable metric tile for dashboard overviews.
 */
export default function StatCard({
  title,
  value,
  icon: Icon,
  tone = "primary",
  hint,
  badge,
  badgeTone = "muted",
  className,
}) {
  const badgeClasses =
    badgeTone === "destructive"
      ? "bg-destructive/10 text-destructive"
      : badgeTone === "success"
      ? "bg-success/10 text-success"
      : "bg-muted text-muted-foreground";

  return (
    <div className={cn("rounded-xl border border-border bg-card p-5 shadow-card transition-shadow hover:shadow-elevated", className)}>
      <div className="flex items-start justify-between">
        <div className={cn("flex h-11 w-11 items-center justify-center rounded-xl", TONES[tone] || TONES.primary)}>
          {Icon && <Icon className="h-[22px] w-[22px]" />}
        </div>
        {badge && (
          <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", badgeClasses)}>
            {badge}
          </span>
        )}
      </div>
      <div className="mt-4">
        <p className="text-3xl font-bold tracking-tight text-foreground tabular-nums">{value}</p>
        <p className="mt-1 text-sm font-medium text-muted-foreground">{title}</p>
      </div>
      {hint && (
        <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-sm">
          {hint}
        </div>
      )}
    </div>
  );
}
