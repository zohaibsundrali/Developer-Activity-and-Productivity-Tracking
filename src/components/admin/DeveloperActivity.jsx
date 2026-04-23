"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import { showPre } from "@/utils/alerts";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area,
} from "recharts";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const CHART_COLORS = ["#009578", "#0ea5e9", "#8b5cf6", "#f59e0b", "#ef4444", "#10b981", "#6366f1", "#ec4899"];
const POLL_INTERVAL = 10_000; // 10 seconds

export default function DeveloperActivity() {
  const [currentAdmin, setCurrentAdmin] = useState(null);
  const [developers, setDevelopers] = useState([]);
  const [selectedDeveloper, setSelectedDeveloper] = useState("");
  const [selectedDate, setSelectedDate] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [timeRange, setTimeRange] = useState("today");
  const [loading, setLoading] = useState(false);
  const [fetchingDevelopers, setFetchingDevelopers] = useState(false);
  const [viewMode, setViewMode] = useState("overview");

  // Data states for each table
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [mouseData, setMouseData] = useState([]);
  const [keyboardData, setKeyboardData] = useState([]);
  const [appUsageData, setAppUsageData] = useState([]);
  const [screenshots, setScreenshots] = useState([]);
  const [selectedScreenshot, setSelectedScreenshot] = useState(null);
  const [todayTotalSeconds, setTodayTotalSeconds] = useState(0);

  // Real-time state
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const pollRef = useRef(null);
  const realtimeChannelRef = useRef(null);

  // ─── Admin Auth ───
  useEffect(() => {
    const getCurrentAdmin = () => {
      try {
        const adminData = JSON.parse(localStorage.getItem("adminUser"));
        setCurrentAdmin(adminData && adminData.email ? adminData : null);
      } catch {
        setCurrentAdmin(null);
      }
    };
    getCurrentAdmin();
    window.addEventListener("storage", getCurrentAdmin);
    return () => window.removeEventListener("storage", getCurrentAdmin);
  }, []);

  // ─── Fetch Developers ───
  const fetchAdminDevelopers = useCallback(async () => {
    if (!currentAdmin?.id) return;
    setFetchingDevelopers(true);
    try {
      let devs = [];
      const cols = ["added_by_admin", "added_by", "admin_id", "created_by"];
      for (const col of cols) {
        const { data } = await supabase.from("developers").select("*").eq(col, currentAdmin.id);
        if (data?.length) { devs = data; break; }
        if (currentAdmin.email) {
          const { data: d2 } = await supabase.from("developers").select("*").eq(col, currentAdmin.email);
          if (d2?.length) { devs = d2; break; }
        }
      }
      if (!devs.length && currentAdmin.id) {
        const { data } = await supabase.from("developers").select("*")
          .or(`added_by_admin.eq.${currentAdmin.id},added_by.eq.${currentAdmin.id},admin_id.eq.${currentAdmin.id}`);
        if (data) devs = data;
      }
      setDevelopers(devs);
      if (selectedDeveloper && devs.length && !devs.find(d => d.id === selectedDeveloper)) setSelectedDeveloper("");
    } catch (err) {
      // Silently handle error
    } finally {
      setFetchingDevelopers(false);
    }
  }, [currentAdmin, selectedDeveloper]);

  useEffect(() => {
    if (currentAdmin?.id) fetchAdminDevelopers();
    else { setDevelopers([]); setSelectedDeveloper(""); }
  }, [currentAdmin, fetchAdminDevelopers]);

  // ─── Date Filter ───
  const getDateFilter = useCallback(() => {
    const [yy, mm, dd] = String(selectedDate).split("-").map(Number);
    // Build the range using *local* time to avoid UTC date drift.
    const start = new Date(yy, (mm || 1) - 1, dd || 1, 0, 0, 0, 0);
    const end = new Date(yy, (mm || 1) - 1, dd || 1, 23, 59, 59, 999);
    if (timeRange === "week") start.setDate(start.getDate() - 7);
    if (timeRange === "month") start.setMonth(start.getMonth() - 1);
    return { start: start.toISOString(), end: end.toISOString() };
  }, [selectedDate, timeRange]);

  // ─── Fetch All Activity Data (with active session detection) ───
  const fetchDeveloperActivity = useCallback(async (silent = false) => {
    const dev = developers.find(d => d.id === selectedDeveloper);
    if (!dev) return;
    if (!silent) setLoading(true);

    const { start, end } = getDateFilter();
    const devId = dev.id;
    const devEmail = dev.email;
    const [yy, mm, dd] = String(selectedDate).split("-").map(Number);
    const dayStart = new Date(yy, (mm || 1) - 1, dd || 1, 0, 0, 0, 0);
    const dayEnd = new Date(yy, (mm || 1) - 1, dd || 1, 0, 0, 0, 0);
    dayEnd.setDate(dayEnd.getDate() + 1);

    try {
      // Fetch all 5 tables in parallel (keyboard via API route to bypass RLS)
      const sessionFilters = [
        devEmail ? `user_email.eq.${devEmail}` : null,
        dev.user_id ? `user_id.eq.${dev.user_id}` : null,
        devId ? `developer_id.eq.${devId}` : null,
      ].filter(Boolean).join(",");

      const [sessionsRes, mouseRes, keyboardApiRes, appRes, screenshotRes, screenshotCreatedAtRes, todayTotalRes] = await Promise.all([
        // Match sessions for this developer by email, user_id, or developer_id
        supabase
          .from("productivity_sessions")
          .select("*")
          .or(sessionFilters)
          .gte("start_time", start)
          .lt("start_time", end)
          .order("start_time", { ascending: false }),
        supabase.from("mouse_activities").select("id, session_id, developer_id, developer_name, timestamp, activity_status, active_percentage, idle_percentage, created_at").eq("developer_id", devId).gte("created_at", start).lte("created_at", end).order("timestamp", { ascending: false }),
        fetch(`/api/keyboard-stats?developerId=${encodeURIComponent(devId)}&email=${encodeURIComponent(devEmail)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`).then(r => r.json()),
        supabase.from("app_usage").select("id, session_id, user_email, app_name, app_name_raw, window_title, start_time, end_time, duration_seconds, duration_minutes, tracked_at, created_at, is_new_app, user_login").eq("user_email", devEmail).gte("tracked_at", start).lte("tracked_at", end).order("tracked_at", { ascending: false }),
        // Screenshots schema has varied; select '*' and normalize client-side.
        supabase.from("screenshots").select("*")
          .or(`developer_id.eq.${devId},developer_email.eq.${devEmail}`)
          .gte("timestamp", start)
          .lt("timestamp", end)
          .order("timestamp", { ascending: false }),
        // Fallback for rows missing `timestamp`: use created_at but keep the same date range.
        supabase.from("screenshots").select("*")
          .or(`developer_id.eq.${devId},developer_email.eq.${devEmail}`)
          .gte("created_at", start)
          .lt("created_at", end)
          .order("created_at", { ascending: false })
          .limit(200),
        devEmail
          ? supabase
              .from("productivity_sessions")
              .select("total_duration")
              .eq("user_email", devEmail)
              .gte("start_time", dayStart.toISOString())
              .lt("start_time", dayEnd.toISOString())
          : Promise.resolve({ data: [], error: null }),
      ]);

      let finalSessions = sessionsRes.data || [];
      let finalMouse = mouseRes.data || [];
      let finalKeyboard = keyboardApiRes.data || [];
      let finalApp = appRes.data || [];

      let screenshotRows = screenshotRes.data || [];
      let screenshotCreatedAtRows = screenshotCreatedAtRes.data || [];
      let finalScreenshots = [];

      const todayTotal = (todayTotalRes?.data || []).reduce(
        (sum, row) => sum + (Number(row.total_duration) || 0),
        0
      );
      setTodayTotalSeconds(todayTotal);

      // Fallback to created_at for sessions if start_time is missing or not in range
      if (!finalSessions.length && sessionFilters) {
        const { data: sByCreatedAt } = await supabase
          .from("productivity_sessions")
          .select("*")
          .or(sessionFilters)
          .gte("created_at", start)
          .lt("created_at", end)
          .order("created_at", { ascending: false });
        if (sByCreatedAt?.length) finalSessions = sByCreatedAt;
      }

      // Fallback to email if developer_id returned nothing
      if (!finalSessions.length && !finalMouse.length) {
        const [s2, m2, a2, ss2, ss2CreatedAt] = await Promise.all([
          supabase
            .from("productivity_sessions")
            .select("*")
            .or(sessionFilters)
            .gte("start_time", start)
            .lt("start_time", end)
            .order("start_time", { ascending: false }),
          supabase.from("mouse_activities").select("id, session_id, developer_id, developer_name, timestamp, activity_status, active_percentage, idle_percentage, created_at").eq("email", devEmail).gte("created_at", start).lte("created_at", end).order("timestamp", { ascending: false }),
          supabase.from("app_usage").select("id, session_id, user_email, app_name, app_name_raw, window_title, start_time, end_time, duration_seconds, duration_minutes, tracked_at, created_at, is_new_app, user_login").eq("user_email", devEmail).gte("tracked_at", start).lte("tracked_at", end).order("tracked_at", { ascending: false }),
          supabase.from("screenshots").select("*")
            .or(`developer_id.eq.${devId},developer_email.eq.${devEmail}`)
            .gte("timestamp", start)
            .lt("timestamp", end)
            .order("timestamp", { ascending: false }),
          supabase.from("screenshots").select("*")
            .or(`developer_id.eq.${devId},developer_email.eq.${devEmail}`)
            .gte("created_at", start)
            .lt("created_at", end)
            .order("created_at", { ascending: false })
            .limit(200),
        ]);
        finalSessions = s2.data || [];
        finalMouse = m2.data || [];
        finalApp = a2.data || [];
        screenshotRows = ss2.data || [];
        screenshotCreatedAtRows = ss2CreatedAt.data || [];
      }

      // Keyboard data already fetched via API route with all fallbacks built-in

      // Normalize + strictly filter screenshots to the selected range.
      // Also require a real image URL so the UI never shows count-only/placeholder rows.
      const startMs = new Date(start).getTime();
      const endMs = new Date(end).getTime();
      const merged = new Map();
      [...(screenshotRows || []), ...(screenshotCreatedAtRows || [])].forEach((r) => {
        const key = r?.id || `${r?.developer_id || ""}-${r?.created_at || ""}-${r?.timestamp || ""}`;
        if (!merged.has(key)) merged.set(key, r);
      });
      finalScreenshots = Array.from(merged.values())
        .map((r) => {
          const imageUrl = r?.public_url || r?.image_url || r?.thumbnail_url || r?.publicUrl || null;
          const ts = r?.timestamp || r?.created_at || null;
          return { ...r, public_url: imageUrl, _display_ts: ts };
        })
        .filter((r) => {
          if (!r.public_url) return false;
          if (!r._display_ts) return false;
          const t = new Date(r._display_ts).getTime();
          if (Number.isNaN(t)) return false;
          return t >= startMs && t < endMs;
        })
        .sort((a, b) => new Date(b._display_ts).getTime() - new Date(a._display_ts).getTime());

      // Detect active session
      const active = finalSessions.find(s => s.status === "active") || null;
      setActiveSession(active);

      setSessions(finalSessions);
      setMouseData(finalMouse);
      setKeyboardData(finalKeyboard);
      setAppUsageData(finalApp);
      setScreenshots(finalScreenshots);
      setLastUpdated(new Date());
    } catch (err) {
      // Silently handle fetch errors
    } finally {
      if (!silent) setLoading(false);
    }
  }, [selectedDeveloper, developers, getDateFilter]);

  // Initial fetch + re-fetch on filter changes
  useEffect(() => {
    if (selectedDeveloper) fetchDeveloperActivity();
  }, [selectedDeveloper, selectedDate, timeRange, fetchDeveloperActivity]);

  // ─── Polling (10s auto-refresh) ───
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (autoRefresh && selectedDeveloper) {
      pollRef.current = setInterval(() => fetchDeveloperActivity(true), POLL_INTERVAL);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [autoRefresh, selectedDeveloper, fetchDeveloperActivity]);

  // ─── Supabase Realtime for mouse_activities ───
  useEffect(() => {
    // Cleanup previous channel
    if (realtimeChannelRef.current) {
      supabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }

    const dev = developers.find(d => d.id === selectedDeveloper);
    if (!dev) return;

    const channel = supabase
      .channel("mouse-activity-realtime")
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "mouse_activities",
        filter: `developer_id=eq.${dev.id}`,
      }, (payload) => {
        setMouseData(prev => [payload.new, ...prev]);
        setLastUpdated(new Date());
      })
      .subscribe();

    realtimeChannelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedDeveloper, developers]);

  // ─── Supabase Realtime for keyboard_stats ───
  const keyboardChannelRef = useRef(null);
  useEffect(() => {
    if (keyboardChannelRef.current) {
      supabase.removeChannel(keyboardChannelRef.current);
      keyboardChannelRef.current = null;
    }
    const dev = developers.find(d => d.id === selectedDeveloper);
    if (!dev) return;
    const kbChannel = supabase
      .channel("keyboard-stats-realtime")
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "keyboard_stats",
        filter: `developer_id=eq.${dev.id}`,
      }, (payload) => {
        setKeyboardData(prev => [payload.new, ...prev]);
        setLastUpdated(new Date());
      })
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "keyboard_stats",
        // Some trackers only populate developer_email; listen to that as well
        filter: `developer_email=eq.${dev.email}`,
      }, (payload) => {
        setKeyboardData(prev => {
          if (prev.some(k => k.id === payload.new.id)) return prev;
          return [payload.new, ...prev];
        });
        setLastUpdated(new Date());
      })
      .subscribe();
    keyboardChannelRef.current = kbChannel;
    return () => { supabase.removeChannel(kbChannel); };
  }, [selectedDeveloper, developers]);

  // ─── Supabase Realtime for app_usage ───
  const appChannelRef = useRef(null);
  useEffect(() => {
    if (appChannelRef.current) {
      supabase.removeChannel(appChannelRef.current);
      appChannelRef.current = null;
    }
    const dev = developers.find(d => d.id === selectedDeveloper);
    if (!dev) return;
    const appChannel = supabase
      .channel("app-usage-realtime")
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "app_usage",
        filter: `user_email=eq.${dev.email}`,
      }, (payload) => {
        setAppUsageData(prev => [payload.new, ...prev]);
        setLastUpdated(new Date());
      })
      .subscribe();
    appChannelRef.current = appChannel;
    return () => { supabase.removeChannel(appChannel); };
  }, [selectedDeveloper, developers]);

  // ─── Supabase Realtime for screenshots ───
  const screenshotChannelRef = useRef(null);
  useEffect(() => {
    if (screenshotChannelRef.current) {
      supabase.removeChannel(screenshotChannelRef.current);
      screenshotChannelRef.current = null;
    }
    const dev = developers.find(d => d.id === selectedDeveloper);
    if (!dev) return;

    const { start, end } = getDateFilter();
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();

    const normalizeRow = (row) => {
      const imageUrl = row?.public_url || row?.image_url || row?.thumbnail_url || row?.publicUrl || null;
      const ts = row?.timestamp || row?.created_at || null;
      return { ...row, public_url: imageUrl, _display_ts: ts };
    };

    const shouldInclude = (row) => {
      const imageUrl = row?.public_url || row?.image_url || row?.thumbnail_url || row?.publicUrl;
      if (!imageUrl) return false;
      const ts = row?.timestamp || row?.created_at;
      if (!ts) return false;
      const t = new Date(ts).getTime();
      if (Number.isNaN(t)) return false;
      return t >= startMs && t < endMs;
    };

    const ssChannel = supabase
      .channel("screenshots-realtime")
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "screenshots",
        filter: `developer_id=eq.${dev.id}`,
      }, (payload) => {
        if (!shouldInclude(payload.new)) return;
        const row = normalizeRow(payload.new);
        setScreenshots(prev => {
          if (row.id && prev.some(s => s.id === row.id)) return prev;
          return [row, ...prev];
        });
        setLastUpdated(new Date());
      })
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "screenshots",
        filter: `developer_email=eq.${dev.email}`,
      }, (payload) => {
        if (!shouldInclude(payload.new)) return;
        const row = normalizeRow(payload.new);
        setScreenshots(prev => {
          if (row.id && prev.some(s => s.id === row.id)) return prev;
          return [row, ...prev];
        });
        setLastUpdated(new Date());
      })
      .subscribe();
    screenshotChannelRef.current = ssChannel;
    return () => { supabase.removeChannel(ssChannel); };
  }, [selectedDeveloper, developers, getDateFilter]);

  // ─── Computed Metrics ───
  const developer = developers.find(d => d.id === selectedDeveloper);
  const hasData = sessions.length || mouseData.length || keyboardData.length || appUsageData.length || screenshots.length;

  const { start: rangeStart, end: rangeEnd } = getDateFilter();

  // Aggregate durations from productivity_sessions for the selected date/range
  const totalActiveTime = sessions.reduce((s, r) => s + (Number(r.active_duration) || 0), 0);
  const totalIdleTime = sessions.reduce((s, r) => s + (Number(r.idle_duration) || 0), 0);

  // Sum of productivity_sessions.total_duration (in seconds) for the selected day (by start_time)
  const rangeStartTime = new Date(rangeStart).getTime();
  const rangeEndTime = new Date(rangeEnd).getTime();
  const totalDurationSeconds = sessions
    .filter((r) => {
      if (!r.start_time || r.total_duration == null) return false;
      const ts = new Date(r.start_time).getTime();
      return !Number.isNaN(ts) && ts >= rangeStartTime && ts < rangeEndTime;
    })
    .reduce((sum, r) => sum + Number(r.total_duration || 0), 0);
    
  // Format seconds to HH:MM:SS
  const formatHHMMSS = (totalSeconds) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const avgProductivity = sessions.length ? sessions.reduce((s, r) => s + (r.productivity_score || 0), 0) / sessions.length : 0;

  // Mouse metrics from actual schema: active_percentage, idle_percentage, activity_status
  const avgMouseActive = mouseData.length ? mouseData.reduce((s, r) => s + (r.active_percentage || 0), 0) / mouseData.length : 0;
  const avgMouseIdle = mouseData.length ? mouseData.reduce((s, r) => s + (r.idle_percentage || 0), 0) / mouseData.length : 0;
  const latestMouseStatus = mouseData.length > 0 ? (mouseData[0].activity_status || "Unknown") : "No Data";

  // Session-scoped mouse data
  const sessionMouseData = activeSession
    ? mouseData.filter(r => r.session_id === activeSession.session_id)
    : mouseData;
  const avgSessionMouseActive = sessionMouseData.length ? sessionMouseData.reduce((s, r) => s + (r.active_percentage || 0), 0) / sessionMouseData.length : 0;
  const avgSessionMouseIdle = sessionMouseData.length ? sessionMouseData.reduce((s, r) => s + (r.idle_percentage || 0), 0) / sessionMouseData.length : 0;

  // Keyboard metrics from actual schema: total_keys, unique_keys, words_per_minute, keyboard_activity_percentage, activity_score, active_time_minutes, idle_time_minutes
  const totalKeystrokes = keyboardData.reduce((s, r) => s + (Number(r.total_keys) || 0), 0);
  const totalUniqueKeys = keyboardData.reduce((s, r) => s + (Number(r.unique_keys) || 0), 0);
  const avgWPM = keyboardData.length ? keyboardData.reduce((s, r) => s + (Number(r.words_per_minute) || 0), 0) / keyboardData.length : 0;
  const avgKeyboardActivity = keyboardData.length ? keyboardData.reduce((s, r) => s + (Number(r.keyboard_activity_percentage) || 0), 0) / keyboardData.length : 0;
  const avgKeyboardScore = keyboardData.length ? keyboardData.reduce((s, r) => s + (Number(r.activity_score) || 0), 0) / keyboardData.length : 0;
  const totalKbActiveTime = keyboardData.reduce((s, r) => s + (Number(r.active_time_minutes) || 0), 0);
  const totalKbIdleTime = keyboardData.reduce((s, r) => s + (Number(r.idle_time_minutes) || 0), 0);
  const totalKbTime = keyboardData.reduce((s, r) => s + (Number(r.total_time_minutes) || 0), 0);

  // Session-scoped keyboard data
  const sessionKeyboardData = activeSession
    ? keyboardData.filter(r => r.session_id === activeSession.session_id)
    : keyboardData;
  const sessionTotalKeys = sessionKeyboardData.reduce((s, r) => s + (Number(r.total_keys) || 0), 0);
  const sessionAvgWPM = sessionKeyboardData.length ? sessionKeyboardData.reduce((s, r) => s + (Number(r.words_per_minute) || 0), 0) / sessionKeyboardData.length : 0;
  const sessionAvgScore = sessionKeyboardData.length ? sessionKeyboardData.reduce((s, r) => s + (Number(r.activity_score) || 0), 0) / sessionKeyboardData.length : 0;
  const sessionAvgKbActivity = sessionKeyboardData.length ? sessionKeyboardData.reduce((s, r) => s + (Number(r.keyboard_activity_percentage) || 0), 0) / sessionKeyboardData.length : 0;

  // App usage aggregation using actual schema: app_name, duration_seconds, duration_minutes
  const appMap = {};
  appUsageData.forEach(row => {
    const name = row.app_name || "Unknown";
    if (!appMap[name]) appMap[name] = { app: name, totalSeconds: 0, totalMinutes: 0, count: 0 };
    appMap[name].totalSeconds += row.duration_seconds || 0;
    appMap[name].totalMinutes += row.duration_minutes || 0;
    appMap[name].count += 1;
  });
  const totalAppSessionMinutes = Object.values(appMap).reduce((s, a) => s + a.totalMinutes, 0);
  const topApps = Object.values(appMap)
    .map(a => ({ ...a, pct: totalAppSessionMinutes > 0 ? (a.totalMinutes / totalAppSessionMinutes) * 100 : 0 }))
    .sort((a, b) => b.totalMinutes - a.totalMinutes)
    .slice(0, 10);
  const totalAppsUsed = Object.keys(appMap).length;
  const totalAppActiveMinutes = appUsageData.reduce((s, r) => s + (r.duration_minutes || 0), 0);

  // Session-scoped app data
  const sessionAppData = activeSession
    ? appUsageData.filter(r => r.session_id === activeSession.session_id)
    : appUsageData;

  // Currently active app (most recent record)
  const currentApp = appUsageData.length > 0 ? appUsageData[0] : null;

  // ─── Chart Data Builders ───
  // Mouse chart: active % vs idle % over time  (using real schema)
  const mouseChartData = mouseData.slice().reverse().map(r => ({
    time: new Date(r.timestamp || r.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    active: r.active_percentage || 0,
    idle: r.idle_percentage || 0,
  }));

  const keyboardChartData = keyboardData.slice().reverse().map(r => ({
    time: new Date(r.tracked_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    totalKeys: Number(r.total_keys) || 0,
    wpm: Number(r.words_per_minute) || 0,
    activityPct: Number(r.keyboard_activity_percentage) || 0,
    score: Number(r.activity_score) || 0,
  }));

  // Build per-minute breakdown from per_minute_summary jsonb
  const perMinuteData = keyboardData.slice().reverse().flatMap(r => {
    if (!r.per_minute_summary) return [];
    try {
      const summary = typeof r.per_minute_summary === "string" ? JSON.parse(r.per_minute_summary) : r.per_minute_summary;
      if (Array.isArray(summary)) {
        return summary.map(entry => ({
          time: entry.minute || entry.time || "",
          keys: entry.keys || entry.total_keys || entry.key_count || 0,
          wpm: entry.wpm || entry.words_per_minute || 0,
        }));
      }
      if (typeof summary === "object") {
        return Object.entries(summary).map(([minute, data]) => ({
          time: minute,
          keys: typeof data === "number" ? data : (data.keys || data.total_keys || 0),
          wpm: typeof data === "object" ? (data.wpm || 0) : 0,
        }));
      }
    } catch { /* ignore parse errors */ }
    return [];
  });

  const appPieData = topApps.slice(0, 6).map(a => ({
    name: a.app.length > 20 ? a.app.slice(0, 20) + "…" : a.app,
    value: Math.round(a.totalMinutes * 100) / 100,
  }));

  const appBarData = topApps.slice(0, 8).map(a => ({
    name: a.app.length > 15 ? a.app.slice(0, 15) + "…" : a.app,
    minutes: Math.round(a.totalMinutes * 100) / 100,
  }));

  const sessionChartData = sessions.slice().reverse().map((s, i) => ({
    session: `#${i + 1}`,
    score: s.productivity_score || 0,
    active: Math.round((s.active_duration || 0) / 60),
    idle: Math.round((s.idle_duration || 0) / 60),
  }));

  // ─── Helpers ───
  const fmtDuration = (sec) => {
    if (!sec) return "0m";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  // Convert decimal minutes into "X min Y sec" (e.g. 6.5 -> "6 min 30 sec")
  const fmtMinutesToMinSec = (minutes) => {
    if (!minutes || isNaN(minutes)) return "0 min 0 sec";
    const totalSeconds = Math.round(Number(minutes) * 60);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m} min ${s} sec`;
  };
  const fmtDateTime = (iso) => {
    if (!iso) return "N/A";
    return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };
  const fmtTime = (iso) => {
    if (!iso) return "N/A";
    return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };
  const prodColor = (s) => (s >= 80 ? "text-green-600" : s >= 60 ? "text-yellow-600" : "text-red-600");
  const prodBg = (s) => (s >= 80 ? "bg-green-100" : s >= 60 ? "bg-yellow-100" : "bg-red-100");
  const prodLevel = (s) => (s >= 80 ? "High" : s >= 60 ? "Medium" : "Low");
  const statusColor = (status) => {
    const s = (status || "").toLowerCase();
    if (s === "active") return "bg-green-100 text-green-800";
    if (s === "idle") return "bg-yellow-100 text-yellow-800";
    return "bg-gray-100 text-gray-600";
  };

  // Format today's total working time from total_duration (in minutes)
  const formatTotalWorkingTime = (totalMinutes) => {
    const value = Number(totalMinutes) || 0;
    if (value <= 0) return "0 min";

    // Treat very small values as seconds (data sometimes logged in seconds)
    if (value < 1) {
      const seconds = Math.round(value);
      return `${seconds} sec`;
    }

    // Less than an hour → show minutes
    if (value < 60) {
      return `${value.toFixed(0)} min`;
    }

    // 60 minutes or more → show hours with 1 decimal place
    const hours = value / 60;
    return `${hours.toFixed(1)} hours`;
  };

  const refreshAdminData = () => {
    try {
      const adminData = JSON.parse(localStorage.getItem("adminUser"));
      if (adminData) { setCurrentAdmin(adminData); fetchAdminDevelopers(); }
    } catch (err) {
      // Silently handle error
    }
  };

  // ─── Render ───
  return (
    <div className="bg-white p-6 rounded-lg shadow">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold">Developer Activity Dashboard</h2>
          {/* Live indicator */}
          {autoRefresh && selectedDeveloper && (
            <span className="flex items-center gap-1.5 text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              LIVE
            </span>
          )}
        </div>
        <div className="flex items-center space-x-4">
          {lastUpdated && (
            <p className="text-xs text-gray-400">Updated: {fmtTime(lastUpdated.toISOString())}</p>
          )}
          {/* {currentAdmin && (
            <div className="text-right">
              <p className="text-sm font-medium text-gray-700">{currentAdmin.name || currentAdmin.email}</p>
              <p className="text-xs text-gray-500">Admin Dashboard</p>
            </div>
          )} */}
          <button onClick={refreshAdminData} className="bg-gray-100 text-gray-700 px-3 py-1 rounded-md hover:bg-gray-200 transition-colors text-sm">
            Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Select Developer</label>
          <select value={selectedDeveloper} onChange={(e) => setSelectedDeveloper(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-[#009578] focus:border-[#009578]" disabled={!currentAdmin || fetchingDevelopers}>
            <option value="">Choose Developer</option>
            {fetchingDevelopers ? (
              <option value="" disabled>Loading developers...</option>
            ) : (
              developers.map(dev => (
                <option key={dev.id} value={dev.id}>{dev.name} ({dev.email})</option>
              ))
            )}
          </select>
          {!currentAdmin && (
            <div className="mt-1">
              <p className="text-xs text-red-500">Please login to view developers</p>
              <button onClick={() => window.location.href = "/login"} className="text-xs text-blue-500 hover:text-blue-700 underline">Go to Login</button>
            </div>
          )}
          {currentAdmin && fetchingDevelopers && <p className="text-xs text-gray-500 mt-1">Loading developers...</p>}
          {currentAdmin && !fetchingDevelopers && developers.length === 0 && (
            <div className="mt-1">
              <p className="text-xs text-yellow-500">No developers added by you yet</p>
              <button onClick={() => window.location.href = "/admin/dashboard?section=add-developer"} className="text-xs text-green-600 hover:text-green-800 underline">Add Developers</button>
            </div>
          )}
          {currentAdmin && !fetchingDevelopers && developers.length > 0 && (
            <p className="text-xs text-gray-500 mt-1">Showing {developers.length} developer{developers.length !== 1 ? "s" : ""} added by you</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Date</label>
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-[#009578] focus:border-[#009578]" disabled={!selectedDeveloper} />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Time Range</label>
          <select value={timeRange} onChange={(e) => setTimeRange(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-[#009578] focus:border-[#009578]" disabled={!selectedDeveloper}>
            <option value="today">Today</option>
            <option value="week">Last 7 Days</option>
            <option value="month">Last 30 Days</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">View Mode</label>
          <select value={viewMode} onChange={(e) => setViewMode(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-[#009578] focus:border-[#009578]" disabled={!selectedDeveloper}>
            <option value="overview">Overview</option>
            <option value="mouse">Mouse Activity</option>
            <option value="keyboard">Keyboard Activity</option>
            <option value="apps">App Usage</option>
            <option value="screenshots">Screenshots</option>
            <option value="timeline">Session Timeline</option>
          </select>
        </div>

       
      </div>

      {/* Active Session Banner */}
      {activeSession && !loading && (
        <div className="mb-6 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
            </span>
            <div>
              <p className="text-sm font-semibold text-green-800">Active Session Running</p>
              <p className="text-xs text-green-600">
                Session: {String(activeSession.session_id || "").slice(-8)} &bull; Started: {fmtDateTime(activeSession.start_time)}
                &bull; Mouse: {sessionMouseData.length}
                &bull; Keyboard: {sessionKeyboardData.length}
                &bull; Apps: {sessionAppData.length}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-green-600">Current Mouse Status</p>
            <span className={`inline-block px-3 py-1 rounded-full text-sm font-bold ${statusColor(latestMouseStatus)}`}>{latestMouseStatus}</span>
          </div>
        </div>
      )}

      {/* Loading Spinner */}
      {loading && (
        <div className="text-center py-8">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#009578]"></div>
          <p className="text-gray-500 mt-2">Loading activity data...</p>
        </div>
      )}

      {/* Main Content */}
      {developer && hasData && !loading && (
        <div className="space-y-6">

          {/* ==================== OVERVIEW ==================== */}
          {viewMode === "overview" && (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                <StatCard
                  icon="⏳"
                  label="Today's Total Time"
                  value={formatHHMMSS(todayTotalSeconds)}
                  bg="bg-teal-100"
                />
                <StatCard icon="⏱️" label="Today Active Time" value={fmtDuration(totalActiveTime)} bg="bg-green-100" />
                <StatCard icon="⏸️" label="Idle Time" value={fmtDuration(totalIdleTime)} bg="bg-red-100" />
                <StatCard icon="🖱️" label="Mouse Active %" value={`${avgMouseActive.toFixed(1)}%`} bg="bg-blue-100" />
                <StatCard icon="🎯" label="Kb Activity %" value={`${avgKeyboardActivity.toFixed(1)}%`} bg="bg-indigo-100" />
                <StatCard icon="📸" label="Screenshots" value={screenshots.length} bg="bg-pink-100" />
              </div>

              {/* Productivity Chart */}
              {sessionChartData.length > 0 && (
                <div className="bg-gray-50 p-6 rounded-lg">
                  <h3 className="text-lg font-semibold mb-4">Productivity per Session</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={sessionChartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="session" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="score" name="Productivity %" fill="#009578" radius={[4,4,0,0]} />
                      <Bar dataKey="active" name="Active (min)" fill="#0ea5e9" radius={[4,4,0,0]} />
                      <Bar dataKey="idle" name="Idle (min)" fill="#ef4444" radius={[4,4,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Top Apps + App Pie side by side */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-gray-50 p-6 rounded-lg">
                  <h3 className="text-lg font-semibold mb-4">Top Applications</h3>
                  {topApps.length > 0 ? (
                    <div className="space-y-2">
                      {topApps.slice(0, 5).map((app, i) => (
                        <div key={i} className="flex justify-between items-center p-3 bg-white rounded border">
                          <div className="flex items-center">
                            <div
                              className="w-8 h-8 rounded-lg flex items-center justify-center mr-3"
                              style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] + "20" }}
                            >
                              <span style={{ color: CHART_COLORS[i % CHART_COLORS.length] }}>●</span>
                            </div>
                            <span className="font-medium text-sm truncate max-w-[180px]">{app.app}</span>
                          </div>
                          {/* Show total active time for this app as minutes + seconds */}
                          <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs whitespace-nowrap">
                            {fmtMinutesToMinSec(app.totalMinutes || 0)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-gray-500 text-center py-4">No app usage data</p>}
                </div>

                {appPieData.length > 0 && (
                  <div className="bg-gray-50 p-6 rounded-lg">
                    <h3 className="text-lg font-semibold mb-4">App Usage Distribution</h3>
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie
                          data={appPieData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          outerRadius={90}
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        >
                          {appPieData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                        </Pie>
                        {/* v is in minutes; show as "X min Y sec" */}
                        <Tooltip formatter={(v) => fmtMinutesToMinSec(v)} />
                        <Tooltip formatter={(v) => `${Number(v).toFixed(1)} min`} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ==================== MOUSE ACTIVITY ==================== */}
          {viewMode === "mouse" && (
            <div className="space-y-6">
              {/* Mouse Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard icon="🖱️" label="Mouse Records" value={mouseData.length} bg="bg-blue-100" />
                <StatCard icon="📈" label="Avg Active %" value={`${avgMouseActive.toFixed(1)}%`} bg="bg-green-100" />
                <StatCard icon="📉" label="Avg Idle %" value={`${avgMouseIdle.toFixed(1)}%`} bg="bg-red-100" />
                <div className="bg-white p-4 rounded-lg border shadow-sm">
                  <div className="flex items-center">
                    <div className={`p-3 rounded-lg mr-3 ${statusColor(latestMouseStatus)}`}><span className="text-xl">🎯</span></div>
                    <div>
                      <p className="text-xs text-gray-500">Current Status</p>
                      <p className={`text-lg font-bold ${latestMouseStatus.toLowerCase() === "active" ? "text-green-700" : latestMouseStatus.toLowerCase() === "idle" ? "text-yellow-700" : "text-gray-600"}`}>
                        {latestMouseStatus}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Active Session Mouse Summary */}
              {activeSession && sessionMouseData.length > 0 && (
                <div className="bg-gradient-to-r from-green-50 to-emerald-50 p-6 rounded-lg border border-green-200">
                  <h3 className="text-lg font-semibold mb-4 text-green-800">
                    Active Session Mouse Activity
                    <span className="text-sm font-normal text-green-600 ml-2">({sessionMouseData.length} records)</span>
                  </h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-white p-4 rounded-lg text-center">
                      <p className="text-2xl font-bold text-green-600">{avgSessionMouseActive.toFixed(1)}%</p>
                      <p className="text-xs text-gray-500">Active %</p>
                    </div>
                    <div className="bg-white p-4 rounded-lg text-center">
                      <p className="text-2xl font-bold text-red-500">{avgSessionMouseIdle.toFixed(1)}%</p>
                      <p className="text-xs text-gray-500">Idle %</p>
                    </div>
                    <div className="bg-white p-4 rounded-lg text-center">
                      <p className={`text-2xl font-bold ${latestMouseStatus.toLowerCase() === "active" ? "text-green-600" : "text-yellow-600"}`}>{latestMouseStatus}</p>
                      <p className="text-xs text-gray-500">Latest Status</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Mouse Activity Chart: Active vs Idle % Over Time */}
              {mouseChartData.length > 0 && (
                <div className="bg-gray-50 p-6 rounded-lg">
                  <h3 className="text-lg font-semibold mb-4">Mouse Active vs Idle % Over Time</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={mouseChartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="time" />
                      <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                      <Tooltip formatter={(v) => `${Number(v).toFixed(1)}%`} />
                      <Legend />
                      <Area type="monotone" dataKey="active" name="Active %" stroke="#10b981" fill="#10b98140" strokeWidth={2} />
                      <Area type="monotone" dataKey="idle" name="Idle %" stroke="#ef4444" fill="#ef444440" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Mouse Activity Pie */}
              {mouseData.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-gray-50 p-6 rounded-lg">
                    <h3 className="text-lg font-semibold mb-4">Active vs Idle Distribution</h3>
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie data={[
                          { name: "Active", value: Math.round(avgMouseActive * 100) / 100 },
                          { name: "Idle", value: Math.round(avgMouseIdle * 100) / 100 }
                        ]} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90}
                          label={({ name, value }) => `${name}: ${value.toFixed(1)}%`}>
                          <Cell fill="#10b981" />
                          <Cell fill="#ef4444" />
                        </Pie>
                        <Tooltip formatter={(v) => `${Number(v).toFixed(1)}%`} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Status Breakdown */}
                  <div className="bg-gray-50 p-6 rounded-lg">
                    <h3 className="text-lg font-semibold mb-4">Status Breakdown</h3>
                    {(() => {
                      const statusMap = {};
                      mouseData.forEach(r => {
                        const s = r.activity_status || "Unknown";
                        statusMap[s] = (statusMap[s] || 0) + 1;
                      });
                      return (
                        <div className="space-y-3">
                          {Object.entries(statusMap).map(([status, count]) => (
                            <div key={status} className="flex items-center justify-between p-3 bg-white rounded border">
                              <div className="flex items-center gap-2">
                                <span className={`px-2 py-1 rounded text-xs font-medium ${statusColor(status)}`}>{status}</span>
                              </div>
                              <div className="text-right">
                                <span className="text-sm font-bold text-gray-700">{count}</span>
                                <span className="text-xs text-gray-400 ml-1">({((count / mouseData.length) * 100).toFixed(0)}%)</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Mouse Activity Timeline Table */}
              <div className="bg-gray-50 p-6 rounded-lg">
                <h3 className="text-lg font-semibold mb-4">Mouse Activity Timeline ({mouseData.length})</h3>
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-100 sticky top-0">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Timestamp</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Active %</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Idle %</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Session</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Developer</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {mouseData.slice(0, 50).map((r, i) => (
                        <tr key={r.id || i} className={`hover:bg-gray-50 ${i === 0 ? "bg-green-50" : ""}`}>
                          <td className="px-4 py-3 text-sm text-gray-600">{fmtDateTime(r.timestamp || r.created_at)}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-1 rounded text-xs font-medium ${statusColor(r.activity_status)}`}>
                              {r.activity_status || "—"}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-16 bg-gray-200 rounded-full h-2">
                                <div className="bg-green-500 h-2 rounded-full" style={{ width: `${Math.min(r.active_percentage || 0, 100)}%` }}></div>
                              </div>
                              <span className="text-sm font-medium text-green-700">{(r.active_percentage || 0).toFixed(1)}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-16 bg-gray-200 rounded-full h-2">
                                <div className="bg-red-400 h-2 rounded-full" style={{ width: `${Math.min(r.idle_percentage || 0, 100)}%` }}></div>
                              </div>
                              <span className="text-sm font-medium text-red-600">{(r.idle_percentage || 0).toFixed(1)}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-400 font-mono">{r.session_id ? String(r.session_id).slice(-8) : "—"}</td>
                          <td className="px-4 py-3 text-xs text-gray-500">{r.developer_name || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {mouseData.length > 50 && <p className="text-center text-sm text-gray-500 mt-3">Showing 50 of {mouseData.length} records</p>}
              </div>
            </div>
          )}

          {/* ==================== KEYBOARD ACTIVITY ==================== */}
          {viewMode === "keyboard" && (
            <div className="space-y-6">
              {/* No Data Fallback */}
              {keyboardData.length === 0 && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
                  <div className="text-4xl mb-4">⌨️</div>
                  <h3 className="text-lg font-semibold text-gray-700 mb-2">No Keyboard Activity Recorded</h3>
                  <p className="text-gray-500">No keyboard activity data found for this session or date range.</p>
                  <p className="text-sm text-gray-400 mt-2">Keyboard stats will appear here once the desktop tracker records typing activity.</p>
                </div>
              )}

              {/* Keyboard Activity Summary Card */}
              {keyboardData.length > 0 && (
              <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard icon="⌨️" label="Total Keystrokes" value={totalKeystrokes.toLocaleString()} bg="bg-purple-100" />
                <StatCard icon="📝" label="Avg WPM" value={avgWPM.toFixed(1)} bg="bg-green-100" />
                <StatCard icon="🎯" label="Activity Score" value={avgKeyboardScore.toFixed(1)} bg="bg-yellow-100" />
                <div className="bg-white p-4 rounded-lg border shadow-sm">
                  <div className="flex items-center">
                    <div className="bg-indigo-100 p-3 rounded-lg mr-3"><span className="text-xl">📊</span></div>
                    <div>
                      <p className="text-xs text-gray-500">Keyboard Activity %</p>
                      <p className="text-lg font-bold text-indigo-700">{avgKeyboardActivity.toFixed(1)}%</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Keyboard Performance Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard icon="⏱️" label="Active Time" value={`${totalKbActiveTime.toFixed(1)} min`} bg="bg-green-100" />
                <StatCard icon="⏸️" label="Idle Time" value={`${totalKbIdleTime.toFixed(1)} min`} bg="bg-red-100" />
                <StatCard icon="🔤" label="Unique Keys" value={totalUniqueKeys.toLocaleString()} bg="bg-blue-100" />
                <StatCard icon="⏲️" label="Total Time" value={`${totalKbTime.toFixed(1)} min`} bg="bg-gray-100" />
              </div>

              {/* Active Session Keyboard Summary */}
              {activeSession && sessionKeyboardData.length > 0 && (
                <div className="bg-gradient-to-r from-purple-50 to-indigo-50 p-6 rounded-lg border border-purple-200">
                  <h3 className="text-lg font-semibold mb-4 text-purple-800">
                    Active Session Keyboard Activity
                    <span className="text-sm font-normal text-purple-600 ml-2">({sessionKeyboardData.length} records)</span>
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-white p-4 rounded-lg text-center">
                      <p className="text-2xl font-bold text-purple-600">{sessionTotalKeys.toLocaleString()}</p>
                      <p className="text-xs text-gray-500">Keystrokes</p>
                    </div>
                    <div className="bg-white p-4 rounded-lg text-center">
                      <p className="text-2xl font-bold text-green-600">{sessionAvgWPM.toFixed(1)}</p>
                      <p className="text-xs text-gray-500">WPM</p>
                    </div>
                    <div className="bg-white p-4 rounded-lg text-center">
                      <p className="text-2xl font-bold text-indigo-600">{sessionAvgKbActivity.toFixed(1)}%</p>
                      <p className="text-xs text-gray-500">Activity %</p>
                    </div>
                    <div className="bg-white p-4 rounded-lg text-center">
                      <p className={`text-2xl font-bold ${sessionAvgScore >= 80 ? "text-green-600" : sessionAvgScore >= 60 ? "text-yellow-600" : "text-red-600"}`}>{sessionAvgScore.toFixed(1)}</p>
                      <p className="text-xs text-gray-500">Score</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Keyboard Activity Chart: WPM & Activity % Over Time */}
              {keyboardChartData.length > 0 && (
                <div className="bg-gray-50 p-6 rounded-lg">
                  <h3 className="text-lg font-semibold mb-4">WPM & Activity % Over Time</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={keyboardChartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="time" />
                      <YAxis yAxisId="left" />
                      <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                      <Tooltip />
                      <Legend />
                      <Line yAxisId="left" type="monotone" dataKey="wpm" name="WPM" stroke="#009578" strokeWidth={2} dot={false} />
                      <Line yAxisId="right" type="monotone" dataKey="activityPct" name="Activity %" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                      <Line yAxisId="left" type="monotone" dataKey="score" name="Score" stroke="#f59e0b" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Keys Pressed Per Minute (from per_minute_summary) */}
              {perMinuteData.length > 0 && (
                <div className="bg-gray-50 p-6 rounded-lg">
                  <h3 className="text-lg font-semibold mb-4">Keys Pressed Per Minute</h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={perMinuteData.slice(-30)}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="time" tick={{ fontSize: 11 }} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="keys" name="Keys" fill="#8b5cf6" radius={[4,4,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Active vs Idle Time Distribution */}
              {keyboardData.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-gray-50 p-6 rounded-lg">
                    <h3 className="text-lg font-semibold mb-4">Active vs Idle Time</h3>
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie data={[
                          { name: "Active", value: Math.round(totalKbActiveTime * 100) / 100 },
                          { name: "Idle", value: Math.round(totalKbIdleTime * 100) / 100 }
                        ]} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90}
                          label={({ name, value }) => `${name}: ${value.toFixed(1)} min`}>
                          <Cell fill="#10b981" />
                          <Cell fill="#ef4444" />
                        </Pie>
                        <Tooltip formatter={(v) => `${Number(v).toFixed(1)} min`} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Keystrokes Trend (AreaChart) */}
                  <div className="bg-gray-50 p-6 rounded-lg">
                    <h3 className="text-lg font-semibold mb-4">Keystroke Trend</h3>
                    <ResponsiveContainer width="100%" height={250}>
                      <AreaChart data={keyboardChartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="time" />
                        <YAxis />
                        <Tooltip />
                        <Area type="monotone" dataKey="totalKeys" name="Keys" stroke="#8b5cf6" fill="#8b5cf640" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Keyboard Activity Timeline Table */}
              <div className="bg-gray-50 p-6 rounded-lg">
                <h3 className="text-lg font-semibold mb-4">Keyboard Activity Timeline ({keyboardData.length})</h3>
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-100 sticky top-0">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tracked At</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Keystrokes</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Unique Keys</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">WPM</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Activity %</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Score</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Active</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Idle</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Session</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {keyboardData.slice(0, 50).map((r, i) => (
                        <tr key={r.id || i} className={`hover:bg-gray-50 ${i === 0 ? "bg-purple-50" : ""}`}>
                          <td className="px-4 py-3 text-sm text-gray-600">{fmtDateTime(r.tracked_at)}</td>
                          <td className="px-4 py-3 text-sm font-medium">{(r.total_keys || 0).toLocaleString()}</td>
                          <td className="px-4 py-3 text-sm">{r.unique_keys || 0}</td>
                          <td className="px-4 py-3 text-sm font-medium text-green-700">{(r.words_per_minute || 0).toFixed(1)}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-16 bg-gray-200 rounded-full h-2">
                                <div className="bg-indigo-500 h-2 rounded-full" style={{ width: `${Math.min(r.keyboard_activity_percentage || 0, 100)}%` }}></div>
                              </div>
                              <span className="text-sm font-medium text-indigo-700">{(r.keyboard_activity_percentage || 0).toFixed(1)}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-1 rounded text-xs font-medium ${prodBg(r.activity_score || 0)} ${prodColor(r.activity_score || 0)}`}>
                              {(r.activity_score || 0).toFixed(0)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-green-600">{(r.active_time_minutes || 0).toFixed(1)}m</td>
                          <td className="px-4 py-3 text-sm text-red-500">{(r.idle_time_minutes || 0).toFixed(1)}m</td>
                          <td className="px-4 py-3 text-xs text-gray-400 font-mono">{r.session_id ? String(r.session_id).slice(-8) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {keyboardData.length > 50 && <p className="text-center text-sm text-gray-500 mt-3">Showing 50 of {keyboardData.length} records</p>}
              </div>
              </>
              )}
            </div>
          )}

          {/* ==================== APP USAGE ==================== */}
          {viewMode === "apps" && (
            <div className="space-y-6">
              {/* App Usage Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard icon="💻" label="Apps Used" value={totalAppsUsed} bg="bg-blue-100" />
                <StatCard icon="📊" label="Usage Records" value={appUsageData.length} bg="bg-green-100" />
                <StatCard icon="⏱️" label="Total Active Time" value={`${totalAppActiveMinutes.toFixed(1)} min`} bg="bg-purple-100" />
                {currentApp && (
                  <div className="bg-white p-4 rounded-lg border shadow-sm">
                    <div className="flex items-center">
                      <div className="bg-orange-100 p-3 rounded-lg mr-3"><span className="text-xl">🟢</span></div>
                      <div>
                        <p className="text-xs text-gray-500">Currently Active</p>
                        <p className="text-sm font-bold text-gray-800 truncate max-w-[140px]">{currentApp.app_name}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Live Application Tracker */}
              {currentApp && (
                <div className="bg-gradient-to-r from-orange-50 to-amber-50 p-6 rounded-lg border border-orange-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-orange-500"></span>
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-orange-800">Currently Active Application</p>
                        <p className="text-lg font-bold text-gray-800">{currentApp.app_name}</p>
                        {currentApp.window_title && <p className="text-xs text-gray-500 truncate max-w-md">{currentApp.window_title}</p>}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-orange-600">{(currentApp.duration_minutes || 0).toFixed(1)} min</p>
                      <p className="text-xs text-gray-500">Since: {fmtDateTime(currentApp.start_time || currentApp.tracked_at)}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Active Session App Summary */}
              {activeSession && sessionAppData.length > 0 && (
                <div className="bg-gradient-to-r from-blue-50 to-cyan-50 p-6 rounded-lg border border-blue-200">
                  <h3 className="text-lg font-semibold mb-4 text-blue-800">
                    Active Session Applications
                    <span className="text-sm font-normal text-blue-600 ml-2">({sessionAppData.length} records)</span>
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-white p-4 rounded-lg text-center">
                      <p className="text-2xl font-bold text-blue-600">{new Set(sessionAppData.map(r => r.app_name)).size}</p>
                      <p className="text-xs text-gray-500">Unique Apps</p>
                    </div>
                    <div className="bg-white p-4 rounded-lg text-center">
                      <p className="text-2xl font-bold text-green-600">{sessionAppData.reduce((s, r) => s + (r.duration_minutes || 0), 0).toFixed(1)}</p>
                      <p className="text-xs text-gray-500">Total Minutes</p>
                    </div>
                    <div className="bg-white p-4 rounded-lg text-center">
                      <p className="text-2xl font-bold text-purple-600">{sessionAppData.length}</p>
                      <p className="text-xs text-gray-500">App Switches</p>
                    </div>
                    <div className="bg-white p-4 rounded-lg text-center">
                      <p className="text-2xl font-bold text-orange-600">{sessionAppData.filter(r => r.is_new_app).length}</p>
                      <p className="text-xs text-gray-500">New Apps</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Top Applications */}
              {topApps.length > 0 && (
                <div className="bg-gray-50 p-6 rounded-lg">
                  <h3 className="text-lg font-semibold mb-4">Top Applications</h3>
                  <div className="space-y-3">
                    {topApps.map((app, i) => (
                      <div key={i} className="flex items-center justify-between p-3 bg-white rounded-lg border hover:shadow-sm transition-shadow">
                        <div className="flex items-center gap-3 flex-1">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] + "20" }}>
                            <span className="text-sm font-bold" style={{ color: CHART_COLORS[i % CHART_COLORS.length] }}>#{i + 1}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{app.app}</p>
                            <p className="text-xs text-gray-400">{app.count} usage{app.count !== 1 ? "s" : ""}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          {/* Progress bar showing % of session time */}
                          <div className="w-24 bg-gray-200 rounded-full h-2 hidden md:block">
                            <div className="h-2 rounded-full" style={{ width: `${Math.min(app.pct, 100)}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}></div>
                          </div>
                          <span className="text-xs text-gray-500 w-12 text-right">{app.pct.toFixed(0)}%</span>
                          <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap">{app.totalMinutes.toFixed(1)} min</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Charts: Pie + Bar side by side */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {appPieData.length > 0 && (
                  <div className="bg-gray-50 p-6 rounded-lg">
                    <h3 className="text-lg font-semibold mb-4">Time Distribution</h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie data={appPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                          {appPieData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v) => `${Number(v).toFixed(1)} min`} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {appBarData.length > 0 && (
                  <div className="bg-gray-50 p-6 rounded-lg">
                    <h3 className="text-lg font-semibold mb-4">Top Apps Usage (minutes)</h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={appBarData} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" />
                        <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 12 }} />
                        <Tooltip formatter={(v) => `${Number(v).toFixed(1)} min`} />
                        <Bar dataKey="minutes" name="Minutes" fill="#009578" radius={[0,4,4,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* Application Activity Timeline Table */}
              <div className="bg-gray-50 p-6 rounded-lg">
                <h3 className="text-lg font-semibold mb-4">Application Activity Timeline ({appUsageData.length})</h3>
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-100 sticky top-0">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Application</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Window Title</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Start Time</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">End Time</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Duration</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">New?</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Session</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {appUsageData.slice(0, 50).map((r, i) => (
                        <tr key={r.id || i} className={`hover:bg-gray-50 ${i === 0 ? "bg-orange-50" : ""}`}>
                          <td className="px-4 py-3">
                            <div className="flex items-center">
                              <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center mr-3">
                                <span className="text-blue-600 text-sm">{i === 0 ? "🟢" : "📱"}</span>
                              </div>
                              <div>
                                <p className="text-sm font-medium text-gray-900 truncate max-w-[180px]">{r.app_name}</p>
                                {r.app_name_raw && r.app_name_raw !== r.app_name && (
                                  <p className="text-xs text-gray-400 truncate max-w-[180px]">{r.app_name_raw}</p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600 truncate max-w-[200px]">{r.window_title || "—"}</td>
                          <td className="px-4 py-3 text-sm text-gray-500">{fmtDateTime(r.start_time)}</td>
                          <td className="px-4 py-3 text-sm text-gray-500">{fmtDateTime(r.end_time)}</td>
                          <td className="px-4 py-3">
                            <div>
                              <span className="text-sm font-medium text-gray-800">{(r.duration_minutes || 0).toFixed(1)} min</span>
                              <span className="text-xs text-gray-400 ml-1">({(r.duration_seconds || 0).toFixed(0)}s)</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {r.is_new_app && <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded font-medium">NEW</span>}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-400 font-mono">{r.session_id ? String(r.session_id).slice(-8) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {appUsageData.length > 50 && <p className="text-center text-sm text-gray-500 mt-3">Showing 50 of {appUsageData.length} records</p>}
              </div>

              {/* Recent App Switches */}
              {appUsageData.length > 1 && (
                <div className="bg-gray-50 p-6 rounded-lg">
                  <h3 className="text-lg font-semibold mb-4">Recent Application Switches</h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {appUsageData.slice(0, 20).map((r, i) => {
                      const next = appUsageData[i + 1];
                      return (
                        <div key={r.id || i} className="flex items-center gap-2 p-2 bg-white rounded border">
                          <span className="text-xs text-gray-400 w-20">{fmtTime(r.tracked_at || r.start_time)}</span>
                          {next && (
                            <>
                              <span className="text-sm text-gray-500 truncate max-w-[120px]">{next.app_name}</span>
                              <span className="text-gray-400">→</span>
                            </>
                          )}
                          <span className="text-sm font-medium text-gray-800 truncate max-w-[120px]">{r.app_name}</span>
                          <span className="text-xs text-gray-400 ml-auto">{(r.duration_minutes || 0).toFixed(1)} min</span>
                          {r.is_new_app && <span className="px-1.5 py-0.5 text-xs bg-yellow-100 text-yellow-800 rounded">NEW</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ==================== SCREENSHOTS ==================== */}
          {viewMode === "screenshots" && (
            <div className="space-y-6">
              {/* Screenshot Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard icon="📸" label="Total Screenshots" value={screenshots.length} bg="bg-pink-100" />
                {screenshots.length > 0 && (
                  <div className="bg-white p-4 rounded-lg border shadow-sm">
                    <div className="flex items-center">
                      <div className="bg-green-100 p-3 rounded-lg mr-3"><span className="text-xl">🟢</span></div>
                      <div>
                        <p className="text-xs text-gray-500">Latest Capture</p>
                        <p className="text-sm font-bold text-gray-800">{fmtTime((screenshots[0].timestamp || screenshots[0].created_at) || "")}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Debug Info (shown when 0 screenshots) */}
              {screenshots.length === 0 && developer && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-yellow-800 mb-2">Debug: No screenshots found</h4>
                  <div className="text-xs text-yellow-700 space-y-1">
                    <p><strong>Developer ID:</strong> {developer.id}</p>
                    <p><strong>Developer Email:</strong> {developer.email}</p>
                    <p><strong>Date Filter:</strong> {selectedDate} ({timeRange})</p>
                    <p>Check browser console for <code>[Screenshots]</code> logs showing query results and errors.</p>
                    <p className="mt-2 text-yellow-600">Common causes: RLS policy blocking reads, developer_id/email mismatch, or date filter excluding data.</p>
                    <button
                      onClick={async () => {
                        const { data, error } = await supabase
                          .from("screenshots")
                          .select("id, developer_id, developer_email, public_url, image_url, thumbnail_url, timestamp, created_at")
                          .limit(5);
                        showPre(
                          "Screenshot diagnostics",
                          error
                            ? `RLS Error: ${error.message}`
                            : `Found ${data?.length || 0} total screenshots.\n${
                                data?.length
                                  ? `Sample: developer_email=${data[0].developer_email}, developer_id=${data[0].developer_id}, has_url=${Boolean(data[0].public_url || data[0].image_url || data[0].thumbnail_url)}`
                                  : "Table is empty."
                              }`,
                          error ? "error" : "info"
                        );
                      }}
                      className="mt-2 px-3 py-1 bg-yellow-200 hover:bg-yellow-300 text-yellow-900 rounded text-xs font-medium transition-colors"
                    >
                      Run Diagnostic Query
                    </button>
                  </div>
                </div>
              )}

              {/* Screenshot Gallery */}
              <div className="bg-gray-50 p-6 rounded-lg">
                <h3 className="text-lg font-semibold mb-4">Screenshot Gallery ({screenshots.length})</h3>
                {screenshots.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {screenshots.map((ss, i) => (
                      <div key={ss.id || i} className={`bg-white rounded-lg border overflow-hidden hover:shadow-lg transition-shadow cursor-pointer ${i === 0 ? "ring-2 ring-pink-300" : ""}`}
                        onClick={() => setSelectedScreenshot(ss)}>
                        {ss.public_url ? (
                          <img src={ss.public_url} alt={ss.filename || `Screenshot ${i + 1}`} className="w-full h-40 object-cover" loading="lazy" />
                        ) : (
                          <div className="w-full h-40 bg-gray-200 flex items-center justify-center"><span className="text-gray-400 text-sm">No preview</span></div>
                        )}
                        <div className="p-3 space-y-1">
                          {ss.app_active && (
                            <div className="flex items-center gap-1">
                              <span className="text-xs">📱</span>
                              <p className="text-xs font-medium text-blue-700 truncate">{ss.app_active}</p>
                            </div>
                          )}
                          <p className="text-xs text-gray-600">{fmtDateTime(ss.timestamp || ss.created_at)}</p>
                          <div className="flex items-center justify-between">
                            {ss.size_kb && <span className="text-xs text-gray-400">{Number(ss.size_kb).toFixed(0)} KB</span>}
                            {ss.width && ss.height && <span className="text-xs text-gray-400">{ss.width}×{ss.height}</span>}
                          </div>
                          {i === 0 && <span className="inline-block px-2 py-0.5 text-xs bg-pink-100 text-pink-700 rounded font-medium">Latest</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-8">
                    {(() => {
                      const todayStr = new Date().toLocaleDateString("en-CA");
                      if (timeRange === "today" && selectedDate === todayStr) return "No screenshots available for today";
                      return "No screenshots found for selected period";
                    })()}
                  </p>
                )}
              </div>

              {/* Screenshot Timeline */}
              {screenshots.length > 0 && (
                <div className="bg-gray-50 p-6 rounded-lg">
                  <h3 className="text-lg font-semibold mb-4">Screenshot Timeline</h3>
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {screenshots.map((ss, i) => (
                      <div key={ss.id || i} className={`flex items-center gap-4 p-3 bg-white rounded-lg border hover:shadow-sm transition-shadow cursor-pointer ${i === 0 ? "border-pink-300 bg-pink-50" : ""}`}
                        onClick={() => setSelectedScreenshot(ss)}>
                        <div className="flex-shrink-0 w-16 text-center">
                          <p className="text-sm font-bold text-gray-700">{fmtTime(ss.timestamp || ss.created_at)}</p>
                          {i === 0 && <span className="text-xs text-pink-600">Latest</span>}
                        </div>
                        <div className="w-px h-12 bg-gray-300"></div>
                        <div className="flex-shrink-0">
                          {ss.public_url ? (
                            <img src={ss.public_url} alt={ss.filename || ""} className="w-16 h-12 object-cover rounded border" loading="lazy" />
                          ) : (
                            <div className="w-16 h-12 bg-gray-200 rounded flex items-center justify-center"><span className="text-gray-400 text-xs">N/A</span></div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          {ss.app_active && <p className="text-sm font-medium text-gray-800 truncate">{ss.app_active}</p>}
                          <p className="text-xs text-gray-500 truncate">{ss.filename || "screenshot"}</p>
                        </div>
                        <div className="flex-shrink-0 text-right">
                          {ss.size_kb && <p className="text-xs text-gray-500">{Number(ss.size_kb).toFixed(0)} KB</p>}
                          {ss.width && ss.height && <p className="text-xs text-gray-400">{ss.width}×{ss.height}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* App Distribution for Screenshots */}
              {screenshots.length > 0 && (() => {
                const appCounts = {};
                screenshots.forEach(ss => {
                  const app = ss.app_active || "Unknown";
                  appCounts[app] = (appCounts[app] || 0) + 1;
                });
                const appScreenshotData = Object.entries(appCounts)
                  .map(([name, count]) => ({ name: name.length > 18 ? name.slice(0, 18) + "…" : name, value: count }))
                  .sort((a, b) => b.value - a.value)
                  .slice(0, 8);
                return (
                  <div className="bg-gray-50 p-6 rounded-lg">
                    <h3 className="text-lg font-semibold mb-4">Screenshots by Application</h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={appScreenshotData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                        <YAxis allowDecimals={false} />
                        <Tooltip />
                        <Bar dataKey="value" name="Screenshots" fill="#ec4899" radius={[4,4,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                );
              })()}

              {/* Screenshot Details Modal */}
              {selectedScreenshot && (() => {
                const ss = selectedScreenshot;
                return (
                  <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4" onClick={() => setSelectedScreenshot(null)}>
                    <div className="relative bg-white rounded-xl max-w-5xl max-h-[90vh] overflow-hidden flex flex-col md:flex-row" onClick={(e) => e.stopPropagation()}>
                      {/* Image Side */}
                      <div className="flex-1 bg-black flex items-center justify-center min-h-[300px]">
                        {ss.public_url ? (
                          <img src={ss.public_url} alt={ss.filename || "Screenshot"} className="max-w-full max-h-[80vh] object-contain" />
                        ) : (
                          <div className="text-gray-400 text-center p-8">No image available</div>
                        )}
                      </div>
                      {/* Metadata Side */}
                      <div className="w-full md:w-72 p-6 bg-white overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                          <h4 className="text-lg font-bold text-gray-800">Details</h4>
                          <button onClick={() => setSelectedScreenshot(null)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
                        </div>
                        <div className="space-y-4">
                          <div>
                            <p className="text-xs text-gray-500 uppercase tracking-wide">Filename</p>
                            <p className="text-sm font-medium text-gray-800 break-all">{ss.filename || "—"}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 uppercase tracking-wide">Timestamp</p>
                            <p className="text-sm font-medium text-gray-800">{fmtDateTime(ss.timestamp || ss.created_at)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 uppercase tracking-wide">Resolution</p>
                            <p className="text-sm font-medium text-gray-800">{ss.width && ss.height ? `${ss.width} × ${ss.height}` : "—"}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 uppercase tracking-wide">File Size</p>
                            <p className="text-sm font-medium text-gray-800">{ss.size_kb ? `${Number(ss.size_kb).toFixed(1)} KB` : "—"}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 uppercase tracking-wide">MIME Type</p>
                            <p className="text-sm font-medium text-gray-800">{ss.mime_type || "—"}</p>
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 uppercase tracking-wide">Developer</p>
                            <p className="text-sm font-medium text-gray-800">{ss.developer_email || "—"}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* ==================== SESSION TIMELINE ==================== */}
          {viewMode === "timeline" && (
            <div className="bg-white p-6 rounded-lg border shadow-sm">
              <h3 className="text-lg font-semibold mb-4">Session Timeline ({sessions.length})</h3>
              <div className="space-y-4 max-h-[600px] overflow-y-auto">
                {sessions.length > 0 ? (
                  sessions.map((session, index) => (
                    <div key={index} className={`border-l-4 pl-4 py-4 bg-white rounded hover:shadow-md transition-shadow ${session.status === "active" ? "border-green-500" : "border-blue-500"}`}>
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="font-semibold text-gray-800">
                            Session {session.session_id ? String(session.session_id).slice(-8) : `#${index + 1}`}
                          </h4>
                          <p className="text-sm text-gray-600">
                            {fmtDateTime(session.start_time)}
                            {session.end_time && ` → ${fmtDateTime(session.end_time)}`}
                          </p>
                          <div className="flex flex-wrap gap-2 mt-2">
                            <span className={`px-3 py-1 rounded-full text-xs font-medium ${prodBg(session.productivity_score)} ${prodColor(session.productivity_score)}`}>
                              Score: {(session.productivity_score || 0).toFixed(1)}%
                            </span>
                            <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs">
                              Active: {fmtDuration(session.active_duration)}
                            </span>
                            <span className="px-3 py-1 bg-red-100 text-red-800 rounded-full text-xs">
                              Idle: {fmtDuration(session.idle_duration)}
                            </span>
                            {(session.mouse_events > 0 || session.mouse_clicks > 0) && (
                              <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs">
                                🖱️ {session.mouse_events || session.mouse_clicks || 0}
                              </span>
                            )}
                            {(session.keyboard_events > 0 || session.keystrokes > 0) && (
                              <span className="px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-xs">
                                ⌨️ {session.keyboard_events || session.keystrokes || 0}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded ${session.status === "active" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`}>
                          {session.status === "active" && (
                            <span className="inline-block w-2 h-2 bg-green-500 rounded-full mr-1 animate-pulse"></span>
                          )}
                          {session.status || "completed"}
                        </span>
                      </div>
                      {session.apps_used && (
                        <div className="mt-3 pt-3 border-t">
                          <p className="text-sm font-medium text-gray-700 mb-1">Apps:</p>
                          <div className="flex flex-wrap gap-1">
                            {(() => {
                              try {
                                const parsed = typeof session.apps_used === "string" ? JSON.parse(session.apps_used) : session.apps_used;
                                const apps = parsed.top_apps || (Array.isArray(parsed) ? parsed : []);
                                return apps.slice(0, 5).map((app, i) => (
                                  <span key={i} className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">{app}</span>
                                ));
                              } catch {
                                return <span className="text-xs text-gray-500">App data available</span>;
                              }
                            })()}
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-gray-500 text-center py-4">No sessions found for selected period</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* No Data State */}
      {!loading && selectedDeveloper && !hasData && (
        <div className="text-center py-12">
          <svg className="w-16 h-16 mx-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 17h6l2 2V7a2 2 0 00-2-2H9a2 2 0 00-2 2v12l2-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v8" />
          </svg>
          <p className="text-gray-500 text-lg mt-4">No activity data found for selected period</p>
          <p className="text-gray-400 text-sm mt-2">Make sure the developer has tracking sessions on {selectedDate}</p>
        </div>
      )}

      {/* No Developer Selected */}
      {!selectedDeveloper && !loading && (
        <div className="text-center py-12">
          <svg className="w-16 h-16 mx-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
          </svg>
          {currentAdmin ? (
            <div>
              <p className="text-gray-500 text-lg">Select a developer to view activity data</p>
              {/* {developers.length === 0 && (
                <div className="mt-4">
                  <p className="text-gray-400 text-sm">No developers added by you yet</p>
                  <button onClick={() => window.location.href = "/admin/dashboard?section=add-developer"} className="mt-2 text-blue-500 hover:text-blue-700 underline text-sm">Add Developers First</button>
                </div>
              )} */}
            </div>
          ) : (
            <div>
              <p className="text-gray-500 text-lg">Please login to access developer activity</p>
              <p className="text-gray-400 text-sm mt-2">Only admins can view developer activity data</p>
              <button onClick={() => window.location.href = "/login"} className="mt-4 bg-[#009578] text-white py-2 px-4 rounded-md hover:bg-[#0e7762] transition-colors">Go to Login</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Stat Card Component ───
function StatCard({ icon, label, value, bg }) {
  return (
    <div className="bg-white p-4 rounded-lg border shadow-sm">
      <div className="flex items-center">
        <div className={`${bg} p-3 rounded-lg mr-3`}><span className="text-xl">{icon}</span></div>
        <div>
          <p className="text-xs text-gray-500">{label}</p>
          <p className="text-lg font-bold text-gray-800">{value}</p>
        </div>
      </div>
    </div>
  );
}