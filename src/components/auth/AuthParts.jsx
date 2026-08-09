"use client";

import { AlertCircle, Check, Eye, EyeOff, Info, Loader2 } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { cn } from "@/lib/utils";
import "@/styles/auth-motion.css";

/**
 * Small presentational pieces shared by login / registration / invite.
 * None of these touch auth state — they render what they are handed.
 *
 * Motion is CSS-only and lives in src/styles/auth-motion.css; each piece here
 * just hands it a class or a data-attribute. Everything degrades to its static
 * end state under `prefers-reduced-motion: reduce`.
 */

/** Shared input sizing: 44px tall so the touch target passes on mobile. */
export const AUTH_INPUT = "h-11 rounded-lg text-base sm:text-sm";

/**
 * Card that holds the form. Full-bleed on mobile, a real card from sm up.
 *
 * `auth-card` scopes the field-focus transitions; `auth-enter` gives it the
 * 400ms fade-and-rise, and the stylesheet blooms a soft shadow underneath it
 * on a pseudo-element (opacity only) as it settles.
 */
export function AuthCard({ className, style, enterDelay = 100, children, ...props }) {
  return (
    <div
      className={cn(
        "auth-card auth-enter sm:rounded-xl sm:border sm:border-border sm:bg-card sm:p-8 sm:shadow-card",
        className
      )}
      style={{ "--auth-enter-delay": `${enterDelay}ms`, ...style }}
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
  // `auth-error-box` is the hook e2e/fixtures/auth.js uses to read back the
  // message when a login never lands — keep the class name exactly as is.
  // It also carries the 260ms fade-and-drop from auth-motion.css. No shake:
  // that was removed on purpose and is not coming back.
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

/**
 * Full-width primary submit with a real progress state.
 *
 * Idle / loading / success / error are stacked in a single CSS grid cell and
 * cross-faded, so the button is sized by its widest state and its width never
 * changes as it moves between them.
 *
 * Only the active layer is exposed to the accessibility tree — the others are
 * `aria-hidden`, so the accessible name stays exactly the idle label (the e2e
 * fixture matches the submit by /^Sign in as/).
 *
 * `status` is presentational and optional: pass "error" to get a single tint
 * pulse (no shake — that was removed deliberately) or "success" for the
 * checkmark. Callers that pass nothing keep the old idle/loading behaviour.
 */
export function SubmitButton({
  loading,
  loadingLabel,
  status = "idle",
  successLabel = "Done",
  children,
  className,
  ...props
}) {
  const state = loading
    ? "loading"
    : status === "success" || status === "error"
    ? status
    : "idle";
  // Error keeps the idle label on screen so the button still says what it does.
  const activeLayer = state === "error" ? "idle" : state;

  return (
    <Button
      type="submit"
      size="lg"
      aria-busy={loading || undefined}
      data-state={state}
      className={cn("auth-submit h-11 w-full text-sm font-semibold", className)}
      {...props}
    >
      <span className="auth-submit__stack">
        <span
          className="auth-submit__layer"
          data-layer="idle"
          data-active={activeLayer === "idle"}
          aria-hidden={activeLayer === "idle" ? undefined : "true"}
        >
          {children}
        </span>

        <span
          className="auth-submit__layer"
          data-layer="loading"
          data-active={activeLayer === "loading"}
          aria-hidden={activeLayer === "loading" ? undefined : "true"}
        >
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {loadingLabel}
        </span>

        <span
          className="auth-submit__layer"
          data-layer="success"
          data-active={activeLayer === "success"}
          aria-hidden={activeLayer === "success" ? undefined : "true"}
        >
          <Check className="h-4 w-4" aria-hidden="true" />
          {successLabel}
        </span>
      </span>
    </Button>
  );
}

/**
 * Segmented control used for role / mode selection.
 *
 * The selected pill is a separate absolutely-positioned element that slides
 * between options on `transform` alone — its width is a static calc over the
 * option count (options are equal-width `flex-1` children), so nothing
 * animates a layout property. If the value is unknown the indicator is simply
 * not rendered.
 */
export function SegmentedControl({ label, options, value, onChange, className }) {
  const activeIndex = options.findIndex((option) => option.value === value);

  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "auth-segmented flex gap-1 rounded-lg border border-border bg-muted/50 p-1",
        className
      )}
      style={{
        "--auth-seg-count": String(options.length),
        "--auth-seg-index": String(Math.max(activeIndex, 0)),
      }}
    >
      {activeIndex >= 0 && (
        <span
          aria-hidden="true"
          className="auth-segmented__indicator rounded-md bg-card shadow-card"
        />
      )}

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
              "relative z-10 min-h-[44px] min-w-0 flex-1 truncate rounded-md px-1.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background sm:px-2",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
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
          <li key={key} className="auth-check flex items-center gap-2 text-xs" data-met={met}>
            <span
              aria-hidden="true"
              className={cn(
                "auth-check__dot flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold leading-none",
                met ? "border-success bg-success text-success-foreground" : "border-border"
              )}
            >
              {/* The mark scales/fades in; the dot's colours cross-fade under it. */}
              <span className="auth-check__mark">&#10003;</span>
            </span>
            <span className={cn("auth-check__label", met ? "text-foreground" : "text-muted-foreground")}>
              {label}
              <span className="sr-only">{met ? " — met" : " — not met"}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
