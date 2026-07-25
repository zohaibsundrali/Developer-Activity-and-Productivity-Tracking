"use client";

import { cn } from "@/lib/utils";
import { LogOut, ChevronLeft, X, ShieldCheck } from "lucide-react";

/**
 * Premium dark sidebar shared by the Admin and Developer dashboards.
 * Purely presentational — navigation still flows through the existing
 * onNavigate(sectionId) handler, so no dashboard logic changes.
 */
export default function Sidebar({
  role = "developer",
  brandName = "DevTrack",
  navItems = [],
  activeSection,
  onNavigate,
  user,
  onLogout,
  collapsed = false,
  onToggleCollapse,
  mobileOpen = false,
  onCloseMobile,
}) {
  // Pretty role word (owner/admin/manager/developer/employee/client).
  const roleWord = role ? role.charAt(0).toUpperCase() + role.slice(1) : "Developer";
  const displayName = user?.full_name || user?.name || roleWord;
  const displayEmail = user?.email || "";
  const initial = (displayName || "U").charAt(0).toUpperCase();
  // Multi-tenant: show the role alongside the organization/workspace name so
  // Manager/Employee (and every other role) is visible in the sidebar.
  const roleLabel = user?.organization_name
    ? `${roleWord} · ${user.organization_name}`
    : `${roleWord} Workspace`;

  const handleNav = (id) => {
    onNavigate?.(id);
    onCloseMobile?.();
  };

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm lg:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "sidebar-scroll fixed inset-y-0 left-0 z-50 flex flex-col bg-sidebar text-sidebar-foreground",
          "border-r border-sidebar-border transition-[width,transform] duration-300 ease-in-out",
          collapsed ? "w-[76px]" : "w-64",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          "lg:translate-x-0"
        )}
      >
        {/* Brand */}
        <div className={cn(
          "flex h-16 items-center gap-3 border-b border-sidebar-border px-4",
          collapsed && "justify-center px-0"
        )}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-lg shadow-black/20">
            <ShieldCheck className="h-5 w-5" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-white">{brandName}</p>
              <p className="truncate text-[11px] font-medium text-sidebar-muted">{roleLabel}</p>
            </div>
          )}
          {/* Mobile close */}
          <button
            onClick={onCloseMobile}
            className="ml-auto rounded-lg p-1.5 text-sidebar-muted hover:bg-sidebar-accent hover:text-white lg:hidden"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {!collapsed && (
            <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted">
              Menu
            </p>
          )}
          <ul className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              return (
                <li key={item.id}>
                  <button
                    onClick={() => handleNav(item.id)}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      collapsed && "justify-center px-0",
                      isActive
                        ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md shadow-black/20"
                        : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-white"
                    )}
                  >
                    {isActive && !collapsed && (
                      <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-white/80" />
                    )}
                    {Icon && <Icon className="h-[18px] w-[18px] shrink-0" />}
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* User + logout */}
        <div className="border-t border-sidebar-border p-3">
          <div className={cn(
            "flex items-center gap-3 rounded-lg px-2 py-2",
            collapsed && "justify-center px-0"
          )}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground">
              {initial}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{displayName}</p>
                <p className="truncate text-[11px] text-sidebar-muted">{displayEmail}</p>
              </div>
            )}
          </div>
          <button
            onClick={onLogout}
            title={collapsed ? "Logout" : undefined}
            className={cn(
              "mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-destructive/90 hover:text-white",
              collapsed && "justify-center px-0"
            )}
          >
            <LogOut className="h-[18px] w-[18px] shrink-0" />
            {!collapsed && <span>Logout</span>}
          </button>
        </div>

        {/* Desktop collapse toggle */}
        <button
          onClick={onToggleCollapse}
          className="absolute -right-3 top-20 hidden h-6 w-6 items-center justify-center rounded-full border border-sidebar-border bg-sidebar text-sidebar-muted shadow-md transition-transform hover:text-white lg:flex"
          aria-label="Toggle sidebar"
        >
          <ChevronLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
        </button>
      </aside>
    </>
  );
}
