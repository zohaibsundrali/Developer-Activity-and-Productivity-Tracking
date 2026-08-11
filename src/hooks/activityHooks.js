"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "../utils/supabaseClient";
import { resolveScreenshotUrls } from "../utils/screenshotFiles";
import { setVisibleInterval } from "./useVisibleInterval";

// Default polling interval (ms) used as a fallback beside Realtime
const DEFAULT_POLL_INTERVAL = 10_000;

// The tracking tables grow by a row a minute per developer, so an unbounded
// `select("*")` on a 10-second poll grows without limit for a long session.
// Every hook below fetches at most this many rows (override via `limit`) and
// trims the same ceiling when Realtime pushes new rows in.
const DEFAULT_ROW_LIMIT = 500;
const SCREENSHOT_ROW_LIMIT = 100;

// ────────────────────────────────────────────────────────────────
// useCurrentSession(userEmail)
// Fetch the latest (usually active) productivity session for user
// ────────────────────────────────────────────────────────────────
export function useCurrentSession(userEmail, { pollIntervalMs = DEFAULT_POLL_INTERVAL } = {}) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchSession = useCallback(async () => {
    if (!userEmail) return;
    setLoading(true);
    setError(null);
    try {
      // Prefer active/periodic session, fall back to latest completed
      let { data, error: err } = await supabase
        .from("productivity_sessions")
        .select("*")
        .eq("user_email", userEmail)
        .in("status", ["active", "periodic"])
        .order("start_time", { ascending: false })
        .limit(1);

      if (err) throw err;

      if (!data || data.length === 0) {
        const { data: lastCompleted, error: err2 } = await supabase
          .from("productivity_sessions")
          .select("*")
          .eq("user_email", userEmail)
          .order("start_time", { ascending: false })
          .limit(1);
        if (err2) throw err2;
        setSession(lastCompleted?.[0] ?? null);
      } else {
        setSession(data[0]);
      }
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [userEmail]);

  // Initial fetch + polling fallback
  useEffect(() => {
    let stopPolling = null;
    fetchSession();
    if (pollIntervalMs && userEmail) {
      stopPolling = setVisibleInterval(fetchSession, pollIntervalMs);
    }
    return () => {
      if (stopPolling) stopPolling();
    };
  }, [fetchSession, pollIntervalMs, userEmail]);

  // Realtime subscription for the current user's sessions
  useEffect(() => {
    if (!userEmail) return;
    const channel = supabase
      .channel("productivity-sessions-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "productivity_sessions",
          filter: `user_email=eq.${userEmail}`,
        },
        () => {
          // Simply refetch on relevant insert
          fetchSession();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "productivity_sessions",
          filter: `user_email=eq.${userEmail}`,
        },
        () => {
          fetchSession();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userEmail, fetchSession]);

  return { session, loading, error, refresh: fetchSession };
}

// ────────────────────────────────────────────────────────────────
// useKeyboardRealtime
// Live keyboard_stats for a session + user
// ────────────────────────────────────────────────────────────────
export function useKeyboardRealtime({
  sessionId,
  developerId,
  developerEmail,
  pollIntervalMs = DEFAULT_POLL_INTERVAL,
  limit = DEFAULT_ROW_LIMIT,
} = {}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const channelRef = useRef(null);

  const fetchKeyboard = useCallback(async () => {
    if (!sessionId || (!developerId && !developerEmail)) return;
    setLoading(true);
    setError(null);
    try {
      // `tracked_at`, not `minute_timestamp`. There is no minute_timestamp
      // column on keyboard_stats and there never has been, and PostgREST
      // rejects the WHOLE request over one unknown column — so this panel
      // has been returning 400 on every load since it was written, for
      // every user, with or without data. Verified against the live schema:
      //   order=minute_timestamp -> 400 column does not exist
      //   order=tracked_at       -> 200
      let query = supabase
        .from("keyboard_stats")
        .select("*")
        .eq("session_id", sessionId)
        .order("tracked_at", { ascending: true })
        .limit(limit);

      if (developerId) {
        query = query.eq("developer_id", developerId);
      }
      // The email column on this table is `user_email`. `developer_email`
      // exists on `screenshots`, which is where that spelling came from.
      if (developerEmail) {
        query = query.eq("user_email", developerEmail);
      }

      const { data, error: err } = await query;
      if (err) throw err;
      setRows(data || []);
      setHasMore((data || []).length >= limit);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [sessionId, developerId, developerEmail, limit]);

  // Initial fetch + polling
  useEffect(() => {
    let stopPolling = null;
    fetchKeyboard();
    if (pollIntervalMs && sessionId && (developerId || developerEmail)) {
      stopPolling = setVisibleInterval(fetchKeyboard, pollIntervalMs);
    }
    return () => {
      if (stopPolling) stopPolling();
    };
  }, [fetchKeyboard, pollIntervalMs, sessionId, developerId, developerEmail]);

  // Realtime
  useEffect(() => {
    if (!sessionId || (!developerId && !developerEmail)) return;

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    // Realtime filter by session; RLS ensures rows belong to this user
    const channel = supabase
      .channel("keyboard-stats-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "keyboard_stats",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          setRows((prev) => {
            // Keyed on `id`, and this is not cosmetic. The dedupe used to
            // compare `minute_timestamp`, a column that does not exist, so
            // every comparison was `undefined === undefined` — always true.
            // The first row therefore matched every incoming insert and got
            // overwritten by it, and the map replaced EVERY row at once,
            // collapsing the whole panel to N copies of the newest sample.
            const incoming = payload.new;
            if (prev.some((r) => r.id === incoming.id)) {
              return prev.map((r) => (r.id === incoming.id ? incoming : r));
            }
            return [...prev, incoming]
              .sort((a, b) =>
                String(a.tracked_at || "").localeCompare(String(b.tracked_at || ""))
              )
              .slice(-limit);
          });
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [sessionId, developerId, developerEmail, limit]);

  // Aggregate summary for convenience
  const summary = rows.reduce(
    (acc, r) => {
      const totalKeys = Number(r.total_keys) || 0;
      const wpm = Number(r.words_per_minute) || 0;
      const activityPct = Number(r.keyboard_activity_percentage) || 0;

      acc.totalKeys += totalKeys;
      acc.totalWpm += wpm;
      acc.totalActivityPct += activityPct;
      acc.count += 1;
      return acc;
    },
    { totalKeys: 0, totalWpm: 0, totalActivityPct: 0, count: 0 }
  );

  const avgWpm = summary.count ? summary.totalWpm / summary.count : 0;
  const avgActivityPct = summary.count
    ? summary.totalActivityPct / summary.count
    : 0;

  return {
    rows,
    loading,
    error,
    hasMore,
    totalKeys: summary.totalKeys,
    avgWpm,
    avgActivityPct,
    refresh: fetchKeyboard,
  };
}

// ────────────────────────────────────────────────────────────────
// useMouseRealtime
// Live mouse_activities for a session + developer
// ────────────────────────────────────────────────────────────────
export function useMouseRealtime({
  sessionId,
  developerId,
  developerEmail,
  pollIntervalMs = DEFAULT_POLL_INTERVAL,
  limit = DEFAULT_ROW_LIMIT,
} = {}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const channelRef = useRef(null);

  const fetchMouse = useCallback(async () => {
    if (!sessionId || (!developerId && !developerEmail)) return;
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from("mouse_activities")
        .select("*")
        .eq("session_id", sessionId)
        .order("timestamp", { ascending: false })
        .limit(limit);

      if (developerId) query = query.eq("developer_id", developerId);
      // mouse_activities carries NO email column at all — not
      // `developer_email`, not `user_email`; only `developer_name`. Filtering
      // on it made PostgREST reject the entire request with a 400, so this
      // panel went blank for any caller that passed an email. `session_id`
      // already scopes the rows to one person's one session, so dropping the
      // filter narrows nothing: a session cannot span two people.

      const { data, error: err } = await query;
      if (err) throw err;
      setRows(data || []);
      setHasMore((data || []).length >= limit);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [sessionId, developerId, developerEmail, limit]);

  useEffect(() => {
    let stopPolling = null;
    fetchMouse();
    if (pollIntervalMs && sessionId && (developerId || developerEmail)) {
      stopPolling = setVisibleInterval(fetchMouse, pollIntervalMs);
    }
    return () => {
      if (stopPolling) stopPolling();
    };
  }, [fetchMouse, pollIntervalMs, sessionId, developerId, developerEmail]);

  useEffect(() => {
    if (!sessionId || (!developerId && !developerEmail)) return;

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase
      .channel("mouse-activities-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "mouse_activities",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          setRows((prev) => [payload.new, ...prev].slice(0, limit));
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [sessionId, developerId, developerEmail, limit]);

  // Latest row represents current status; aggregate percentages over session
  const latest = rows[0] || null;
  const summary = rows.reduce(
    (acc, r) => {
      acc.totalEvents += Number(r.total_events) || 0;
      acc.totalActivePct += Number(r.active_percentage) || 0;
      acc.totalIdlePct += Number(r.idle_percentage) || 0;
      acc.count += 1;
      return acc;
    },
    { totalEvents: 0, totalActivePct: 0, totalIdlePct: 0, count: 0 }
  );

  const avgActivePct = summary.count
    ? summary.totalActivePct / summary.count
    : 0;
  const avgIdlePct = summary.count ? summary.totalIdlePct / summary.count : 0;

  return {
    rows,
    loading,
    error,
    hasMore,
    latest,
    totalEvents: summary.totalEvents,
    avgActivePct,
    avgIdlePct,
    refresh: fetchMouse,
  };
}

// ────────────────────────────────────────────────────────────────
// useAppUsageRealtime
// Live app_usage for a session + user; aggregates top apps & browsers
// ────────────────────────────────────────────────────────────────
const BROWSER_EXES = [
  "chrome.exe",
  "msedge.exe",
  "firefox.exe",
  "brave.exe",
  "opera.exe",
  "safari.exe",
];

export function useAppUsageRealtime({
  sessionId,
  userEmail,
  pollIntervalMs = DEFAULT_POLL_INTERVAL,
  limit = DEFAULT_ROW_LIMIT,
} = {}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const channelRef = useRef(null);

  const fetchApps = useCallback(async () => {
    if (!sessionId || !userEmail) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("app_usage")
        .select("*")
        .eq("session_id", sessionId)
        .eq("user_email", userEmail)
        .order("start_time", { ascending: true })
        .limit(limit);
      if (err) throw err;
      setRows(data || []);
      setHasMore((data || []).length >= limit);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [sessionId, userEmail, limit]);

  useEffect(() => {
    let stopPolling = null;
    fetchApps();
    if (pollIntervalMs && sessionId && userEmail) {
      stopPolling = setVisibleInterval(fetchApps, pollIntervalMs);
    }
    return () => {
      if (stopPolling) stopPolling();
    };
  }, [fetchApps, pollIntervalMs, sessionId, userEmail]);

  useEffect(() => {
    if (!sessionId || !userEmail) return;

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase
      .channel("app-usage-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "app_usage",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          setRows((prev) => [...prev, payload.new].slice(-limit));
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [sessionId, userEmail, limit]);

  // Aggregate app usage
  const appMap = rows.reduce((acc, row) => {
    const key = row.app_name || row.app_name_raw || "Unknown";
    const minutes = Number(row.duration_minutes) || 0;
    if (!acc[key]) {
      acc[key] = {
        app: key,
        appRaw: row.app_name_raw,
        totalMinutes: 0,
      };
    }
    acc[key].totalMinutes += minutes;
    return acc;
  }, {});

  const apps = Object.values(appMap).sort(
    (a, b) => b.totalMinutes - a.totalMinutes
  );
  const topApps = apps.slice(0, 3);

  // Browser aggregation by exe
  const browserMap = rows.reduce((acc, row) => {
    const raw = (row.app_name_raw || "").toLowerCase();
    if (!BROWSER_EXES.includes(raw)) return acc;
    const key = raw;
    const minutes = Number(row.duration_minutes) || 0;
    if (!acc[key]) {
      acc[key] = { browser: raw, totalMinutes: 0 };
    }
    acc[key].totalMinutes += minutes;
    return acc;
  }, {});

  const browsers = Object.values(browserMap).sort(
    (a, b) => b.totalMinutes - a.totalMinutes
  );
  const topBrowser = browsers[0] || null;

  return {
    rows,
    loading,
    error,
    hasMore,
    topApps,
    browsers,
    topBrowser,
    refresh: fetchApps,
  };
}

// ────────────────────────────────────────────────────────────────
// useWebsiteUsageRealtime
// Live browser_usage for a session: time per DOMAIN, not per page.
//
// The desktop agent has always written this table (app_monitor.py, upserting
// on session_id + site) — nothing on the website had ever read it, so the
// data was collected and never shown. The privacy policy now discloses it;
// see "Websites — the domain, and how long" in src/content/legal/privacy.js.
//
// Rows arrive by UPSERT, not plain INSERT: the agent keeps re-writing the same
// (session_id, site) row as the duration grows. So the realtime subscription
// listens for every event and replaces by id, rather than appending the way
// the app_usage one does — appending here would show the same domain a dozen
// times with a dozen different durations.
// ────────────────────────────────────────────────────────────────
export function useWebsiteUsageRealtime({
  sessionId,
  userEmail,
  pollIntervalMs = DEFAULT_POLL_INTERVAL,
  limit = DEFAULT_ROW_LIMIT,
} = {}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const channelRef = useRef(null);

  const fetchSites = useCallback(async () => {
    if (!sessionId || !userEmail) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("browser_usage")
        .select("*")
        .eq("session_id", sessionId)
        .eq("user_email", userEmail)
        .order("duration_seconds", { ascending: false })
        .limit(limit);
      if (err) throw err;
      setRows(data || []);
      setHasMore((data || []).length >= limit);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [sessionId, userEmail, limit]);

  useEffect(() => {
    let stopPolling = null;
    fetchSites();
    if (pollIntervalMs && sessionId && userEmail) {
      stopPolling = setVisibleInterval(fetchSites, pollIntervalMs);
    }
    return () => {
      if (stopPolling) stopPolling();
    };
  }, [fetchSites, pollIntervalMs, sessionId, userEmail]);

  useEffect(() => {
    if (!sessionId || !userEmail) return;

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const channel = supabase
      .channel("browser-usage-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "browser_usage",
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const incoming = payload.new;
          if (!incoming?.id) return;
          setRows((prev) => {
            const next = prev.some((r) => r.id === incoming.id)
              ? prev.map((r) => (r.id === incoming.id ? incoming : r))
              : [...prev, incoming];
            return next
              .sort(
                (a, b) => (Number(b.duration_seconds) || 0) - (Number(a.duration_seconds) || 0)
              )
              .slice(0, limit);
          });
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [sessionId, userEmail, limit]);

  // One entry per domain. The agent already upserts per (session_id, site),
  // so this is a safeguard rather than a real fold — but a duplicate here
  // would double somebody's reported time, which is worth guarding against.
  const siteMap = rows.reduce((acc, row) => {
    const key = row.site || "unknown";
    const minutes =
      Number(row.duration_minutes) ||
      (Number(row.duration_seconds) || 0) / 60 ||
      0;
    if (!acc[key]) acc[key] = { site: key, totalMinutes: 0, lastSeen: null };
    acc[key].totalMinutes += minutes;
    const seen = row.last_seen || null;
    if (seen && (!acc[key].lastSeen || seen > acc[key].lastSeen)) {
      acc[key].lastSeen = seen;
    }
    return acc;
  }, {});

  const sites = Object.values(siteMap).sort((a, b) => b.totalMinutes - a.totalMinutes);
  const totalMinutes = sites.reduce((sum, s) => sum + s.totalMinutes, 0);

  return {
    rows,
    loading,
    error,
    hasMore,
    sites,
    topSites: sites.slice(0, 8),
    totalMinutes,
    refresh: fetchSites,
  };
}

// ────────────────────────────────────────────────────────────────
// useScreenshotsRealtime
// Live screenshots for a developer; optionally limited to a session
// (by passing session start/end timestamps)
// ────────────────────────────────────────────────────────────────
export function useScreenshotsRealtime({
  developerId,
  developerEmail,
  session,
  pollIntervalMs = DEFAULT_POLL_INTERVAL,
  limit = SCREENSHOT_ROW_LIMIT,
} = {}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const channelRef = useRef(null);

  const hasIdentity = developerId || developerEmail;

  const fetchScreenshots = useCallback(async () => {
    if (!hasIdentity) return;
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from("screenshots")
        .select("*")
        .order("timestamp", { ascending: false })
        .limit(limit);

      if (developerId) query = query.eq("developer_id", developerId);
      if (developerEmail) query = query.eq("developer_email", developerEmail);

      if (session?.start_time && session?.end_time) {
        query = query
          .gte("timestamp", session.start_time)
          .lte("timestamp", session.end_time);
      }

      const { data, error: err } = await query;
      if (err) throw err;
      setHasMore((data || []).length >= limit);
      // Resolve the display URL. Rows in the private `monitoring` bucket are
      // signed on demand (short-lived); pre-Phase-2 rows fall back to their
      // stored public URL. Either way consumers read shot.public_url.
      setRows(await resolveScreenshotUrls(data || []));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [developerId, developerEmail, session, hasIdentity, limit]);

  useEffect(() => {
    let stopPolling = null;
    fetchScreenshots();
    if (pollIntervalMs && hasIdentity) {
      stopPolling = setVisibleInterval(fetchScreenshots, pollIntervalMs);
    }
    return () => {
      if (stopPolling) stopPolling();
    };
  }, [fetchScreenshots, pollIntervalMs, hasIdentity]);

  useEffect(() => {
    if (!hasIdentity) return;

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    const filter = developerId
      ? `developer_id=eq.${developerId}`
      : developerEmail
      ? `developer_email=eq.${developerEmail}`
      : undefined;

    const channel = supabase
      .channel("screenshots-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "screenshots",
          ...(filter ? { filter } : {}),
        },
        (payload) => {
          setRows((prev) => [payload.new, ...prev].slice(0, limit));
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [developerId, developerEmail, hasIdentity, limit]);

  const recentThree = rows.slice(0, 3);

  return {
    rows,
    loading,
    error,
    hasMore,
    recentThree,
    count: rows.length,
    refresh: fetchScreenshots,
  };
}
