"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The topbar control that opens the command palette.
 *
 * Discoverability is the whole point: Cmd+K is invisible until something in the
 * chrome says it exists, so the shortcut is printed on the control itself.
 */
export default function GlobalSearchButton({ onClick, className }) {
  // Rendered server-side too, where `navigator` does not exist — and a value
  // that differs between server and first client render is a hydration error.
  // Ctrl is the safe default; Mac users get the swap on mount.
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    try {
      const platform = window.navigator?.platform || "";
      setIsMac(/mac|iphone|ipad|ipod/i.test(platform));
    } catch {
      setIsMac(false);
    }
  }, []);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Search"
      title={isMac ? "Search (⌘K)" : "Search (Ctrl K)"}
      className={cn(
        "flex items-center gap-2 rounded-lg border border-border bg-background/60 p-2 text-muted-foreground",
        "transition-colors hover:bg-muted hover:text-foreground sm:w-56 sm:px-3 sm:py-1.5 lg:w-64",
        className
      )}
    >
      <Search className="h-4 w-4 shrink-0" />
      {/* Below sm the topbar is tight — the control collapses to the icon. */}
      <span className="hidden flex-1 text-left text-sm sm:inline">Search</span>
      <kbd className="hidden shrink-0 rounded-md border border-border bg-muted px-1.5 py-0.5 font-sans text-[10px] font-semibold text-muted-foreground sm:inline-block">
        {isMac ? "⌘K" : "Ctrl K"}
      </kbd>
    </button>
  );
}
