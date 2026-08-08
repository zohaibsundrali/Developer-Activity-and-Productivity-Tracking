"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
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
} from "lucide-react";
import useNotifications from "@/hooks/useNotifications";
import { CATEGORY_KEYS, categoryMeta, notificationHref } from "@/utils/notifications";
import {
  categoryIcon,
  toneClass,
  getTimeAgo,
  getClockTime,
  dayBucket,
  DAY_BUCKETS,
} from "./notificationVisuals";

/**
 * The full notification history.
 *
 * The same rows as the bell, with the space the dropdown does not have: day
 * headings instead of eleven "3 hours ago"s in a column, the clock time next to
 * the relative one, and the whole message rather than as much of it as 26rem
 * allows.
 *
 * It reads through the same `useNotifications` hook, and therefore the same
 * `fetchNotifications`, as the dropdown. A second query path here would be a
 * second place for the recipient filter and the dismissed predicate to be got
 * wrong, and the failure mode of getting either one wrong is one person seeing
 * another person's notifications.
 *
 * `audience` decides which columns address the reader and where a row links to,
 * exactly as it does in the dropdown; the page above resolves it from the
 * session rather than this component guessing.
 */

// Larger than the dropdown's 15: a full page can show more before asking, and
// each request costs the same round trip either way.
const PAGE_SIZE = 25;

export default function NotificationHistory({ audience = "admin", userId = null, email = null }) {
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
  } = useNotifications({ userId, email, audience, pageSize: PAGE_SIZE });

  const chips = useMemo(
    () => [{ key: null, label: "All" }, ...CATEGORY_KEYS.map((key) => ({ key, label: categoryMeta(key).label }))],
    []
  );

  // Everything a row needs, resolved once per list change: icon, tone, link,
  // both time formats, and the day heading it belongs under.
  const items = useMemo(
    () =>
      rows.map((row) => {
        const meta = categoryMeta(row.category);
        return {
          row,
          href: notificationHref(row, { audience }),
          Icon: categoryIcon(meta),
          tone: toneClass(meta),
          label: meta.label,
          timeAgo: getTimeAgo(row.created_at),
          clock: getClockTime(row.created_at),
          bucket: dayBucket(row.created_at),
        };
      }),
    [rows, audience]
  );

  // Only the headings that have rows under them: an empty "Yesterday" between
  // two populated days claims nothing happened, which is a different statement
  // from the filter having excluded it.
  const groups = useMemo(
    () =>
      DAY_BUCKETS.map((bucket) => ({
        ...bucket,
        items: items.filter((item) => item.bucket === bucket.key),
      })).filter((group) => group.items.length > 0),
    [items]
  );

  const handleOpenRow = (item) => {
    if (!item.href) return;
    if (!item.row.read) markOneRead(item.row.id);
    router.push(item.href);
  };

  return (
    <section className="rounded-xl border border-border bg-card shadow-card">
      {/* Controls */}
      <div className="border-b border-border px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">All notifications</h2>
            <p className="text-sm text-muted-foreground">
              {unreadCount > 0 ? `${unreadCount > 99 ? "99+" : unreadCount} unread` : "All caught up"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-lg border border-border bg-card p-0.5">
              {[
                { key: false, label: "All" },
                { key: true, label: "Unread" },
              ].map((option) => (
                <button
                  key={String(option.key)}
                  type="button"
                  onClick={() => setUnreadOnly(option.key)}
                  aria-pressed={unreadOnly === option.key}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    unreadOnly === option.key
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={markEveryRead}
              disabled={unreadCount === 0}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs
                font-medium text-foreground transition-colors hover:bg-muted
                disabled:cursor-not-allowed disabled:text-muted-foreground disabled:hover:bg-card"
            >
              <CheckCheck className="h-4 w-4" />
              {/* Scoped to the open chip, same as the dropdown — the button sits
                  over a filtered list and describes the list it sits over. */}
              <span>{category ? "Mark these read" : "Mark all as read"}</span>
            </button>

            <button
              type="button"
              onClick={refresh}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs
                font-medium text-foreground transition-colors hover:bg-muted"
            >
              <RefreshCw className="h-4 w-4" />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>

        {/* The page has the width the dropdown lacks, so the categories wrap
            into view instead of hiding behind a sideways scroll. */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => {
            const active = chip.key === category;
            return (
              <button
                key={chip.key || "all"}
                type="button"
                onClick={() => setCategory(chip.key)}
                aria-pressed={active}
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
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
      {error ? (
        <div className="flex flex-col items-center justify-center px-4 py-16">
          <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <p className="font-medium text-foreground">Couldn&apos;t load your notifications</p>
          <p className="mt-1 max-w-md text-center text-sm text-muted-foreground">
            {error.message || "Something went wrong."}
          </p>
          <button
            type="button"
            onClick={refresh}
            className="mt-4 flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5
              text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <RefreshCw className="h-4 w-4" />
            <span>Try again</span>
          </button>
        </div>
      ) : loading && items.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-4 py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="mt-3 text-sm text-muted-foreground">Loading notifications…</p>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-4 py-16">
          <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Bell className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="font-medium text-foreground">No notifications</p>
          <p className="mt-1 max-w-md text-center text-sm text-muted-foreground">
            {category || unreadOnly
              ? "Nothing here under this filter. Try All, or pick another category."
              : "Nothing has been sent to you yet. Dismissed notifications don't appear here."}
          </p>
        </div>
      ) : (
        <div>
          {groups.map((group) => (
            <div key={group.key}>
              <h3
                className="sticky top-16 z-10 border-b border-border bg-muted/70 px-4 py-2 text-xs font-semibold
                  uppercase tracking-wider text-muted-foreground backdrop-blur-sm sm:px-5"
              >
                {group.label}
              </h3>

              <ul className="divide-y divide-border">
                {group.items.map((item) => {
                  const isUnread = !item.row.read;
                  const { Icon } = item;

                  const body = (
                    <>
                      <div
                        className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${item.tone}`}
                      >
                        <Icon className="h-5 w-5" />
                      </div>

                      <div className="min-w-0 flex-1">
                        {item.row.title && (
                          <p
                            className={`text-sm ${
                              isUnread ? "font-semibold text-foreground" : "font-medium text-foreground"
                            }`}
                          >
                            {item.row.title}
                          </p>
                        )}
                        {/* No truncation: the page exists so the whole message
                            can be read without opening anything. */}
                        <p className={`text-sm ${isUnread ? "text-foreground" : "text-muted-foreground"}`}>
                          {item.row.message}
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                          <span className="font-medium text-primary">{item.timeAgo}</span>
                          {item.clock && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{item.clock}</span>
                            </>
                          )}
                          <span aria-hidden="true">·</span>
                          <span>{item.label}</span>
                          {isUnread && (
                            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
                              Unread
                            </span>
                          )}
                        </p>
                      </div>
                    </>
                  );

                  return (
                    <li
                      key={item.row.id}
                      className={`flex items-start gap-2 px-4 py-4 transition-colors sm:px-5 ${
                        isUnread ? "bg-primary/5" : ""
                      } ${item.href ? "hover:bg-muted/50" : ""}`}
                    >
                      {item.href ? (
                        <button
                          type="button"
                          onClick={() => handleOpenRow(item)}
                          className="flex min-w-0 flex-1 items-start gap-3 text-left"
                        >
                          {body}
                          <ChevronRight className="mt-3 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                        </button>
                      ) : (
                        // Nothing to open on this surface: rendered as plain
                        // content rather than offering a click that goes nowhere.
                        <div className="flex min-w-0 flex-1 cursor-default items-start gap-3">{body}</div>
                      )}

                      <div className="flex flex-shrink-0 items-center gap-0.5">
                        {isUnread && (
                          <button
                            type="button"
                            onClick={() => markOneRead(item.row.id)}
                            title="Mark as read"
                            aria-label="Mark as read"
                            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => dismissOne(item.row.id)}
                          title="Dismiss"
                          aria-label="Dismiss notification"
                          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Paging */}
      {!error && items.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 sm:px-5">
          <span className="text-xs text-muted-foreground">
            Showing {items.length} notification{items.length !== 1 ? "s" : ""}
            {hasMore ? "" : " · all loaded"}
          </span>

          {hasMore && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm
                font-medium text-foreground transition-colors hover:bg-muted
                disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingMore ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span>Loading…</span>
                </>
              ) : (
                <>
                  <span>Load older</span>
                  <ChevronDown className="h-4 w-4" />
                </>
              )}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
