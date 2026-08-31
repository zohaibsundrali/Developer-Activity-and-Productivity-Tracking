import * as React from "react"
import { CircleAlert, RefreshCw } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { warnAliasedProps } from "@/components/ui/prop-aliases"

/**
 * ErrorState — for a failed fetch, with retry.
 *
 * <ErrorState title="Couldn't load" description={err} onRetry={fn} />
 */
// Reduce anything to a string React can render. Handles: Error instances,
// supabase-js `{ code, details, hint, message }`, a bare string, arrays of
// any of those, and null/undefined (which means "no description", not "null").
function toMessage(value) {
  if (value == null || value === "") return null
  if (typeof value === "string") return value
  if (Array.isArray(value)) {
    const parts = value.map(toMessage).filter(Boolean)
    return parts.length ? parts.join(" · ") : null
  }
  if (typeof value === "object") {
    if (typeof value.message === "string" && value.message) return value.message
    if (typeof value.error === "string" && value.error) return value.error
    if (typeof value.details === "string" && value.details) return value.details
    try {
      const json = JSON.stringify(value)
      return json && json !== "{}" ? json : null
    } catch {
      return null
    }
  }
  return String(value)
}

function ErrorState({
  icon: Icon = CircleAlert,
  title = "Something went wrong",
  description,
  onRetry,
  retryLabel = "Try again",
  className,
  ...props
}) {
  // Anything that is not renderable as a React child must be reduced to a
  // string HERE, not at the call site.
  //
  // `instanceof Error` alone was not enough and the gap was reachable: a
  // supabase-js failure is a PLAIN OBJECT — `{ code, details, hint, message }`
  // — so it passed straight through and React threw #31 ("Objects are not
  // valid as a React child"). That took /sessions/[sessionId] to the error
  // boundary on every session, and the visitor saw "Something went wrong"
  // instead of the error this component exists to show. An error surface that
  // crashes on an error is the worst possible failure for it to have.
  //
  // Prefer `.message` wherever one exists, since that is the human-readable
  // part of both Error instances and supabase-js results. Fall back to a JSON
  // dump rather than "[object Object]", which tells nobody anything.
  const message = toMessage(description)

  // `message=` was passed by twenty call sites and silently became a DOM
  // attribute on the div below, so every one of them rendered the generic
  // title with no reason underneath. Fixed at the call sites; this is what
  // stops the next one being written. See components/ui/prop-aliases.js.
  warnAliasedProps("ErrorState", props, {
    message: "description",
    error: "description",
    text: "description",
  })

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
