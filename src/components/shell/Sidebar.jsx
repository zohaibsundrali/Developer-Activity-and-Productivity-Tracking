"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { LogOut, ChevronLeft, ChevronDown, X } from "lucide-react";
// The same hook Modal/Drawer use: focus trap, Escape, focus restore and body
// scroll lock. The rail can't be a <Drawer> — its panel is a padded bg-card
// box and this is flush dark chrome — but the dialog behaviour must not be a
// second implementation.
import { useDialog } from "@/components/ui/use-dialog";
import { BRAND_NAME } from "@/components/brand/brand";
import { LogoMark } from "@/components/brand/Logo";

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
  brandName = BRAND_NAME,
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
  const navRef = useRef(null);

  // Whether the nav still has sections above / below the visible slice.
  //
  // The rail is taller than the viewport as soon as the admin nav is rendered
  // (scrollHeight 999 against clientHeight 711 at 1440x900), so the last row on
  // screen is severed mid-glyph by the footer's top edge with nothing saying
  // that five more sections — Team Stats, Organization, Clients, Billing,
  // System Health — exist below it. These two booleans drive a fade at each
  // overflowing edge plus a "more below" cue, so the cut is legible as a scroll
  // position rather than as a rendering bug. Presentation only: nothing here
  // changes what is in `navItems`.
  const [navAtTop, setNavAtTop] = useState(true);
  const [navAtBottom, setNavAtBottom] = useState(true);

  const measureNav = useCallback(() => {
    const el = navRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    setNavAtTop(el.scrollTop <= 1);
    setNavAtBottom(max <= 1 || el.scrollTop >= max - 1);
  }, []);

  // No dependency array: re-measures after every render, so collapsing to the
  // rail or swapping nav lists re-evaluates the edges immediately.
  useEffect(measureNav);

  useEffect(() => {
    const el = navRef.current;
    if (!el) return undefined;
    el.addEventListener("scroll", measureNav, { passive: true });
    let observer;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measureNav);
      observer.observe(el);
    }
    window.addEventListener("resize", measureNav);
    return () => {
      el.removeEventListener("scroll", measureNav);
      observer?.disconnect();
      window.removeEventListener("resize", measureNav);
    };
  }, [measureNav]);

  const scrollNavDown = () => {
    const el = navRef.current;
    if (!el) return;
    el.scrollBy({ top: Math.round(el.clientHeight * 0.8), behavior: "smooth" });
  };

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
          {/* The mark is its own tile — no wrapper box. `text-sidebar-primary`
              is the indigo lightened for dark ground, and the check is a true
              knockout, so the navy sidebar shows straight through it. */}
          <LogoMark className="h-9 w-9 shrink-0 text-sidebar-primary" />
          {!isRail && (
            <div className="min-w-0">
              <p className="truncate font-display text-sm font-bold tracking-[-0.015em] text-sidebar-primary-foreground">
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

        {/* Nav.
            `min-h-0` on the wrapper is what actually lets the nav shrink below
            its content height inside the flex column; without it a flex item
            floors at its content size and the overflow lands on the footer
            instead of inside the scroller. */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <nav
            ref={navRef}
            // pb-8 keeps the last row clear of the bottom fade, so a nav item is
            // never half-legible under the gradient.
            className="flex-1 overflow-y-auto px-3 pb-8 pt-4 [scrollbar-gutter:stable]"
            aria-label="Sections"
          >
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

          {/* Scroll affordances. Both are inert decoration except the bottom
              cue, which is a real button so the sections below are reachable
              by click as well as by scrolling. */}
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-sidebar to-transparent transition-opacity duration-150 motion-reduce:transition-none",
              navAtTop ? "opacity-0" : "opacity-100"
            )}
          />
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-sidebar to-transparent transition-opacity duration-150 motion-reduce:transition-none",
              navAtBottom ? "opacity-0" : "opacity-100"
            )}
          />
          {!navAtBottom && (
            <button
              type="button"
              onClick={scrollNavDown}
              // Sits over the fade, centred, so it reads as the edge of the
              // list rather than as another nav item.
              className={cn(
                "absolute bottom-1 left-1/2 flex h-8 -translate-x-1/2 items-center gap-1 rounded-full border border-sidebar-border bg-sidebar-accent px-3 text-[11px] font-semibold text-sidebar-foreground shadow-card transition-colors duration-150 hover:text-sidebar-primary-foreground motion-reduce:transition-none",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
                isRail && "px-0 h-8 w-8 justify-center"
              )}
              aria-label="Scroll navigation down for more sections"
            >
              <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
              {!isRail && <span>More</span>}
            </button>
          )}
        </div>

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
