"use client";

import { Menu } from "lucide-react";

/**
 * Sticky top bar for the dashboard shell. The notification bell is passed in
 * as `notificationSlot` so each dashboard keeps using its own
 * NotificationDropdown (with its existing props) unchanged. `searchSlot` works
 * the same way for the global search control, which AppShell owns because the
 * palette it opens lives there.
 */
export default function Topbar({
  title = "Dashboard",
  subtitle,
  user,
  role = "developer",
  notificationSlot,
  searchSlot,
  onOpenMobile,
}) {
  const displayName = user?.full_name || user?.name || "";
  const displayEmail = user?.email || "";
  const initial = (displayName || "U").charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-card/80 px-4 backdrop-blur-md sm:px-6">
      {/* Mobile menu */}
      <button
        onClick={onOpenMobile}
        className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">{title}</h1>
        {subtitle && (
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        {searchSlot}
        {notificationSlot}

        <div className="hidden items-center gap-3 border-l border-border pl-3 sm:flex">
          <div className="text-right">
            <p className="max-w-[14rem] truncate text-sm font-semibold text-foreground">{displayName}</p>
            <p className="max-w-[14rem] truncate text-xs text-muted-foreground">{displayEmail}</p>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
            {initial}
          </div>
        </div>
      </div>
    </header>
  );
}
