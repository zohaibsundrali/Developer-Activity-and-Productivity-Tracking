"use client";

import { BarChart3, Clock, ShieldCheck } from "lucide-react";

import AuthBackdrop from "@/components/auth/AuthBackdrop";
import { BRAND_NAME } from "@/components/brand/brand";
import { LogoMark } from "@/components/brand/Logo";
import "@/styles/auth-motion.css";

/**
 * Presentational only — no auth, no data, no redirects.
 * Split pane: a quiet brand column on large screens, the form on the right.
 * On mobile the form is full-bleed (no cramped card) and the brand collapses
 * to a single lockup above the form.
 *
 * Motion lives in src/styles/auth-motion.css. Entrance is a staggered
 * fade-and-rise: 400ms each, ~60ms apart, all of it `animation-fill-mode:
 * both` so nothing waits on JS and every control is clickable from the first
 * paint. `prefers-reduced-motion: reduce` turns the whole thing off.
 */

/** Entrance helper — sets the per-item stagger without a wrapper component. */
export const enterDelay = (ms) => ({ "--auth-enter-delay": `${ms}ms` });

const DEFAULT_HIGHLIGHTS = [
  {
    icon: Clock,
    title: "Automatic time capture",
    description: "Hours, apps and activity recorded without anyone filling in a timesheet.",
  },
  {
    icon: BarChart3,
    title: "Reports people actually read",
    description: "Daily and weekly productivity views, exportable to PDF or Excel.",
  },
  {
    icon: ShieldCheck,
    title: "Isolated by organization",
    description: "Every workspace is tenant-scoped, with role-based access throughout.",
  },
];

export function BrandLockup({ className = "" }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark className="h-9 w-9 shrink-0 text-primary" />
      <span className="font-display text-base font-bold tracking-[-0.015em] text-foreground">{BRAND_NAME}</span>
    </span>
  );
}

export default function AuthShell({ children, highlights = DEFAULT_HIGHLIGHTS, panelTitle }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground lg:flex-row">
      {/* Brand column — decorative context, hidden where space is scarce */}
      <aside className="relative hidden overflow-hidden border-r border-border bg-muted/30 lg:flex lg:w-[42%] lg:max-w-xl lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <AuthBackdrop />

        <div className="auth-enter relative z-10">
          <BrandLockup />
        </div>

        <div className="relative z-10 space-y-10 py-12">
          <h2
            className="auth-enter max-w-sm text-3xl font-semibold leading-[1.15] tracking-tight text-foreground xl:text-4xl"
            style={enterDelay(60)}
          >
            {panelTitle || "The work your team does, measured honestly."}
          </h2>

          <ul className="space-y-7">
            {highlights.map(({ icon: Icon, title, description }, i) => (
              <li
                key={title}
                className="auth-enter flex gap-4"
                style={enterDelay(120 + i * 60)}
              >
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-primary">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="space-y-1">
                  <span className="block text-sm font-medium text-foreground">{title}</span>
                  <span className="block max-w-xs text-sm leading-relaxed text-muted-foreground">
                    {description}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="auth-enter relative z-10 text-xs text-muted-foreground" style={enterDelay(300)}>
          &copy; 2026 {BRAND_NAME}. Activity &amp; productivity tracking.
        </p>
      </aside>

      {/* Form column */}
      <main className="flex flex-1 flex-col">
        <div className="flex flex-1 items-start justify-center px-4 py-8 sm:px-6 sm:py-12 lg:items-center lg:px-8">
          <div className="w-full max-w-md">{children}</div>
        </div>
      </main>
    </div>
  );
}
