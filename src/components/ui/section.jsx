"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Section — a titled block inside a page.
 *
 * <Section title="Recent activity" description="…" actions={…}>{children}</Section>
 */
function Section({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
  as: Comp = "section",
  ...props
}) {
  const headingId = React.useId()
  const hasHeader = Boolean(title || description || actions)

  return (
    <Comp
      data-slot="section"
      aria-labelledby={title ? headingId : undefined}
      className={cn("space-y-4", className)}
      {...props}
    >
      {hasHeader && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 space-y-1">
            {title && (
              <h2
                id={headingId}
                data-slot="section-title"
                className="text-base font-semibold tracking-tight text-foreground"
              >
                {title}
              </h2>
            )}
            {description && (
              <p
                data-slot="section-description"
                className="text-sm text-muted-foreground"
              >
                {description}
              </p>
            )}
          </div>
          {actions && (
            <div
              data-slot="section-actions"
              className="flex shrink-0 flex-wrap items-center gap-2"
            >
              {actions}
            </div>
          )}
        </div>
      )}
      <div data-slot="section-content" className={cn(contentClassName)}>
        {children}
      </div>
    </Comp>
  )
}

export { Section }
