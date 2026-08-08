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
  X,
  History,
} from "lucide-react";
import useNotifications from "@/hooks/useNotifications";
import { CATEGORY_KEYS, categoryMeta, notificationHref } from "@/utils/notifications";
import { Badge, Button, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  categoryIcon,
  toneClass,
  getTimeAgo,
  priorityMeta,
  notificationPriority,
  railClass,
} from "./notificationVisuals";

/**
 * The notification centre: one panel behind both dashboards' bells.
 *
 * The admin and developer dropdowns were near-identical copies that had already
 * drifted (different icons, different time formats, different bugs). Everything
 * that differs between the two surfaces is now the `audience` prop, which is
 * also what decides where a notification takes you.
 *
 * Reading order on this panel is deliberate: unread first (rail + weight +
 * dot), priority second (rail colour and, on an unread high row only, one
 * badge), category third (icon and label). Anything more and eleven categories
 * of amber all shout at once, which is the same as none of them shouting.
 */

/** A row-shaped placeholder, so the list does not appear out of nowhere. */
function RowSkeleton() {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-2.5 w-24" />
      </div>
    </li>
  );
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
          priority: notificationPriority(row.category),
          priority_: priorityMeta(row.category),
          rail: railClass({ read: row.read, category: row.category }),
        };
      }),
    [rows, audience]
  );

  const badgeLabel = unreadCount > 99 ? "99+" : String(unreadCount);
  const filtered = Boolean(category) || unreadOnly;

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
        className="relative rounded-lg border border-border bg-card p-2 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none"
        title="Notifications"
        aria-label={unreadCount > 0 ? `Notifications, ${badgeLabel} unread` : "Notifications"}
        aria-expanded={isOpen}
      >
        <Bell className="h-5 w-5" aria-hidden="true" />

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
          className="absolute right-0 mt-2 flex max-h-[70vh] w-[min(26rem,calc(100vw-2rem))] flex-col rounded-xl
            border border-border bg-popover shadow-popover z-50 animate-fade-in motion-reduce:animate-none"
        >
          {/* Header */}
          <div className="rounded-t-xl border-b border-border bg-muted/50 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold tracking-tight text-foreground">Notifications</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={markEveryRead}
                disabled={unreadCount === 0}
                className="text-primary hover:text-primary"
              >
                <CheckCheck aria-hidden="true" />
                {/* "All" means the list under the button, which a chip narrows.
                    Saying "all" over a filtered list promises a bulk action
                    across every category that this no longer performs. */}
                <span>{category ? "Mark these read" : "Mark all as read"}</span>
              </Button>
            </div>

            {/* Unread-only toggle */}
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">
                {unreadCount > 0 ? `${badgeLabel} unread` : "All caught up"}
              </span>
              <Button
                variant={unreadOnly ? "default" : "outline"}
                size="xs"
                onClick={() => setUnreadOnly(!unreadOnly)}
                aria-pressed={unreadOnly}
              >
                Unread only
              </Button>
            </div>
          </div>

          {/* Category chips. Eleven categories never fit a dropdown's width, so
              the row scrolls sideways instead of wrapping into a wall. */}
          <div className="overflow-x-auto border-b border-border px-2 py-2">
            <div className="flex w-max items-center gap-1.5">
              {chips.map((chip) => {
                const active = chip.key === category;
                return (
                  <Button
                    key={chip.key || "all"}
                    variant={active ? "default" : "outline"}
                    size="xs"
                    onClick={() => setCategory(chip.key)}
                    aria-pressed={active}
                    className="whitespace-nowrap"
                  >
                    {chip.label}
                  </Button>
                );
              })}
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {error ? (
              <div className="p-3">
                <ErrorState
                  title="Couldn't load notifications"
                  description={error.message || "Something went wrong."}
                  onRetry={refresh}
                />
              </div>
            ) : loading && items.length === 0 ? (
              // Shaped like the rows it is standing in for, so nothing jumps
              // when the real list lands.
              <ul className="divide-y divide-border" aria-busy="true">
                <RowSkeleton />
                <RowSkeleton />
                <RowSkeleton />
                <RowSkeleton />
              </ul>
            ) : items.length === 0 ? (
              <div className="p-3">
                {/* An empty inbox is the good outcome, so it is drawn as one:
                    a tick, not a warning, and no destructive colour anywhere. */}
                <EmptyState
                  icon={filtered ? Bell : CheckCheck}
                  title={filtered ? "Nothing under this filter" : "You're all caught up"}
                  description={
                    filtered
                      ? "No notifications match the filter you have on. Try All, or switch the unread filter off."
                      : "Nothing new to read. Anything sent to you shows up here — mentions, due dates and status changes first."
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
                  className="border-0 bg-transparent py-8"
                />
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((item) => {
                  const isUnread = !item.row.read;
                  const { Icon } = item;
                  const showPriority = isUnread && item.priority === "high";
                  const PriorityIcon = item.priority_.icon;

                  const body = (
                    <>
                      <span
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                          item.toneClass
                        )}
                      >
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          {/* The unread marker: a filled dot, in the reading
                              line rather than off in the margin. Its space is
                              reserved on read rows so the text does not shift
                              sideways the moment a row is marked read. */}
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
                                "min-w-0 truncate text-sm text-foreground",
                                isUnread ? "font-semibold" : "font-medium"
                              )}
                            >
                              {item.row.title}
                            </span>
                          )}
                          {showPriority && (
                            <Badge variant={item.priority_.badgeVariant} size="sm" className="ml-auto shrink-0">
                              {PriorityIcon && <PriorityIcon aria-hidden="true" />}
                              {item.priority_.label}
                            </Badge>
                          )}
                        </span>

                        <span
                          className={cn(
                            "mt-0.5 block pl-3.5 text-sm",
                            isUnread ? "font-medium text-foreground" : "text-muted-foreground"
                          )}
                        >
                          {item.row.message}
                        </span>

                        <span className="mt-1 block pl-3.5 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">{item.timeAgo}</span>
                          <span className="mx-1" aria-hidden="true">
                            ·
                          </span>
                          <span>{item.label}</span>
                          <span className="sr-only">{isUnread ? " · unread" : " · read"}</span>
                        </span>
                      </span>
                    </>
                  );

                  return (
                    <li
                      key={item.row.id}
                      className={cn(
                        "relative flex items-start gap-2 py-3 pl-5 pr-4 transition-colors duration-150 motion-reduce:transition-none",
                        isUnread && "bg-primary/5",
                        item.href && "hover:bg-muted/50"
                      )}
                    >
                      {/* Priority + unread rail. Colour is never doing this on
                          its own — the dot, the weight and the tint all say
                          "unread" too. */}
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
                        // Nothing to open: rendered as plain content so it does
                        // not offer a click that would go nowhere.
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

                        {/* Dismiss is offered on read and unread rows alike:
                            "I have seen this and want it gone" is a different
                            statement from "I have read it", and a row that must
                            be marked read before it can be cleared makes the
                            two indistinguishable in the record. */}
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
            )}
          </div>

          {/* Footer. Rendered whenever the list itself loaded, including when it
              came back empty: the way out to the full history is the one thing
              a user needs MOST from an empty panel — the row they are looking
              for is either older than this page or already dismissed. */}
          {!error && (
            <div className="rounded-b-xl border-t border-border bg-muted/50 px-4 py-3">
              {hasMore && items.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="mb-2 w-full text-primary hover:text-primary"
                >
                  {loadingMore ? (
                    <>
                      <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                      <span>Loading…</span>
                    </>
                  ) : (
                    <>
                      <span>Load more</span>
                      <ChevronDown aria-hidden="true" />
                    </>
                  )}
                </Button>
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
                  className="flex shrink-0 items-center gap-1.5 rounded-md text-sm font-medium text-primary
                    transition-colors duration-150 hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none"
                >
                  <History className="h-4 w-4" aria-hidden="true" />
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
