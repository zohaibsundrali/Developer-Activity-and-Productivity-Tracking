"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/utils/supabaseClient";
import { getOrgId } from "@/utils/orgContext";
import { setVisibleInterval } from "@/hooks/useVisibleInterval";
import {
  fetchNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
} from "@/utils/notifications";

/**
 * The notification centre's state, shared by the admin and developer shells.
 *
 * Both dashboards grew their own copy of this: two page fetchers, two realtime
 * subscriptions, two mark-read paths, and two different wrong answers for the
 * badge. The count in particular was derived from the rows that happened to be
 * loaded, so it under-reported at first and then climbed as the user pressed
 * "load more" — here it is a separate count query against the whole table.
 */

const DEFAULT_PAGE_SIZE = 15;

// A dashboard is left open all day, and every realtime insert prepends a row.
// Without a ceiling the array is a slow leak, so old rows fall off the bottom;
// they are still reachable by reopening the panel, which refetches page 0.
//
// This bounds what arrives on its own. It deliberately does not bound explicit
// paging: capping the array while the server kept reporting more, and `page`
// kept advancing, meant "load more" past this many rows spun and changed
// nothing at all — a button that is enabled, acts pressed, and does nothing.
// Rows a user asked for one page at a time are theirs to accumulate.
const MAX_ROWS = 200;

// A bulk update emits one WAL event per row, so "mark all as read" over 200
// unread rows arrives as 200 realtime events. One count query each is 200
// concurrent requests answering the same question, and only the last answer
// matters. Bursts collapse into at most one query per window.
const COUNT_COALESCE_MS = 400;

// Realtime can drop a message (tab suspended, socket reconnect) and the badge
// is the one thing that must not silently drift, so it is re-read on a slow
// timer as well. `setVisibleInterval` stops the timer while the tab is hidden.
const UNREAD_COUNT_POLL_MS = 60_000;

/**
 * Does this row belong to the person looking at the panel?
 *
 * This mirrors `recipientFilter` in utils/notifications, and exists because the
 * realtime subscription deliberately carries no server-side filter — see the
 * subscription effect below.
 */
function isForRecipient(row, { userId, email, audience }) {
  if (!row) return false;

  if (audience === "admin") {
    if (userId && row.admin_id && String(row.admin_id) === String(userId)) return true;
    // Equality, case-insensitively, because that is what the list query asks
    // for. Containment used to be the answer here and it accepted another
    // admin's rows into this panel: `sara@acme.com` is contained in
    // `sara@acme.com.au`, so a live insert for one landed in the other's list.
    if (email && row.admin_email) {
      return String(row.admin_email).toLowerCase() === String(email).toLowerCase();
    }
    return false;
  }

  if (!userId) return false;
  return (
    (row.developer_id && String(row.developer_id) === String(userId)) ||
    (row.assigned_developer_id && String(row.assigned_developer_id) === String(userId))
  );
}

/**
 * Append a page without letting a row that arrived live show up twice.
 *
 * Uncapped: these are rows the user paged to explicitly, and dropping them off
 * the end is what made "load more" stop having any visible effect.
 */
export function mergeRows(existing, incoming) {
  const seen = new Set(existing.map((row) => row.id));
  const merged = existing.slice();
  for (const row of incoming) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  return merged;
}

/** Fold a realtime row into the list: update in place, or prepend if new. */
export function upsertRow(existing, row, { category, unreadOnly, isInsert = true }) {
  const index = existing.findIndex((item) => item.id === row.id);
  if (index !== -1) {
    const next = existing.slice();
    // An update that takes the row out of the active filter leaves it on
    // screen: a row disappearing from under the pointer mid-click is worse
    // than a list that is briefly wider than its filter.
    next[index] = { ...next[index], ...row };
    return next;
  }

  // An UPDATE to a row that is not loaded is not news, and putting it on top
  // says the opposite. "Mark all as read" updates every unread row and each
  // arrives as its own event, which prepended hundreds of already-read rows in
  // WAL order to a list whose whole contract is newest-first.
  if (!isInsert) return existing;

  // A brand new row only belongs on screen if it passes what is being filtered
  // for, otherwise the panel contradicts its own chips.
  if (category && row.category !== category) return existing;
  if (unreadOnly && row.read) return existing;

  // The ceiling travels with the list rather than truncating it, so a live
  // insert cannot undo pages the user asked for.
  return [row, ...existing].slice(0, Math.max(MAX_ROWS, existing.length));
}

export default function useNotifications({
  userId = null,
  email = null,
  audience = "admin",
  pageSize = DEFAULT_PAGE_SIZE,
} = {}) {
  const [rows, setRows] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [category, setCategory] = useState(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  const hasIdentity = Boolean(userId || email);

  // Filters are read by the realtime handler, which must not be torn down and
  // resubscribed every time a chip is pressed — a refs copy keeps the channel
  // effect independent of them.
  const categoryRef = useRef(category);
  const unreadOnlyRef = useRef(unreadOnly);
  useEffect(() => {
    categoryRef.current = category;
    unreadOnlyRef.current = unreadOnly;
  }, [category, unreadOnly]);

  // Switching filters fires a second fetch while the first is still in flight;
  // whichever returns last would otherwise win regardless of what was asked.
  const requestRef = useRef(0);

  const refreshCount = useCallback(async () => {
    if (!hasIdentity) return;
    // Deliberately unscoped by category: this is the bell's badge, the count of
    // everything waiting. Narrowing it to the open chip would make picking a
    // filter appear to clear notifications that are still there.
    const { count, error: countError } = await getUnreadCount({ userId, email, audience });
    // A failed count keeps the last known number rather than flashing zero,
    // which reads as "all caught up" and is the one lie a badge must not tell.
    if (!countError) setUnreadCount(count);
  }, [hasIdentity, userId, email, audience]);

  // Fires once immediately, then at most once per window for as long as events
  // keep arriving — a burst costs two queries instead of one per row, and the
  // trailing one guarantees the badge still settles on the final answer.
  const countTimerRef = useRef(null);
  const countAgainRef = useRef(false);
  const refreshCountSoon = useCallback(() => {
    if (countTimerRef.current) {
      countAgainRef.current = true;
      return;
    }
    const openWindow = () => {
      countTimerRef.current = setTimeout(() => {
        countTimerRef.current = null;
        if (!countAgainRef.current) return;
        countAgainRef.current = false;
        openWindow();
        refreshCount();
      }, COUNT_COALESCE_MS);
    };
    openWindow();
    refreshCount();
  }, [refreshCount]);

  useEffect(
    () => () => {
      if (countTimerRef.current) clearTimeout(countTimerRef.current);
    },
    []
  );

  const loadPage = useCallback(
    async (targetPage, { append = false } = {}) => {
      if (!hasIdentity) return;

      const ticket = requestRef.current + 1;
      requestRef.current = ticket;

      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        // A first page supersedes any page-append still in flight; clearing the
        // flag here is what stops that append's spinner from being stranded.
        setLoadingMore(false);
      }

      const {
        rows: fetched,
        hasMore: more,
        error: fetchError,
      } = await fetchNotifications({
        userId,
        email,
        audience,
        category,
        unreadOnly,
        page: targetPage,
        pageSize,
      });

      // Superseded by a newer request: drop the result, and leave the loading
      // flags to the request that now owns them — clearing them here would
      // blank the spinner and flash an empty list while that one is still out.
      if (ticket !== requestRef.current) return;

      if (append) setLoadingMore(false);
      else setLoading(false);

      if (fetchError) {
        setError(fetchError);
        return;
      }

      setError(null);
      setRows((prev) => (append ? mergeRows(prev, fetched) : fetched));
      setHasMore(more);
      setPage(targetPage);
    },
    [hasIdentity, userId, email, audience, category, unreadOnly, pageSize]
  );

  const refresh = useCallback(() => {
    loadPage(0, { append: false });
    refreshCount();
  }, [loadPage, refreshCount]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;
    loadPage(page + 1, { append: true });
  }, [loading, loadingMore, hasMore, page, loadPage]);

  // First page, and a fresh first page whenever identity or filters change
  // (`loadPage` closes over both, so its identity is the trigger).
  useEffect(() => {
    if (!hasIdentity) {
      setRows([]);
      setUnreadCount(0);
      setHasMore(false);
      return;
    }
    loadPage(0, { append: false });
    refreshCount();
  }, [hasIdentity, loadPage, refreshCount]);

  useEffect(() => {
    if (!hasIdentity) return undefined;
    return setVisibleInterval(refreshCount, UNREAD_COUNT_POLL_MS);
  }, [hasIdentity, refreshCount]);

  useEffect(() => {
    if (!hasIdentity) return undefined;

    const orgId = getOrgId();

    const handleChange = (payload) => {
      const row = payload?.new;
      if (!row) return;
      // Realtime bypasses the org scoping the queries apply, so re-apply it.
      if (orgId && row.organization_id && row.organization_id !== orgId) return;
      if (!isForRecipient(row, { userId, email, audience })) return;

      setRows((prev) =>
        upsertRow(prev, row, {
          category: categoryRef.current,
          unreadOnly: unreadOnlyRef.current,
          isInsert: payload?.eventType === "INSERT",
        })
      );
      // The badge is never inferred from the event — an INSERT the filter
      // rejected still changes the true unread total.
      refreshCountSoon();
    };

    // One topic per audience+user. Two surfaces sharing a client and a topic
    // name ("notifications-changes") got each other's bindings, and the second
    // subscriber's callbacks quietly never fired.
    const channelName = `notifications-${audience}-${userId || email}`;

    // No server-side filter, on purpose. The admin list matches admin_id OR
    // admin_email, but a postgres_changes filter takes a single column: the
    // previous `admin_id=eq.{id}` binding meant every email-addressed
    // notification arrived only on the next full refetch, i.e. never while the
    // panel sat open. Developers have the same split across developer_id and
    // assigned_developer_id. Matching in `isForRecipient` covers both columns;
    // the cost is discarding rows addressed to other people.
    const channel = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, handleChange)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notifications" }, handleChange)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [hasIdentity, userId, email, audience, refreshCountSoon]);

  const markOneRead = useCallback(
    async (id) => {
      if (!id) return;

      // Optimistic: opening a notification should feel instant. The count is
      // re-read from the server either way, so the badge cannot end up guessed.
      setRows((prev) =>
        prev.map((row) => (row.id === id ? { ...row, read: true, read_at: new Date().toISOString() } : row))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));

      const { error: markError } = await markRead(id);
      if (markError) {
        // Put it back rather than leaving a row that looks handled and is not.
        setRows((prev) => prev.map((row) => (row.id === id ? { ...row, read: false, read_at: null } : row)));
      }
      refreshCount();
    },
    [refreshCount]
  );

  const markEveryRead = useCallback(async () => {
    // Scoped to the chip that is open: the button sits above a filtered list
    // and reads as "all of this". Sending it unscoped meant a user looking at
    // three mentions cleared every category in one press, with nothing to undo
    // it and no indication it had happened.
    const scope = categoryRef.current;

    setRows((prev) => prev.map((row) => (row.read ? row : { ...row, read: true, read_at: new Date().toISOString() })));
    // Zero is only true when the whole inbox was the target. Under a filter the
    // badge still counts the other categories, so it is left to the server
    // rather than guessed at.
    if (!scope) setUnreadCount(0);

    const { error: markError } = await markAllRead({ userId, email, audience, category: scope });
    if (markError) setError(markError);

    // Under "unread only" the list should now be empty; anywhere else the rows
    // stay put and just lose their emphasis.
    if (unreadOnlyRef.current) loadPage(0, { append: false });
    refreshCount();
  }, [userId, email, audience, loadPage, refreshCount]);

  // Rows belong to the filter they were fetched under, so clearing them here
  // means the panel shows its loading state instead of the previous category's
  // list wearing the new category's chip.
  const selectCategory = useCallback((next) => {
    setRows([]);
    setHasMore(false);
    setCategory(next || null);
  }, []);

  const selectUnreadOnly = useCallback((next) => {
    setRows([]);
    setHasMore(false);
    setUnreadOnly(Boolean(next));
  }, []);

  return {
    rows,
    unreadCount,
    category,
    setCategory: selectCategory,
    unreadOnly,
    setUnreadOnly: selectUnreadOnly,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
    markOneRead,
    markEveryRead,
    refresh,
  };
}

export { useNotifications };
