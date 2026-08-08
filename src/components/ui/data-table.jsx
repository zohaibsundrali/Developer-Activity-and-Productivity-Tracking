"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { EmptyState } from "@/components/ui/empty-state"
import { SkeletonTable } from "@/components/ui/skeleton"

const ALIGN = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
}

/**
 * DataTable — presentation only. No fetching, no sorting logic, no state
 * beyond what rendering needs (there is none).
 *
 * <DataTable
 *   columns={[{ key, header, align, width, render(row) }]}
 *   rows={rows} loading empty={<EmptyState />} onRowClick keyField="id" />
 */
function DataTable({
  columns = [],
  rows = [],
  loading = false,
  empty,
  onRowClick,
  keyField = "id",
  caption,
  className,
  tableClassName,
  ...props
}) {
  const isInteractive = typeof onRowClick === "function"

  const handleKeyDown = (event, row, index) => {
    if (!isInteractive) return
    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      event.preventDefault()
      onRowClick(row, index)
    }
  }

  if (loading) {
    return (
      <div
        data-slot="data-table"
        className={cn(
          "w-full overflow-hidden rounded-xl border border-border bg-card shadow-card",
          className
        )}
        {...props}
      >
        <SkeletonTable rows={5} cols={Math.max(columns.length, 1)} />
      </div>
    )
  }

  if (!rows || rows.length === 0) {
    return (
      <div data-slot="data-table" className={cn("w-full", className)} {...props}>
        {empty ?? (
          <EmptyState
            title="Nothing to show"
            description="There are no records to display yet."
          />
        )}
      </div>
    )
  }

  return (
    <div
      data-slot="data-table"
      className={cn(
        "w-full overflow-hidden rounded-xl border border-border bg-card shadow-card",
        className
      )}
      {...props}
    >
      {/* A table is the single most common cause of mobile horizontal overflow. */}
      <div className="w-full overflow-x-auto">
        <table className={cn("w-full caption-bottom text-sm", tableClassName)}>
          {caption && (
            <caption className="px-4 py-3 text-left text-xs text-muted-foreground">
              {caption}
            </caption>
          )}
          <thead className="border-b border-border bg-muted/30">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  style={col.width ? { width: col.width } : undefined}
                  className={cn(
                    "h-10 whitespace-nowrap px-4 text-xs font-medium uppercase tracking-wide text-muted-foreground",
                    ALIGN[col.align] || ALIGN.left,
                    col.headerClassName
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row, index) => {
              const key = row?.[keyField] ?? index
              return (
                <tr
                  key={key}
                  data-slot="data-table-row"
                  // No role override: a `role="button"` on <tr> would drop the
                  // row out of the table's accessibility tree. Rows stay rows
                  // and simply become focusable + Enter/Space activatable.
                  tabIndex={isInteractive ? 0 : undefined}
                  onClick={isInteractive ? () => onRowClick(row, index) : undefined}
                  onKeyDown={
                    isInteractive
                      ? (event) => handleKeyDown(event, row, index)
                      : undefined
                  }
                  className={cn(
                    "h-12 transition-colors duration-150 motion-reduce:transition-none",
                    isInteractive &&
                      "cursor-pointer hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    !isInteractive && "hover:bg-muted/40"
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        "px-4 py-2 align-middle text-foreground",
                        ALIGN[col.align] || ALIGN.left,
                        col.cellClassName
                      )}
                    >
                      {typeof col.render === "function"
                        ? col.render(row, index)
                        : row?.[col.key]}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export { DataTable }
