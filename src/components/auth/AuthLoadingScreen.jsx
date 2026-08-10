"use client";

import { Loader2 } from "lucide-react";

import { Logo, BRAND_NAME } from "@/components/brand";
import { cn } from "@/lib/utils";

/**
 * The branded wait a visitor sees while a protected route decides whether they
 * may enter it.
 *
 * WHY THIS EXISTS
 *  A logged-out visitor who typed an app URL used to get an abrupt bounce: the
 *  guard rendered `null` (or nothing at all) for a frame and then the router
 *  threw them at /login. A white flash followed by a screen they did not ask
 *  for reads as a crash, not as a redirect.
 *
 *  So the guard shows this first. It is deliberately the deep brand chrome —
 *  `bg-sidebar`, the same navy the app shell uses — rather than the light form
 *  ground, because it has to be legible as "the product is working" and not as
 *  "a page failed to load". Colour comes entirely from tokens (`--sidebar`,
 *  `--sidebar-primary`, `--sidebar-foreground`); there is not a literal in the
 *  file, so dark mode and any future rebrand come free.
 *
 * PRESENTATIONAL ONLY. It performs no auth check, reads no session and issues
 * no redirect — ProtectedRoute owns all of that and simply renders this while
 * it works. That separation is what lets it be reused for the password-reset
 * gate, which is guarded by a Supabase recovery session rather than an app one.
 */
export default function AuthLoadingScreen({
  message = "Checking your session…",
  className,
  ...props
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        "flex min-h-screen flex-col items-center justify-center gap-6 bg-sidebar px-6 text-center",
        className
      )}
      {...props}
    >
      {/* The full lockup: the mark takes the lighter indigo step defined for
          dark grounds, the wordmark (BRAND_NAME) inherits near-white. */}
      <Logo
        className="animate-fade-in text-xl text-sidebar-primary-foreground motion-reduce:animate-none"
        markClassName="text-sidebar-primary"
      />

      <p className="flex items-center gap-2.5 text-sm text-sidebar-foreground">
        <Loader2
          className="h-4 w-4 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        {message}
      </p>

      {/* Named for screen readers, which otherwise hear only "loading". */}
      <span className="sr-only">{BRAND_NAME}</span>
    </div>
  );
}
