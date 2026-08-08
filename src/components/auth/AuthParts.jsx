"use client";

import { AlertCircle, Eye, EyeOff, Info, Loader2 } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Small presentational pieces shared by login / registration / invite.
 * None of these touch auth state — they render what they are handed.
 */

/** Shared input sizing: 44px tall so the touch target passes on mobile. */
export const AUTH_INPUT = "h-11 rounded-lg text-base sm:text-sm";

/** Card that holds the form. Full-bleed on mobile, a real card from sm up. */
export function AuthCard({ className, children, ...props }) {
  return (
    <div
      className={cn(
        "animate-fade-in sm:rounded-xl sm:border sm:border-border sm:bg-card sm:p-8 sm:shadow-card",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function AuthHeading({ title, description, className }) {
  return (
    <div className={cn("space-y-2", className)}>
      <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[1.75rem] sm:leading-tight">
        {title}
      </h1>
      {description ? (
        <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

/** A designed error surface — announced to screen readers, not a red string. */
export function AuthError({ message, className }) {
  if (!message) return null;
  // `auth-error-box` carries no styles — it is the hook e2e/fixtures/auth.js
  // uses to read back the message when a login never lands. Keep it.
  return (
    <div
      role="alert"
      className={cn(
        "auth-error-box flex items-start gap-3 rounded-lg border border-destructive/25 bg-destructive/10 p-3.5",
        className
      )}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
      <p className="text-sm leading-relaxed text-destructive">{message}</p>
    </div>
  );
}

export function AuthNotice({ children, className }) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border border-border bg-muted/50 p-3.5",
        className
      )}
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

/** Password visibility toggle, positioned inside the input row. */
function PasswordToggle({ visible, onToggle, controls }) {
  const Icon = visible ? EyeOff : Eye;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={visible ? "Hide password" : "Show password"}
      aria-pressed={visible}
      aria-controls={controls}
      className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

/**
 * Password input with its visibility toggle.
 *
 * Must be the single child of a `Field`: Field clones its lone child to inject
 * `id` / `aria-describedby` / `aria-invalid`, so those props have to land on a
 * component that forwards them to the real <input> — not on a wrapper div.
 */
export function PasswordInput({ visible, onToggle, className, ...props }) {
  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        className={cn(AUTH_INPUT, "pr-11", className)}
      />
      <PasswordToggle visible={visible} onToggle={onToggle} controls={props.id} />
    </div>
  );
}

/** Full-width primary submit with a real progress state. */
export function SubmitButton({ loading, loadingLabel, children, className, ...props }) {
  return (
    <Button
      type="submit"
      size="lg"
      aria-busy={loading || undefined}
      className={cn("h-11 w-full text-sm font-semibold", className)}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {loadingLabel}
        </>
      ) : (
        children
      )}
    </Button>
  );
}

/** Segmented control used for role / mode selection. */
export function SegmentedControl({ label, options, value, onChange, className }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "flex gap-1 rounded-lg border border-border bg-muted/50 p-1",
        className
      )}
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            title={option.title}
            className={cn(
              "min-h-[44px] min-w-0 flex-1 truncate rounded-md px-1.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background sm:px-2",
              active
                ? "bg-card text-foreground shadow-card"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Password requirement checklist — colour plus an explicit met/unmet mark. */
export function PasswordChecklist({ requirements, id }) {
  const items = [
    { key: "minLength", label: "8+ characters" },
    { key: "hasUpperCase", label: "Uppercase letter" },
    { key: "hasLowerCase", label: "Lowercase letter" },
    { key: "hasNumbers", label: "Number" },
    { key: "hasSpecialChar", label: "Special character" },
  ];

  return (
    <ul
      id={id}
      className="grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-lg border border-border bg-muted/40 p-3 sm:grid-cols-2"
    >
      {items.map(({ key, label }) => {
        const met = Boolean(requirements?.[key]);
        return (
          <li key={key} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden="true"
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold leading-none",
                met
                  ? "border-success bg-success text-success-foreground"
                  : "border-border text-transparent"
              )}
            >
              &#10003;
            </span>
            <span className={met ? "text-foreground" : "text-muted-foreground"}>
              {label}
              <span className="sr-only">{met ? " — met" : " — not met"}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
