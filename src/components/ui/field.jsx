"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"

/**
 * Field — label + control + hint + error, wired with htmlFor/id/aria-describedby.
 *
 * <Field label="Email" htmlFor="email" error={msg} hint="…" required>
 *   <Input id="email" />
 * </Field>
 *
 * The single child control is cloned so it receives `id`, `aria-describedby`
 * (hint and/or error) and `aria-invalid` without the caller repeating them.
 * Anything the caller sets explicitly wins.
 */
function Field({
  label,
  htmlFor,
  hint,
  error,
  required = false,
  children,
  className,
  labelClassName,
  ...props
}) {
  const generatedId = React.useId()
  // Tolerant of multiple children: only a lone element gets the aria wiring.
  const childArray = React.Children.toArray(children)
  const child = childArray.length === 1 ? childArray[0] : null
  const controlId =
    htmlFor ||
    (React.isValidElement(child) && child.props.id) ||
    generatedId
  const hintId = `${controlId}-hint`
  const errorId = `${controlId}-error`

  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") ||
    undefined

  const control = !child
    ? children
    : React.isValidElement(child)
    ? React.cloneElement(child, {
        id: child.props.id ?? controlId,
        "aria-invalid": child.props["aria-invalid"] ?? (error ? true : undefined),
        "aria-describedby":
          child.props["aria-describedby"] ??
          (describedBy || undefined),
        "aria-required": child.props["aria-required"] ?? (required || undefined),
      })
    : child

  return (
    <div
      data-slot="field"
      className={cn("space-y-1.5", className)}
      {...props}
    >
      {label && (
        <Label htmlFor={controlId} className={cn(labelClassName)}>
          <span>{label}</span>
          {required && (
            <>
              <span aria-hidden="true" className="text-destructive">
                *
              </span>
              <span className="sr-only">(required)</span>
            </>
          )}
        </Label>
      )}

      {control}

      {hint && !error && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}

      {error && (
        <p id={errorId} className="text-xs font-medium text-destructive">
          {typeof error === "string" ? error : "This field is invalid."}
        </p>
      )}
    </div>
  )
}

export { Field }
