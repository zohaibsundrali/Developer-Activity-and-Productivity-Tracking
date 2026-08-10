"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/contexts/AuthContext";
import AuthLoadingScreen from "./AuthLoadingScreen";

// useLayoutEffect has no meaning on the server and warns if called there.
// Resolved once, at module scope, so the hook call below is unconditional.
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Client-side gate for a protected screen.
 *
 * WHAT IT IS NOT
 *  It is not the security boundary and must never be mistaken for one.
 *  middleware.ts verifies the HMAC-signed HttpOnly session cookie before the
 *  page is served, every API route independently verifies the caller's JWT via
 *  getAuthedOrg, and RLS is role-scoped in the database. This component decides
 *  only what the browser paints while those real gates do their work — and it
 *  reuses the existing centralised check rather than inventing a second one, so
 *  there is no new place for "who is allowed in" to be decided.
 *
 * THE THREE STATES
 *  pending  — the check has not settled. Show the branded screen.
 *  denied   — the check settled negative. Show the branded screen, then
 *             client-side `router.replace` to `redirectTo`. The screen is what
 *             turns the old abrupt bounce into an explained one.
 *  allowed  — render children, and never show the screen again for this mount.
 *
 *  `allowed` is sticky (see allowedRef): once the visitor is known to be
 *  authenticated, a later re-render can no longer flash the loading screen at
 *  them. That is the "must not flash for an already-authenticated user" rule —
 *  the screen appears only while the check is genuinely pending or has failed.
 *
 * AVOIDING THE FIRST-PAINT FLASH
 *  AuthProvider starts `isLoading: true` and settles in a passive effect, which
 *  runs after the browser has painted — so even a signed-in user would see one
 *  frame of the loading screen. The layout effect below calls the context's own
 *  `checkAuth()` instead: layout effects flush synchronously BEFORE paint, so
 *  for a visitor who already has a valid session the very first painted frame
 *  is the page itself. `checkAuth` is a pure read of the stored session plus a
 *  setState — calling it here changes no rule about who is let in, it only
 *  makes the existing answer available a frame earlier.
 *
 * @param {object}   props
 * @param {React.ReactNode} props.children      rendered only when allowed
 * @param {string}  [props.redirectTo="/login"] where a denied visitor is sent
 * @param {boolean} [props.preserveRedirect]    append `?redirect=<path>` so the
 *                                              visitor returns after signing in
 * @param {() => boolean | Promise<boolean>} [props.check]
 *        Optional replacement check, for a screen whose gate is not the app
 *        session — /reset-password is guarded by a live Supabase recovery
 *        session, for instance. MUST be referentially stable (useCallback).
 * @param {string}  [props.loadingMessage]      copy while pending
 * @param {string}  [props.deniedMessage]       copy while redirecting
 */
export default function ProtectedRoute({
  children,
  redirectTo = "/login",
  preserveRedirect = true,
  check,
  loadingMessage = "Checking your session…",
  deniedMessage = "Taking you to sign in…",
}) {
  const router = useRouter();
  const { isLoading, isLoggedIn, checkAuth } = useAuth();

  // Only used when a custom `check` is supplied.
  const [customStatus, setCustomStatus] = useState("pending");

  useIsomorphicLayoutEffect(() => {
    // Custom checks own their own resolution (below); the shared one is
    // resolved here, before paint. See "avoiding the first-paint flash".
    if (check) return;
    checkAuth();
  }, [check, checkAuth]);

  useEffect(() => {
    if (!check) return undefined;

    let active = true;
    setCustomStatus("pending");

    Promise.resolve()
      .then(() => check())
      .then((ok) => {
        if (active) setCustomStatus(ok ? "allowed" : "denied");
      })
      .catch(() => {
        // A check that throws is a check that did not pass. Fail closed.
        if (active) setCustomStatus("denied");
      });

    return () => {
      active = false;
    };
  }, [check]);

  const status = check
    ? customStatus
    : isLoading
    ? "pending"
    : isLoggedIn
    ? "allowed"
    : "denied";

  const allowedRef = useRef(false);
  if (status === "allowed") allowedRef.current = true;
  const effective = allowedRef.current ? "allowed" : status;

  useEffect(() => {
    if (effective !== "denied") return;

    // Client-side navigation on purpose. A hard load here would throw away the
    // React tree and re-download the app just to show a form. `replace` rather
    // than `push` so Back does not bounce off the guard again.
    let target = redirectTo;
    if (preserveRedirect && typeof window !== "undefined") {
      const from = `${window.location.pathname}${window.location.search}`;
      if (from && from !== redirectTo) {
        target = `${redirectTo}?redirect=${encodeURIComponent(from)}`;
      }
    }
    router.replace(target);
  }, [effective, redirectTo, preserveRedirect, router]);

  if (effective === "allowed") return children;

  return (
    <AuthLoadingScreen
      message={effective === "denied" ? deniedMessage : loadingMessage}
    />
  );
}

/**
 * Convenience for the common case of guarding a whole page component.
 *
 *   export default withProtectedRoute(DashboardPage);
 */
export function withProtectedRoute(Component, options = {}) {
  function Guarded(props) {
    return (
      <ProtectedRoute {...options}>
        <Component {...props} />
      </ProtectedRoute>
    );
  }
  Guarded.displayName = `withProtectedRoute(${
    Component.displayName || Component.name || "Component"
  })`;
  return Guarded;
}
