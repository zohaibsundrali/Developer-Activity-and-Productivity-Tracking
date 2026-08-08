import * as React from "react"
import { Inbox } from "lucide-react"

import { cn } from "@/lib/utils"

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
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/50 px-6 py-12 text-center",
        className
      )}
      {...props}
    >
      {Icon && (
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon aria-hidden="true" className="h-5 w-5" />
        </span>
      )}
      <div className="space-y-1">
        {title && (
          <p className="text-sm font-medium text-foreground">{title}</p>
        )}
        {description && (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  )
}

export { EmptyState }
