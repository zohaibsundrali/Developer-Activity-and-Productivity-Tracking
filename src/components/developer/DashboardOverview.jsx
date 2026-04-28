"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/utils/supabaseClient";

export default function DashboardTimeTracking({ user }) {
  const [dailyTotals, setDailyTotals] = useState({});
  const [weeklyTotals, setWeeklyTotals] = useState([]);
  const [totalTime, setTotalTime] = useState("00:00");
  const [recentProjects, setRecentProjects] = useState([]);
  const [todayTrackedTime, setTodayTrackedTime] = useState("00:00:00");

  const userId = user?.id || null;
  const userEmail = user?.email || null;

  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();

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
    const { data } = await supabase
      .from("projects")
      .select("id, name")
      .eq("user_id", userId)
      .limit(5);

    setRecentProjects(data || []);
  }, [userId]);

  // 🔴 REAL-TIME SUBSCRIPTION
  useEffect(() => {
    if (!userId && !userEmail) return;

    const initialLoadTimer = setTimeout(() => {
      void Promise.all([
        loadTimeData(),
        loadProjects(),
        loadTodayTrackedTime(),
      ]);
    }, 0);

    const channel = supabase
      .channel("time-tracking-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "time_entries" },
        () => loadTimeData()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "productivity_sessions" },
        () => loadTodayTrackedTime()
      )
      .subscribe();

    return () => {
      clearTimeout(initialLoadTimer);
      supabase.removeChannel(channel);
    };
  }, [userId, userEmail, loadProjects, loadTimeData, loadTodayTrackedTime]);

  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      
      {/* LEFT PANEL */}
      <div className="lg:col-span-2 bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-6">
          📅 {new Date().toLocaleString("default", { month: "long" })}{" "}
          {currentYear}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* TOTAL TIME */}
          <div className="flex flex-col items-center">
            <div className="w-40 h-40 rounded-full border-[12px] border-gray-100 flex items-center justify-center">
              <div className="text-center">
                <p className="text-2xl font-bold text-blue-600">
                  {totalTime} h
                </p>
                <p className="text-sm text-gray-500">
                  {recentProjects.length} projects
                </p>
              </div>
            </div>
          </div>

          {/* CALENDAR */}
          <div className="md:col-span-2">
            <p className="text-sm font-medium text-gray-600 mb-2">
              Daily totals
            </p>

            <div className="grid grid-cols-7 text-xs text-center gap-y-3">
              {["M","T","W","T","F","S","S"].map(d => (
                <span key={d} className="text-gray-400">{d}</span>
              ))}

              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const key = `${currentYear}-${String(currentMonth).padStart(2,"0")}-${String(day).padStart(2,"0")}`;

                return (
                  <div key={day}>
                    <p className="text-gray-500">{day}</p>
                    <p className={`text-xs mt-1 ${
                      dailyTotals[key] ? "text-blue-600 font-medium" : "text-gray-300"
                    }`}>
                      {dailyTotals[key] || "0"}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* WEEKLY TOTALS */}
        <div className="mt-6">
          <p className="text-sm font-medium text-gray-600 mb-3">
            Weekly totals
          </p>
          <div className="flex gap-6">
            {weeklyTotals.map((w, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full border-4 border-gray-200 flex items-center justify-center text-xs font-semibold text-blue-600">
                  {w.hours}
                </div>
                <span className="text-sm text-gray-600">{w.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">Today’s Tracked Time</h3>
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-center">
            <p className="text-3xl font-bold text-blue-600">{todayTrackedTime}</p>
            <p className="text-sm text-gray-500 mt-1">Completed Sessions</p>
          </div>
        </div>

        <h3 className="text-lg font-semibold mb-4">Your recent projects</h3>

        {recentProjects.length === 0 ? (
          <p className="text-center text-gray-400 py-16">
            No projects to display
          </p>
        ) : (
          <ul className="space-y-3">
            {recentProjects.map(p => (
              <li key={p.id} className="border-b pb-2">
                <p className="font-medium">{p.name}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
