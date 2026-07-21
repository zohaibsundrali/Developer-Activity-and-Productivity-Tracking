"use client";

import EChart from "@/components/charts/EChart";
import {
  textStyle,
  baseGrid,
  baseTooltip,
  baseLegend,
  axisLabel,
  axisLine,
  splitLine,
} from "@/components/charts/chartTheme";

export function SessionCard({ session, onClick }) {
  if (!session) return null;
  const start = session.start_time
    ? new Date(session.start_time).toLocaleString()
    : "Unknown";
  const end = session.end_time
    ? new Date(session.end_time).toLocaleString()
    : "Ongoing";

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-xl border border-border bg-card p-4 shadow-card hover:border-primary hover:shadow-md transition"
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-muted-foreground">Session ID</div>
          <div className="font-mono text-xs text-foreground truncate max-w-xs">
            {session.session_id}
          </div>
        </div>
        <span className="inline-flex rounded-full bg-info/10 px-3 py-1 text-xs font-medium text-info">
          {session.status || "unknown"}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-muted-foreground">
        <div>
          <span className="font-medium">Start:</span> {start}
        </div>
        <div>
          <span className="font-medium">End:</span> {end}
        </div>
        <div>
          <span className="font-medium">Total duration:</span> {session.total_duration ?? 0} min
        </div>
        <div>
          <span className="font-medium">Productivity score:</span> {session.productivity_score ?? 0}
        </div>
      </div>
    </button>
  );
}

export function KeyboardActivityChart({ data }) {
  if (!data?.length) return <p className="text-sm text-muted-foreground">No keyboard data yet.</p>;

  const chartData = data.map((r) => ({
    time: String(r.minute_timestamp).slice(11, 16),
    wpm: Number(r.words_per_minute) || 0,
    activityPct: Number(r.keyboard_activity_percentage) || 0,
  }));

  const option = {
    color: ["#0ea5e9", "#16a34a"],
    textStyle,
    grid: { ...baseGrid, right: 44 },
    tooltip: { trigger: "axis", ...baseTooltip },
    legend: { ...baseLegend, data: ["WPM", "Keyboard %"] },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: chartData.map((d) => d.time),
      axisLabel,
      axisLine,
      axisTick: { show: false },
    },
    yAxis: [
      { type: "value", axisLabel, splitLine },
      { type: "value", max: 100, position: "right", axisLabel, splitLine: { show: false } },
    ],
    series: [
      { name: "WPM", type: "line", yAxisIndex: 0, smooth: true, showSymbol: false, lineStyle: { width: 2 }, data: chartData.map((d) => d.wpm) },
      { name: "Keyboard %", type: "line", yAxisIndex: 1, smooth: true, showSymbol: false, lineStyle: { width: 2 }, data: chartData.map((d) => d.activityPct) },
    ],
  };

  return (
    <div className="h-64 w-full">
      <EChart option={option} height="100%" />
    </div>
  );
}

export function MouseActivityChart({ data }) {
  if (!data?.length) return <p className="text-sm text-muted-foreground">No mouse data yet.</p>;

  const chartData = data
    .slice()
    .reverse()
    .map((r) => ({
      time: r.timestamp ? new Date(r.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "",
      active: Number(r.active_percentage) || 0,
      idle: Number(r.idle_percentage) || 0,
    }));

  const option = {
    color: ["#16a34a", "#ef4444"],
    textStyle,
    grid: baseGrid,
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, ...baseTooltip },
    legend: { ...baseLegend, data: ["Active %", "Idle %"] },
    xAxis: {
      type: "category",
      data: chartData.map((d) => d.time),
      axisLabel,
      axisLine,
      axisTick: { show: false },
    },
    yAxis: { type: "value", max: 100, axisLabel, splitLine },
    series: [
      { name: "Active %", type: "bar", stack: "a", data: chartData.map((d) => d.active) },
      { name: "Idle %", type: "bar", stack: "a", itemStyle: { borderRadius: [4, 4, 0, 0] }, data: chartData.map((d) => d.idle) },
    ],
  };

  return (
    <div className="h-64 w-full">
      <EChart option={option} height="100%" />
    </div>
  );
}

export function AppUsageList({ topApps, topBrowser }) {
  if (!topApps?.length) return <p className="text-sm text-muted-foreground">No app usage recorded yet.</p>;

  return (
    <div className="space-y-2 text-sm">
      {topBrowser && (
        <div className="mb-2 rounded-md bg-info/10 px-3 py-2 text-info">
          <span className="font-semibold">Top browser:</span> {topBrowser.browser} ({
            topBrowser.totalMinutes.toFixed(1)
          }
          m)
        </div>
      )}
      <ul className="space-y-1">
        {topApps.map((a) => (
          <li
            key={a.app}
            className="flex items-center justify-between rounded border border-border px-3 py-1.5"
          >
            <span className="truncate mr-2" title={a.app}>
              {a.app}
            </span>
            <span className="font-mono text-xs text-foreground">
              {a.totalMinutes.toFixed(1)} m
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ScreenshotGrid({ screenshots }) {
  if (!screenshots?.length) return <p className="text-sm text-muted-foreground">No screenshots for this session.</p>;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {screenshots.map((shot) => (
        <div
          key={shot.id || shot.filename}
          className="overflow-hidden rounded-lg border border-border bg-card shadow-card"
        >
          <div className="aspect-video bg-muted">
            {/* Coalesce across the possible URL columns (desktop app writes
                public_url; website upload route may write image_url/thumbnail_url). */}
            {(shot.public_url || shot.image_url || shot.thumbnail_url) ? (
              <img
                src={shot.public_url || shot.image_url || shot.thumbnail_url}
                alt={shot.app_active || shot.filename || "Screenshot"}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                No preview
              </div>
            )}
          </div>
          <div className="px-2 py-1.5 text-xs text-muted-foreground space-y-0.5">
            <div className="truncate" title={shot.app_active || "Unknown app"}>
              {shot.app_active || "Unknown app"}
            </div>
            <div className="truncate">
              {shot.timestamp
                ? new Date(shot.timestamp).toLocaleTimeString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : ""}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
