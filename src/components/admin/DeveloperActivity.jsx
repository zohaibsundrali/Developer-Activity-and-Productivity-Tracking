"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/utils/supabaseClient";
import { getOrgId } from "@/utils/orgContext";
import { authFetch } from "@/utils/authFetch";
import { showPre } from "@/utils/alerts";
import { resolveScreenshotUrls } from "@/utils/screenshotFiles";
import { setVisibleInterval } from "@/hooks/useVisibleInterval";
import EChart from "@/components/charts/EChart";
import {
  PRIMARY,
  RANKED,
  rankedColor,
  SEMANTIC,
  textStyle,
  baseTooltip,
  baseLegend,
  axisLabel,
  valueAxis,
  categoryAxis,
  legendFor,
  gridWithLegend,
  roundedBarH,
  fmtMinutes,
  fmtPct,
  heightForRows,
  donutCenter,
  donutCenterEmphasis,
  verticalGradient,
} from "@/components/charts/chartTheme";
// The page <h1> reads the same string the sidebar and topbar do.
import { sectionTitle } from "@/components/shell/navConfig";
import {
  Button,
  EmptyState,
  Modal,
  PageHeader,
  Skeleton,
  SkeletonTable,
} from "@/components/ui";
import {
  BarChart3,
  Calendar,
  Camera,
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
} from "lucide-react";

// Every list and donut in this file ranks applications by time spent, largest
// first. That is an ORDERED set, not an unrelated one, so it takes a single hue
// stepped in lightness rather than six competing hues — the reader sees the
// ranking in the colour, and the panel stops looking like a pie of confetti.
// (This file used to carry its own eight hexes, which drifted from every other
// chart; then a seven-hue categorical palette, which was the single loudest
// thing on the page.)
const CHART_COLORS = RANKED;

/**
 * Category-axis labels for time series. A day of per-minute samples is
 * hundreds of ticks; without hideOverlap echarts stacks them into a smear.
 */
const timeAxisLabel = { ...axisLabel, hideOverlap: true, interval: "auto" };

/**
 * Shared donut config. Slice labels were the worst offender in this file —
 * two thin slices printed their names on top of each other at every width.
 * The legend carries the names, the tooltip carries the values.
 */
const donutBase = {
  type: "pie",
  radius: ["58%", "78%"],
  center: ["50%", "44%"],
  avoidLabelOverlap: true,
  minAngle: 4,
  padAngle: 2,
  label: { show: false },
  labelLine: { show: false },
  emphasis: { scale: false },
};

const sumValues = (rows) => rows.reduce((a, r) => a + (Number(r?.value) || 0), 0);

// Legend under the ring, centred: at 375px a top-right legend and a donut fight
// for the same corner.
const donutLegend = { ...baseLegend, bottom: 0, top: "auto", left: "center", right: "auto" };
const POLL_INTERVAL = 10_000; // 10 seconds
const MOUSE_PAGE_SIZE = 50;

// The tracker tables gain a row a minute per developer and this dashboard polls
// every 10s, so every read is capped. The caps sit well above a realistic day
// (or month, for the wider ranges) of activity for one developer.
const SESSION_LIMIT = 500;
const APP_USAGE_LIMIT = 1000;
const SCREENSHOT_LIMIT = 200;
const LOGIN_LIMIT = 500;

export default function DeveloperActivity() {
  const router = useRouter();
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
          .order("start_time", { ascending: false })
          .limit(SESSION_LIMIT),
        authFetch(`/api/keyboard-stats?developerId=${encodeURIComponent(devId || "")}&userId=${encodeURIComponent(dev.user_id || "")}&email=${encodeURIComponent(devEmail || "")}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`).then(r => r.json()),
        supabase.from("app_usage").select("id, session_id, user_email, app_name, app_name_raw, window_title, start_time, end_time, duration_seconds, duration_minutes, tracked_at, created_at, is_new_app, user_login").eq("user_email", devEmail).gte("tracked_at", start).lt("tracked_at", end).order("tracked_at", { ascending: false }).limit(APP_USAGE_LIMIT),
        // Screenshots schema has varied; select '*' and normalize client-side.
        supabase.from("screenshots").select("*")
          .or(`developer_id.eq.${devId},developer_email.eq.${devEmail}`)
          .gte("timestamp", start)
          .lt("timestamp", end)
          .order("timestamp", { ascending: false })
          .limit(SCREENSHOT_LIMIT),
        // Fallback for rows missing `timestamp`: use created_at but keep the same date range.
        supabase.from("screenshots").select("*")
          .or(`developer_id.eq.${devId},developer_email.eq.${devEmail}`)
          .gte("created_at", start)
          .lt("created_at", end)
          .order("created_at", { ascending: false })
          .limit(SCREENSHOT_LIMIT),
        devEmail
          ? supabase
            .from("productivity_sessions")
            .select("total_duration")
            .eq("user_email", devEmail)
            .gte("start_time", start)
            .lt("start_time", end)
            .limit(SESSION_LIMIT)
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
          () => supabase.from("developer_logins").select("*").eq("developer_id", devId).gte("login_time", startIso).lt("login_time", endIso).order("login_time", { ascending: true }).limit(LOGIN_LIMIT),
          // Fallback: keyed by email + login_time
          () => supabase.from("developer_logins").select("*").eq("developer_email", devEmail).gte("login_time", startIso).lt("login_time", endIso).order("login_time", { ascending: true }).limit(LOGIN_LIMIT),
          () => supabase.from("developer_logins").select("*").eq("user_email", devEmail).gte("login_time", startIso).lt("login_time", endIso).order("login_time", { ascending: true }).limit(LOGIN_LIMIT),
          () => supabase.from("developer_logins").select("*").eq("email", devEmail).gte("login_time", startIso).lt("login_time", endIso).order("login_time", { ascending: true }).limit(LOGIN_LIMIT),
          // Fallback: some schemas may only have created_at
          () => supabase.from("developer_logins").select("*").eq("developer_id", devId).gte("created_at", startIso).lt("created_at", endIso).order("created_at", { ascending: true }).limit(LOGIN_LIMIT),
          () => supabase.from("developer_logins").select("*").eq("developer_email", devEmail).gte("created_at", startIso).lt("created_at", endIso).order("created_at", { ascending: true }).limit(LOGIN_LIMIT),
          // Last resort: date-bounded fetch then client-side filter
          () => supabase.from("developer_logins").select("*").gte("login_time", startIso).lt("login_time", endIso).order("login_time", { ascending: true }).limit(LOGIN_LIMIT),
          () => supabase.from("developer_logins").select("*").gte("created_at", startIso).lt("created_at", endIso).order("created_at", { ascending: true }).limit(LOGIN_LIMIT),
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
          .order("created_at", { ascending: false })
          .limit(SESSION_LIMIT);
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
            .order("start_time", { ascending: false })
            .limit(SESSION_LIMIT),
          supabase.from("app_usage").select("id, session_id, user_email, app_name, app_name_raw, window_title, start_time, end_time, duration_seconds, duration_minutes, tracked_at, created_at, is_new_app, user_login").eq("user_email", devEmail).gte("tracked_at", start).lt("tracked_at", end).order("tracked_at", { ascending: false }).limit(APP_USAGE_LIMIT),
          supabase.from("screenshots").select("*")
            .or(`developer_id.eq.${devId},developer_email.eq.${devEmail}`)
            .gte("timestamp", start)
            .lt("timestamp", end)
            .order("timestamp", { ascending: false })
            .limit(SCREENSHOT_LIMIT),
          supabase.from("screenshots").select("*")
            .or(`developer_id.eq.${devId},developer_email.eq.${devEmail}`)
            .gte("created_at", start)
            .lt("created_at", end)
            .order("created_at", { ascending: false })
            .limit(SCREENSHOT_LIMIT),
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
      // Sign private-bucket rows first: they carry no durable public_url, so the
      // URL filter below would otherwise discard every Phase 2 screenshot.
      const resolvedShots = await resolveScreenshotUrls(Array.from(merged.values()));
      finalScreenshots = resolvedShots
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
    if (pollRef.current) pollRef.current();
    pollRef.current = null;
    if (autoRefresh && selectedDeveloper) {
      pollRef.current = setVisibleInterval(() => fetchDeveloperActivity(true), POLL_INTERVAL);
    }
    return () => { if (pollRef.current) pollRef.current(); pollRef.current = null; };
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

    let channel = supabase.channel("admin-activity-mouse");
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

    let kbChannel = supabase.channel("admin-activity-keyboard");
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
      .channel("admin-activity-app-usage")
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
      // Private-bucket rows have no public_url — a storage_path is enough,
      // the URL is signed on ingest below.
      const imageUrl =
        row?.public_url || row?.image_url || row?.thumbnail_url || row?.publicUrl || row?.storage_path;
      if (!imageUrl) return false;
      const displayTs = row?.timestamp || row?.created_at;
      if (!displayTs) return false;
      const tRaw = parseDbTimeMs(displayTs);
      const t = Number.isNaN(tRaw) ? parseDbTimeMs(row?.created_at) : tRaw;
      if (Number.isNaN(t)) return false;
      return t >= startMs && t < endMs;
    };

    // Sign (if private) then prepend. Shared by both realtime subscriptions.
    const ingest = async (incoming) => {
      if (!shouldInclude(incoming)) return;
      const [signed] = await resolveScreenshotUrls([incoming]);
      const row = normalizeRow(signed || incoming);
      if (!row.public_url) return;
      setScreenshots(prev => {
        if (row.id && prev.some(s => s.id === row.id)) return prev;
        // Trim to the same ceiling the fetch uses. Without this an admin page
        // left open accumulated screenshots without limit — every other
        // realtime handler here caps its array, this one did not.
        return [row, ...prev].slice(0, SCREENSHOT_LIMIT);
      });
      setLastUpdated(new Date());
    };

    const ssChannel = supabase
      .channel("admin-activity-screenshots")
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "screenshots",
        filter: `developer_id=eq.${dev.id}`,
      }, (payload) => { ingest(payload.new); })
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "screenshots",
        filter: `developer_email=eq.${dev.email}`,
      }, (payload) => { ingest(payload.new); })
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
      .channel("admin-activity-logins")
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

  // keyboardChartData and perMinuteData used to be computed here on every
  // render. The charts that consumed them are commented out, so both were pure
  // waste — and perMinuteData ran a JSON.parse per keyboard_stats row, up to a
  // thousand of them, on a component that re-renders every 10 seconds from
  // polling and again on each of five realtime channels. Restore them next to
  // whichever chart needs them, inside a useMemo.


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
  // A "Login Status: Blocked / Allowed" card used to be derived here from
  // `todaysLoginCount >= 2`. Nothing in the product blocks anything on that
  // basis — no login path consults it — so the card told admins an account was
  // restricted when it was not, and they could act on that. It is gone rather
  // than relabelled: the only real fact behind it was the login count, and the
  // "Today's Login Count" card next to it already states that plainly.
  // Enforcing a daily login cap is a product decision, not a display fix.

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
    if (s === "idle") return "bg-warning/10 text-warning-on-tint";
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
    /* The screen is the page, not a card: it used to be wrapped in one so its
       heading sat inside a panel at 24px padding. The shared PageHeader owns
       the <h1> now and the panels below carry their own frames. */
    <div>
      <PageHeader
        title={sectionTitle("developer-activity", "admin")}
        description="Sessions, input, applications and screenshots recorded by the desktop tracker."
        actions={
          <Button variant="outline" onClick={refreshAdminData}>
            <RefreshCw aria-hidden="true" />
            Refresh
          </Button>
        }
      />

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
                  // Deliberately a HARD load, unlike the in-app links in this
                  // file. Signing out of a stale session must tear down the
                  // whole document so in-memory auth state and any live
                  // Supabase subscriptions cannot survive the redirect.
                  // Do not "optimise" this into router.push.
                  onClick={() => window.location.href = "/login"}
                  className="text-xs text-info hover:text-info/80 underline"
                >
                  Go to Login
                </button>
              </div>
            )}
            {currentAdmin && fetchingDevelopers && <p className="text-xs text-muted-foreground mt-2">Loading developers...</p>}
            {/* "No developers added by you yet" used to be repeated here as a
                warning line with an underlined pseudo-link beside it. The
                empty state below now says it once, in the place the eye
                already goes when the screen has nothing on it, and carries the
                one action as a real primary Button. */}
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

      {/* Loading — skeletons shaped like the view underneath (tiles, two
          panels, a table) rather than a spinner on a blank page. */}
      {loading && (
        <div className="space-y-6" aria-busy="true">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-20 w-full rounded-xl" />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Skeleton className="h-64 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
          <div className="rounded-xl border border-border p-4">
            <SkeletonTable rows={5} cols={4} />
          </div>
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
                  bg="bg-primary/10"
                />
                {/* <StatCard icon={<Timer className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Today Active Time" value={fmtDuration(totalActiveTime)} bg="bg-success/10" /> */}
                {/* <StatCard icon={<Pause className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Idle Time" value={fmtDuration(totalIdleTime)} bg="bg-destructive/10" /> */}
                <StatCard icon={<MousePointer2 className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Mouse Active %" value={`${avgMouseActive.toFixed(1)}%`} bg="bg-info/10" />
                <StatCard icon={<Target className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Kb Activity %" value={`${avgKeyboardActivity.toFixed(1)}%`} bg="bg-primary/10" />
                <StatCard icon={<Camera className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Screenshots" value={screenshots.length} bg="bg-accent" />
              </div>

              {/* Productivity Chart */}
              {/* {sessionChartData.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-6 shadow-card">
                  <h3 className="text-lg font-semibold text-foreground mb-4">Productivity per Session</h3>
                  <EChart
                    height={300}
                    option={{
                      // #4840DD is the logo tile colour (src/app/icon.svg),
                      // replacing #0c8f6e — the pre-rename green.
                      color: ["#4840DD", "#0ea5e9", "#ef4444"],
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
                        { name: "Productivity %", type: "bar", data: sessionChartData.map((d) => d.score), itemStyle: { color: "#4840DD", borderRadius: [4, 4, 0, 0] } },
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
                    // Fixed row height + truncation with a title: an app with a
                    // 60-character window name no longer makes its row taller
                    // than its neighbours.
                    <ul className="divide-y divide-border rounded-lg border border-border">
                      {topApps.slice(0, 5).map((app, i) => (
                        <li key={i} className="flex h-14 items-center gap-3 px-3">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: rankedColor(i) }}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={app.app}>
                            {app.app}
                          </span>
                          <span className="shrink-0 whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">
                            {fmtMinutesToMinSec(app.totalMinutes || 0)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState
                      icon={Monitor}
                      title="No app usage yet"
                      description="Applications the tracker sees appear here, longest first."
                    />
                  )}
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
                        tooltip: {
                          trigger: "item",
                          // "12.4 min" is a machine's unit. Show the duration
                          // the way a person would say it.
                          formatter: (p) =>
                            `${p.name}<br/><b>${fmtMinutes(p.value)}</b> · ${p.percent.toFixed(0)}%`,
                          ...baseTooltip,
                        },
                        legend: legendFor(appPieData.length, donutLegend),
                        series: [
                          {
                            ...donutBase,
                            // Caption says "top apps", not "tracked": these slices are the top
                            // six only, so the sum is NOT the developer's total
                            // tracked time and must not be labelled as if it were.
                            label: donutCenter(sumValues(appPieData), fmtMinutes, "top apps"),
                            emphasis: donutCenterEmphasis,
                            data: appPieData.map((d, i) => ({
                              value: d.value,
                              name: d.name,
                              // Ranked, so the ramp is indexed by position and
                              // clamped rather than wrapped — slice 7 must not
                              // come back round to the darkest step.
                              itemStyle: { color: rankedColor(i) },
                            })),
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
                <StatCard icon={<TrendingUp className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Avg Active %" value={`${avgMouseActive.toFixed(1)}%`} bg="bg-success/10" />
                <StatCard icon={<TrendingDown className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Avg Idle %" value={`${avgMouseIdle.toFixed(1)}%`} bg="bg-destructive/10" />
                {/* <div className="bg-card p-4 rounded-xl border border-border shadow-card">
                  <div className="flex items-center">
                    <div className={`p-3 rounded-lg mr-3 ${statusColor(latestMouseStatus)}`}><span className="text-xl">Status</span></div>
                    <div>
                      <p className="text-xs text-muted-foreground">Current Status</p>
                      <p className={`text-lg font-bold ${latestMouseStatus.toLowerCase() === "active" ? "text-success" : latestMouseStatus.toLowerCase() === "idle" ? "text-yellow-700" : "text-muted-foreground"}`}>
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
                      <p className="text-2xl font-bold text-success">{avgSessionMouseActive.toFixed(1)}%</p>
                      <p className="text-xs text-muted-foreground">Active %</p>
                    </div>
                    <div className="bg-card p-4 rounded-lg text-center border border-border">
                      <p className="text-2xl font-bold text-destructive">{avgSessionMouseIdle.toFixed(1)}%</p>
                      <p className="text-xs text-muted-foreground">Idle %</p>
                    </div>
                    <div className="bg-card p-4 rounded-lg text-center border border-border">
                      <p className={`text-2xl font-bold ${latestMouseStatus.toLowerCase() === "active" ? "text-success" : "text-warning"}`}>{latestMouseStatus}</p>
                      <p className="text-xs text-muted-foreground">Latest Status</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Mouse Activity Chart: Active vs Idle % Over Time */}
              {mouseChartData.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-6 shadow-card">
                  <h3 className="text-lg font-semibold text-foreground mb-4">Mouse active vs idle over time</h3>
                  <EChart
                    height={300}
                    option={{
                      color: [SEMANTIC.success, SEMANTIC.danger],
                      textStyle,
                      tooltip: {
                        trigger: "axis",
                        valueFormatter: (v) => fmtPct(v, 1),
                        ...baseTooltip,
                      },
                      // Two series, so the legend earns its place; the matching
                      // grid.top keeps it off the plot.
                      legend: legendFor(2, { data: ["Active %", "Idle %"] }),
                      grid: gridWithLegend(2, { bottom: 30 }),
                      xAxis: {
                        ...categoryAxis,
                        boundaryGap: false,
                        name: "Time",
                        nameLocation: "middle",
                        nameGap: 28,
                        data: mouseChartData.map((d) => d.time),
                        // 50 timestamps per page used to overprint each other.
                        axisLabel: timeAxisLabel,
                      },
                      yAxis: {
                        ...valueAxis,
                        name: "Share of minute",
                        nameLocation: "middle",
                        nameGap: 42,
                        max: 100,
                        axisLabel: { ...axisLabel, formatter: "{value}%" },
                      },
                      series: [
                        {
                          name: "Active %",
                          type: "line",
                          smooth: true,
                          showSymbol: false,
                          lineStyle: { width: 2, color: SEMANTIC.success },
                          areaStyle: { color: verticalGradient(SEMANTIC.success) },
                          data: mouseChartData.map((d) => d.active),
                        },
                        {
                          name: "Idle %",
                          type: "line",
                          smooth: true,
                          showSymbol: false,
                          lineStyle: { width: 2, color: SEMANTIC.danger },
                          areaStyle: { color: verticalGradient(SEMANTIC.danger) },
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
                          valueFormatter: (v) => fmtPct(v, 1),
                          ...baseTooltip,
                        },
                        legend: legendFor(2, donutLegend),
                        series: [
                          {
                            ...donutBase,
                            // The two slices sum to 100%, so a total in the hole
                            // would say nothing. The active share is the number
                            // the reader actually came for.
                            label: donutCenter(avgMouseActive, (v) => fmtPct(v), "active"),
                            emphasis: donutCenterEmphasis,
                            data: [
                              { name: "Active", value: Math.round(avgMouseActive * 100) / 100, itemStyle: { color: SEMANTIC.success } },
                              { name: "Idle", value: Math.round(avgMouseIdle * 100) / 100, itemStyle: { color: SEMANTIC.track } },
                            ],
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
                        <tr key={r.id || i} className={`hover:bg-muted/50 ${i === 0 ? "bg-success/10" : ""}`}>
                          <td className="px-4 py-3 text-sm text-muted-foreground">{fmtDateTime(r.created_at)}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-16 bg-muted rounded-full h-2">
                                <div className="bg-success h-2 rounded-full" style={{ width: `${Math.min(r.active_percentage || 0, 100)}%` }}></div>
                              </div>
                              <span className="text-sm font-medium text-success">{(r.active_percentage || 0).toFixed(1)}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-16 bg-muted rounded-full h-2">
                                <div className="bg-destructive h-2 rounded-full" style={{ width: `${Math.min(r.idle_percentage || 0, 100)}%` }}></div>
                              </div>
                              <span className="text-sm font-medium text-destructive">{(r.idle_percentage || 0).toFixed(1)}%</span>
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
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <StatCard icon={<LockKeyhole className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Today's Login Count" value={todaysLoginCount} bg="bg-success/10" />
                <StatCard icon={<Clock1 className="h-5 w-5 text-foreground" aria-hidden="true" />} label="First Login" value={firstLoginTime} bg="bg-info/10" />
                <StatCard icon={<Clock2 className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Second Login" value={secondLoginTime} bg="bg-primary/10" />
              </div>

              <div className="rounded-xl border border-border bg-card p-6 shadow-card">
                <h3 className="text-lg font-semibold text-foreground mb-4">Developer Login Activity ({loginRecords.length})</h3>

                {loginRecords.length === 0 ? (
                  <EmptyState
                    icon={LockKeyhole}
                    title="No login activity recorded"
                    description={`No login records found for this developer on ${selectedDate}.`}
                  />
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
                <EmptyState
                  icon={Keyboard}
                  title="No keyboard activity recorded"
                  description="Keyboard stats appear here once the desktop tracker records typing activity for this session or date range."
                />
              )}

              {/* Keyboard Activity Summary Card */}
              {keyboardData.length > 0 && (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard icon={<Keyboard className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Total Keystrokes" value={totalKeystrokes.toLocaleString()} bg="bg-accent" />
                    <StatCard icon={<Gauge className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Avg WPM" value={avgWPM.toFixed(1)} bg="bg-success/10" />
                    <StatCard icon={<Target className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Activity Score" value={avgKeyboardScore.toFixed(1)} bg="bg-warning/10" />
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
                    <StatCard icon={<Timer className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Active Time" value={`${totalKbActiveTime.toFixed(1)} min`} bg="bg-success/10" />
                    <StatCard icon={<Pause className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Idle Time" value={`${totalKbIdleTime.toFixed(1)} min`} bg="bg-destructive/10" />
                    <StatCard icon={<Type className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Unique Keys" value={totalUniqueKeys.toLocaleString()} bg="bg-info/10" />
                    <StatCard icon={<Clock className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Total Time" value={`${totalKbTime.toFixed(1)} min`} bg="bg-muted" />
                  </div>

                  {/* Active Session Keyboard Summary */}
                  {activeSession && sessionKeyboardData.length > 0 && (
                    <div className="rounded-xl border border-border bg-accent p-6">
                      <h3 className="text-lg font-semibold mb-4 text-accent-foreground">
                        Active Session Keyboard Activity
                        <span className="text-sm font-normal ml-2 text-muted-foreground">({sessionKeyboardData.length} records)</span>
                      </h3>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-card p-4 rounded-lg text-center border border-border">
                          <p className="text-2xl font-bold text-foreground">{sessionTotalKeys.toLocaleString()}</p>
                          <p className="text-xs text-muted-foreground">Keystrokes</p>
                        </div>
                        <div className="bg-card p-4 rounded-lg text-center border border-border">
                          <p className="text-2xl font-bold text-success">{sessionAvgWPM.toFixed(1)}</p>
                          <p className="text-xs text-muted-foreground">WPM</p>
                        </div>
                        <div className="bg-card p-4 rounded-lg text-center border border-border">
                          <p className="text-2xl font-bold text-primary">{sessionAvgKbActivity.toFixed(1)}%</p>
                          <p className="text-xs text-muted-foreground">Activity %</p>
                        </div>
                        <div className="bg-card p-4 rounded-lg text-center border border-border">
                          <p className={`text-2xl font-bold ${sessionAvgScore >= 80 ? "text-success" : sessionAvgScore >= 60 ? "text-warning" : "text-destructive"}`}>{sessionAvgScore.toFixed(1)}</p>
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
                              formatter: (p) =>
                                `${p.name}<br/><b>${fmtMinutes(p.value)}</b> · ${p.percent.toFixed(0)}%`,
                              ...baseTooltip,
                            },
                            legend: legendFor(2, donutLegend),
                            series: [
                              {
                                ...donutBase,
                                label: donutCenter(
                                  totalKbActiveTime + totalKbIdleTime,
                                  fmtMinutes,
                                  "tracked"
                                ),
                                emphasis: donutCenterEmphasis,
                                data: [
                                  { name: "Active", value: Math.round(totalKbActiveTime * 100) / 100, itemStyle: { color: SEMANTIC.success } },
                                  // Idle is the absence of work, not a fault:
                                  // the inert track tint rather than the red
                                  // that means "rejected" everywhere else.
                                  { name: "Idle", value: Math.round(totalKbIdleTime * 100) / 100, itemStyle: { color: SEMANTIC.track } },
                                ],
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
                            <tr key={r.id || i} className={`hover:bg-muted/50 ${i === 0 ? "bg-accent" : ""}`}>
                              <td className="px-4 py-3 text-sm text-muted-foreground">{fmtDateTime(r.tracked_at)}</td>
                              <td className="px-4 py-3 text-sm font-medium">{(r.total_keys || 0).toLocaleString()}</td>
                              <td className="px-4 py-3 text-sm">{r.unique_keys || 0}</td>
                              <td className="px-4 py-3 text-sm font-medium text-success">{(r.words_per_minute || 0).toFixed(1)}</td>
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
                              <td className="px-4 py-3 text-sm text-success">{(r.active_time_minutes || 0).toFixed(1)}m</td>
                              <td className="px-4 py-3 text-sm text-destructive">{(r.idle_time_minutes || 0).toFixed(1)}m</td>
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
                {/* <StatCard icon={<BarChart3 className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Usage Records" value={appUsageData.length} bg="bg-success/10" /> */}
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
                  bg="bg-accent"
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
                      <p className="text-2xl font-bold text-warning">{(currentApp.duration_minutes || 0).toFixed(1)} min</p>
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
                      <p className="text-2xl font-bold text-success">{sessionAppData.reduce((s, r) => s + (r.duration_minutes || 0), 0).toFixed(1)}</p>
                      <p className="text-xs text-muted-foreground">Total Minutes</p>
                    </div>
                    <div className="bg-card p-4 rounded-lg text-center border border-border">
                      <p className="text-2xl font-bold text-foreground">{sessionAppData.length}</p>
                      <p className="text-xs text-muted-foreground">App Switches</p>
                    </div>
                    <div className="bg-card p-4 rounded-lg text-center border border-border">
                      <p className="text-2xl font-bold text-warning">{sessionAppData.filter(r => r.is_new_app).length}</p>
                      <p className="text-xs text-muted-foreground">New Apps</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Top Applications */}
              {topApps.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-6 shadow-card">
                  <h3 className="text-lg font-semibold text-foreground mb-4">Top Applications</h3>
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {topApps.map((app, i) => (
                      <li key={i} className="flex h-16 items-center gap-3 px-3">
                        <span className="w-6 shrink-0 text-right text-xs font-semibold tabular-nums text-muted-foreground">
                          #{i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground" title={app.app}>{app.app}</p>
                          <p className="text-xs tabular-nums text-muted-foreground">
                            {app.count} usage{app.count !== 1 ? "s" : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <div className="hidden h-2 w-24 overflow-hidden rounded-full bg-muted md:block">
                            <div
                              className="h-2 rounded-full"
                              style={{
                                width: `${Math.min(app.pct, 100)}%`,
                                // Same ranked ramp, same index, as the donut on
                                // this tab — the list and the chart are two
                                // views of one ordering and must agree.
                                backgroundColor: rankedColor(i),
                              }}
                            />
                          </div>
                          <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                            {app.pct.toFixed(0)}%
                          </span>
                          <span className="w-20 whitespace-nowrap text-right font-mono text-xs tabular-nums text-foreground">
                            {fmtMinutes(app.totalMinutes)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
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
                          formatter: (p) =>
                            `${p.name}<br/><b>${fmtMinutes(p.value)}</b> · ${p.percent.toFixed(0)}%`,
                          ...baseTooltip,
                        },
                        legend: legendFor(appPieData.length, donutLegend),
                        series: [
                          {
                            ...donutBase,
                            // Caption says "top apps", not "tracked": these slices are the top
                            // six only, so the sum is NOT the developer's total
                            // tracked time and must not be labelled as if it were.
                            label: donutCenter(sumValues(appPieData), fmtMinutes, "top apps"),
                            emphasis: donutCenterEmphasis,
                            data: appPieData.map((d, i) => ({
                              value: d.value,
                              name: d.name,
                              itemStyle: { color: rankedColor(i) },
                            })),
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
                      // One row per app at a readable band instead of eight
                      // squeezed into a fixed 300px box.
                      height={heightForRows(appBarData.length, {
                        perRow: 30,
                        chrome: 76,
                        min: 200,
                      })}
                      option={{
                        textStyle,
                        // Nominal bars, so every bar takes the same hue: the bar
                        // length already encodes the magnitude, and colouring by
                        // value would spend the identity channel saying it twice.
                        legend: legendFor(1),
                        grid: gridWithLegend(1, { bottom: 30 }),
                        tooltip: {
                          trigger: "axis",
                          axisPointer: { type: "shadow" },
                          // Was a bespoke three-branch formatter that fell back
                          // to a raw HH:MM:SS clock past an hour. One shared
                          // duration format now covers every branch: "42s",
                          // "7m", "1h 35m".
                          valueFormatter: (v) => fmtMinutes(v),
                          ...baseTooltip,
                        },
                        xAxis: {
                          ...valueAxis,
                          name: "Time spent",
                          nameLocation: "middle",
                          nameGap: 28,
                          axisLabel: { ...axisLabel, formatter: (v) => fmtMinutes(v) },
                        },
                        yAxis: {
                          ...categoryAxis,
                          data: appBarData.map((d) => d.name),
                          inverse: true,
                          // App names are arbitrary length; truncate at a fixed
                          // width and drop any that still collide. 11px matches
                          // every other axis in the app.
                          axisLabel: {
                            ...axisLabel,
                            width: 120,
                            overflow: "truncate",
                            hideOverlap: true,
                          },
                        },
                        series: [
                          {
                            name: "Time spent",
                            type: "bar",
                            barMaxWidth: 18,
                            data: appBarData.map((d) => d.minutes),
                            itemStyle: roundedBarH(PRIMARY),
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
                              <span className="bg-info/10 text-info-on-tint px-3 py-1 rounded-full text-xs whitespace-nowrap">{formattedDuration}</span>
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
                          {r.is_new_app && <span className="px-1.5 py-0.5 text-xs bg-warning/10 text-warning-on-tint rounded">NEW</span>}
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
                <StatCard icon={<Camera className="h-5 w-5 text-foreground" aria-hidden="true" />} label="Total Screenshots" value={screenshots.length} bg="bg-accent" />
                {screenshots.length > 0 && (
                  <div className="bg-card p-4 rounded-xl border border-border shadow-card">
                    <div className="flex items-center">
                      <div className="bg-success/10 p-3 rounded-lg mr-3 flex items-center justify-center">
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
                  <h4 className="text-sm font-semibold text-warning mb-2">Debug: No screenshots found</h4>
                  <div className="text-xs text-yellow-700 space-y-1">
                    <p><strong>Developer ID:</strong> {developer.id}</p>
                    <p><strong>Developer Email:</strong> {developer.email}</p>
                    <p><strong>Date Filter:</strong> {selectedDate} ({timeRange})</p>
                    <p>Check browser console for <code>[Screenshots]</code> logs showing query results and errors.</p>
                    <p className="mt-2 text-warning">Common causes: RLS policy blocking reads, developer_id/email mismatch, or date filter excluding data.</p>
                    <button
                      onClick={async () => {
                        const { data, error } = await supabase
                          .from("screenshots")
                          .select("id, developer_id, developer_email, public_url, image_url, thumbnail_url, storage_path, timestamp, created_at")
                          .limit(5);
                        showPre(
                          "Screenshot diagnostics",
                          error
                            ? `RLS Error: ${error.message}`
                            : `Found ${data?.length || 0} total screenshots.\n${
                                data?.length
                                  ? `Sample: developer_email=${data[0].developer_email}, developer_id=${data[0].developer_id}, has_url=${Boolean(data[0].public_url || data[0].image_url || data[0].thumbnail_url)}, storage_path=${data[0].storage_path || "(none)"}`
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
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                    {screenshots.map((ss, i) => (
                      <ScreenshotTile
                        key={ss.id || i}
                        shot={ss}
                        index={i}
                        latest={i === 0}
                        time={fmtDbExactTime(ss.timestamp || ss.created_at)}
                        onSelect={() => setSelectedScreenshot(ss)}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    icon={Camera}
                    title={
                      timeRange === "today" && selectedDate === new Date().toLocaleDateString("en-CA")
                        ? "No screenshots today"
                        : "No screenshots in this period"
                    }
                    description="Captures appear here while the desktop tracker is running for this developer."
                  />
                )}
              </div>

              {/* Screenshot Timeline */}
              {screenshots.length > 0 && (
                <div className="rounded-xl border border-border bg-card p-6 shadow-card">
                  <h3 className="text-lg font-semibold text-foreground mb-4">Screenshot Timeline</h3>
                  <div className="max-h-96 space-y-2 overflow-y-auto">
                    {screenshots.map((ss, i) => (
                      // Fixed row height + a reserved 64×48 thumb slot: the row
                      // is the same size whether the image has arrived or not.
                      <button
                        type="button"
                        key={ss.id || i}
                        className={`flex h-16 w-full items-center gap-4 rounded-lg border bg-card px-3 text-left transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                          i === 0 ? "border-primary" : "border-border"
                        }`}
                        onClick={() => setSelectedScreenshot(ss)}
                      >
                        <div className="w-16 shrink-0 text-center">
                          <p className="text-sm font-semibold tabular-nums text-foreground">
                            {fmtDbExactTime(ss.timestamp || ss.created_at)}
                          </p>
                          {i === 0 && <span className="text-xs text-primary">Latest</span>}
                        </div>
                        <div className="h-10 w-px shrink-0 bg-border" />
                        <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded border border-border bg-muted">
                          {ss.public_url ? (
                            <img
                              src={ss.public_url}
                              alt=""
                              className="absolute inset-0 h-full w-full object-cover"
                              loading="lazy"
                              decoding="async"
                            />
                          ) : (
                            <span className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                              N/A
                            </span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground" title={ss.app_active || "Unknown app"}>
                            {ss.app_active || "Unknown app"}
                          </p>
                          <p className="truncate text-xs text-muted-foreground" title={ss.filename || "screenshot"}>
                            {ss.filename || "screenshot"}
                          </p>
                        </div>
                        <div className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                          {ss.size_kb && <p>{Number(ss.size_kb).toFixed(0)} KB</p>}
                          {ss.width && ss.height && <p>{ss.width}×{ss.height}</p>}
                        </div>
                      </button>
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

              {/* Screenshot details — Modal gives focus trap, Escape and
                  focus restoration, which the hand-rolled overlay never had. */}
              <Modal
                open={Boolean(selectedScreenshot)}
                onClose={() => setSelectedScreenshot(null)}
                title="Screenshot details"
                description={selectedScreenshot?.app_active || undefined}
                size="xl"
              >
                {selectedScreenshot && (
                  <div className="flex flex-col gap-5 md:flex-row">
                    <div className="flex min-h-[240px] flex-1 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
                      {selectedScreenshot.public_url ? (
                        <img
                          src={selectedScreenshot.public_url}
                          alt={selectedScreenshot.filename || "Screenshot"}
                          className="max-h-[60vh] max-w-full object-contain"
                          decoding="async"
                        />
                      ) : (
                        <p className="p-8 text-center text-sm text-muted-foreground">No image available</p>
                      )}
                    </div>

                    <dl className="w-full shrink-0 space-y-4 md:w-64">
                      {[
                        { label: "Filename", value: selectedScreenshot.filename, wrap: true },
                        {
                          label: "Timestamp",
                          value: fmtDbExactTime(selectedScreenshot.timestamp || selectedScreenshot.created_at),
                        },
                        {
                          label: "Resolution",
                          value:
                            selectedScreenshot.width && selectedScreenshot.height
                              ? `${selectedScreenshot.width} × ${selectedScreenshot.height}`
                              : null,
                        },
                        {
                          label: "File size",
                          value: selectedScreenshot.size_kb
                            ? `${Number(selectedScreenshot.size_kb).toFixed(1)} KB`
                            : null,
                        },
                        { label: "MIME type", value: selectedScreenshot.mime_type },
                        { label: "Developer", value: selectedScreenshot.developer_email, wrap: true },
                      ].map((row) => (
                        <div key={row.label}>
                          <dt className="text-xs uppercase tracking-wide text-muted-foreground">{row.label}</dt>
                          <dd
                            className={`text-sm font-medium tabular-nums text-foreground ${
                              row.wrap ? "break-all" : ""
                            }`}
                          >
                            {row.value || "—"}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}
              </Modal>
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
                            <span className="px-3 py-1 bg-info/10 text-info-on-tint rounded-full text-xs">
                              Active: {fmtDuration(session.active_duration)}
                            </span>
                            <span className="px-3 py-1 bg-destructive/10 text-red-800 rounded-full text-xs">
                              Idle: {fmtDuration(session.idle_duration)}
                            </span>
                            {(session.mouse_events > 0 || session.mouse_clicks > 0) && (
                              <span className="px-3 py-1 bg-success/10 text-green-800 rounded-full text-xs">
                                Mouse: {session.mouse_events || session.mouse_clicks || 0}
                              </span>
                            )}
                            {(session.keyboard_events > 0 || session.keystrokes > 0) && (
                              <span className="px-3 py-1 bg-accent text-violet-700 rounded-full text-xs">
                                Keyboard: {session.keyboard_events || session.keystrokes || 0}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded ${session.status === "active" ? "bg-success/10 text-green-800" : "bg-muted text-foreground"}`}>
                          {session.status === "active" && (
                            <span className="inline-block w-2 h-2 bg-success rounded-full mr-1 animate-pulse"></span>
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

      {/* No Data State — the shared dashed-border EmptyState, like every other
          screen, instead of this file's own bare centred icon. */}
      {!loading && selectedDeveloper && !hasData && viewMode !== "logins" && (
        <EmptyState
          icon={Monitor}
          title="No activity data found for selected period"
          description={`Make sure the developer has tracking sessions on ${selectedDate}`}
        />
      )}

      {/* No Developer Selected */}
      {!selectedDeveloper && !loading && (
        currentAdmin ? (
          fetchingDevelopers ? null : developers.length === 0 ? (
            /* Nothing to choose from, so "pick someone from the list above" is
               not the message — adding the first developer is. It is the only
               action on the screen, so it is the default (primary) Button. */
            <EmptyState
              icon={User}
              title="No developers yet"
              description="Add a developer to this organization and their tracked sessions, input and screenshots will show up here."
              action={
                <Button
                  // In-app route change: router.push keeps the shell mounted.
                  // A window.location assignment here reloaded the whole
                  // document — flash, lost scroll, shell rebuilt from scratch.
                  onClick={() => router.push("/admin/dashboard?section=add-developer")}
                >
                  Add a Developer
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={User}
              title="Select a developer to view activity data"
              description="Pick someone from the Select Developer list above to see their sessions, input and screenshots."
            />
          )
        ) : (
          <EmptyState
            icon={LockKeyhole}
            title="Please login to access developer activity"
            description="Only admins can view developer activity data"
            action={
              /* Hard load on purpose — see the note on the other Go to Login
                 button: the stale session and its subscriptions must die with
                 the document. Not a candidate for router.push. */
              <Button onClick={() => window.location.href = "/login"}>Go to Login</Button>
            }
          />
        )
      )}
    </div>
  );
}

// ─── Screenshot tile ───
/**
 * The 16:9 frame is painted before the image exists and keeps its size in
 * every state, so a screenshot landing (or failing) never reflows the grid —
 * previously a fixed `h-40` img with no placeholder left a blank hole that
 * filled in one row at a time as the network caught up.
 */
function ScreenshotTile({ shot, index, latest, time, onSelect }) {
  const [state, setState] = useState(shot?.public_url ? "loading" : "failed");
  const app = shot?.app_active || "Unknown app";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`overflow-hidden rounded-lg border bg-card text-left transition-shadow duration-150 hover:shadow-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
        latest ? "border-primary" : "border-border"
      }`}
    >
      <div className="relative aspect-video w-full bg-muted">
        {shot?.public_url && state !== "failed" && (
          <img
            src={shot.public_url}
            alt={shot.filename || `Screenshot ${index + 1}`}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-150 ${
              state === "loaded" ? "opacity-100" : "opacity-0"
            }`}
            loading="lazy"
            decoding="async"
            onLoad={() => setState("loaded")}
            onError={() => setState("failed")}
          />
        )}
        {state === "failed" && (
          <span className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            No preview
          </span>
        )}
        {state === "loading" && <Skeleton className="absolute inset-0 h-full w-full rounded-none" />}
      </div>

      <div className="space-y-1 p-3">
        <div className="flex items-center gap-1">
          <Monitor className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="truncate text-xs font-medium text-foreground" title={app}>{app}</p>
        </div>
        <p className="text-xs tabular-nums text-muted-foreground">{time}</p>
        <div className="flex items-center justify-between text-xs tabular-nums text-muted-foreground">
          <span>{shot?.size_kb ? `${Number(shot.size_kb).toFixed(0)} KB` : ""}</span>
          <span>{shot?.width && shot?.height ? `${shot.width}×${shot.height}` : ""}</span>
        </div>
        {latest && (
          <span className="inline-block rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            Latest
          </span>
        )}
      </div>
    </button>
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