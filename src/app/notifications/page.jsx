"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/utils/supabaseClient";
import { Skeleton } from "@/components/ui";
import AppShell from "@/components/shell/AppShell";
import { adminNavFor, staffNav } from "@/components/shell/navConfig";
import NotificationHistory from "@/components/shell/NotificationHistory";
import NotificationPreferences from "@/components/shell/NotificationPreferences";
import { isSessionExpired, clearAdminSession, clearDeveloperSession } from "@/utils/sessionPolicy";

/**
 * The full notification history, for both audiences.
 *
 * ONE route rather than /admin/notifications and /developer/notifications. The
 * two dashboards' bells were the same panel twice and drifted apart; splitting
 * the page the same way would set that up again, and the only thing that
 * actually differs between them — which columns address you, and where a row
 * links to — is already a single `audience` value.
 *
 * That value comes from the session, never from the URL. A `?audience=admin`
 * would be a request to be filtered as an admin, and the filter is what decides
 * whose notifications you are shown.
 *
 * GATE: this path is outside the middleware matcher (/admin, /developer,
 * /client), so the check below is the navigation gate for it. It is not the
 * data gate — that is RLS plus the recipient filter every query carries, both
 * of which hold regardless of what this component believes.
 */

// Ordered: an admin session wins if a tab somehow holds both, because the admin
// surface is the one with more to show and the one they logged into last.
const STAFF_SESSIONS = [
  { storageKey: "adminUser", audience: "admin", clear: clearAdminSession },
  { storageKey: "developerUser", audience: "developer", clear: clearDeveloperSession },
];

function readStored(key) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    // Storage can be unavailable outright (privacy modes, embedded webviews).
    // Unreadable is treated the same as absent: not signed in here.
    return null;
  }
}

function resolveStaffSession() {
  if (typeof window === "undefined") return null;

  for (const candidate of STAFF_SESSIONS) {
    const raw = readStored(candidate.storageKey);
    if (!raw) continue;

    let user = null;
    try {
      user = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!user) continue;

    // The same sliding-expiry rule the dashboards apply. Skipping it here would
    // make this page the one door a stale session still opens.
    if (isSessionExpired(user)) {
      candidate.clear();
      continue;
    }

    return { audience: candidate.audience, user, clear: candidate.clear };
  }

  return null;
}

export default function NotificationsPage() {
  const router = useRouter();
  // `resolving` until the effect has run: sessionStorage does not exist during
  // render on the server, so nothing may be decided from it before mount.
  const [status, setStatus] = useState("resolving");
  const [session, setSession] = useState(null);

  useEffect(() => {
    const resolved = resolveStaffSession();
    if (resolved) {
      setSession(resolved);
      setStatus("ready");
      return;
    }

    setStatus("leaving");
    // A client is signed in, just not to a surface that has a notification
    // centre — sending them to /login would ask them to fix an unbroken session.
    if (readStored("clientUser")) {
      router.replace("/client");
      return;
    }
    router.replace(`/login?redirect=${encodeURIComponent("/notifications")}`);
  }, [router]);

  const user = session?.user || null;
  const audience = session?.audience || "developer";

  const role = useMemo(() => {
    if (!user) return audience === "admin" ? "admin" : "developer";
    return user.membership_role || (audience === "admin" ? "admin" : "developer");
  }, [user, audience]);

  const navItems = useMemo(
    () => (audience === "admin" ? adminNavFor(role) : staffNav(role)),
    [audience, role]
  );

  if (status !== "ready" || !session) {
    // Shaped like the page it is standing in for — history on the left,
    // preferences on the right — so the layout does not rearrange itself the
    // instant the session resolves.
    return (
      <div className="min-h-screen bg-background" role="status" aria-busy="true">
        <span className="sr-only">
          {status === "leaving" ? "Taking you to sign in…" : "Loading notifications…"}
        </span>

        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="space-y-2 pb-6">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-4 w-72" />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-card lg:col-span-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-8 w-full" />
              {[0, 1, 2, 3, 4].map((row) => (
                <div key={row} className="flex items-start gap-3 border-t border-border pt-4">
                  <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-1/3" />
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-2.5 w-40" />
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-card">
              <Skeleton className="h-5 w-48" />
              {[0, 1, 2, 3, 4, 5].map((row) => (
                <div key={row} className="flex items-center gap-3">
                  <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
                  <Skeleton className="h-3.5 flex-1" />
                  <Skeleton className="h-6 w-11 shrink-0 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const dashboardPath = audience === "admin" ? "/admin/dashboard" : "/developer/dashboard";

  const handleNavigate = (sectionId) => {
    // The sidebar's items are dashboard sections, and this is not one of them,
    // so navigating means going back to that dashboard with the section asked
    // for — the same `?section=` the dashboards already read.
    router.push(`${dashboardPath}?section=${sectionId}`);
  };

  const handleLogout = () => {
    try {
      supabase.auth.signOut();
    } catch {
      // Sign-out must not depend on the network call succeeding; the local
      // session is cleared either way.
    }
    session.clear();
    router.push("/login");
  };

  return (
    <AppShell
      role={role}
      brandName="DevTrack"
      navItems={navItems}
      // Deliberately unset: no sidebar item corresponds to this page, and
      // highlighting the nearest one would claim you are somewhere you are not.
      activeSection={null}
      onNavigate={handleNavigate}
      user={user}
      onLogout={handleLogout}
      title="Notifications"
      subtitle="Everything sent to you"
      // No bell in the topbar here. The panel and this page would open the same
      // realtime topic name, and two subscribers on one topic take each other's
      // bindings — the second one's callbacks quietly stop firing.
    >
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <NotificationHistory
            audience={audience}
            userId={user?.id || null}
            // Admin rows are addressed by id OR email; developer rows only ever
            // by id, so passing an address there would widen nothing and is
            // left out explicitly rather than by omission.
            email={audience === "admin" ? user?.email || null : null}
          />
        </div>

        <div className="lg:sticky lg:top-24 lg:self-start">
          <NotificationPreferences />
        </div>
      </div>
    </AppShell>
  );
}
