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
  X,
} from "lucide-react";
import useNotifications from "@/hooks/useNotifications";
import { CATEGORY_KEYS, categoryMeta, notificationHref } from "@/utils/notifications";
import { Badge, Button, EmptyState, ErrorState, Skeleton, Tabs } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  categoryIcon,
  toneClass,
  getTimeAgo,
  getClockTime,
  dayBucket,
  DAY_BUCKETS,
  notificationPriority,
  priorityMeta,
  railClass,
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
 *
 * The read/unread and priority language is identical to the dropdown's, and
 * comes from the same `notificationVisuals` helpers — the two surfaces drifting
 * apart is the exact failure this module was built to end.
 */

// Larger than the dropdown's 15: a full page can show more before asking, and
// each request costs the same round trip either way.
const PAGE_SIZE = 25;

/** A row-shaped placeholder — same geometry as a real row, so nothing jumps. */
function RowSkeleton() {
  return (
    <li className="flex items-start gap-3 px-4 py-4 sm:px-5">
      <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-3.5 w-1/3" />
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-2.5 w-40" />
      </div>
    </li>
  );
}

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
  // both time formats, the day heading it belongs under, and its priority.
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
          priority: notificationPriority(row.category),
          priority_: priorityMeta(row.category),
          rail: railClass({ read: row.read, category: row.category }),
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

  const filtered = Boolean(category) || unreadOnly;

  const handleOpenRow = (item) => {
    if (!item.href) return;
    if (!item.row.read) markOneRead(item.row.id);
    router.push(item.href);
  };

  return (
    <section className="rounded-xl border border-border bg-card shadow-card">
      {/* Controls */}
      <div className="border-b border-border px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-foreground">All notifications</h2>
            <p className="text-sm text-muted-foreground">
              {unreadCount > 0 ? `${unreadCount > 99 ? "99+" : unreadCount} unread` : "All caught up"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={markEveryRead} disabled={unreadCount === 0}>
              <CheckCheck aria-hidden="true" />
              {/* Scoped to the open chip, same as the dropdown — the button sits
                  over a filtered list and describes the list it sits over. */}
              <span>{category ? "Mark these read" : "Mark all as read"}</span>
            </Button>

            <Button variant="outline" size="sm" onClick={refresh}>
              <RefreshCw aria-hidden="true" />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </div>

        {/* Read state is the primary cut through this list, so it gets the tab
            bar rather than a third row of pills. */}
        <Tabs
          aria-label="Filter by read state"
          className="mt-3 border-b-0"
          active={unreadOnly ? "unread" : "all"}
          onChange={(id) => setUnreadOnly(id === "unread")}
          tabs={[
            { id: "all", label: "All" },
            { id: "unread", label: "Unread", count: unreadCount > 99 ? "99+" : unreadCount },
          ]}
        />

        {/* The page has the width the dropdown lacks, so the categories wrap
            into view instead of hiding behind a sideways scroll. */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => {
            const active = chip.key === category;
            return (
              <Button
                key={chip.key || "all"}
                variant={active ? "default" : "outline"}
                size="xs"
                onClick={() => setCategory(chip.key)}
                aria-pressed={active}
              >
                {chip.label}
              </Button>
            );
          })}
        </div>
      </div>

      {/* List */}
      {error ? (
        <div className="p-4 sm:p-5">
          <ErrorState
            title="Couldn't load your notifications"
            description={error.message || "Something went wrong."}
            onRetry={refresh}
          />
        </div>
      ) : loading && items.length === 0 ? (
        <div aria-busy="true">
          <div className="border-b border-border bg-muted/70 px-4 py-2 sm:px-5">
            <Skeleton className="h-3 w-16" />
          </div>
          <ul className="divide-y divide-border">
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </ul>
        </div>
      ) : items.length === 0 ? (
        <div className="p-4 sm:p-5">
          {/* Nothing to read is a success, not a failure — a tick, not a siren. */}
          <EmptyState
            icon={filtered ? Bell : CheckCheck}
            title={filtered ? "Nothing under this filter" : "You're all caught up"}
            description={
              filtered
                ? "No notifications match the filter you have on. Try All, or pick another category."
                : "Nothing has been sent to you yet. Mentions, due dates and status changes land here first. Dismissed notifications don't appear."
            }
            action={
              filtered ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCategory(null);
                    setUnreadOnly(false);
                  }}
                >
                  Clear filters
                </Button>
              ) : null
            }
            className="border-0 bg-transparent py-10"
          />
        </div>
      ) : (
        <div>
          {groups.map((group) => (
            <div key={group.key}>
              <h3
                className="sticky top-16 z-10 border-b border-border bg-muted/70 px-4 py-2 text-xs font-medium
                  uppercase tracking-wide text-muted-foreground backdrop-blur-sm sm:px-5"
              >
                {group.label}
              </h3>

              <ul className="divide-y divide-border">
                {group.items.map((item) => {
                  const isUnread = !item.row.read;
                  const { Icon } = item;
                  const showPriority = isUnread && item.priority === "high";
                  const PriorityIcon = item.priority_.icon;

                  const body = (
                    <>
                      <span
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                          item.tone
                        )}
                      >
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          {/* Filled dot = unread. Its slot is held open on read
                              rows so marking one read does not shift the text. */}
                          <span
                            aria-hidden="true"
                            className={cn(
                              "h-2 w-2 shrink-0 rounded-full",
                              isUnread ? "bg-primary" : "bg-transparent"
                            )}
                          />
                          {item.row.title && (
                            <span
                              className={cn(
                                "text-sm text-foreground",
                                isUnread ? "font-semibold" : "font-medium"
                              )}
                            >
                              {item.row.title}
                            </span>
                          )}
                          {showPriority && (
                            <Badge variant={item.priority_.badgeVariant} size="sm">
                              {PriorityIcon && <PriorityIcon aria-hidden="true" />}
                              {item.priority_.label}
                            </Badge>
                          )}
                        </span>

                        {/* No truncation: the page exists so the whole message
                            can be read without opening anything. */}
                        <span
                          className={cn(
                            "mt-0.5 block pl-3.5 text-sm",
                            isUnread ? "font-medium text-foreground" : "text-muted-foreground"
                          )}
                        >
                          {item.row.message}
                        </span>

                        <span className="mt-1 flex flex-wrap items-center gap-x-1.5 pl-3.5 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">{item.timeAgo}</span>
                          {item.clock && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{item.clock}</span>
                            </>
                          )}
                          <span aria-hidden="true">·</span>
                          <span>{item.label}</span>
                          {isUnread && (
                            <Badge variant="default" size="sm">
                              Unread
                            </Badge>
                          )}
                        </span>
                      </span>
                    </>
                  );

                  return (
                    <li
                      key={item.row.id}
                      className={cn(
                        "relative flex items-start gap-2 py-4 pl-5 pr-4 transition-colors duration-150 motion-reduce:transition-none sm:pl-6 sm:pr-5",
                        isUnread && "bg-primary/5",
                        item.href && "hover:bg-muted/50"
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn("absolute inset-y-0 left-0 w-1", item.rail)}
                      />

                      {item.href ? (
                        <button
                          type="button"
                          onClick={() => handleOpenRow(item)}
                          className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                          {body}
                          <ChevronRight
                            className="mt-3 h-4 w-4 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                        </button>
                      ) : (
                        // Nothing to open on this surface: rendered as plain
                        // content rather than offering a click that goes nowhere.
                        <div className="flex min-w-0 flex-1 cursor-default items-start gap-3">{body}</div>
                      )}

                      <div className="flex shrink-0 items-center gap-0.5">
                        {isUnread && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => markOneRead(item.row.id)}
                            title="Mark as read"
                            aria-label="Mark as read"
                          >
                            <Check aria-hidden="true" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => dismissOne(item.row.id)}
                          title="Dismiss"
                          aria-label="Dismiss notification"
                        >
                          <X aria-hidden="true" />
                        </Button>
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
            <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? (
                <>
                  <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  <span>Loading…</span>
                </>
              ) : (
                <>
                  <span>Load older</span>
                  <ChevronDown aria-hidden="true" />
                </>
              )}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
