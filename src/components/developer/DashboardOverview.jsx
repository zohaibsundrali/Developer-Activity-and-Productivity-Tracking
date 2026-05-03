"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/utils/supabaseClient";

export default function DashboardTimeTracking({ user, assignedProjects = [] }) {
  const [dailyTotals, setDailyTotals] = useState({});
  const [weeklyTotals, setWeeklyTotals] = useState([]);
  const [totalTime, setTotalTime] = useState("00:00");
  const [recentProjects, setRecentProjects] = useState([]);
  const [todayTrackedTime, setTodayTrackedTime] = useState("00:00:00");
  const [taskStats, setTaskStats] = useState({ completed: 0, pending: 0 });

  const userId = user?.id || null;
  const userEmail = user?.email || null;

  useEffect(() => {
    async function fetchTaskStats() {
      if (!userId) return;
      const { data, error } = await supabase
        .from("developer_tasks")
        .select("status")
        .eq("developer_id", userId);

      if (!error && data) {
        let completed = 0;
        let pending = 0;
        data.forEach(t => {
          if (t.status === "completed") completed++;
          else pending++;
        });
        setTaskStats({ completed, pending });
      }
    }
    fetchTaskStats();
  }, [userId]);


  // Debounce realtime-driven refreshes (multiple events can fire quickly).
  const refreshDebounceRef = useRef(null);

  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();

  const getStatusBadge = useCallback((status) => {
    const s = String(status || "pending").toLowerCase();
    if (s === "completed") {
      return { label: "Completed", className: "bg-green-100 text-green-700" };
    }
    if (s === "in_progress" || s === "in progress" || s === "active") {
      return { label: "In progress", className: "bg-blue-100 text-blue-700" };
    }
    if (s === "on_hold" || s === "on hold") {
      return { label: "On hold", className: "bg-yellow-100 text-yellow-800" };
    }
    if (s === "cancelled" || s === "canceled") {
      return { label: "Cancelled", className: "bg-red-100 text-red-700" };
    }
    return { label: "Pending", className: "bg-gray-100 text-gray-700" };
  }, []);

  const formatUpdatedAt = useCallback((value) => {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString(undefined, {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, []);

  const parseTimeMs = useCallback((value) => {
    if (!value) return 0;
    const d = new Date(value);
    const ms = d.getTime();
    return Number.isNaN(ms) ? 0 : ms;
  }, []);

  // ⏱ Minutes → HH:MM
  const formatMinutes = useCallback((mins) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }, []);

  // ⏱ Seconds → HH:MM:SS
  const formatSeconds = useCallback((totalSeconds) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, []);

  // ⏱ Fetch Today's Tracked Time
  const loadTodayTrackedTime = useCallback(async () => {
    if (!userId && !userEmail) return;

    // Match Admin behavior: use local date components but build UTC boundaries.
    const now = new Date();
    const yy = now.getFullYear();
    const mm = now.getMonth() + 1;
    const dd = now.getDate();
    const dayStart = new Date(Date.UTC(yy, (mm || 1) - 1, dd || 1, 0, 0, 0, 0));
    const dayEnd = new Date(Date.UTC(yy, (mm || 1) - 1, dd || 1, 0, 0, 0, 0));
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    // Use the same filter that works in the Sessions page.
    // Fallback to ids only if email isn't available.
    let query = supabase
      .from("productivity_sessions")
      .select("total_duration")
      .gte("start_time", dayStart.toISOString())
      .lt("start_time", dayEnd.toISOString());

    if (userEmail) {
      query = query.eq("user_email", userEmail);
    } else if (userId) {
      query = query.or(`user_id.eq.${userId},developer_id.eq.${userId}`);
    } else {
      return;
    }

    const { data, error } = await query;

    if (!error && data) {
      const totalSeconds = data.reduce((sum, session) => sum + (Number(session.total_duration) || 0), 0);
      setTodayTrackedTime(formatSeconds(totalSeconds));
    } else if (error) {
      // Keep UI stable; surface details for debugging.
      console.error("[Developer Dashboard] Failed to load today's tracked time:", error);
    }
  }, [userId, userEmail, formatSeconds]);

  // 📊 Fetch time data
  const loadTimeData = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from("time_entries")
      .select("*")
      .eq("user_id", userId);

    if (error) {
      return;
    }

    let daily = {};
    let weekly = {};
    let totalMinutes = 0;

    data.forEach((entry) => {
      const date = new Date(entry.start_time);
      if (
        date.getMonth() + 1 !== currentMonth ||
        date.getFullYear() !== currentYear
      )
        return;

      const dayKey = date.toISOString().split("T")[0];
      daily[dayKey] = (daily[dayKey] || 0) + entry.duration_minutes;

      const week = Math.ceil(date.getDate() / 7);
      weekly[week] = (weekly[week] || 0) + entry.duration_minutes;

      totalMinutes += entry.duration_minutes;
    });

    Object.keys(daily).forEach(
      (k) => (daily[k] = formatMinutes(daily[k]))
    );

    setDailyTotals(daily);
    setWeeklyTotals(
      Object.keys(weekly).map((w) => ({
        label: `Week ${w}`,
        hours: formatMinutes(weekly[w]),
      }))
    );
    setTotalTime(formatMinutes(totalMinutes));
  }, [userId, currentMonth, currentYear, formatMinutes]);

  // 📁 Recent Projects
  const loadProjects = useCallback(async () => {
    if (!userId) return;

    // Goal: show up to 3 projects. Rank by an "effective" timestamp:
    // - prefer this developer's latest task activity within the project
    // - otherwise fall back to project updated_at/created_at
    // This prevents a third project from being dropped just because it has no tasks yet.

    const keyOf = (value) => (value === null || value === undefined ? "" : String(value));

    // 1) Fetch this developer's recent task activity (used only for ordering + labels).
    const { data: taskRows, error: tasksError } = await supabase
      .from("developer_tasks")
      .select("project_id, updated_at, submitted_at, created_at")
      .eq("developer_id", userId)
      .order("updated_at", { ascending: false })
      .order("submitted_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(2000);

    const activityMsByProjectKey = new Map();
    const rawProjectIdByKey = new Map();

    if (!tasksError && Array.isArray(taskRows)) {
      for (const row of taskRows) {
        const projectId = row?.project_id;
        if (!projectId) continue;

        const projectKey = keyOf(projectId);
        if (!projectKey) continue;

        rawProjectIdByKey.set(projectKey, projectId);
        const ms = Math.max(
          parseTimeMs(row.updated_at),
          parseTimeMs(row.submitted_at),
          parseTimeMs(row.created_at)
        );
        const current = activityMsByProjectKey.get(projectKey) || 0;
        if (ms > current) activityMsByProjectKey.set(projectKey, ms);
      }
    } else if (tasksError) {
      console.error(
        "[Developer Dashboard] Failed to load developer task activity:",
        tasksError
      );
    }

    // 2) Build candidate project list.
    // Prefer assignedProjects when present, but also fetch projects for the top activity IDs
    // in case assignedProjects is missing/incomplete.
    const candidatesByKey = new Map();

    if (Array.isArray(assignedProjects)) {
      for (const p of assignedProjects) {
        const projectKey = keyOf(p?.id);
        if (!projectKey) continue;
        candidatesByKey.set(projectKey, p);
      }
    }

    const activityTopKeys = Array.from(activityMsByProjectKey.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([k]) => k);

    const missingActivityRawIds = activityTopKeys
      .filter((k) => !candidatesByKey.has(k))
      .map((k) => rawProjectIdByKey.get(k))
      .filter(Boolean);

    if (missingActivityRawIds.length > 0) {
      const { data: projRows, error: projError } = await supabase
        .from("projects")
        .select("id, name, description, status, updated_at, created_at")
        .in("id", missingActivityRawIds)
        .eq("assigned_developer_id", userId);

      if (projError) {
        console.error(
          "[Developer Dashboard] Failed to hydrate activity projects:",
          projError
        );
      } else if (Array.isArray(projRows)) {
        for (const p of projRows) {
          const projectKey = keyOf(p?.id);
          if (!projectKey) continue;
          candidatesByKey.set(projectKey, p);
        }
      }
    }

    // If the caller passed an incomplete assignedProjects list, ensure we still have enough
    // candidates to show up to 3 by hydrating a small set from the DB.
    if (candidatesByKey.size > 0 && candidatesByKey.size < 3) {
      const { data: projRows, error: projError } = await supabase
        .from("projects")
        .select("id, name, description, status, updated_at, created_at")
        .eq("assigned_developer_id", userId)
        .order("updated_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(25);

      if (!projError) {
        for (const p of projRows || []) {
          const projectKey = keyOf(p?.id);
          if (!projectKey) continue;
          candidatesByKey.set(projectKey, p);
        }
      }
    }

    // If we still don't have any candidates, fetch the most recently updated assigned projects.
    if (candidatesByKey.size === 0) {
      const { data: projRows, error: projError } = await supabase
        .from("projects")
        .select("id, name, description, status, updated_at, created_at")
        .eq("assigned_developer_id", userId)
        .order("updated_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(25);

      if (projError) {
        console.error(
          "[Developer Dashboard] Failed to load recent projects:",
          projError
        );
        setRecentProjects([]);
        return;
      }

      for (const p of projRows || []) {
        const projectKey = keyOf(p?.id);
        if (!projectKey) continue;
        candidatesByKey.set(projectKey, p);
      }
    }

    // 3) Rank candidates by effective timestamp and take up to 3.
    const ranked = Array.from(candidatesByKey.values())
      .map((p) => {
        const projectKey = keyOf(p?.id);
        const projectMs = Math.max(parseTimeMs(p?.updated_at), parseTimeMs(p?.created_at));
        const activityMs = activityMsByProjectKey.get(projectKey) || 0;
        const effectiveMs = Math.max(projectMs, activityMs);

        return {
          id: p.id,
          name: p.name,
          description: p.description,
          status: p.status,
          updated_at: p.updated_at,
          created_at: p.created_at,
          activity_at: activityMs ? new Date(activityMs).toISOString() : undefined,
          __effectiveMs: effectiveMs,
        };
      })
      .sort((a, b) => b.__effectiveMs - a.__effectiveMs)
      .slice(0, 3)
      .map(({ __effectiveMs, ...rest }) => rest);

    setRecentProjects(ranked);
  }, [assignedProjects, userId, parseTimeMs]);

  // 🔴 REAL-TIME SUBSCRIPTION
  useEffect(() => {
    if (!userId && !userEmail) return;

    const scheduleRefresh = () => {
      if (refreshDebounceRef.current) {
        clearTimeout(refreshDebounceRef.current);
      }

      refreshDebounceRef.current = setTimeout(() => {
        void Promise.all([
          loadTimeData(),
          loadProjects(),
          loadTodayTrackedTime(),
        ]);
      }, 250);
    };

    // Initial load
    const initialLoadTimer = setTimeout(scheduleRefresh, 0);

    // Realtime subscriptions (scoped to this developer where possible)
    const timeEntriesChannel = supabase
      .channel(`dev-dashboard-time-entries:${userId || "anon"}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "time_entries",
          ...(userId ? { filter: `user_id=eq.${userId}` } : {}),
        },
        scheduleRefresh
      )
      .subscribe();

    const sessionsChannel = supabase
      .channel(`dev-dashboard-sessions:${userEmail || userId || "anon"}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "productivity_sessions",
          ...(userEmail ? { filter: `user_email=eq.${userEmail}` } : {}),
        },
        scheduleRefresh
      )
      .subscribe();

    const tasksChannel = supabase
      .channel(`dev-dashboard-tasks:${userId || "anon"}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "developer_tasks",
          ...(userId ? { filter: `developer_id=eq.${userId}` } : {}),
        },
        scheduleRefresh
      )
      .subscribe();

    // Polling fallback (mirrors Admin's approach for resilience)
    const pollId = setInterval(scheduleRefresh, 10_000);

    return () => {
      clearTimeout(initialLoadTimer);
      clearInterval(pollId);

      if (refreshDebounceRef.current) {
        clearTimeout(refreshDebounceRef.current);
        refreshDebounceRef.current = null;
      }

      supabase.removeChannel(timeEntriesChannel);
      supabase.removeChannel(sessionsChannel);
      supabase.removeChannel(tasksChannel);
    };
  }, [userId, userEmail, loadProjects, loadTimeData, loadTodayTrackedTime]);

  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

      {/* LEFT PANEL */}
      <div className="lg:col-span-2 space-y-6">
        {/* Profile Card */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 sm:p-8 text-black">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
            <div className="w-24 h-24 rounded-full bg-gray-100 border border-gray-300 flex items-center justify-center text-4xl font-bold text-[#009578]">
              {user?.name?.charAt(0)?.toUpperCase() || user?.full_name?.charAt(0)?.toUpperCase() || "D"}
            </div>
            <div className="flex-1 text-center sm:text-left">
              <h2 className="text-2xl text-[#009578] font-bold mb-1">{user?.name || user?.full_name || "Developer"}</h2>
              <p className="text-gray-600 mb-4 flex items-center justify-center sm:justify-start gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                {userEmail}
              </p>
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3">
                <span className="px-3 py-1 rounded-full bg-gray-100 text-black text-sm font-medium border border-gray-200">
                  {user?.role || "Software Developer"}
                </span>
                <span className="px-3 py-1 rounded-full bg-gray-100 text-black text-sm font-medium border border-gray-200 flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                  Joined {user?.created_at ? new Date(user.created_at).toLocaleDateString() : new Date().toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
            <h3 className="text-gray-600 text-sm font-medium mb-1">Total Projects</h3>
            <p className="text-3xl font-bold text-black">{assignedProjects?.length || recentProjects?.length || 0}</p>
          </div>

        </div>

        {/* Recent Activity Card */}

      </div>

      {/* RIGHT PANEL */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">Today’s Tracked Time</h3>
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-center">
            <p className="text-3xl font-bold text-[#009578]">{todayTrackedTime}</p>
            {/* <p className="text-sm text-gray-500 mt-1">Completed Sessions</p> */}
          </div>
        </div>

        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold">Most recent activity</h3>

          </div>

        </div>

        {recentProjects.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 p-10 text-center">
            <p className="text-sm text-gray-500">No projects to display</p>
            <p className="text-xs text-gray-400 mt-1">Projects assigned to you will appear here.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {recentProjects.map((p) => {
              const badge = getStatusBadge(p.status);
              const updated = formatUpdatedAt(p.activity_at || p.updated_at || p.created_at);
              const desc = (p.description || "").trim();

              return (
                <div
                  key={p.id}
                  className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm hover:border-gray-300 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{p.name}</p>
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                        {desc || "No description provided."}
                      </p>
                    </div>
                    <span className={`shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${badge.className}`}>
                      {badge.label}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                    <span>Last activity</span>
                    <span className="font-medium text-gray-700">{updated}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
