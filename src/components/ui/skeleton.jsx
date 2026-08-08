import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Skeleton — the loading primitive. Never a spinner on a blank page.
 * `animate-pulse` is disabled under prefers-reduced-motion.
 *
 * <Skeleton className="h-4 w-32" />
 */
function Skeleton({ className, ...props }) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-md bg-muted motion-reduce:animate-none",
        className
      )}
      {...props}
    />
  )
}

/**
 * SkeletonTable — matches the DataTable shell: h-12 rows, divide-y.
 * <SkeletonTable rows={5} cols={4} />
 */
function SkeletonTable({ rows = 5, cols = 4, className, ...props }) {
  return (
    <div
      data-slot="skeleton-table"
      role="status"
      aria-busy="true"
      aria-label="Loading table"
      className={cn("w-full overflow-hidden", className)}
      {...props}
    >
      <div className="flex h-10 items-center gap-4 border-b border-border px-4">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={`h-${i}`} className="h-3 flex-1" />
        ))}
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={`r-${r}`} className="flex h-12 items-center gap-4 px-4">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton
                key={`c-${r}-${c}`}
                className={cn("h-4 flex-1", c === 0 && "max-w-[10rem]")}
              />
            ))}
          </div>
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  )
}

/**
 * SkeletonCard — a card-shaped placeholder.
 * <SkeletonCard />
 */
function SkeletonCard({ lines = 3, className, ...props }) {
  return (
    <div
      data-slot="skeleton-card"
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className={cn(
        "space-y-3 rounded-xl border border-border bg-card p-5 shadow-card",
        className
      )}
      {...props}
    >
      <Skeleton className="h-4 w-1/3" />
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton
            key={i}
            className={cn("h-3 w-full", i === lines - 1 && "w-2/3")}
          />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  )
}

/**
 * SkeletonList — stacked avatar + two-line rows.
 * <SkeletonList rows={3} />
 */
function SkeletonList({ rows = 3, className, ...props }) {
  return (
    <div
      data-slot="skeleton-list"
      role="status"
      aria-busy="true"
      aria-label="Loading list"
      className={cn("space-y-3", className)}
      {...props}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-1/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  )
}

export { Skeleton, SkeletonTable, SkeletonCard, SkeletonList }
