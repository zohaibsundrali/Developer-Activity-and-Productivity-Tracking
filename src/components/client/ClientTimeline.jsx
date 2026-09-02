"use client";

// Unified project activity feed. Project updates, milestones, approval events,
// non-internal comments and client-visible task status changes arrive already
// merged and newest-first from the timeline route, so this file only paints
// them — it never re-orders or re-merges what the server decided.

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { authFetch } from "@/utils/authFetch";
import {
  ClientPage,
  Panel,
  EmptyState,
  ErrorState,
  LoadMoreButton,
  TimelineSkeleton,
  kindMeta,
  formatDateTime,
  formatRelativeTime,
} from "./ClientShared";

const PAGE_SIZE = 20;

export default function ClientTimeline({ projectId, showHeader = false, projectName }) {
  const [events, setEvents] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState("");

  const fetchPage = useCallback(
    async (before) => {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      if (before) params.set("before", before);

      const res = await authFetch(`/api/client/projects/${projectId}/timeline?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to load the activity feed.");
      return {
        events: Array.isArray(data.events) ? data.events : [],
        hasMore: Boolean(data.hasMore),
      };
    },
    [projectId]
  );

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setLoading(true);
      setError("");
      setPageError("");
      const page = await fetchPage(null);
      setEvents(page.events);
      setHasMore(page.hasMore);
    } catch (err) {
      setError(err?.message || "Something went wrong while loading activity.");
    } finally {
      setLoading(false);
    }
  }, [projectId, fetchPage]);

  useEffect(() => {
    load();
  }, [load]);

  // Keyset cursor: the timestamp of the oldest row already on screen. Offset
  // paging would skip or repeat rows whenever a new event lands mid-scroll.
  const cursor = useMemo(() => {
    if (events.length === 0) return null;
    return events[events.length - 1]?.created_at || null;
  }, [events]);

  const loadMore = useCallback(async () => {
    if (!cursor || pageLoading) return;
    try {
      setPageLoading(true);
      setPageError("");
      const page = await fetchPage(cursor);
      setEvents((prev) => [...prev, ...page.events]);
      setHasMore(page.hasMore);
    } catch (err) {
      setPageError(err?.message || "Could not load older activity.");
    } finally {
      setPageLoading(false);
    }
  }, [cursor, pageLoading, fetchPage]);

  const title = showHeader ? "Activity" : undefined;
  const description = showHeader
    ? projectName
      ? `Everything that has happened on ${projectName}`
      : "Everything that has happened on this project"
    : undefined;

  if (loading) {
    return (
      <ClientPage title={title} description={description}>
        <TimelineSkeleton />
      </ClientPage>
    );
  }

  if (error) {
    return (
      <ClientPage title={title} description={description}>
        <ErrorState description={error} onRetry={load} />
      </ClientPage>
    );
  }

  if (events.length === 0) {
    return (
      <ClientPage title={title} description={description}>
        <EmptyState
          icon={CalendarDays}
          title="No activity yet"
          description="Updates, milestones, comments and approvals will appear here as your project moves."
        />
      </ClientPage>
    );
  }

  return (
    <ClientPage title={title} description={description}>
      <ol className="relative space-y-5 border-l border-border pl-6 sm:pl-7">
        {events.map((event) => {
          const meta = kindMeta(event.kind);
          const Icon = meta.icon;
          return (
            <li key={event.id} className="relative">
              <span
                className={`absolute -left-[36px] top-5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-card sm:-left-[40px] ${meta.tone}`}
              >
                <Icon className="h-3 w-3" aria-hidden="true" />
              </span>
              <Panel className="space-y-2">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                  <p className="min-w-0 text-lg font-semibold leading-snug text-foreground">{event.title}</p>
                  <span
                    className="whitespace-nowrap text-sm text-muted-foreground"
                    title={formatDateTime(event.created_at)}
                  >
                    {formatRelativeTime(event.created_at)}
                  </span>
                </div>
                {event.body && (
                  <p className="whitespace-pre-line break-words text-[15px] leading-relaxed text-muted-foreground">
                    {event.body}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1 text-sm text-muted-foreground">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${meta.tone}`}>{meta.label}</span>
                  {event.actor_name && <span>{event.actor_name}</span>}
                </div>
              </Panel>
            </li>
          );
        })}
      </ol>

      {pageError && <ErrorState description={pageError} onRetry={loadMore} />}

      {hasMore && !pageError && <LoadMoreButton onClick={loadMore} loading={pageLoading} label="Load older activity" />}
    </ClientPage>
  );
}
