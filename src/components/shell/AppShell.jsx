"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import CommandPalette from "./CommandPalette";
import GlobalSearchButton from "./GlobalSearchButton";
import { BRAND_NAME } from "@/components/brand/brand";

// Deliberately still "devtrack.*" after the rename to Verisade. This key names a
// slot in a real user's browser, not the product — changing it would silently
// reset the sidebar preference of everyone already using the app, which is a
// worse outcome than an out-of-date string nobody sees.
const COLLAPSE_KEY = "devtrack.sidebarCollapsed";

/**
 * Full dashboard chrome: premium left sidebar + sticky topbar + content area.
 * Drop-in replacement for the old <Header/> + <Navigation/> + dashed-box shell.
 * All navigation/notification/logout behaviour is passed through unchanged.
 */
export default function AppShell({
  role = "developer",
  brandName = BRAND_NAME,
  navItems = [],
  activeSection,
  onNavigate,
  user,
  onLogout,
  title,
  subtitle,
  notificationSlot,
  // True while a client-side route transition is in flight (React's
  // `useTransition` isPending). The shell stays mounted and interactive; this
  // only drives the hairline progress bar and the busy state on <main>.
  navPending = false,
  children,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  // The shell owns the palette's open state because two things reach for it —
  // the topbar button and the global Cmd+K listener inside CommandPalette.
  const [searchOpen, setSearchOpen] = useState(false);

  // Restore the collapse preference after mount (never during render, so the
  // server and first client paint agree).
  useEffect(() => {
    try {
      if (window.localStorage.getItem(COLLAPSE_KEY) === "1") setCollapsed(true);
    } catch {
      /* storage unavailable — the default expanded rail is fine */
    }
  }, []);

  const toggleCollapse = useCallback(() => {
    setCollapsed((value) => {
      const next = !value;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* non-fatal */
      }
      return next;
    });
  }, []);

  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const openMobile = useCallback(() => setMobileOpen(true), []);

  // Crossing into the desktop breakpoint retires the drawer. Without this the
  // drawer stays "open" in state after a rotate/resize, so the next time the
  // window narrows the overlay is already covering the page.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(min-width: 1024px)");
    const onChange = (event) => {
      if (event.matches) setMobileOpen(false);
    };
    if (query.matches) setMobileOpen(false);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <a
        href="#main-content"
        className="sr-only left-4 top-4 z-[60] rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-elevated focus:not-sr-only focus:fixed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        Skip to content
      </a>

      <Sidebar
        role={role}
        brandName={brandName}
        navItems={navItems}
        activeSection={activeSection}
        onNavigate={onNavigate}
        user={user}
        onLogout={onLogout}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        mobileOpen={mobileOpen}
        onCloseMobile={closeMobile}
      />

      <div
        className={cn(
          "flex min-h-screen flex-col transition-[padding] duration-300 ease-in-out motion-reduce:transition-none",
          collapsed ? "lg:pl-[76px]" : "lg:pl-64"
        )}
      >
        <Topbar
          title={title}
          subtitle={subtitle}
          user={user}
          role={role}
          notificationSlot={notificationSlot}
          searchSlot={<GlobalSearchButton onClick={() => setSearchOpen(true)} />}
          onOpenMobile={openMobile}
          onLogout={onLogout}
          navPending={navPending}
        />

        <main
          id="main-content"
          tabIndex={-1}
          aria-busy={navPending || undefined}
          className="flex-1 px-4 py-6 sm:px-6 lg:px-8"
        >
          {/* Announced once per transition, and only for screen readers — the
              sighted cue is the topbar hairline. */}
          {navPending && (
            <span className="sr-only" role="status" aria-live="polite">
              Loading section…
            </span>
          )}
          <div className="mx-auto w-full max-w-[1400px] animate-fade-in motion-reduce:animate-none">{children}</div>
        </main>
      </div>

      {/* Always mounted, not gated on `searchOpen` — the component carries the
          window-level Cmd+K listener, which has to be live while it is shut. */}
      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
