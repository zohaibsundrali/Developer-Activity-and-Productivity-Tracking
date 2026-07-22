"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/utils/supabaseClient";
import { getOrgId } from "@/utils/orgContext";
import { authFetch } from "@/utils/authFetch";
import { showPre } from "@/utils/alerts";
import EChart from "@/components/charts/EChart";
import {
  textStyle,
  baseGrid,
  baseTooltip,
  baseLegend,
  axisLabel,
  axisLine,
  splitLine,
  verticalGradient,
} from "@/components/charts/chartTheme";
import {
  BarChart3,
  Calendar,
  Camera,
  CheckCircle2,
  Clock,
  Clock1,
  Clock2,
  Eye,
  Gauge,
  Hourglass,
  Keyboard,
  LockKeyhole,
  Monitor,
  MousePointer2,
  Pause,
  CircleDot,
  RefreshCw,
  Target,
  Timer,
  TrendingDown,
  TrendingUp,
  Type,
  User,
  XCircle,
} from "lucide-react";

const CHART_COLORS = ["#0c8f6e", "#0ea5e9", "#7c3aed", "#f59e0b", "#ef4444", "#10b981", "#6366f1", "#ec4899"];
const POLL_INTERVAL = 10_000; // 10 seconds
const MOUSE_PAGE_SIZE = 50;

export default function DeveloperActivity() {
  const [currentAdmin, setCurrentAdmin] = useState(null);
  const [developers, setDevelopers] = useState([]);
  const [selectedDeveloper, setSelectedDeveloper] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [timeRange, setTimeRange] = useState("today");
  const [loading, setLoading] = useState(false);
  const [fetchingDevelopers, setFetchingDevelopers] = useState(false);
  const [viewMode, setViewMode] = useState("overview");

  // Avoid hydration mismatches by setting any time-based defaults after mount.
  useEffect(() => {
    if (!selectedDate) {
      setSelectedDate(new Date().toLocaleDateString("en-CA"));
    }
  }, [selectedDate]);

  // Parse DB timestamps safely.
  // Supabase can return `timestamp` (without timezone) which JS treats as local time.
  // To keep date filtering stable, treat timezone-less timestamps as UTC.
  const parseDbTimeMs = useCallback((value) => {
    if (!value) return Number.NaN;
    if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
    if (value instanceof Date) return value.getTime();

    const s = String(value).trim();
    if (!s) return Number.NaN;

    // Postgres timestamptz often arrives like: "YYYY-MM-DD HH:MM:SS.ffffff+00".
    // JS Date parsing of that format is inconsistent across runtimes, so normalize to ISO.
    // - Use 'T' separator
    // - Trim fractional seconds to milliseconds
    // - Normalize offset to "+HH:MM"
    const pgTzMatch = s.match(
      /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.(\d+))?([+-]\d{2})(?::?(\d{2}))?$/
    );
    if (pgTzMatch) {
      const datePart = pgTzMatch[1];
      const timePart = pgTzMatch[2];
      const fracDigits = pgTzMatch[4] || "";
      const msDigits = fracDigits ? fracDigits.slice(0, 3).padEnd(3, "0") : "";
      const fracPart = msDigits ? `.${msDigits}` : "";
      const offHour = pgTzMatch[5];
      const offMin = pgTzMatch[6] || "00";
      const offset = `${offHour}:${offMin}`;
      const isoLike = `${datePart}T${timePart}${fracPart}${offset}`;
      const t = new Date(isoLike).getTime();
      return Number.isNaN(t) ? Number.NaN : t;
    }

    // ISO with timezone (Z or ±HH:MM)
    if (/\dT\d.*(Z|[+-]\d{2}:\d{2})$/.test(s)) {
      const t = new Date(s).getTime();
      return Number.isNaN(t) ? Number.NaN : t;
    }

    // Postgres timestamp (no tz): "YYYY-MM-DD HH:MM:SS(.sss)" -> treat as UTC
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) {
      const isoLike = s.replace(" ", "T") + "Z";
      const t = new Date(isoLike).getTime();
      return Number.isNaN(t) ? Number.NaN : t;
    }

    // Date-only -> treat as UTC start-of-day
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const t = new Date(s + "T00:00:00.000Z").getTime();
      return Number.isNaN(t) ? Number.NaN : t;
    }

    const t = new Date(s).getTime();
    return Number.isNaN(t) ? Number.NaN : t;
  }, []);

  // Normalize developer login timestamps across possible column names.
  const loginRowTimeMs = useCallback((row) => {
    if (!row) return Number.NaN;
    const v =
      row.login_time ??
      row.login_at ??
      row.logged_in_at ??
      row.timestamp ??
      row.created_at ??
      row.createdAt ??
      null;
    return parseDbTimeMs(v);
  }, [parseDbTimeMs]);

  const loginRowStatus = useCallback((row) => {
    if (!row) return "Allowed";

    // Prefer explicit boolean columns when present.
    if (typeof row.is_blocked === "boolean") return row.is_blocked ? "Blocked" : "Allowed";
    if (typeof row.blocked === "boolean") return row.blocked ? "Blocked" : "Allowed";
    if (typeof row.is_allowed === "boolean") return row.is_allowed ? "Allowed" : "Blocked";
    if (typeof row.allowed === "boolean") return row.allowed ? "Allowed" : "Blocked";

    const raw = row.login_status ?? row.status ?? row.result ?? null;
    if (raw == null) return "Allowed";

    const s = String(raw).trim().toLowerCase();
    if (["blocked", "block", "deny", "denied", "not_allowed", "not allowed", "false", "0"].includes(s)) return "Blocked";
    if (["allowed", "allow", "permitted", "true", "1"].includes(s)) return "Allowed";
    return s.includes("block") || s.includes("deny") ? "Blocked" : "Allowed";
  }, []);

  // Data states for each table
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [mouseData, setMouseData] = useState([]);
  const [mousePage, setMousePage] = useState(1);
  const [mouseTotalCount, setMouseTotalCount] = useState(0);
  const [mousePageLoading, setMousePageLoading] = useState(false);
  const [keyboardData, setKeyboardData] = useState([]);
  const [appUsageData, setAppUsageData] = useState([]);
  const [screenshots, setScreenshots] = useState([]);
  const [selectedScreenshot, setSelectedScreenshot] = useState(null);
  const [todayTotalSeconds, setTodayTotalSeconds] = useState(0);
  const [loginRecords, setLoginRecords] = useState([]);

  // Real-time state
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const pollRef = useRef(null);
  const realtimeChannelRef = useRef(null);
  const loginChannelRef = useRef(null);

  // ─── Admin Auth ───
  useEffect(() => {
    const getCurrentAdmin = () => {
      try {
        const adminData = JSON.parse(sessionStorage.getItem("adminUser"));
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
      const orgId = getOrgId();
      let devs = [];
      const cols = ["added_by_admin", "added_by", "admin_id", "created_by"];
      for (const col of cols) {
        let q1 = supabase.from("developers").select("*").eq(col, currentAdmin.id);
        if (orgId) q1 = q1.eq("organization_id", orgId);
        const { data } = await q1;
        if (data?.length) { devs = data; break; }
        if (currentAdmin.email) {
          let q2 = supabase.from("developers").select("*").eq(col, currentAdmin.email);
          if (orgId) q2 = q2.eq("organization_id", orgId);
          const { data: d2 } = await q2;
          if (d2?.length) { devs = d2; break; }
        }
      }
      if (!devs.length && currentAdmin.id) {
        let q3 = supabase.from("developers").select("*")
          .or(`added_by_admin.eq.${currentAdmin.id},added_by.eq.${currentAdmin.id},admin_id.eq.${currentAdmin.id}`);
        if (orgId) q3 = q3.eq("organization_id", orgId);
        const { data } = await q3;
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

    // Use UTC boundaries so "YYYY-MM-DD" matches tracked_at::date in DB (typically UTC).
    // Treat the window as: [startInclusive, endExclusive)
    const selectedDayStartUtc = new Date(Date.UTC(yy, (mm || 1) - 1, dd || 1, 0, 0, 0, 0));
    const baseStartUtc = new Date(selectedDayStartUtc);
    const endExclusiveUtc = new Date(selectedDayStartUtc);
    endExclusiveUtc.setUTCDate(endExclusiveUtc.getUTCDate() + 1);

    if (timeRange === "week") {
      baseStartUtc.setUTCDate(baseStartUtc.getUTCDate() - 6);
    }
    if (timeRange === "month") {
      baseStartUtc.setUTCDate(baseStartUtc.getUTCDate() - 29);
    }

    const startISO = baseStartUtc.toISOString();
    const endISO = endExclusiveUtc.toISOString();

    return { start: startISO, end: endISO };
  }, [selectedDate, timeRange]);

  // ─── Fetch All Activity Data (with active session detection) ───
  const fetchDeveloperActivity = useCallback(async (silent = false) => {
    const dev
      = developers.find(d => d.id === selectedDeveloper);
    if (!dev) return;
    if (!silent) setLoading(true);

    const { start, end } = getDateFilter();
    const devId = dev.id;
    const devEmail = dev.email;

    try {
      // Fetch all 5 tables in parallel (keyboard via API route to bypass RLS)
      const sessionFilters = [
        devEmail ? `user_email.eq.${devEmail}` : null,
        dev.user_id ? `user_id.eq.${dev.user_id}` : null,
        // devId ? `developer_id.eq.${devId}` : null,
      ].filter(Boolean).join(",");

      const [sessionsRes, keyboardApiRes, appRes, screenshotRes, screenshotCreatedAtRes, todayTotalRes] = await Promise.all([
        // Match sessions for this developer by email, user_id, or developer_id
        supabase
          .from("productivity_sessions")
          .select("*")
          .or(sessionFilters)
          .gte("start_time", start)
          .lt("start_time", end)
          .order("start_time", { ascending: false }),
        authFetch(`/api/keyboard-stats?developerId=${encodeURIComponent(devId || "")}&userId=${encodeURIComponent(dev.user_id || "")}&email=${encodeURIComponent(devEmail || "")}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`).then(r => r.json()),
        supabase.from("app_usage").select("id, session_id, user_email, app_name, app_name_raw, window_title, start_time, end_time, duration_seconds, duration_minutes, tracked_at, created_at, is_new_app, user_login").eq("user_email", devEmail).gte("tracked_at", start).lt("tracked_at", end).order("tracked_at", { ascending: false }),
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
            .gte("start_time", start)
            .lt("start_time", end)
          : Promise.resolve({ data: [], error: null }),
      ]);

      // Fetch login records in a guarded way so login table issues never break productivity tracking.
      const matchesDeveloperLoginRow = (row) => {
        if (!row) return false;
        if (devId && (row.developer_id === devId || row.developerId === devId || row.user_id === devId || row.userId === devId)) return true;
        if (devEmail && (
          row.developer_email === devEmail ||
          row.user_email === devEmail ||
          row.email === devEmail ||
          row.userEmail === devEmail
        )) return true;
        return false;
      };

      const fetchLoginsSafe = async () => {
        const startIso = start;
        const endIso = end;
        const attempts = [
          // Preferred: keyed by developer_id + login_time
          () => supabase.from("developer_logins").select("*").eq("developer_id", devId).gte("login_time", startIso).lt("login_time", endIso).order("login_time", { ascending: true }),
          // Fallback: keyed by email + login_time
          () => supabase.from("developer_logins").select("*").eq("developer_email", devEmail).gte("login_time", startIso).lt("login_time", endIso).order("login_time", { ascending: true }),
          () => supabase.from("developer_logins").select("*").eq("user_email", devEmail).gte("login_time", startIso).lt("login_time", endIso).order("login_time", { ascending: true }),
          () => supabase.from("developer_logins").select("*").eq("email", devEmail).gte("login_time", startIso).lt("login_time", endIso).order("login_time", { ascending: true }),
          // Fallback: some schemas may only have created_at
          () => supabase.from("developer_logins").select("*").eq("developer_id", devId).gte("created_at", startIso).lt("created_at", endIso).order("created_at", { ascending: true }),
          () => supabase.from("developer_logins").select("*").eq("developer_email", devEmail).gte("created_at", startIso).lt("created_at", endIso).order("created_at", { ascending: true }),
          // Last resort: date-bounded fetch then client-side filter
          () => supabase.from("developer_logins").select("*").gte("login_time", startIso).lt("login_time", endIso).order("login_time", { ascending: true }).limit(500),
          () => supabase.from("developer_logins").select("*").gte("created_at", startIso).lt("created_at", endIso).order("created_at", { ascending: true }).limit(500),
        ];

        let lastError = null;
        for (const run of attempts) {
          try {
            const res = await run();
            if (!res?.error) return res;
            lastError = res.error;
          } catch (e) {
            lastError = e;
          }
        }
        return { data: [], error: lastError };
      };

      const loginRes = await fetchLoginsSafe();
      let finalLogins = Array.isArray(loginRes?.data) ? loginRes.data : [];
      // Ensure scoped to the selected developer and selected date/time-range window.
      const startMs = new Date(start).getTime();
      const endMs = new Date(end).getTime();
      finalLogins = finalLogins
        .filter(matchesDeveloperLoginRow)
        .map((r) => ({ row: r, ms: loginRowTimeMs(r) }))
        .filter((x) => !Number.isNaN(x.ms) && x.ms >= startMs && x.ms < endMs)
        .sort((a, b) => a.ms - b.ms)
        .map((x) => x.row);

      let finalSessions = sessionsRes.data || [];
      // Handle keyboard API response
      let finalKeyboard = [];
      if (keyboardApiRes && keyboardApiRes.data) {
        finalKeyboard = keyboardApiRes.data;
      } else if (Array.isArray(keyboardApiRes)) {
        finalKeyboard = keyboardApiRes;
      }
      if (keyboardApiRes?.source && keyboardApiRes.source !== "primary-date-filtered" && keyboardApiRes.source !== "range-bounded") {
        console.warn("[Keyboard] Unexpected source (possible fallback/unfiltered response):", keyboardApiRes.source);
      }

      // Strict client-side date validation to prevent cross-day leakage (timezone or backend issues).
      const kbStartMs = new Date(start).getTime();
      const kbEndMs = new Date(end).getTime();
      finalKeyboard = (finalKeyboard || [])
        .filter((row) => {
          const t = new Date(row?.tracked_at).getTime();
          if (Number.isNaN(t)) return false;
          return t >= kbStartMs && t < kbEndMs;
        })
        .sort((a, b) => new Date(b.tracked_at).getTime() - new Date(a.tracked_at).getTime());

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

      // Fallback to email if sessions returned nothing
      if (!finalSessions.length) {
        const [s2, a2, ss2, ss2CreatedAt] = await Promise.all([
          supabase
            .from("productivity_sessions")
            .select("*")
            .or(sessionFilters)
            .gte("start_time", start)
            .lt("start_time", end)
            .order("start_time", { ascending: false }),
          supabase.from("app_usage").select("id, session_id, user_email, app_name, app_name_raw, window_title, start_time, end_time, duration_seconds, duration_minutes, tracked_at, created_at, is_new_app, user_login").eq("user_email", devEmail).gte("tracked_at", start).lt("tracked_at", end).order("tracked_at", { ascending: false }),
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
        finalApp = a2.data || [];
        screenshotRows = ss2.data || [];
        screenshotCreatedAtRows = ss2CreatedAt.data || [];
      }

      // Keyboard data already fetched via API route with all fallbacks built-in

      // Normalize + strictly filter screenshots to the selected range.
      // Also require a real image URL so the UI never shows count-only/placeholder rows.
      const merged = new Map();
      [...(screenshotRows || []), ...(screenshotCreatedAtRows || [])].forEach((r) => {
        const key = r?.id || `${r?.developer_id || ""}-${r?.created_at || ""}-${r?.timestamp || ""}`;
        if (!merged.has(key)) merged.set(key, r);
      });
      finalScreenshots = Array.from(merged.values())
        .map((r) => {
          const imageUrl = r?.public_url || r?.image_url || r?.thumbnail_url || r?.publicUrl || null;
          const displayTs = r?.timestamp || r?.created_at || null;
          const displayMsRaw = parseDbTimeMs(displayTs);
          const displayMs = Number.isNaN(displayMsRaw) ? parseDbTimeMs(r?.created_at) : displayMsRaw;
          return { ...r, public_url: imageUrl, _display_ts: displayTs, _display_ms: displayMs };
        })
        .filter((r) => {
          if (!r.public_url) return false;
          if (r._display_ms == null || Number.isNaN(r._display_ms)) return false;
          return r._display_ms >= startMs && r._display_ms < endMs;
        })
        .sort((a, b) => (b._display_ms || 0) - (a._display_ms || 0));

      // Detect active session
      const active = finalSessions.find(s => s.status === "active") || null;
      setActiveSession(active);

      setSessions(finalSessions);
      setKeyboardData(finalKeyboard);
      setAppUsageData(finalApp);
      setScreenshots(finalScreenshots);
      setLoginRecords(finalLogins);
      setLastUpdated(new Date());
    } catch (err) {
      // Silently handle fetch errors
    } finally {
      if (!silent) setLoading(false);
    }
  }, [selectedDeveloper, developers, getDateFilter, selectedDate, loginRowTimeMs]);

  // ─── Mouse Activity (server-side pagination) ───
  const fetchMousePage = useCallback(async ({ page = 1, silent = false } = {}) => {
    const dev = developers.find(d => d.id === selectedDeveloper);
    if (!dev) return;

    const { start, end } = getDateFilter();
    const from = (page - 1) * MOUSE_PAGE_SIZE;
    const to = from + MOUSE_PAGE_SIZE - 1;

    if (!silent) setMousePageLoading(true);
    try {
      const baseSelect = "id, session_id, developer_id, developer_name, timestamp, activity_status, active_percentage, idle_percentage, created_at";

      const mouseDeveloperFilters = [`developer_id.eq.${dev.id}`];
      if (dev.user_id) mouseDeveloperFilters.push(`developer_id.eq.${dev.user_id}`);

      let res = await supabase
        .from("mouse_activities")
        .select(baseSelect, { count: "exact" })
        .or(mouseDeveloperFilters.join(","))
        .gte("timestamp", start)
        .lt("timestamp", end)
        .order("timestamp", { ascending: false })
        .range(from, to);

      let rows = Array.isArray(res?.data) ? res.data : [];
      let total = typeof res?.count === "number" ? res.count : rows.length;

      // Fallback: some schemas may use email instead of developer_id.
      if (!rows.length && dev.email) {
        res = await supabase
          .from("mouse_activities")
          .select(baseSelect, { count: "exact" })
          .eq("email", dev.email)
          .gte("timestamp", start)
          .lt("timestamp", end)
          .order("timestamp", { ascending: false })
          .range(from, to);
        rows = Array.isArray(res?.data) ? res.data : [];
        total = typeof res?.count === "number" ? res.count : rows.length;
      }

      setMouseData(rows);
      setMouseTotalCount(total);
      setMousePage(page);
    } catch (e) {
      // Silently handle mouse paging errors
      setMouseData([]);
      setMouseTotalCount(0);
      setMousePage(1);
    } finally {
      if (!silent) setMousePageLoading(false);
    }
  }, [developers, selectedDeveloper, getDateFilter]);

  // Reset mouse pagination when filters change.
  useEffect(() => {
    if (!selectedDeveloper) {
      setMouseData([]);
      setMouseTotalCount(0);
      setMousePage(1);
      return;
    }
    fetchMousePage({ page: 1, silent: true });
  }, [selectedDeveloper, selectedDate, timeRange, fetchMousePage]);

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

    const { start, end } = getDateFilter();
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    const inRange = (row) => {
      const t = parseDbTimeMs(row?.created_at ?? row?.timestamp ?? null);
      if (Number.isNaN(t)) return false;
      return t >= startMs && t < endMs;
    };

    let channel = supabase.channel("mouse-activity-realtime");
    const mouseFilters = [`developer_id=eq.${dev.id}`];
    if (dev.user_id) mouseFilters.push(`developer_id=eq.${dev.user_id}`);

    mouseFilters.forEach(f => {
      channel = channel.on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "mouse_activities",
        filter: f,
      }, (payload) => {
        if (!inRange(payload?.new)) return;
        setMouseTotalCount((c) => (typeof c === "number" ? c + 1 : c));
        if (mousePage === 1) {
          setMouseData(prev => {
            if (prev.some(m => m.id === payload.new.id)) return prev;
            return [payload.new, ...prev].slice(0, MOUSE_PAGE_SIZE);
          });
        }
        setLastUpdated(new Date());
      });
    });
    channel.subscribe();

    realtimeChannelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedDeveloper, developers, getDateFilter, parseDbTimeMs, mousePage]);

  // ─── Supabase Realtime for keyboard_stats ───
  const keyboardChannelRef = useRef(null);
  useEffect(() => {
    if (keyboardChannelRef.current) {
      supabase.removeChannel(keyboardChannelRef.current);
      keyboardChannelRef.current = null;
    }
    const dev = developers.find(d => d.id === selectedDeveloper);
    if (!dev) return;

    const { start, end } = getDateFilter();
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    const inRange = (row) => {
      const t = new Date(row?.tracked_at).getTime();
      if (Number.isNaN(t)) return false;
      return t >= startMs && t < endMs;
    };

    let kbChannel = supabase.channel("keyboard-stats-realtime");
    const kbFilters = [`developer_id=eq.${dev.id}`];
    if (dev.user_id) kbFilters.push(`developer_id=eq.${dev.user_id}`);
    if (dev.email) kbFilters.push(`user_email=eq.${dev.email}`);

    kbFilters.forEach(f => {
      kbChannel = kbChannel.on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "keyboard_stats",
        filter: f,
      }, (payload) => {
        if (!inRange(payload.new)) return;
        setKeyboardData(prev => {
          if (prev.some(k => k.id === payload.new.id)) return prev;
          return [payload.new, ...prev];
        });
        setLastUpdated(new Date());
      });
    });
    kbChannel.subscribe();
    keyboardChannelRef.current = kbChannel;
    return () => { supabase.removeChannel(kbChannel); };
  }, [selectedDeveloper, developers, getDateFilter]);

  // ─── Supabase Realtime for app_usage ───
  const appChannelRef = useRef(null);
  useEffect(() => {
    if (appChannelRef.current) {
      supabase.removeChannel(appChannelRef.current);
      appChannelRef.current = null;
    }
    const dev = developers.find(d => d.id === selectedDeveloper);
    if (!dev) return;
    const { start, end } = getDateFilter();
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    const inRange = (row) => {
      const t = parseDbTimeMs(row?.tracked_at ?? row?.created_at ?? null);
      if (Number.isNaN(t)) return false;
      return t >= startMs && t < endMs;
    };
    const appChannel = supabase
      .channel("app-usage-realtime")
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "app_usage",
        filter: `user_email=eq.${dev.email}`,
      }, (payload) => {
        if (!inRange(payload?.new)) return;
        setAppUsageData(prev => [payload.new, ...prev]);
        setLastUpdated(new Date());
      })
      .subscribe();
    appChannelRef.current = appChannel;
    return () => { supabase.removeChannel(appChannel); };
  }, [selectedDeveloper, developers, getDateFilter, parseDbTimeMs]);

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
      const displayTs = row?.timestamp || row?.created_at || null;
      const displayMsRaw = parseDbTimeMs(displayTs);
      const displayMs = Number.isNaN(displayMsRaw) ? parseDbTimeMs(row?.created_at) : displayMsRaw;
      return { ...row, public_url: imageUrl, _display_ts: displayTs, _display_ms: displayMs };
    };

    const shouldInclude = (row) => {
      const imageUrl = row?.public_url || row?.image_url || row?.thumbnail_url || row?.publicUrl;
      if (!imageUrl) return false;
      const displayTs = row?.timestamp || row?.created_at;
      if (!displayTs) return false;
      const tRaw = parseDbTimeMs(displayTs);
      const t = Number.isNaN(tRaw) ? parseDbTimeMs(row?.created_at) : tRaw;
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
  }, [selectedDeveloper, developers, getDateFilter, parseDbTimeMs]);

  // ─── Supabase Realtime for developer_logins ───
  useEffect(() => {
    if (loginChannelRef.current) {
      supabase.removeChannel(loginChannelRef.current);
      loginChannelRef.current = null;
    }
    const dev = developers.find(d => d.id === selectedDeveloper);
    if (!dev) return;

    const { start, end } = getDateFilter();
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();

    const matchesDeveloper = (row) => {
      if (!row) return false;
      if (row.developer_id && row.developer_id === dev.id) return true;
      if (row.developer_email && row.developer_email === dev.email) return true;
      if (row.user_email && row.user_email === dev.email) return true;
      if (row.email && row.email === dev.email) return true;
      if (row.user_login && row.user_login === dev.email) return true;
      return false;
    };

    const inSelectedRange = (row) => {
      const ms = loginRowTimeMs(row);
      if (Number.isNaN(ms)) return false;
      return ms >= startMs && ms < endMs;
    };

    const channel = supabase
      .channel("developer-logins-realtime")
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "developer_logins",
      }, (payload) => {
        const row = payload?.new;
        if (!matchesDeveloper(row)) return;
        if (!inSelectedRange(row)) return;
        setLoginRecords((prev) => {
          if (row?.id && prev.some((r) => r.id === row.id)) return prev;
          const next = [row, ...prev];
          // Keep chronological order for summary (first/second login).
          return next
            .map((r) => ({ row: r, ms: loginRowTimeMs(r) }))
            .filter((x) => !Number.isNaN(x.ms))
            .sort((a, b) => a.ms - b.ms)
            .map((x) => x.row);
        });
        setLastUpdated(new Date());
      })
      .subscribe();

    loginChannelRef.current = channel;
    return () => { supabase.removeChannel(channel); };
  }, [selectedDeveloper, developers, selectedDate, timeRange, loginRowTimeMs, getDateFilter]);

  // ─── Computed Metrics ───
  const developer = developers.find(d => d.id === selectedDeveloper);
  const hasData = sessions.length || mouseData.length || keyboardData.length || appUsageData.length || screenshots.length || loginRecords.length;

  const { start: rangeStart, end: rangeEnd } = getDateFilter();

  // Aggregate durations from productivity_sessions for the selected date/range
  const totalActiveTime = sessions.reduce((s, r) => s + (Number(r.active_duration) || 0), 0);
  const totalIdleTime = sessions.reduce((s, r) => s + (Number(r.idle_duration) || 0), 0);

  // Sum of productivity_sessions.total_duration (in seconds) for the selected day (by start_time)
  const rangeStartTime = new Date(rangeStart).getTime();
  const rangeEndTime = new Date(rangeEnd).getTime();

  // Format seconds to HH:MM:SS
  const formatHHMMSS = (totalSeconds) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

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
    const t = parseDbTimeMs(iso);
    if (Number.isNaN(t)) return "N/A";
    return new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };
  const fmtTime = (iso) => {
    const t = parseDbTimeMs(iso);
    if (Number.isNaN(t)) return "N/A";
    return new Date(t).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  const fmtPkDate = (iso) => {
    const t = parseDbTimeMs(iso);
    if (Number.isNaN(t)) return "N/A";
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Karachi",
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(t));
  };

  const fmtPkTime12 = (iso) => {
    const t = parseDbTimeMs(iso);
    if (Number.isNaN(t)) return "N/A";
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Karachi",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(t));
  };

  const getLoginDisplayValue = (row) =>
    row?.login_time ?? row?.login_at ?? row?.logged_in_at ?? row?.timestamp ?? row?.created_at ?? null;

  const loginChrono = loginRecords
    .map((r) => ({ row: r, ms: loginRowTimeMs(r) }))
    .filter((x) => !Number.isNaN(x.ms))
    .sort((a, b) => a.ms - b.ms);
  const todaysLoginCount = loginChrono.length;
  const firstLoginRow = loginChrono[0]?.row || null;
  const secondLoginRow = loginChrono[1]?.row || null;
  const firstLoginTime = firstLoginRow ? fmtPkTime12(getLoginDisplayValue(firstLoginRow)) : "—";
  const secondLoginTime = secondLoginRow ? fmtPkTime12(getLoginDisplayValue(secondLoginRow)) : "—";
  // Dashboard status rule (display-only): 0-1 logins => Allowed, 2+ logins => Blocked.
  // A developer is allowed a maximum of 2 logins per day.
  const dailyLoginStatus = todaysLoginCount >= 2 ? "Blocked" : "Allowed";

  // Screenshots: show time exactly as stored (no timezone conversion).
  // Example input: "2026-04-24 05:53:04.978197+00" -> "05:53:04"
  const fmtDbExactTime = (value) => {
    if (!value) return "N/A";
    const s = String(value).trim();
    const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
    if (m) return m[2];
    // If the value is already just a time string, keep it.
    const timeOnly = s.match(/^(\d{2}:\d{2}:\d{2})/);
    if (timeOnly) return timeOnly[1];
    return s;
  };
  const prodColor = (s) => (s >= 80 ? "text-success" : s >= 60 ? "text-warning" : "text-destructive");
  const prodBg = (s) => (s >= 80 ? "bg-success/10" : s >= 60 ? "bg-warning/10" : "bg-destructive/10");
  const statusColor = (status) => {
    const s = (status || "").toLowerCase();
    if (s === "active") return "bg-success/10 text-success";
    if (s === "idle") return "bg-warning/10 text-warning";
    return "bg-muted text-muted-foreground";
  };

  const refreshAdminData = () => {
    try {
      const adminData = JSON.parse(sessionStorage.getItem("adminUser"));
      if (adminData) { setCurrentAdmin(adminData); fetchAdminDevelopers(); }
    } catch (err) {
      // Silently handle error
    }
  };

  // ─── Render ───
  return (
    <div className="bg-card p-6 rounded-xl border border-border shadow-card">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Developer Activity Dashboard</h2>
          {/* Live indicator */}

        </div>
        <div className="flex items-center space-x-4">

          {/* {currentAdmin && (
            <div className="text-right">
              <p className="text-sm font-medium text-foreground">{currentAdmin.name || currentAdmin.email}</p>
              <p className="text-xs text-muted-foreground">Admin Dashboard</p>
            </div>
          )} */}
          <button onClick={refreshAdminData} className="inline-flex items-center gap-2 bg-card text-foreground border border-border px-3 py-1.5 rounded-lg hover:bg-muted transition-colors text-sm font-semibold">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6 bg-card rounded-xl p-5 border border-border shadow-card">


        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <User className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <label htmlFor="developer-filter" className="text-sm font-medium text-muted-foreground">Select Developer</label>
            </div>
            <select
              id="developer-filter"
              value={selectedDeveloper}
              onChange={(e) => setSelectedDeveloper(e.target.value)}
              className="w-full px-4 py-2.5 border border-input rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
              disabled={!currentAdmin || fetchingDevelopers}
            >
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
              <div className="mt-2">
                <p className="text-xs text-destructive">Please login to view developers</p>
                <button
                  onClick={() => window.location.href = "/login"}
                  className="text-xs text-info hover:text-info/80 underline"
                >
                  Go to Login
                </button>
              </div>
            )}
            {currentAdmin && fetchingDevelopers && <p className="text-xs text-muted-foreground mt-2">Loading developers...</p>}
            {currentAdmin && !fetchingDevelopers && developers.length === 0 && (
              <div className="mt-2">
                <p className="text-xs text-warning">No developers added by you yet</p>
                <button
                  onClick={() => window.location.href = "/admin/dashboard?section=add-developer"}
                  className="text-xs text-success hover:text-success/80 underline"
                >
                  Add Developers
                </button>
              </div>
            )}
            {currentAdmin && !fetchingDevelopers && developers.length > 0 && (
              <p className="text-xs text-muted-foreground mt-2">Showing {developers.length} developer{developers.length !== 1 ? "s" : ""} added by you</p>
            )}
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <label htmlFor="date-filter" className="text-sm font-medium text-muted-foreground">Date</label>
            </div>
            <input
              id="date-filter"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full px-4 py-2.5 border border-input rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
              disabled={!selectedDeveloper}
            />
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <Timer className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <label htmlFor="time-range-filter" className="text-sm font-medium text-muted-foreground">Time Range</label>
            </div>
            <select
              id="time-range-filter"
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              className="w-full px-4 py-2.5 border border-input rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
              disabled={!selectedDeveloper}
            >
              <option value="today">Today</option>
              <option value="week">Last 7 Days</option>
              <option value="month">Last 30 Days</option>
            </select>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <Eye className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <label htmlFor="view-mode-filter" className="text-sm font-medium text-muted-foreground">View Mode</label>
            </div>
            <select
              id="view-mode-filter"
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value)}
              className="w-full px-4 py-2.5 border border-input rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
              disabled={!selectedDeveloper}
            >
              <option value="overview">Overview</option>
              <option value="mouse">Mouse Activity</option>
              <option value="keyboard">Keyboard Activity</option>
              <option value="apps">App Usage</option>
              <option value="screenshots">Screenshots</option>
              <option value="logins">Login Activity</option>
              {/* <option value="timeline">Session Timeline</option> */}
            </select>
          </div>
        </div>
      </div>

      {/* Active Session Banner */}
      {activeSession && !loading && (
        <div className="mb-6 bg-success/10 border border-success/20 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-success"></span>
            </span>
            <div>
              <p className="text-sm font-semibold text-success">Active Session Running</p>
              <p className="text-xs text-success/80">
                Session: {String(activeSession.session_id || "").slice(-8)} &bull; Started: {fmtDateTime(activeSession.start_time)}
                &bull; Mouse: {sessionMouseData.length}
                &bull; Keyboard: {sessionKeyboardData.length}
                &bull; Apps: {sessionAppData.length}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-success/80">Current Mouse Status</p>
            <span className={`inline-block px-3 py-1 rounded-full text-sm font-bold ${statusColor(latestMouseStatus)}`}>{latestMouseStatus}</span>
          </div>
        </div>
      )}

      {/* Loading Spinner */}
      {loading && (
        <div className="text-center py-8">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="text-muted-foreground mt-2">Loading activity data...</p>
        </div>
      )}

      {/* Main Content */}
      {developer && !loading && (hasData || viewMode === "logins") && (
        <div className="space-y-6">

          {/* ==================== OVERVIEW ==================== */}
          {viewMode === "overview" && (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                <StatCard
                  icon={<Hourglass className="h-5 w-5 text-foreground" aria-hidden="true" />}
                  label="Today's Total Time"
                  value={formatHHMMSS(todayTotalSeconds)}
                  bg="bg-teal-100"
                />
                {/* <StatCard icon={<Timer className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Today Active Time" value={fmtDuration(totalActiveTime)} bg="bg-green-100" /> */}
                {/* <StatCard icon={<Pause className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Idle Time" value={fmtDuration(totalIdleTime)} bg="bg-red-100" /> */}
                <StatCard icon={<MousePointer2 className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Mouse Active %" value={`${avgMouseActive.toFixed(1)}%`} bg="bg-info/10" />
                <StatCard icon={<Target className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Kb Activity %" value={`${avgKeyboardActivity.toFixed(1)}%`} bg="bg-primary/10" />
                <StatCard icon={<Camera className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Screenshots" value={screenshots.length} bg="bg-pink-100" />
              </div>

              {/* Productivity Chart */}
              {/* {sessionChartData.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-6 shadow-card">
                  <h3 className="text-lg font-semibold text-foreground mb-4">Productivity per Session</h3>
                  <EChart
                    height={300}
                    option={{
                      color: ["#0c8f6e", "#0ea5e9", "#ef4444"],
                      textStyle,
                      grid: baseGrid,
                      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, ...baseTooltip },
                      legend: { ...baseLegend, data: ["Productivity %", "Active (min)", "Idle (min)"] },
                      xAxis: {
                        type: "category",
                        data: sessionChartData.map((d) => d.session),
                        axisLabel,
                        axisLine,
                        axisTick: { show: false },
                      },
                      yAxis: { type: "value", axisLabel, splitLine },
                      series: [
                        { name: "Productivity %", type: "bar", data: sessionChartData.map((d) => d.score), itemStyle: { color: "#0c8f6e", borderRadius: [4, 4, 0, 0] } },
                        { name: "Active (min)", type: "bar", data: sessionChartData.map((d) => d.active), itemStyle: { color: "#0ea5e9", borderRadius: [4, 4, 0, 0] } },
                        { name: "Idle (min)", type: "bar", data: sessionChartData.map((d) => d.idle), itemStyle: { color: "#ef4444", borderRadius: [4, 4, 0, 0] } },
                      ],
                    }}
                  />
                </div>
              )} */}

              {/* Top Apps + App Pie side by side */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="rounded-xl border border-border bg-card p-6 shadow-card">
                  <h3 className="text-lg font-semibold text-foreground mb-4">Top Applications</h3>
                  {topApps.length > 0 ? (
                    <div className="space-y-2">
                      {topApps.slice(0, 5).map((app, i) => (
                        <div key={i} className="flex justify-between items-center p-3 bg-card rounded border">
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
                          <span className="bg-info/10 text-info px-3 py-1 rounded-full text-xs whitespace-nowrap">
                            {fmtMinutesToMinSec(app.totalMinutes || 0)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-muted-foreground text-center py-4">No app usage data</p>}
                </div>

                {/* App Usage Distribution Pie Chart */}
                {appPieData.length > 0 && (
                  <div className="rounded-xl border border-border bg-card p-6 shadow-card">
                    <h3 className="text-lg font-semibold text-foreground mb-4">App Usage Distribution</h3>
                    <EChart
                      height={250}
                      option={{
                        color: CHART_COLORS,
                        textStyle,
                        tooltip: { trigger: "item", ...baseTooltip },
                        series: [
                          {
                            type: "pie",
                            radius: "68%",
                            center: ["50%", "50%"],
                            data: appPieData.map((d, i) => ({
                              value: d.value,
                              name: d.name,
                              itemStyle: { color: CHART_COLORS[i % CHART_COLORS.length] },
                            })),
                            label: { formatter: (p) => `${p.name} ${p.percent.toFixed(0)}%` },
                          },
                        ],
                      }}
                    />
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
                <StatCard icon={<MousePointer2 className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Mouse Records" value={mouseData.length} bg="bg-info/10" />
                <StatCard icon={<TrendingUp className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Avg Active %" value={`${avgMouseActive.toFixed(1)}%`} bg="bg-green-100" />
                <StatCard icon={<TrendingDown className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Avg Idle %" value={`${avgMouseIdle.toFixed(1)}%`} bg="bg-red-100" />
                {/* <div className="bg-card p-4 rounded-xl border border-border shadow-card">
                  <div className="flex items-center">
                    <div className={`p-3 rounded-lg mr-3 ${statusColor(latestMouseStatus)}`}><span className="text-xl">Status</span></div>
                    <div>
                      <p className="text-xs text-muted-foreground">Current Status</p>
                      <p className={`text-lg font-bold ${latestMouseStatus.toLowerCase() === "active" ? "text-green-700" : latestMouseStatus.toLowerCase() === "idle" ? "text-yellow-700" : "text-muted-foreground"}`}>
                        {latestMouseStatus}
                      </p>
                    </div>
                  </div>
                </div> */}
              </div>

              {/* Active Session Mouse Summary */}
              {activeSession && sessionMouseData.length > 0 && (
                <div className="rounded-xl border border-success/20 bg-success/10 p-6">
                  <h3 className="text-lg font-semibold mb-4 text-success">
                    Active Session Mouse Activity
                    <span className="text-sm font-normal text-success/80 ml-2">({sessionMouseData.length} records)</span>
                  </h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-card p-4 rounded-lg text-center border border-border">
                      <p className="text-2xl font-bold text-green-600">{avgSessionMouseActive.toFixed(1)}%</p>
                      <p className="text-xs text-muted-foreground">Active %</p>
                    </div>
                    <div className="bg-card p-4 rounded-lg text-center border border-border">
                      <p className="text-2xl font-bold text-red-500">{avgSessionMouseIdle.toFixed(1)}%</p>
                      <p className="text-xs text-muted-foreground">Idle %</p>
                    </div>
                    <div className="bg-card p-4 rounded-lg text-center border border-border">
                      <p className={`text-2xl font-bold ${latestMouseStatus.toLowerCase() === "active" ? "text-green-600" : "text-yellow-600"}`}>{latestMouseStatus}</p>
                      <p className="text-xs text-muted-foreground">Latest Status</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Mouse Activity Chart: Active vs Idle % Over Time */}
              {mouseChartData.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-6 shadow-card">
                  <h3 className="text-lg font-semibold text-foreground mb-4">Mouse Active vs Idle % Over Time</h3>
                  <EChart
                    height={300}
                    option={{
                      color: ["#10b981", "#ef4444"],
                      textStyle,
                      grid: baseGrid,
                      tooltip: {
                        trigger: "axis",
                        valueFormatter: (v) => `${Number(v).toFixed(1)}%`,
                        ...baseTooltip,
                      },
                      legend: { ...baseLegend, data: ["Active %", "Idle %"] },
                      xAxis: {
                        type: "category",
                        boundaryGap: false,
                        data: mouseChartData.map((d) => d.time),
                        axisLabel,
                        axisLine,
                        axisTick: { show: false },
                      },
                      yAxis: {
                        type: "value",
                        max: 100,
                        axisLabel: { ...axisLabel, formatter: "{value}%" },
                        splitLine,
                      },
                      series: [
                        {
                          name: "Active %",
                          type: "line",
                          smooth: true,
                          showSymbol: false,
                          lineStyle: { width: 2, color: "#10b981" },
                          areaStyle: { color: verticalGradient("#10b981") },
                          data: mouseChartData.map((d) => d.active),
                        },
                        {
                          name: "Idle %",
                          type: "line",
                          smooth: true,
                          showSymbol: false,
                          lineStyle: { width: 2, color: "#ef4444" },
                          areaStyle: { color: verticalGradient("#ef4444") },
                          data: mouseChartData.map((d) => d.idle),
                        },
                      ],
                    }}
                  />
                </div>
              )}

              {/* Mouse Activity Pie */}
              {mouseData.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="rounded-xl border border-border bg-card p-6 shadow-card">
                    <h3 className="text-lg font-semibold text-foreground mb-4">Active vs Idle Distribution</h3>
                    <EChart
                      height={250}
                      option={{
                        textStyle,
                        tooltip: {
                          trigger: "item",
                          valueFormatter: (v) => `${Number(v).toFixed(1)}%`,
                          ...baseTooltip,
                        },
                        series: [
                          {
                            type: "pie",
                            radius: "68%",
                            center: ["50%", "50%"],
                            data: [
                              { name: "Active", value: Math.round(avgMouseActive * 100) / 100, itemStyle: { color: "#10b981" } },
                              { name: "Idle", value: Math.round(avgMouseIdle * 100) / 100, itemStyle: { color: "#ef4444" } },
                            ],
                            label: { formatter: (p) => `${p.name}: ${Number(p.value).toFixed(1)}%` },
                          },
                        ],
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Mouse Activity Timeline Table */}
              <div className="rounded-xl border border-border bg-card p-6 shadow-card">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <h3 className="text-lg font-semibold">Mouse Activity Timeline</h3>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="px-3 py-1.5 rounded-lg border border-border bg-card text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
                      onClick={() => fetchMousePage({ page: Math.max(1, mousePage - 1) })}
                      disabled={mousePageLoading || mousePage <= 1}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="px-3 py-1.5 rounded-lg border border-border bg-card text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
                      onClick={() => fetchMousePage({ page: mousePage + 1 })}
                      disabled={mousePageLoading || (mousePage * MOUSE_PAGE_SIZE) >= mouseTotalCount}
                    >
                      Next
                    </button>
                  </div>
                </div>

                <p className="text-sm text-muted-foreground mb-3">
                  {(() => {
                    const total = mouseTotalCount || 0;
                    if (!total) return "Showing 0 to 0 of 0";
                    const startIdx = (mousePage - 1) * MOUSE_PAGE_SIZE + 1;
                    const endIdx = Math.min(mousePage * MOUSE_PAGE_SIZE, total);
                    return `Showing ${startIdx} to ${endIdx} of ${total}`;
                  })()}
                </p>
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="min-w-full divide-y divide-border">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Timestamp</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Active %</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Idle %</th>
                      </tr>
                    </thead>
                    <tbody className="bg-card divide-y divide-border">
                      {mouseData.map((r, i) => (
                        <tr key={r.id || i} className={`hover:bg-muted/50 ${i === 0 ? "bg-green-50" : ""}`}>
                          <td className="px-4 py-3 text-sm text-muted-foreground">{fmtDateTime(r.created_at)}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-16 bg-muted rounded-full h-2">
                                <div className="bg-green-500 h-2 rounded-full" style={{ width: `${Math.min(r.active_percentage || 0, 100)}%` }}></div>
                              </div>
                              <span className="text-sm font-medium text-green-700">{(r.active_percentage || 0).toFixed(1)}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-16 bg-muted rounded-full h-2">
                                <div className="bg-red-400 h-2 rounded-full" style={{ width: `${Math.min(r.idle_percentage || 0, 100)}%` }}></div>
                              </div>
                              <span className="text-sm font-medium text-red-600">{(r.idle_percentage || 0).toFixed(1)}%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {mousePageLoading && <p className="text-center text-sm text-muted-foreground mt-3">Loading…</p>}
              </div>
            </div>
          )}

          {/* ==================== LOGIN ACTIVITY ==================== */}
          {viewMode === "logins" && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard icon={<LockKeyhole className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Today's Login Count" value={todaysLoginCount} bg="bg-emerald-100" />
                <StatCard icon={<Clock1 className="h-5 w-5 text-foreground" aria-hidden="true" />} label="First Login" value={firstLoginTime} bg="bg-info/10" />
                <StatCard icon={<Clock2 className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Second Login" value={secondLoginTime} bg="bg-primary/10" />
                <div className="bg-card p-4 rounded-xl border border-border shadow-card">
                  <div className="flex items-center">
                    <div className={`${dailyLoginStatus === "Blocked" ? "bg-red-100" : "bg-green-100"} p-3 rounded-lg mr-3`}>
                      {dailyLoginStatus === "Blocked" ? (
                        <XCircle className="h-5 w-5 text-foreground" aria-hidden="true" />
                      ) : (
                        <CheckCircle2 className="h-5 w-5 text-foreground" aria-hidden="true" />
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Login Status</p>
                      <p className={`text-lg font-bold ${dailyLoginStatus === "Blocked" ? "text-red-700" : "text-green-700"}`}>{dailyLoginStatus}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-6 shadow-card">
                <h3 className="text-lg font-semibold text-foreground mb-4">Developer Login Activity ({loginRecords.length})</h3>

                {loginRecords.length === 0 ? (
                  <div className="bg-card rounded-lg border p-8 text-center">
                    <div className="mb-4 flex justify-center">
                      <LockKeyhole className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
                    </div>
                    <h4 className="text-lg font-semibold text-foreground mb-2">No Login Activity Recorded</h4>
                    <p className="text-muted-foreground">No login records found for this developer on {selectedDate}.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-96 overflow-y-auto">
                    <table className="min-w-full divide-y divide-border">
                      <thead className="bg-muted sticky top-0">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Developer</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Login Date</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Login Time</th>
                        </tr>
                      </thead>
                      <tbody className="bg-card divide-y divide-border">
                        {loginChrono.map(({ row }, i) => {
                          const ts = getLoginDisplayValue(row);
                          const devName = row?.developer_name || row?.name || developer?.name || "—";
                          return (
                            <tr key={row?.id || i} className="hover:bg-muted/50">
                              <td className="px-4 py-3 text-sm text-foreground">{devName}</td>
                              <td className="px-4 py-3 text-sm text-muted-foreground">{fmtPkDate(ts)}</td>
                              <td className="px-4 py-3 text-sm font-medium text-foreground">{fmtPkTime12(ts)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ==================== KEYBOARD ACTIVITY ==================== */}
          {viewMode === "keyboard" && (
            <div className="space-y-6">
              {/* No Data Fallback */}
              {keyboardData.length === 0 && (
                <div className="bg-muted/50 border border-border rounded-lg p-8 text-center">
                  <div className="mb-4 flex justify-center">
                    <Keyboard className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">No Keyboard Activity Recorded</h3>
                  <p className="text-muted-foreground">No keyboard activity data found for this session or date range.</p>
                  <p className="text-sm text-muted-foreground mt-2">Keyboard stats will appear here once the desktop tracker records typing activity.</p>
                </div>
              )}

              {/* Keyboard Activity Summary Card */}
              {keyboardData.length > 0 && (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard icon={<Keyboard className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Total Keystrokes" value={totalKeystrokes.toLocaleString()} bg="bg-violet-500/10" />
                    <StatCard icon={<Gauge className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Avg WPM" value={avgWPM.toFixed(1)} bg="bg-green-100" />
                    <StatCard icon={<Target className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Activity Score" value={avgKeyboardScore.toFixed(1)} bg="bg-yellow-100" />
                    <div className="bg-card p-4 rounded-xl border border-border shadow-card">
                      <div className="flex items-center">
                        <div className="bg-primary/10 p-3 rounded-lg mr-3 flex items-center justify-center">
                          <BarChart3 className="h-5 w-5 text-foreground" aria-hidden="true" />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Keyboard Activity %</p>
                          <p className="text-lg font-bold text-primary">{avgKeyboardActivity.toFixed(1)}%</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Keyboard Performance Stats */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard icon={<Timer className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Active Time" value={`${totalKbActiveTime.toFixed(1)} min`} bg="bg-green-100" />
                    <StatCard icon={<Pause className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Idle Time" value={`${totalKbIdleTime.toFixed(1)} min`} bg="bg-red-100" />
                    <StatCard icon={<Type className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Unique Keys" value={totalUniqueKeys.toLocaleString()} bg="bg-info/10" />
                    <StatCard icon={<Clock className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Total Time" value={`${totalKbTime.toFixed(1)} min`} bg="bg-muted" />
                  </div>

                  {/* Active Session Keyboard Summary */}
                  {activeSession && sessionKeyboardData.length > 0 && (
                    <div className="rounded-xl border p-6" style={{ borderColor: "#7c3aed33", backgroundColor: "#7c3aed14" }}>
                      <h3 className="text-lg font-semibold mb-4" style={{ color: "#7c3aed" }}>
                        Active Session Keyboard Activity
                        <span className="text-sm font-normal ml-2" style={{ color: "#7c3aed" }}>({sessionKeyboardData.length} records)</span>
                      </h3>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-card p-4 rounded-lg text-center border border-border">
                          <p className="text-2xl font-bold text-violet-600">{sessionTotalKeys.toLocaleString()}</p>
                          <p className="text-xs text-muted-foreground">Keystrokes</p>
                        </div>
                        <div className="bg-card p-4 rounded-lg text-center border border-border">
                          <p className="text-2xl font-bold text-green-600">{sessionAvgWPM.toFixed(1)}</p>
                          <p className="text-xs text-muted-foreground">WPM</p>
                        </div>
                        <div className="bg-card p-4 rounded-lg text-center border border-border">
                          <p className="text-2xl font-bold text-primary">{sessionAvgKbActivity.toFixed(1)}%</p>
                          <p className="text-xs text-muted-foreground">Activity %</p>
                        </div>
                        <div className="bg-card p-4 rounded-lg text-center border border-border">
                          <p className={`text-2xl font-bold ${sessionAvgScore >= 80 ? "text-green-600" : sessionAvgScore >= 60 ? "text-yellow-600" : "text-red-600"}`}>{sessionAvgScore.toFixed(1)}</p>
                          <p className="text-xs text-muted-foreground">Score</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Keyboard Activity Chart: WPM & Activity % Over Time */}
                

                  {/* Keys Pressed Per Minute (from per_minute_summary) */}


                  {/* Active vs Idle Time Distribution */}
                  {keyboardData.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="rounded-xl border border-border bg-card p-6 shadow-card">
                        <h3 className="text-lg font-semibold text-foreground mb-4">Active vs Idle Time</h3>
                        <EChart
                          height={250}
                          option={{
                            textStyle,
                            tooltip: {
                              trigger: "item",
                              valueFormatter: (v) => `${Number(v).toFixed(1)} min`,
                              ...baseTooltip,
                            },
                            series: [
                              {
                                type: "pie",
                                radius: "68%",
                                center: ["50%", "50%"],
                                data: [
                                  { name: "Active", value: Math.round(totalKbActiveTime * 100) / 100, itemStyle: { color: "#10b981" } },
                                  { name: "Idle", value: Math.round(totalKbIdleTime * 100) / 100, itemStyle: { color: "#ef4444" } },
                                ],
                                label: { formatter: (p) => `${p.name}: ${Number(p.value).toFixed(1)} min` },
                              },
                            ],
                          }}
                        />
                      </div>

                      {/* Keystrokes Trend (AreaChart) */}

                    </div>
                  )}

                  {/* Keyboard Activity Timeline Table */}
                  <div className="rounded-xl border border-border bg-card p-6 shadow-card">
                    <h3 className="text-lg font-semibold text-foreground mb-4">Keyboard Activity Timeline ({keyboardData.length})</h3>
                    <div className="overflow-x-auto max-h-96 overflow-y-auto">
                      <table className="min-w-full divide-y divide-border">
                        <thead className="bg-muted sticky top-0">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Tracked At</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Keystrokes</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Unique Keys</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">WPM</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Activity %</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Score</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Active</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Idle</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Session</th>
                          </tr>
                        </thead>
                        <tbody className="bg-card divide-y divide-border">
                          {keyboardData.slice(0, 50).map((r, i) => (
                            <tr key={r.id || i} className={`hover:bg-muted/50 ${i === 0 ? "bg-violet-500/5" : ""}`}>
                              <td className="px-4 py-3 text-sm text-muted-foreground">{fmtDateTime(r.tracked_at)}</td>
                              <td className="px-4 py-3 text-sm font-medium">{(r.total_keys || 0).toLocaleString()}</td>
                              <td className="px-4 py-3 text-sm">{r.unique_keys || 0}</td>
                              <td className="px-4 py-3 text-sm font-medium text-green-700">{(r.words_per_minute || 0).toFixed(1)}</td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <div className="w-16 bg-muted rounded-full h-2">
                                    <div className="bg-primary h-2 rounded-full" style={{ width: `${Math.min(r.keyboard_activity_percentage || 0, 100)}%` }}></div>
                                  </div>
                                  <span className="text-sm font-medium text-primary">{(r.keyboard_activity_percentage || 0).toFixed(1)}%</span>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <span className={`px-2 py-1 rounded text-xs font-medium ${prodBg(r.activity_score || 0)} ${prodColor(r.activity_score || 0)}`}>
                                  {(r.activity_score || 0).toFixed(0)}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-sm text-green-600">{(r.active_time_minutes || 0).toFixed(1)}m</td>
                              <td className="px-4 py-3 text-sm text-red-500">{(r.idle_time_minutes || 0).toFixed(1)}m</td>
                              <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{r.session_id ? String(r.session_id).slice(-8) : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {keyboardData.length > 50 && <p className="text-center text-sm text-muted-foreground mt-3">Showing 50 of {keyboardData.length} records</p>}
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
                <StatCard icon={<Monitor className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Apps Used" value={totalAppsUsed} bg="bg-info/10" />
                {/* <StatCard icon={<BarChart3 className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Usage Records" value={appUsageData.length} bg="bg-green-100" /> */}
                <StatCard
                  icon={<Clock className="h-5 w-5 text-foreground" aria-hidden="true" />}
                  label="Total Active Time"
                  value={(() => {
                    const totalSeconds = totalAppActiveMinutes * 60;

                    if (totalSeconds < 60) {
                      return `${Math.round(totalSeconds)} sec`;
                    } else if (totalSeconds < 3600) {
                      const mins = Math.floor(totalSeconds / 60);
                      const secs = Math.round(totalSeconds % 60);
                      return `${mins} min ${secs} sec`;
                    } else {
                      const hours = Math.floor(totalSeconds / 3600);
                      const mins = Math.floor((totalSeconds % 3600) / 60);
                      const secs = Math.round(totalSeconds % 60);
                      return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
                    }
                  })()}
                  bg="bg-violet-500/10"
                />
                {/* {currentApp && (
                  <div className="bg-card p-4 rounded-xl border border-border shadow-card">
                    <div className="flex items-center">
                      <div className="bg-orange-100 p-3 rounded-lg mr-3"><span className="text-sm font-medium text-foreground">Active</span></div>
                      <div>
                        <p className="text-xs text-muted-foreground">Currently Active</p>
                        <p className="text-sm font-bold text-foreground truncate max-w-[140px]">{currentApp.app_name}</p>
                      </div>
                    </div>
                  </div>
                )} */}
              </div>

              {/* Live Application Tracker */}
              {/* {currentApp && (
                <div className="bg-gradient-to-r from-orange-50 to-amber-50 p-6 rounded-lg border border-orange-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-orange-500"></span>
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-orange-800">Currently Active Application</p>
                        <p className="text-lg font-bold text-foreground">{currentApp.app_name}</p>
                        {currentApp.window_title && <p className="text-xs text-muted-foreground truncate max-w-md">{currentApp.window_title}</p>}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-orange-600">{(currentApp.duration_minutes || 0).toFixed(1)} min</p>
                      <p className="text-xs text-muted-foreground">Since: {fmtDateTime(currentApp.start_time || currentApp.tracked_at)}</p>
                    </div>
                  </div>
                </div>
              )} */}

              {/* Active Session App Summary */}
              {activeSession && sessionAppData.length > 0 && (
                <div className="rounded-xl border border-info/20 bg-info/10 p-6">
                  <h3 className="text-lg font-semibold mb-4 text-info">
                    Active Session Applications
                    <span className="text-sm font-normal text-info/80 ml-2">({sessionAppData.length} records)</span>
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-card p-4 rounded-lg text-center border border-border">
                      <p className="text-2xl font-bold text-info">{new Set(sessionAppData.map(r => r.app_name)).size}</p>
                      <p className="text-xs text-muted-foreground">Unique Apps</p>
                    </div>
                    <div className="bg-card p-4 rounded-lg text-center border border-border">
                      <p className="text-2xl font-bold text-green-600">{sessionAppData.reduce((s, r) => s + (r.duration_minutes || 0), 0).toFixed(1)}</p>
                      <p className="text-xs text-muted-foreground">Total Minutes</p>
                    </div>
                    <div className="bg-card p-4 rounded-lg text-center border border-border">
                      <p className="text-2xl font-bold text-violet-600">{sessionAppData.length}</p>
                      <p className="text-xs text-muted-foreground">App Switches</p>
                    </div>
                    <div className="bg-card p-4 rounded-lg text-center border border-border">
                      <p className="text-2xl font-bold text-orange-600">{sessionAppData.filter(r => r.is_new_app).length}</p>
                      <p className="text-xs text-muted-foreground">New Apps</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Top Applications */}
              {topApps.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-6 shadow-card">
                  <h3 className="text-lg font-semibold text-foreground mb-4">Top Applications</h3>
                  <div className="space-y-3">
                    {topApps.map((app, i) => (
                      <div key={i} className="flex items-center justify-between p-3 bg-card rounded-lg border hover:shadow-sm transition-shadow">
                        <div className="flex items-center gap-3 flex-1">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] + "20" }}>
                            <span className="text-sm font-bold" style={{ color: CHART_COLORS[i % CHART_COLORS.length] }}>#{i + 1}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{app.app}</p>
                            <p className="text-xs text-muted-foreground">{app.count} usage{app.count !== 1 ? "s" : ""}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          {/* Progress bar showing % of session time */}
                          <div className="w-24 bg-muted rounded-full h-2 hidden md:block">
                            <div className="h-2 rounded-full" style={{ width: `${Math.min(app.pct, 100)}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}></div>
                          </div>
                          <span className="text-xs text-muted-foreground w-12 text-right">{app.pct.toFixed(0)}%</span>
                          <span className="bg-info/10 text-info px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap">{app.totalMinutes.toFixed(1)} min</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Charts: Pie + Bar side by side */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {appPieData.length > 0 && (
                  <div className="rounded-xl border border-border bg-card p-6 shadow-card">
                    <h3 className="text-lg font-semibold text-foreground mb-4">Time Distribution</h3>
                    <EChart
                      height={300}
                      option={{
                        color: CHART_COLORS,
                        textStyle,
                        tooltip: {
                          trigger: "item",
                          valueFormatter: (v) => `${Number(v).toFixed(1)} min`,
                          ...baseTooltip,
                        },
                        series: [
                          {
                            type: "pie",
                            radius: "68%",
                            center: ["50%", "50%"],
                            data: appPieData.map((d, i) => ({
                              value: d.value,
                              name: d.name,
                              itemStyle: { color: CHART_COLORS[i % CHART_COLORS.length] },
                            })),
                            label: { formatter: (p) => `${p.name} ${p.percent.toFixed(0)}%` },
                          },
                        ],
                      }}
                    />
                  </div>
                )}

                {appBarData.length > 0 && (
                  <div className="rounded-xl border border-border bg-card p-6 shadow-card">
                    <h3 className="text-lg font-semibold text-foreground mb-4">Top Apps Usage (minutes)</h3>
                    <EChart
                      height={300}
                      option={{
                        color: ["#0c8f6e"],
                        textStyle,
                        grid: baseGrid,
                        tooltip: {
                          trigger: "axis",
                          axisPointer: { type: "shadow" },
                          valueFormatter: (v) => {
                            // Convert minutes to seconds for calculation
                            const totalSeconds = v * 60;

                            if (totalSeconds < 60) {
                              // Less than 1 minute - show seconds
                              return `${Math.round(totalSeconds)} sec`;
                            } else if (totalSeconds < 3600) {
                              // Less than 1 hour - show minutes and seconds
                              const minutes = Math.floor(totalSeconds / 60);
                              const seconds = Math.round(totalSeconds % 60);
                              return `${minutes} min ${seconds} sec`;
                            } else {
                              // Greater than or equal to 1 hour - show HH:MM:SS
                              const hours = Math.floor(totalSeconds / 3600);
                              const minutes = Math.floor((totalSeconds % 3600) / 60);
                              const seconds = Math.round(totalSeconds % 60);
                              return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                            }
                          },
                          ...baseTooltip,
                        },
                        xAxis: { type: "value", axisLabel, splitLine },
                        yAxis: {
                          type: "category",
                          data: appBarData.map((d) => d.name),
                          inverse: true,
                          axisLabel: { ...axisLabel, fontSize: 12 },
                          axisLine,
                          axisTick: { show: false },
                        },
                        series: [
                          {
                            name: "Minutes",
                            type: "bar",
                            data: appBarData.map((d) => d.minutes),
                            itemStyle: { color: "#0c8f6e", borderRadius: [0, 4, 4, 0] },
                          },
                        ],
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Application Activity Timeline Table */}
              <div className="rounded-xl border border-border bg-card p-6 shadow-card">
                <h3 className="text-lg font-semibold text-foreground mb-4">Application Activity Timeline ({appUsageData.length})</h3>
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="min-w-full divide-y divide-border">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Application</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Window Title</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Duration</th>
                      </tr>
                    </thead>
                    <tbody className="bg-card divide-y divide-border">
                      {[...appUsageData].sort((a, b) => {
                        // Derive canonical total seconds for each row using explicit parseFloat
                        // so Postgres numeric-as-string values are always compared correctly.
                        // Prefer duration_seconds (integer precision) and fall back to duration_minutes * 60.
                        const secA = parseFloat(a.duration_seconds) || (parseFloat(a.duration_minutes) * 60) || 0;
                        const secB = parseFloat(b.duration_seconds) || (parseFloat(b.duration_minutes) * 60) || 0;
                        return secB - secA; // descending: highest duration first
                      }).slice(0, 50).map((r, i) => {
                        // Use the same duration logic as Overview's Top Applications:
                        // fmtMinutesToMinSec converts decimal minutes → "X min Y sec"
                        const durationMinutes = r.duration_minutes || 0;
                        const formattedDuration = fmtMinutesToMinSec(durationMinutes);

                        return (
                          <tr key={r.id || i} className="hover:bg-muted/50">
                            <td className="px-4 py-3">
                              <div className="flex items-center">
                                <div className="w-8 h-8 bg-info/10 rounded-lg flex items-center justify-center mr-3">
                                  <Monitor className="h-4 w-4 text-info" aria-hidden="true" />
                                </div>
                                <div>
                                  <p className="text-sm font-medium text-foreground truncate max-w-[180px]">{r.app_name}</p>
                                  {r.app_name_raw && r.app_name_raw !== r.app_name && (
                                    <p className="text-xs text-muted-foreground truncate max-w-[180px]">{r.app_name_raw}</p>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm text-muted-foreground truncate max-w-[200px]">{r.window_title || "—"}</td>
                            <td className="px-4 py-3">
                              <span className="bg-info/10 text-info px-3 py-1 rounded-full text-xs whitespace-nowrap">{formattedDuration}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {appUsageData.length > 50 && <p className="text-center text-sm text-muted-foreground mt-3">Showing 50 of {appUsageData.length} records</p>}
              </div>

              {/* Recent App Switches */}
              {appUsageData.length > 1 && (
                <div className="rounded-xl border border-border bg-card p-6 shadow-card">
                  <h3 className="text-lg font-semibold text-foreground mb-4">Recent Application Switches</h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {appUsageData.slice(0, 20).map((r, i) => {
                      const next = appUsageData[i + 1];
                      return (
                        <div key={r.id || i} className="flex items-center gap-2 p-2 bg-card rounded border">
                          <span className="text-xs text-muted-foreground w-20">{fmtTime(r.tracked_at || r.start_time)}</span>
                          {next && (
                            <>
                              <span className="text-sm text-muted-foreground truncate max-w-[120px]">{next.app_name}</span>
                              <span className="text-muted-foreground">→</span>
                            </>
                          )}
                          <span className="text-sm font-medium text-foreground truncate max-w-[120px]">{r.app_name}</span>
                          <span className="text-xs text-muted-foreground ml-auto">{(r.duration_minutes || 0).toFixed(1)} min</span>
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
                <StatCard icon={<Camera className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Total Screenshots" value={screenshots.length} bg="bg-pink-100" />
                {screenshots.length > 0 && (
                  <div className="bg-card p-4 rounded-xl border border-border shadow-card">
                    <div className="flex items-center">
                      <div className="bg-green-100 p-3 rounded-lg mr-3 flex items-center justify-center">
                        <CircleDot className="h-5 w-5 text-foreground" aria-hidden="true" />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Latest Capture</p>
                        <p className="text-sm font-bold text-foreground">{fmtDbExactTime((screenshots[0].timestamp || screenshots[0].created_at) || "")}</p>
                      </div>
                    </div>

                  </div>
                )}
              </div>

              {/* Debug Info (shown when 0 screenshots) */}
              {/* {screenshots.length === 0 && developer && (
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
              )} */}

              {/* Screenshot Gallery */}
              <div className="rounded-xl border border-border bg-card p-6 shadow-card">
                <h3 className="text-lg font-semibold text-foreground mb-4">Screenshot Gallery ({screenshots.length})</h3>
                {screenshots.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {screenshots.map((ss, i) => (
                      <div key={ss.id || i} className={`bg-card rounded-lg border overflow-hidden hover:shadow-lg transition-shadow cursor-pointer ${i === 0 ? "ring-2 ring-pink-300" : ""}`}
                        onClick={() => setSelectedScreenshot(ss)}>
                        {ss.public_url ? (
                          <img src={ss.public_url} alt={ss.filename || `Screenshot ${i + 1}`} className="w-full h-40 object-cover" loading="lazy" />
                        ) : (
                          <div className="w-full h-40 bg-muted flex items-center justify-center"><span className="text-muted-foreground text-sm">No preview</span></div>
                        )}
                        <div className="p-3 space-y-1">
                          {ss.app_active && (
                            <div className="flex items-center gap-1">
                              <Monitor className="h-3 w-3 text-info" aria-hidden="true" />
                              <p className="text-xs font-medium text-info truncate">{ss.app_active}</p>
                            </div>
                          )}
                          <p className="text-xs text-muted-foreground">{fmtDbExactTime(ss.timestamp || ss.created_at)}</p>
                          <div className="flex items-center justify-between">
                            {ss.size_kb && <span className="text-xs text-muted-foreground">{Number(ss.size_kb).toFixed(0)} KB</span>}
                            {ss.width && ss.height && <span className="text-xs text-muted-foreground">{ss.width}×{ss.height}</span>}
                          </div>
                          {i === 0 && <span className="inline-block px-2 py-0.5 text-xs bg-pink-100 text-pink-700 rounded font-medium">Latest</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-8">
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
                <div className="rounded-xl border border-border bg-card p-6 shadow-card">
                  <h3 className="text-lg font-semibold text-foreground mb-4">Screenshot Timeline</h3>
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {screenshots.map((ss, i) => (
                      <div key={ss.id || i} className={`flex items-center gap-4 p-3 bg-card rounded-lg border hover:shadow-sm transition-shadow cursor-pointer ${i === 0 ? "border-pink-300 bg-pink-50" : ""}`}
                        onClick={() => setSelectedScreenshot(ss)}>
                        <div className="flex-shrink-0 w-16 text-center">
                          <p className="text-sm font-bold text-foreground">{fmtDbExactTime(ss.timestamp || ss.created_at)}</p>
                          {i === 0 && <span className="text-xs text-pink-600">Latest</span>}
                        </div>
                        <div className="w-px h-12 bg-border"></div>
                        <div className="flex-shrink-0">
                          {ss.public_url ? (
                            <img src={ss.public_url} alt={ss.filename || ""} className="w-16 h-12 object-cover rounded border" loading="lazy" />
                          ) : (
                            <div className="w-16 h-12 bg-muted rounded flex items-center justify-center"><span className="text-muted-foreground text-xs">N/A</span></div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          {ss.app_active && <p className="text-sm font-medium text-foreground truncate">{ss.app_active}</p>}
                          <p className="text-xs text-muted-foreground truncate">{ss.filename || "screenshot"}</p>
                        </div>
                        <div className="flex-shrink-0 text-right">
                          {ss.size_kb && <p className="text-xs text-muted-foreground">{Number(ss.size_kb).toFixed(0)} KB</p>}
                          {ss.width && ss.height && <p className="text-xs text-muted-foreground">{ss.width}×{ss.height}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* App Distribution for Screenshots */}
              {/* {screenshots.length > 0 && (() => {
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
                  <div className="rounded-xl border border-border bg-card p-6 shadow-card">
                    <h3 className="text-lg font-semibold text-foreground mb-4">Screenshots by Application</h3>
                    <EChart
                      height={300}
                      option={{
                        color: ["#ec4899"],
                        textStyle,
                        grid: baseGrid,
                        tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, ...baseTooltip },
                        xAxis: {
                          type: "category",
                          data: appScreenshotData.map((d) => d.name),
                          axisLabel: { ...axisLabel, fontSize: 12 },
                          axisLine,
                          axisTick: { show: false },
                        },
                        yAxis: { type: "value", minInterval: 1, axisLabel, splitLine },
                        series: [
                          {
                            name: "Screenshots",
                            type: "bar",
                            data: appScreenshotData.map((d) => d.value),
                            itemStyle: { color: "#ec4899", borderRadius: [4, 4, 0, 0] },
                          },
                        ],
                      }}
                    />
                  </div>
                );
              })()} */}

              {/* Screenshot Details Modal */}
              {selectedScreenshot && (() => {
                const ss = selectedScreenshot;
                return (
                  <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4" onClick={() => setSelectedScreenshot(null)}>
                    <div className="relative bg-card rounded-xl max-w-5xl max-h-[90vh] overflow-hidden flex flex-col md:flex-row" onClick={(e) => e.stopPropagation()}>
                      {/* Image Side */}
                      <div className="flex-1 bg-black flex items-center justify-center min-h-[300px]">
                        {ss.public_url ? (
                          <img src={ss.public_url} alt={ss.filename || "Screenshot"} className="max-w-full max-h-[80vh] object-contain" />
                        ) : (
                          <div className="text-muted-foreground text-center p-8">No image available</div>
                        )}
                      </div>
                      {/* Metadata Side */}
                      <div className="w-full md:w-72 p-6 bg-card overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                          <h4 className="text-lg font-bold text-foreground">Details</h4>
                          <button onClick={() => setSelectedScreenshot(null)} className="text-muted-foreground hover:text-muted-foreground text-xl">&times;</button>
                        </div>
                        <div className="space-y-4">
                          <div>
                            <p className="text-xs text-muted-foreground uppercase tracking-wide">Filename</p>
                            <p className="text-sm font-medium text-foreground break-all">{ss.filename || "—"}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground uppercase tracking-wide">Timestamp</p>
                            <p className="text-sm font-medium text-foreground">{fmtDbExactTime(ss.timestamp || ss.created_at)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground uppercase tracking-wide">Resolution</p>
                            <p className="text-sm font-medium text-foreground">{ss.width && ss.height ? `${ss.width} × ${ss.height}` : "—"}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground uppercase tracking-wide">File Size</p>
                            <p className="text-sm font-medium text-foreground">{ss.size_kb ? `${Number(ss.size_kb).toFixed(1)} KB` : "—"}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground uppercase tracking-wide">MIME Type</p>
                            <p className="text-sm font-medium text-foreground">{ss.mime_type || "—"}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground uppercase tracking-wide">Developer</p>
                            <p className="text-sm font-medium text-foreground">{ss.developer_email || "—"}</p>
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
          {/* {viewMode === "timeline" && (
            <div className="bg-card p-6 rounded-lg border shadow-sm">
              <h3 className="text-lg font-semibold text-foreground mb-4">Session Timeline ({sessions.length})</h3>
              <div className="space-y-4 max-h-[600px] overflow-y-auto">
                {sessions.length > 0 ? (
                  sessions.map((session, index) => (
                    <div key={index} className={`border-l-4 pl-4 py-4 bg-card rounded hover:shadow-md transition-shadow ${session.status === "active" ? "border-green-500" : "border-primary"}`}>
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="font-semibold text-foreground">
                            Session {session.session_id ? String(session.session_id).slice(-8) : `#${index + 1}`}
                          </h4>
                          <p className="text-sm text-muted-foreground">
                            {fmtDateTime(session.start_time)}
                            {session.end_time && ` → ${fmtDateTime(session.end_time)}`}
                          </p>
                          <div className="flex flex-wrap gap-2 mt-2">
                            <span className={`px-3 py-1 rounded-full text-xs font-medium ${prodBg(session.productivity_score)} ${prodColor(session.productivity_score)}`}>
                              Score: {(session.productivity_score || 0).toFixed(1)}%
                            </span>
                            <span className="px-3 py-1 bg-info/10 text-info rounded-full text-xs">
                              Active: {fmtDuration(session.active_duration)}
                            </span>
                            <span className="px-3 py-1 bg-red-100 text-red-800 rounded-full text-xs">
                              Idle: {fmtDuration(session.idle_duration)}
                            </span>
                            {(session.mouse_events > 0 || session.mouse_clicks > 0) && (
                              <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs">
                                Mouse: {session.mouse_events || session.mouse_clicks || 0}
                              </span>
                            )}
                            {(session.keyboard_events > 0 || session.keystrokes > 0) && (
                              <span className="px-3 py-1 bg-violet-500/10 text-violet-700 rounded-full text-xs">
                                Keyboard: {session.keyboard_events || session.keystrokes || 0}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded ${session.status === "active" ? "bg-green-100 text-green-800" : "bg-muted text-foreground"}`}>
                          {session.status === "active" && (
                            <span className="inline-block w-2 h-2 bg-green-500 rounded-full mr-1 animate-pulse"></span>
                          )}
                          {session.status || "completed"}
                        </span>
                      </div>
                      {session.app_usage_summary && (
                        <div className="mt-3 pt-3 border-t">
                          <p className="text-sm font-medium text-foreground mb-1">Apps:</p>
                          <div className="flex flex-wrap gap-1">
                            {(() => {
                              try {
                                const parsed = typeof session.app_usage_summary === "string" ? JSON.parse(session.app_usage_summary) : session.app_usage_summary;
                                const apps = parsed.top_apps || (Array.isArray(parsed) ? parsed : []);
                                return apps.slice(0, 5).map((app, i) => (
                                  <span key={i} className="px-2 py-1 bg-muted text-foreground rounded text-xs">{app}</span>
                                ));
                              } catch {
                                return <span className="text-xs text-muted-foreground">App data available</span>;
                              }
                            })()}
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground text-center py-4">No sessions found for selected period</p>
                )}
              </div>
            </div>
          )} */}
        </div>
      )}

      {/* No Data State */}
      {!loading && selectedDeveloper && !hasData && viewMode !== "logins" && (
        <div className="text-center py-12">
          <svg className="w-16 h-16 mx-auto text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 17h6l2 2V7a2 2 0 00-2-2H9a2 2 0 00-2 2v12l2-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v8" />
          </svg>
          <p className="text-muted-foreground text-lg mt-4">No activity data found for selected period</p>
          <p className="text-muted-foreground text-sm mt-2">Make sure the developer has tracking sessions on {selectedDate}</p>
        </div>
      )}

      {/* No Developer Selected */}
      {!selectedDeveloper && !loading && (
        <div className="text-center py-12">
          <svg className="w-16 h-16 mx-auto text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
          </svg>
          {currentAdmin ? (
            <div>
              <p className="text-muted-foreground text-lg">Select a developer to view activity data</p>
              {/* {developers.length === 0 && (
                <div className="mt-4">
                  <p className="text-muted-foreground text-sm">No developers added by you yet</p>
                  <button onClick={() => window.location.href = "/admin/dashboard?section=add-developer"} className="mt-2 text-info hover:text-info underline text-sm">Add Developers First</button>
                </div>
              )} */}
            </div>
          ) : (
            <div>
              <p className="text-muted-foreground text-lg">Please login to access developer activity</p>
              <p className="text-muted-foreground text-sm mt-2">Only admins can view developer activity data</p>
              <button onClick={() => window.location.href = "/login"} className="mt-4 inline-flex items-center gap-2 bg-primary text-primary-foreground py-2 px-4 rounded-lg font-semibold hover:bg-primary/90 transition-colors">Go to Login</button>
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
    <div className="bg-card p-4 rounded-xl border border-border shadow-card">
      <div className="flex items-center">
        <div className={`${bg} p-3 rounded-lg mr-3 flex items-center justify-center`}>{icon}</div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-bold text-foreground">{value}</p>
        </div>
      </div>
    </div>
  );
}