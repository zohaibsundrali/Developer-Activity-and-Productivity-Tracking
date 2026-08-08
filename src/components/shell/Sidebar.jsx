"use client";

import { useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { LogOut, ChevronLeft, X, ShieldCheck } from "lucide-react";
// The same hook Modal/Drawer use: focus trap, Escape, focus restore and body
// scroll lock. The rail can't be a <Drawer> — its panel is a padded bg-card
// box and this is flush dark chrome — but the dialog behaviour must not be a
// second implementation.
import { useDialog } from "@/components/ui/use-dialog";

/**
 * Group the flat nav list into labelled sections. An item may carry an
 * optional `group` label; consecutive items sharing one land in the same
 * section. Lists with no `group` at all collapse to a single "Menu" section,
 * which is exactly what the previous flat sidebar rendered.
 */
function groupNavItems(navItems) {
  const groups = [];
  navItems.forEach((item) => {
    const name = item.group || "Menu";
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.items.push(item);
    else groups.push({ name, items: [item] });
  });
  return groups;
}

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
  const asideRef = useRef(null);

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

  // Collapsing is a desktop-only preference. While the mobile drawer is open
  // the rail must render at full width with labels — a 76px icon rail is
  // unusable as a drawer, and it is what you got before if you had ever
  // collapsed the sidebar on desktop.
  const isRail = collapsed && !mobileOpen;

  const groups = useMemo(() => groupNavItems(navItems), [navItems]);

  const handleNav = (id) => {
    onNavigate?.(id);
    onCloseMobile?.();
  };

  // Mobile drawer behaviour — Escape, focus trap, focus restore and scroll
  // lock — all from the kit's shared dialog hook. Inert on desktop, where
  // `mobileOpen` is forced false and the rail is permanent chrome.
  useDialog({ open: mobileOpen, onClose: onCloseMobile, containerRef: asideRef });

  return (
    <>
      {/* Mobile overlay */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-foreground/40 backdrop-blur-sm transition-opacity duration-300 motion-reduce:transition-none lg:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none invisible opacity-0"
        )}
        onClick={onCloseMobile}
        aria-hidden="true"
      />

      <aside
        ref={asideRef}
        id="app-sidebar"
        // Only a modal surface on mobile; from `lg` up it is permanent chrome.
        role={mobileOpen ? "dialog" : undefined}
        aria-modal={mobileOpen ? "true" : undefined}
        aria-label={mobileOpen ? "Main navigation" : undefined}
        className={cn(
          "sidebar-scroll fixed inset-y-0 left-0 z-50 flex flex-col bg-sidebar text-sidebar-foreground",
          "border-r border-sidebar-border ease-in-out",
          // `visibility` is in the transition so the drawer still slides out
          // before it becomes untabbable, rather than vanishing instantly.
          "transition-[width,transform,visibility] duration-300 motion-reduce:transition-none",
          isRail ? "w-[76px]" : "w-64",
          mobileOpen ? "translate-x-0" : "invisible -translate-x-full",
          "lg:visible lg:translate-x-0"
        )}
      >
        {/* Brand */}
        <div
          className={cn(
            "flex h-16 shrink-0 items-center gap-3 border-b border-sidebar-border px-4",
            isRail && "justify-center px-0"
          )}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-card">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          {!isRail && (
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-sidebar-primary-foreground">
                {brandName}
              </p>
              <p className="truncate text-[11px] font-medium text-sidebar-muted">{roleLabel}</p>
            </div>
          )}
          {/* Mobile close */}
          <button
            type="button"
            onClick={onCloseMobile}
            className="ml-auto rounded-lg p-1.5 text-sidebar-muted transition-colors duration-150 hover:bg-sidebar-accent hover:text-sidebar-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar lg:hidden"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Sections">
          {groups.map((group, groupIndex) => (
            <div
              key={`${group.name}-${groupIndex}`}
              className={cn(
                groupIndex > 0 && "mt-5",
                // Collapsed to a rail there is no room for a heading, so the
                // sections are separated by a rule instead.
                groupIndex > 0 && isRail && "border-t border-sidebar-border pt-4"
              )}
            >
              {!isRail && (
                <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted">
                  {group.name}
                </p>
              )}
              <ul className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeSection === item.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => handleNav(item.id)}
                        title={isRail ? item.label : undefined}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors duration-150",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
                          isRail && "justify-center px-0",
                          isActive
                            ? // Active is carried by three signals at once —
                              // fill, weight and the rail marker — so it does
                              // not depend on colour perception alone.
                              "bg-sidebar-primary font-semibold text-sidebar-primary-foreground shadow-card"
                            : "font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-primary-foreground"
                        )}
                      >
                        {isActive && (
                          <span
                            aria-hidden="true"
                            // Stays inside the button: `nav` scrolls on the Y
                            // axis, which clips the X axis too, so a marker
                            // hung outside the button would be cut off.
                            className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-sidebar-primary-foreground/80"
                          />
                        )}
                        {Icon && <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />}
                        {!isRail && <span className="truncate">{item.label}</span>}
                        {isRail && <span className="sr-only">{item.label}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* User + logout */}
        <div className="shrink-0 border-t border-sidebar-border p-3">
          <div
            className={cn(
              "flex items-center gap-3 rounded-lg px-2 py-2",
              isRail && "justify-center px-0"
            )}
          >
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground"
              title={isRail ? displayName : undefined}
            >
              {initial}
            </div>
            {!isRail && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-sidebar-primary-foreground">
                  {displayName}
                </p>
                <p className="truncate text-[11px] text-sidebar-muted">{displayEmail}</p>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onLogout}
            title={isRail ? "Logout" : undefined}
            className={cn(
              "mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground transition-colors duration-150 hover:bg-destructive hover:text-destructive-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
              isRail && "justify-center px-0"
            )}
          >
            <LogOut className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
            {isRail ? <span className="sr-only">Logout</span> : <span>Logout</span>}
          </button>
        </div>

        {/* Desktop collapse toggle */}
        <button
          type="button"
          onClick={onToggleCollapse}
          className="absolute -right-3 top-20 hidden h-6 w-6 items-center justify-center rounded-full border border-sidebar-border bg-sidebar text-sidebar-muted shadow-card transition-colors duration-150 hover:text-sidebar-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:flex"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          aria-controls="app-sidebar"
        >
          <ChevronLeft
            className={cn("h-4 w-4 transition-transform duration-300 motion-reduce:transition-none", collapsed && "rotate-180")}
            aria-hidden="true"
          />
        </button>
      </aside>
    </>
  );
}
