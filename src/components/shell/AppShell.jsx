"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

/**
 * Full dashboard chrome: premium left sidebar + sticky topbar + content area.
 * Drop-in replacement for the old <Header/> + <Navigation/> + dashed-box shell.
 * All navigation/notification/logout behaviour is passed through unchanged.
 */
export default function AppShell({
  role = "developer",
  brandName = "DevTrack",
  navItems = [],
  activeSection,
  onNavigate,
  user,
  onLogout,
  title,
  subtitle,
  notificationSlot,
  children,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar
        role={role}
        brandName={brandName}
        navItems={navItems}
        activeSection={activeSection}
        onNavigate={onNavigate}
        user={user}
        onLogout={onLogout}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((v) => !v)}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div
        className={cn(
          "flex min-h-screen flex-col transition-[padding] duration-300 ease-in-out",
          collapsed ? "lg:pl-[76px]" : "lg:pl-64"
        )}
      >
        <Topbar
          title={title}
          subtitle={subtitle}
          user={user}
          role={role}
          notificationSlot={notificationSlot}
          onOpenMobile={() => setMobileOpen(true)}
        />

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1400px] animate-fade-in">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
