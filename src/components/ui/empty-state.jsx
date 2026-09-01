import * as React from "react"
import { Inbox } from "lucide-react"

import { cn } from "@/lib/utils"
import { warnAliasedProps } from "@/components/ui/prop-aliases"

/**
 * EmptyState
 *
 * <EmptyState icon={Inbox} title="No tasks yet" description="…"
 *             action={<Button>Create</Button>} />
 */
function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
  ...props
}) {
  // Sixteen call sites passed `message=` here, which this component does not
  // take — it went onto the root div as an attribute and the explanatory line
  // simply did not render. Same defect as ErrorState's, same guard.
  warnAliasedProps("EmptyState", props, {
    message: "description",
    subtitle: "description",
    text: "description",
  })

  return (
    <div
      data-slot="empty-state"
      className={cn(
        // The most-rendered surface in the product — 47 files — and the one
        // people see most on a new installation, where almost everything is
        // empty. It was a grey circle on a dashed box; it is worth more than
        // that, because for a first-time user it IS the product.
        "flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-gradient-to-b from-card/60 to-card/20 px-6 py-14 text-center",
        className
      )}
      {...props}
    >
      {Icon && (
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary ring-1 ring-inset ring-primary/10">
          <Icon aria-hidden="true" className="h-6 w-6" />
        </span>
      )}
      <div className="space-y-1.5">
        {title && (
          <p className="text-base font-semibold tracking-tight text-foreground">{title}</p>
        )}
        {description && (
          <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action && <div className="pt-2">{action}</div>}
    </div>
  )
}

export { EmptyState }
