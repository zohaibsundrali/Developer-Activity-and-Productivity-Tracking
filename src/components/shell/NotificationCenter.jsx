"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  UserPlus,
  ArrowRightLeft,
  AtSign,
  MessageSquare,
  Clock,
  ClipboardCheck,
  Rocket,
  FolderKanban,
  Users,
  Zap,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import useNotifications from "@/hooks/useNotifications";
import { CATEGORY_KEYS, categoryMeta, notificationHref } from "@/utils/notifications";

/**
 * The notification centre: one panel behind both dashboards' bells.
 *
 * The admin and developer dropdowns were near-identical copies that had already
 * drifted (different icons, different time formats, different bugs). Everything
 * that differs between the two surfaces is now the `audience` prop, which is
 * also what decides where a notification takes you.
 */

// `categoryMeta` names a lucide icon; lucide has no runtime lookup by name, and
// a dynamic import of the whole set would pull the entire library into the
// bundle, so the eleven categories are wired up explicitly.
const CATEGORY_ICONS = {
  UserPlus,
  ArrowRightLeft,
  AtSign,
  MessageSquare,
  Clock,
  ClipboardCheck,
  Rocket,
  FolderKanban,
  Users,
  Zap,
  Bell,
};

// `tone` from the category metadata, mapped onto the semantic classes that
// already exist — no new colour values enter the design system here.
const TONE_CLASSES = {
  info: "bg-info/10 text-info",
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  muted: "bg-muted text-muted-foreground",
};

function getTimeAgo(dateString) {
  if (!dateString) return "";
  const now = new Date();
  const date = new Date(dateString);
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 60) return "Just now";
  if (seconds < 120) return "1 minute ago";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 7200) return "1 hour ago";
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  if (seconds < 172800) return "1 day ago";
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

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
          Icon: CATEGORY_ICONS[meta.icon] || Bell,
          toneClass: TONE_CLASSES[meta.tone] || TONE_CLASSES.muted,
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
                <span>Mark all as read</span>
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

                      {isUnread && (
                        <button
                          type="button"
                          onClick={() => markOneRead(item.row.id)}
                          title="Mark as read"
                          aria-label="Mark as read"
                          className="flex-shrink-0 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Footer */}
          {!error && items.length > 0 && (
            <div className="px-4 py-3 border-t border-border bg-muted/50 rounded-b-xl">
              {hasMore && (
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

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Showing {items.length} notification{items.length !== 1 ? "s" : ""}
                </span>
                {!hasMore && <span className="text-muted-foreground text-xs">All loaded</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
