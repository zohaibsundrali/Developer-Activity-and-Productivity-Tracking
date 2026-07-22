"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/utils/supabaseClient";
import { Mail, CalendarDays, FolderKanban, CheckCircle2, Clock, Timer } from "lucide-react";
import StatCard from "@/components/shell/StatCard";

export default function DashboardOverview({ user, assignedProjects = [] }) {
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
      return { label: "In progress", className: "bg-info/10 text-info" };
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
          loadProjects(),
          loadTodayTrackedTime(),
        ]);
      }, 250);
    };

    // Initial load
    const initialLoadTimer = setTimeout(scheduleRefresh, 0);

    // Realtime subscriptions (scoped to this developer where possible)
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

      supabase.removeChannel(sessionsChannel);
      supabase.removeChannel(tasksChannel);
    };
  }, [userId, userEmail, loadProjects, loadTodayTrackedTime]);

  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();

  return (
    <div className="space-y-6">
      {/* Profile Card */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-card sm:p-7">
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-3xl font-bold text-primary">
            {user?.name?.charAt(0)?.toUpperCase() || user?.full_name?.charAt(0)?.toUpperCase() || "D"}
          </div>
          <div className="flex-1 text-center sm:text-left">
            <h2 className="text-xl font-bold text-foreground">{user?.name || user?.full_name || "Developer"}</h2>
            <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-muted-foreground sm:justify-start">
              <Mail className="h-4 w-4" />
              {userEmail}
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-foreground">
                {user?.role || "Software Developer"}
              </span>
              <span className="flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-foreground">
                <CalendarDays className="h-3.5 w-3.5" />
                Joined {user?.created_at ? new Date(user.created_at).toLocaleDateString() : new Date().toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Projects" value={assignedProjects?.length || recentProjects?.length || 0} icon={FolderKanban} tone="primary" />
        <StatCard title="Completed Tasks" value={taskStats.completed} icon={CheckCircle2} tone="success" />
        <StatCard title="Pending Tasks" value={taskStats.pending} icon={Clock} tone="warning" />
        <StatCard title="Today's Tracked Time" value={todayTrackedTime} icon={Timer} tone="info" />
      </div>

      {/* Recent projects */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-card">
        <h3 className="mb-4 text-base font-semibold text-foreground">Most recent activity</h3>

        {recentProjects.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-center">
            <p className="text-sm font-medium text-muted-foreground">No projects to display</p>
            <p className="mt-1 text-xs text-muted-foreground">Projects assigned to you will appear here.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recentProjects.map((p) => {
              const badge = getStatusBadge(p.status);
              const updated = formatUpdatedAt(p.activity_at || p.updated_at || p.created_at);
              const desc = (p.description || "").trim();

              return (
                <div
                  key={p.id}
                  className="rounded-lg border border-border bg-card p-4 shadow-card transition-colors hover:border-primary/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{p.name}</p>
                    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium ${badge.className}`}>
                      {badge.label}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {desc || "No description provided."}
                  </p>
                  <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-xs text-muted-foreground">
                    <span>Last activity</span>
                    <span className="font-medium text-foreground">{updated}</span>
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
