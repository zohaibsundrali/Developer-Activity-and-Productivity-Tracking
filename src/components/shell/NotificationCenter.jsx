"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Bell,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  AlertTriangle,
  X,
  History,
} from "lucide-react";
import useNotifications from "@/hooks/useNotifications";
import { CATEGORY_KEYS, categoryMeta, notificationHref } from "@/utils/notifications";
import { categoryIcon, toneClass, getTimeAgo } from "./notificationVisuals";

/**
 * The notification centre: one panel behind both dashboards' bells.
 *
 * The admin and developer dropdowns were near-identical copies that had already
 * drifted (different icons, different time formats, different bugs). Everything
 * that differs between the two surfaces is now the `audience` prop, which is
 * also what decides where a notification takes you.
 */

export default function NotificationCenter({ audience = "admin", userId = null, email = null }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);
  const router = useRouter();

  const {
    rows,
    unreadCount,
    category,
    setCategory,
    unreadOnly,
    setUnreadOnly,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
    markOneRead,
    markEveryRead,
    dismissOne,
    refresh,
  } = useNotifications({ userId, email, audience });

  // Close on an outside click, and on Escape — the panel traps nothing, so the
  // keyboard needs a way out that is not "find the bell again".
  useEffect(() => {
    if (!isOpen) return undefined;

    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const chips = useMemo(
    () => [
      { key: null, label: "All" },
      ...CATEGORY_KEYS.map((key) => ({ key, label: categoryMeta(key).label })),
    ],
    []
  );

  // Everything a row needs to render, resolved once per list change rather than
  // per render pass: icon component, tone classes, destination, timestamp.
  const items = useMemo(
    () =>
      rows.map((row) => {
        const meta = categoryMeta(row.category);
        return {
          row,
          href: notificationHref(row, { audience }),
          Icon: categoryIcon(meta),
          toneClass: toneClass(meta),
          label: meta.label,
          timeAgo: getTimeAgo(row.created_at),
        };
      }),
    [rows, audience]
  );

  const badgeLabel = unreadCount > 99 ? "99+" : String(unreadCount);

  const handleOpenRow = (item) => {
    if (!item.href) return;
    if (!item.row.read) markOneRead(item.row.id);
    setIsOpen(false);
    router.push(item.href);
  };

  return (
    <div className="relative" ref={containerRef}>
      {/* Bell */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative rounded-lg border border-border bg-card p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="Notifications"
        aria-label={unreadCount > 0 ? `Notifications, ${badgeLabel} unread` : "Notifications"}
        aria-expanded={isOpen}
      >
        <Bell className="w-5 h-5" />

        {unreadCount > 0 && (
          <span
            className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full
              bg-destructive px-1 text-xs font-bold text-destructive-foreground"
          >
            {badgeLabel}
          </span>
        )}
      </button>

      {/* Panel */}
      {isOpen && (
        <div
          className="absolute right-0 mt-2 w-[min(26rem,calc(100vw-2rem))] bg-popover shadow-popover rounded-xl
            border border-border z-50 max-h-[70vh] flex flex-col animate-fade-in"
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-border bg-muted/50 rounded-t-xl">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-bold text-foreground">Notifications</h3>
              <button
                onClick={markEveryRead}
                disabled={unreadCount === 0}
                className="flex items-center gap-1.5 text-sm font-medium text-primary transition-colors
                  hover:text-primary/80 disabled:cursor-not-allowed disabled:text-muted-foreground disabled:hover:text-muted-foreground"
              >
                <CheckCheck className="w-4 h-4" />
                {/* "All" means the list under the button, which a chip narrows.
                    Saying "all" over a filtered list promises a bulk action
                    across every category that this no longer performs. */}
                <span>{category ? "Mark these read" : "Mark all as read"}</span>
              </button>
            </div>

            {/* Unread-only toggle */}
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">
                {unreadCount > 0 ? `${badgeLabel} unread` : "All caught up"}
              </span>
              <button
                onClick={() => setUnreadOnly(!unreadOnly)}
                aria-pressed={unreadOnly}
                className={`rounded-lg border px-2 py-1 text-xs font-medium transition-colors ${
                  unreadOnly
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                Unread only
              </button>
            </div>
          </div>

          {/* Category chips. Eleven categories never fit a dropdown's width, so
              the row scrolls sideways instead of wrapping into a wall. */}
          <div className="border-b border-border px-2 py-2 overflow-x-auto">
            <div className="flex items-center gap-1.5 w-max">
              {chips.map((chip) => {
                const active = chip.key === category;
                return (
                  <button
                    key={chip.key || "all"}
                    onClick={() => setCategory(chip.key)}
                    aria-pressed={active}
                    className={`whitespace-nowrap rounded-lg border px-2 py-1 text-xs font-medium transition-colors ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* List */}
          <div className="overflow-y-auto flex-1">
            {error ? (
              <div className="flex flex-col items-center justify-center py-12 px-4">
                <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mb-3">
                  <AlertTriangle className="w-8 h-8 text-destructive" />
                </div>
                <p className="text-foreground font-medium">Couldn&apos;t load notifications</p>
                <p className="text-muted-foreground text-sm mt-1 text-center">
                  {error.message || "Something went wrong."}
                </p>
                <button
                  onClick={refresh}
                  className="mt-3 flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5
                    text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Try again</span>
                </button>
              </div>
            ) : loading && items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p className="text-muted-foreground text-sm mt-3">Loading notifications…</p>
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4">
                <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-3">
                  <Bell className="w-8 h-8 text-muted-foreground" />
                </div>
                <p className="text-foreground font-medium">No notifications</p>
                <p className="text-muted-foreground text-sm mt-1 text-center">
                  {category || unreadOnly
                    ? "Nothing here under this filter."
                    : "You're all caught up! Check back later for updates."}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((item) => {
                  const isUnread = !item.row.read;
                  const { Icon } = item;

                  const body = (
                    <>
                      <div
                        className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${item.toneClass}`}
                      >
                        <Icon className="w-5 h-5" />
                      </div>

                      <div className="flex-1 min-w-0">
                        {item.row.title && (
                          <p
                            className={`text-sm truncate ${
                              isUnread ? "font-semibold text-foreground" : "font-medium text-foreground"
                            }`}
                          >
                            {item.row.title}
                          </p>
                        )}
                        <p
                          className={`text-sm ${
                            isUnread ? "font-semibold text-foreground" : "text-muted-foreground"
                          }`}
                        >
                          {item.row.message}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          <span className="font-medium text-primary">{item.timeAgo}</span>
                          <span className="mx-1">·</span>
                          <span>{item.label}</span>
                        </p>
                      </div>
                    </>
                  );

                  return (
                    <li
                      key={item.row.id}
                      className={`flex items-start gap-2 px-4 py-3 transition-colors ${
                        isUnread ? "bg-primary/5" : ""
                      } ${item.href ? "hover:bg-muted/50" : ""}`}
                    >
                      {item.href ? (
                        <button
                          type="button"
                          onClick={() => handleOpenRow(item)}
                          className="flex flex-1 items-start gap-3 text-left min-w-0"
                        >
                          {body}
                          <ChevronRight className="w-4 h-4 flex-shrink-0 text-muted-foreground mt-3" />
                        </button>
                      ) : (
                        // Nothing to open: rendered as plain content so it does
                        // not offer a click that would go nowhere.
                        <div className="flex flex-1 items-start gap-3 cursor-default min-w-0">{body}</div>
                      )}

                      <div className="flex flex-shrink-0 items-center gap-0.5">
                        {isUnread && (
                          <button
                            type="button"
                            onClick={() => markOneRead(item.row.id)}
                            title="Mark as read"
                            aria-label="Mark as read"
                            className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                        )}

                        {/* Dismiss is offered on read and unread rows alike:
                            "I have seen this and want it gone" is a different
                            statement from "I have read it", and a row that must
                            be marked read before it can be cleared makes the
                            two indistinguishable in the record. */}
                        <button
                          type="button"
                          onClick={() => dismissOne(item.row.id)}
                          title="Dismiss"
                          aria-label="Dismiss notification"
                          className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Footer. Rendered whenever the list itself loaded, including when it
              came back empty: the way out to the full history is the one thing
              a user needs MOST from an empty panel — the row they are looking
              for is either older than this page or already dismissed. */}
          {!error && (
            <div className="px-4 py-3 border-t border-border bg-muted/50 rounded-b-xl">
              {hasMore && items.length > 0 && (
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="w-full flex items-center justify-center space-x-2 text-sm font-medium
                    text-primary hover:text-primary/80 transition-colors py-2 mb-2
                    disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loadingMore ? (
                    <>
                      <Loader2 className="animate-spin h-4 w-4 text-primary" />
                      <span>Loading…</span>
                    </>
                  ) : (
                    <>
                      <span>Load more</span>
                      <ChevronDown className="w-4 h-4" />
                    </>
                  )}
                </button>
              )}

              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  {items.length > 0
                    ? `Showing ${items.length} notification${items.length !== 1 ? "s" : ""}${
                        hasMore ? "" : " · all loaded"
                      }`
                    : "Nothing in this view"}
                </span>

                <Link
                  href="/notifications"
                  onClick={() => setIsOpen(false)}
                  className="flex flex-shrink-0 items-center gap-1.5 text-sm font-medium text-primary
                    transition-colors hover:text-primary/80"
                >
                  <History className="w-4 h-4" />
                  <span>Full history</span>
                </Link>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
