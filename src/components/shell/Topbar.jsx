"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Menu, ChevronDown, LogOut, Moon, Sun } from "lucide-react";

// Same namespace as `devtrack.sidebarCollapsed` in AppShell, and the same key
// the pre-paint script in src/app/layout.js reads. If you rename it here you
// must rename it there too — the script runs before any of this module exists.
const THEME_KEY = "devtrack.theme";

/**
 * Toggles the `.dark` class on <html>, which is what `darkMode: ["class"]` in
 * tailwind.config.js keys every dark token off.
 *
 * The icon is driven by the `dark:` variant rather than by React state, so it
 * is correct in the very first server-rendered byte: the pre-paint script in
 * layout.js has already put the class on <html> by the time this HTML is
 * parsed, so there is no wrong-icon flash and no hydration mismatch to
 * suppress. React state is used only for `aria-pressed`, which CSS cannot
 * express — it starts absent and is filled in after mount.
 */
function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  // Follow the OS until the user states a preference. Once they have chosen,
  // their choice wins and this listener stops applying.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event) => {
      let stored = null;
      try {
        stored = window.localStorage.getItem(THEME_KEY);
      } catch {
        /* storage unavailable — fall through and follow the OS */
      }
      if (stored === "dark" || stored === "light") return;
      document.documentElement.classList.toggle("dark", event.matches);
      document.documentElement.style.colorScheme = event.matches ? "dark" : "light";
      // SweetAlert2 reads this, not our class — see layout.js.
      document.documentElement.setAttribute("data-swal2-theme", event.matches ? "dark" : "light");
      setIsDark(event.matches);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const toggle = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    document.documentElement.setAttribute("data-swal2-theme", next ? "dark" : "light");
    // Keeps form controls, scrollbars and the caret in step with the palette.
    document.documentElement.style.colorScheme = next ? "dark" : "light";
    setIsDark(next);
    try {
      window.localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      /* non-fatal — the theme still applies for this page view */
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      // 44px target, matching the mobile menu button.
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      aria-label="Toggle dark theme"
      aria-pressed={mounted ? isDark : undefined}
      title="Toggle dark theme"
    >
      <Moon className="h-5 w-5 dark:hidden" aria-hidden="true" />
      <Sun className="hidden h-5 w-5 dark:block" aria-hidden="true" />
    </button>
  );
}

/**
 * Sticky top bar for the dashboard shell. The notification bell is passed in
 * as `notificationSlot` so each dashboard keeps using its own
 * NotificationDropdown (with its existing props) unchanged. `searchSlot` works
 * the same way for the global search control, which AppShell owns because the
 * palette it opens lives there.
 *
 * There is deliberately no section title here any more. It was a verbatim
 * repeat of the page's own <h1> — the same string from sectionTitles.js
 * rendered twice, 24px apart — and the <h1> is the canonical one (the e2e
 * suite addresses screens by `getByRole('heading', { level: 1 })`). Nothing
 * referenced this element: it carried no `id`, so no `aria-labelledby` could
 * point at it, and no test or QA script selected it. AppShell still ACCEPTS
 * `title`/`subtitle` — all four callers pass them and they are outside this
 * change — it just no longer forwards them here.
 */
export default function Topbar({
  user,
  role = "developer",
  notificationSlot,
  searchSlot,
  onOpenMobile,
  onLogout,
  navPending = false,
}) {
  const displayName = user?.full_name || user?.name || "";
  const displayEmail = user?.email || "";
  const initial = (displayName || "U").charAt(0).toUpperCase();
  const roleWord = role ? role.charAt(0).toUpperCase() + role.slice(1) : "";

  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const wrapperRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  // Escape closes and hands focus back to the trigger; a click anywhere else
  // closes without stealing focus.
  useEffect(() => {
    if (!menuOpen) return;

    // Focus the first item so the menu is operable from the keyboard.
    const first = menuRef.current?.querySelector("[data-menu-item]");
    first?.focus();

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setMenuOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      // Tabbing out of the menu closes it rather than leaving an orphaned
      // popover open behind the rest of the page.
      window.requestAnimationFrame(() => {
        if (!wrapperRef.current?.contains(document.activeElement)) {
          setMenuOpen(false);
        }
      });
    };

    const onPointerDown = (event) => {
      if (!wrapperRef.current?.contains(event.target)) setMenuOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-card/80 px-4 backdrop-blur-md sm:gap-3 sm:px-6">
      {/* Mobile menu. Explicit 44px box rather than padding around a 20px
          glyph: `p-2` made this a 36px target, and it is the only way into
          navigation on a phone. */}
      <button
        type="button"
        onClick={onOpenMobile}
        className="-ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:hidden"
        aria-label="Open menu"
        aria-controls="app-sidebar"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>

      {/* Pushes the account controls to the trailing edge. The title that used
          to fill this space is gone — see the note on the component. */}
      <div className="min-w-0 flex-1" />

      <div className="flex items-center gap-1 sm:gap-2">
        {searchSlot}
        <ThemeToggle />
        {notificationSlot}

        <div ref={wrapperRef} className="relative ml-1 sm:ml-2 sm:border-l sm:border-border sm:pl-2">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className={cn(
              "flex min-h-11 items-center gap-2 rounded-lg p-1 pr-1.5 transition-colors duration-150 hover:bg-muted",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              menuOpen && "bg-muted"
            )}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            aria-label={displayName ? `Account menu for ${displayName}` : "Account menu"}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
              {initial}
            </span>
            <span className="hidden min-w-0 text-left sm:block">
              <span className="block max-w-[12rem] truncate text-sm font-semibold text-foreground">
                {displayName}
              </span>
              <span className="block max-w-[12rem] truncate text-xs text-muted-foreground">
                {displayEmail}
              </span>
            </span>
            <ChevronDown
              className={cn(
                "hidden h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none sm:block",
                menuOpen && "rotate-180"
              )}
              aria-hidden="true"
            />
          </button>

          {menuOpen && (
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              aria-label="Account"
              className="absolute right-0 z-50 mt-2 w-64 animate-fade-in motion-reduce:animate-none overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-popover"
            >
              <div className="border-b border-border px-4 py-3">
                <p className="truncate text-sm font-semibold text-foreground">
                  {displayName || "Signed in"}
                </p>
                {displayEmail && (
                  <p className="truncate text-xs text-muted-foreground">{displayEmail}</p>
                )}
                {roleWord && (
                  <p className="mt-1 text-xs font-medium text-muted-foreground">{roleWord}</p>
                )}
              </div>
              {onLogout && (
                <button
                  type="button"
                  role="menuitem"
                  data-menu-item
                  onClick={() => {
                    setMenuOpen(false);
                    onLogout();
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-destructive transition-colors duration-150 hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  Sign out
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Client-side route transition indicator.
          Deliberately a hairline on the topbar's own bottom edge and NOT an
          overlay: the screen you are leaving stays readable and clickable while
          the next section resolves, which is the whole point of doing the
          navigation in a transition. It only ever appears if the transition is
          slow enough to see — a fast section switch commits before the bar has
          grown wide enough to register. `aria-hidden` because the live region
          announcing the wait lives on <main> in AppShell; two announcements for
          one event is noise. */}
      {navPending && (
        <>
          <style>{TOPBAR_PROGRESS_CSS}</style>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden"
          >
            <span className="topbar-nav-progress block h-full bg-primary" />
          </span>
        </>
      )}
    </header>
  );
}

// Eases towards — but never reaches — full width, because the transition ends
// at an unknown time and a bar that completes on its own would be lying. It is
// unmounted the moment the navigation commits.
const TOPBAR_PROGRESS_CSS = `
@keyframes topbar-nav-progress {
  0%   { width: 0%; }
  40%  { width: 55%; }
  100% { width: 90%; }
}
.topbar-nav-progress {
  width: 0%;
  animation: topbar-nav-progress 4s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
@media (prefers-reduced-motion: reduce) {
  .topbar-nav-progress { width: 100%; animation: none; opacity: 0.6; }
}
`;
