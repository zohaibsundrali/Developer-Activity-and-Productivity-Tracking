"use client"

import * as React from "react"
import { Search } from "lucide-react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

/**
 * Toolbar — the filter/search row above a table or board.
 *
 * <Toolbar search={{ value, onChange, placeholder }} filters={…} actions={…} />
 *
 * `search.onChange` is called with the raw string value (not the event), which
 * is what a filter state setter wants. The rendered input is controlled by the
 * caller — Toolbar holds no state.
 */
function Toolbar({
  search,
  filters,
  actions,
  children,
  className,
  ...props
}) {
  const searchId = React.useId()

  return (
    <div
      data-slot="toolbar"
      role="toolbar"
      aria-orientation="horizontal"
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between",
        className
      )}
      {...props}
    >
      <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {search && (
          <div className="relative w-full sm:max-w-xs">
            <label htmlFor={searchId} className="sr-only">
              {search.label || search.placeholder || "Search"}
            </label>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id={searchId}
              type="search"
              value={search.value ?? ""}
              onChange={(event) => search.onChange?.(event.target.value, event)}
              placeholder={search.placeholder || "Search…"}
              className="pl-8"
            />
          </div>
        )}
        {filters && (
          <div
            data-slot="toolbar-filters"
            className="flex flex-wrap items-center gap-2"
          >
            {filters}
          </div>
        )}
        {children}
      </div>

      {actions && (
        <div
          data-slot="toolbar-actions"
          className="flex shrink-0 flex-wrap items-center gap-2"
        >
          {actions}
        </div>
      )}
    </div>
  )
}

export { Toolbar }
