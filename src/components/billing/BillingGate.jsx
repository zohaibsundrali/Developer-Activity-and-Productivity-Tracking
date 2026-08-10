"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { AlertTriangle, Clock, Lock } from "lucide-react";

import { authFetch } from "@/utils/authFetch";
import { BRAND_NAME } from "@/components/brand/brand";

/**
 * The trial countdown, and the door that closes at the end of it.
 *
 * Mounted once in src/app/admin/layout.js, so it applies to the whole admin
 * surface without every screen having to remember it.
 *
 * IT IS NOT THE ENFORCEMENT, AND MUST NOT BE MISTAKEN FOR IT.
 *  A locked organization is refused by the server, in
 *  src/utils/entitlements.js — checkResourceLimit, checkSeatLimitForRole and
 *  checkFeatureAccess all consult the same lock before they consult a limit.
 *  Deleting this file would cost a polite screen and change nothing about what
 *  a locked organization can actually do. That distinction matters: a gate the
 *  browser evaluates is a suggestion, and hiding a button is not a permission.
 *
 * IT FAILS OPEN, DELIBERATELY.
 *  Any error, any 401, any unreadable answer renders the children. The worst
 *  outcome of this component is telling a paying customer their workspace is
 *  closed when it is not, so every uncertain path resolves to "let them work".
 */

// Screens this must never gate.
//
//   /admin/registration  is the signup flow — nobody holds a session there, so
//                        the fetch would 401 on every keystroke of a brand-new
//                        account being created.
//   /admin/upgrade       is where a locked admin is SENT. Gating it is an
//                        infinite redirect.
const EXEMPT = ["/admin/registration", "/admin/upgrade"];

export default function BillingGate({ children }) {
  const pathname = usePathname() || "";
  const router = useRouter();

  const [state, setState] = useState(null);
  // Distinguishes "not asked yet" from "asked, not locked". Without it the
  // null state fell through to rendering the children, so a locked admin's
  // FIRST PAINT was the real dashboard — mounted, with all of its own data
  // fetches fired — and it was only replaced once the answer arrived. That is
  // not a cosmetic flash: it is a full render of the surface the gate exists
  // to withhold.
  const [checked, setChecked] = useState(false);
  const exempt = EXEMPT.some((p) => pathname.startsWith(p));

  const load = useCallback(async () => {
    try {
      const res = await authFetch("/api/billing/access");
      if (!res.ok) return; // 401 while a session settles, etc. — stay open.
      const data = await res.json();
      setState(data);
    } catch {
      // Offline, aborted, malformed — all mean "we do not know", and not
      // knowing is not grounds for locking anybody out.
    } finally {
      // In `finally`, so every failure path also releases the children. The
      // gate must never be able to hold the app shut by failing to answer.
      setChecked(true);
    }
  }, []);

  useEffect(() => {
    if (exempt) return;
    load();
  }, [exempt, load, pathname]);

  // A locked admin is taken to the one screen that can fix it. `replace`, not
  // `push`, so Back does not bounce them between the two.
  useEffect(() => {
    if (exempt || !state?.locked || !state?.canPay) return;
    router.replace(state.payUrl || "/admin/upgrade");
  }, [exempt, state, router]);

  if (exempt) return children;

  // Held only until the first answer arrives — one request, already in flight.
  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <p className="text-sm text-muted-foreground">Loading your workspace…</p>
      </div>
    );
  }

  // Locked, and this person cannot pay — a developer, or a manager. Showing
  // them a card form would be a dead end, so they get the reason and the name
  // of the person who can act.
  if (state?.locked && !state.canPay) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-card">
          <span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground">
            <Lock className="h-5 w-5" aria-hidden="true" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            This workspace is paused
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {state.message ||
              `Your organization's ${BRAND_NAME} subscription needs attention.`}{" "}
            An owner or admin can restore access from the Billing screen.
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            Your data is untouched and nothing has been deleted.
          </p>
        </div>
      </div>
    );
  }

  // Locked and able to pay: the redirect above is already running. Render a
  // quiet holding screen rather than a flash of the dashboard behind it.
  if (state?.locked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <p className="text-sm text-muted-foreground">Taking you to billing…</p>
      </div>
    );
  }

  return (
    <>
      {children}
      {state?.onTrial && typeof state.daysRemaining === "number" && (
        <TrialPill days={state.daysRemaining} planName={state.planName} payUrl={state.payUrl} />
      )}
    </>
  );
}

/**
 * The countdown, as a floating card rather than a strip at the top of the page.
 *
 * A banner above the shell would push the whole fixed-sidebar layout down by
 * its own height on every admin screen; a fixed element costs no layout at all.
 * It sits bottom-right, out of the reading path, and turns from neutral to
 * warning in the last two days rather than shouting from day seven.
 */
function TrialPill({ days, planName, payUrl }) {
  const urgent = days <= 2;

  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 sm:inset-x-auto sm:right-6 sm:justify-end"
    >
      <div
        className={`pointer-events-auto flex max-w-sm items-start gap-3 rounded-xl border px-4 py-3 shadow-elevated ${
          urgent
            ? "border-warning/40 bg-warning/10"
            : "border-border bg-card"
        }`}
      >
        {urgent ? (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-on-tint" aria-hidden="true" />
        ) : (
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <div className="text-sm leading-relaxed">
          <p className="font-medium text-foreground">
            {days === 0
              ? `Your ${planName || "trial"} trial ends today`
              : days === 1
              ? "1 day left on your trial"
              : `${days} days left on your trial`}
          </p>
          <Link
            href={payUrl || "/admin/upgrade"}
            className="mt-0.5 inline-block font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Add a payment method
          </Link>
        </div>
      </div>
    </div>
  );
}
