"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "../utils/supabaseClient";
import { resolveScreenshotUrls } from "../utils/screenshotFiles";

// Default polling interval (ms) used as a fallback beside Realtime
const DEFAULT_POLL_INTERVAL = 10_000;

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
    let intervalId;
    fetchSession();
    if (pollIntervalMs && userEmail) {
      intervalId = setInterval(fetchSession, pollIntervalMs);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
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
} = {}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const channelRef = useRef(null);

  const fetchKeyboard = useCallback(async () => {
    if (!sessionId || (!developerId && !developerEmail)) return;
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from("keyboard_stats")
        .select("*")
        .eq("session_id", sessionId)
        .order("minute_timestamp", { ascending: true });

      if (developerId) {
        query = query.eq("developer_id", developerId);
      }
      if (developerEmail) {
        query = query.eq("developer_email", developerEmail);
      }

      const { data, error: err } = await query;
      if (err) throw err;
      setRows(data || []);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [sessionId, developerId, developerEmail]);

  // Initial fetch + polling
  useEffect(() => {
    let intervalId;
    fetchKeyboard();
    if (pollIntervalMs && sessionId && (developerId || developerEmail)) {
      intervalId = setInterval(fetchKeyboard, pollIntervalMs);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
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
            const existing = prev.find(
              (r) => r.minute_timestamp === payload.new.minute_timestamp
            );
            if (existing) {
              return prev.map((r) =>
                r.minute_timestamp === payload.new.minute_timestamp ? payload.new : r
              );
            }
            return [...prev, payload.new].sort((a, b) =>
              String(a.minute_timestamp).localeCompare(String(b.minute_timestamp))
            );
          });
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [sessionId, developerId, developerEmail]);

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
} = {}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
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
        .order("timestamp", { ascending: false });

      if (developerId) query = query.eq("developer_id", developerId);
      if (developerEmail) query = query.eq("developer_email", developerEmail);

      const { data, error: err } = await query;
      if (err) throw err;
      setRows(data || []);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [sessionId, developerId, developerEmail]);

  useEffect(() => {
    let intervalId;
    fetchMouse();
    if (pollIntervalMs && sessionId && (developerId || developerEmail)) {
      intervalId = setInterval(fetchMouse, pollIntervalMs);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
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
          setRows((prev) => [payload.new, ...prev]);
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [sessionId, developerId, developerEmail]);

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
} = {}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
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
        .order("start_time", { ascending: true });
      if (err) throw err;
      setRows(data || []);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [sessionId, userEmail]);

  useEffect(() => {
    let intervalId;
    fetchApps();
    if (pollIntervalMs && sessionId && userEmail) {
      intervalId = setInterval(fetchApps, pollIntervalMs);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
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
          setRows((prev) => [...prev, payload.new]);
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [sessionId, userEmail]);

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
    topApps,
    browsers,
    topBrowser,
    refresh: fetchApps,
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
} = {}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
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
        .limit(100);

      if (developerId) query = query.eq("developer_id", developerId);
      if (developerEmail) query = query.eq("developer_email", developerEmail);

      if (session?.start_time && session?.end_time) {
        query = query
          .gte("timestamp", session.start_time)
          .lte("timestamp", session.end_time);
      }

      const { data, error: err } = await query;
      if (err) throw err;
      // Resolve the display URL. Rows in the private `monitoring` bucket are
      // signed on demand (short-lived); pre-Phase-2 rows fall back to their
      // stored public URL. Either way consumers read shot.public_url.
      setRows(await resolveScreenshotUrls(data || []));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [developerId, developerEmail, session, hasIdentity]);

  useEffect(() => {
    let intervalId;
    fetchScreenshots();
    if (pollIntervalMs && hasIdentity) {
      intervalId = setInterval(fetchScreenshots, pollIntervalMs);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
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
          setRows((prev) => [payload.new, ...prev]);
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [developerId, developerEmail, hasIdentity]);

  const recentThree = rows.slice(0, 3);

  return {
    rows,
    loading,
    error,
    recentThree,
    count: rows.length,
    refresh: fetchScreenshots,
  };
}
