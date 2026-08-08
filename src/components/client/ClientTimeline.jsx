"use client";

// Unified project activity feed. Project updates, milestones, approval events,
// non-internal comments and client-visible task status changes arrive already
// merged and newest-first from the timeline route, so this file only paints
// them — it never re-orders or re-merges what the server decided.

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { authFetch } from "@/utils/authFetch";
import {
  Spinner,
  EmptyState,
  ErrorState,
  SectionHeader,
  LoadMoreButton,
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

  const header = showHeader ? (
    <SectionHeader
      title="Activity"
      subtitle={projectName ? `Everything that has happened on ${projectName}` : "Everything that has happened on this project"}
    />
  ) : null;

  if (loading) {
    return (
      <div>
        {header}
        <Spinner label="Loading activity…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        {header}
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div>
        {header}
        <EmptyState
          icon={CalendarDays}
          title="No activity yet"
          message="Updates, milestones, comments and approvals will appear here as your project moves."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {header}

      <ol className="relative space-y-4 border-l border-border pl-5 sm:pl-6">
        {events.map((event) => {
          const meta = kindMeta(event.kind);
          const Icon = meta.icon;
          return (
            <li key={event.id} className="relative">
              <span
                className={`absolute -left-[30px] top-3 flex h-6 w-6 items-center justify-center rounded-full border-2 border-card sm:-left-[34px] ${meta.tone}`}
              >
                <Icon className="h-3 w-3" />
              </span>
              <div className="rounded-xl border border-border bg-card p-4 shadow-card">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <p className="min-w-0 font-semibold text-foreground">{event.title}</p>
                  <span
                    className="whitespace-nowrap text-xs text-muted-foreground"
                    title={formatDateTime(event.created_at)}
                  >
                    {formatRelativeTime(event.created_at)}
                  </span>
                </div>
                {event.body && (
                  <p className="mt-1.5 whitespace-pre-line break-words text-sm text-muted-foreground">
                    {event.body}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className={`rounded-full px-2 py-0.5 font-medium ${meta.tone}`}>{meta.label}</span>
                  {event.actor_name && <span>{event.actor_name}</span>}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {pageError && <ErrorState message={pageError} onRetry={loadMore} />}

      {hasMore && !pageError && <LoadMoreButton onClick={loadMore} loading={pageLoading} label="Load older activity" />}
    </div>
  );
}
