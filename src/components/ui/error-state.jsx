import * as React from "react"
import { CircleAlert, RefreshCw } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/**
 * ErrorState — for a failed fetch, with retry.
 *
 * <ErrorState title="Couldn't load" description={err} onRetry={fn} />
 */
function ErrorState({
  icon: Icon = CircleAlert,
  title = "Something went wrong",
  description,
  onRetry,
  retryLabel = "Try again",
  className,
  ...props
}) {
  const message =
    description instanceof Error ? description.message : description

  return (
    <div
      data-slot="error-state"
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center",
        className
      )}
      {...props}
    >
      {Icon && (
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <Icon aria-hidden="true" className="h-5 w-5" />
        </span>
      )}
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {message && (
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            {message}
          </p>
        )}
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-1">
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          {retryLabel}
        </Button>
      )}
    </div>
  )
}

export { ErrorState }
