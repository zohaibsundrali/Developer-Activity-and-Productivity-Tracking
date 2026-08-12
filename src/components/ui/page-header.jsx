import * as React from "react"
import Link from "next/link"
import { ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * PageHeader — every screen starts with exactly one.
 *
 * <PageHeader title="Employees" description="Directory and profiles"
 *             actions={<Button>Add</Button>}
 *             breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Employees" }]} />
 */
function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  className,
  ...props
}) {
  const crumbs = Array.isArray(breadcrumbs) ? breadcrumbs : []

  return (
    <div
      data-slot="page-header"
      // A hairline under every masthead. Before this the title, the actions
      // and the first card were three things floating in the same column of
      // space, and each screen decided for itself how much air went between
      // them. The rule is what makes a page look composed rather than stacked
      // — and it costs nothing, because every screen already renders exactly
      // one PageHeader.
      className={cn("flex flex-col gap-4 border-b border-border pb-5 mb-6", className)}
      {...props}
    >
      {crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" data-slot="page-header-breadcrumbs">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            {crumbs.map((crumb, index) => {
              const isLast = index === crumbs.length - 1
              return (
                <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                  {index > 0 && (
                    <ChevronRight
                      aria-hidden="true"
                      className="h-4 w-4 shrink-0 text-muted-foreground/70"
                    />
                  )}
                  {crumb.href && !isLast ? (
                    <Link
                      href={crumb.href}
                      className="rounded-sm transition-colors duration-150 motion-reduce:transition-none hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span
                      className={cn(isLast && "font-medium text-foreground")}
                      aria-current={isLast ? "page" : undefined}
                    >
                      {crumb.label}
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
        </nav>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 space-y-1">
          <h1
            data-slot="page-header-title"
            // -0.02em at this size. Large type set at default tracking reads
            // loose and slightly amateur; the tightening is most of what
            // separates a product masthead from a document heading.
            className="truncate text-2xl font-semibold leading-tight tracking-[-0.02em] text-foreground sm:text-[1.75rem]"
          >
            {title}
          </h1>
          {description && (
            <p
              data-slot="page-header-description"
              className="max-w-2xl text-sm leading-relaxed text-muted-foreground"
            >
              {description}
            </p>
          )}
        </div>

        {actions && (
          <div
            data-slot="page-header-actions"
            className="flex shrink-0 flex-wrap items-center gap-2"
          >
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}

export { PageHeader }
