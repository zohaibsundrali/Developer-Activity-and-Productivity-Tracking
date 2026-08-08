"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Tabs — controlled, presentation only.
 *
 * <Tabs tabs={[{ id, label, count }]} active={id} onChange={fn} />
 *
 * Keyboard: roving tabindex, Arrow Left/Right/Home/End move and select,
 * per the WAI-ARIA tabs pattern.
 */
function Tabs({
  tabs = [],
  active,
  onChange,
  className,
  "aria-label": ariaLabel = "Tabs",
  ...props
}) {
  const listRef = React.useRef(null)

  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === active)
  )

  const focusTab = (index) => {
    const node = listRef.current?.querySelectorAll("[role=tab]")?.[index]
    if (node) node.focus()
  }

  const select = (index) => {
    const tab = tabs[index]
    if (!tab || tab.disabled) return
    focusTab(index)
    if (typeof onChange === "function") onChange(tab.id, tab)
  }

  const handleKeyDown = (event) => {
    if (tabs.length === 0) return
    let next = null
    if (event.key === "ArrowRight") next = (activeIndex + 1) % tabs.length
    else if (event.key === "ArrowLeft")
      next = (activeIndex - 1 + tabs.length) % tabs.length
    else if (event.key === "Home") next = 0
    else if (event.key === "End") next = tabs.length - 1
    if (next === null) return
    event.preventDefault()
    select(next)
  }

  return (
    <div
      data-slot="tabs"
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={cn(
        "flex w-full items-center gap-1 overflow-x-auto border-b border-border",
        className
      )}
      {...props}
    >
      {tabs.map((tab, index) => {
        const isActive = tab.id === active
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={isActive}
            aria-controls={tab.panelId}
            tabIndex={isActive ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => select(index)}
            data-slot="tab"
            className={cn(
              "-mb-px inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
            )}
          >
            {tab.label}
            {tab.count !== undefined && tab.count !== null && (
              <span
                className={cn(
                  "inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[0.6875rem] font-medium",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export { Tabs }
