"use client";

import { useState } from "react";
import { AppWindow, CameraOff, Globe, Keyboard, MousePointer2 } from "lucide-react";
import EChart from "@/components/charts/EChart";
import {
  PALETTE,
  SEMANTIC,
  textStyle,
  baseGrid,
  baseTooltip,
  baseLegend,
  axisLabel,
  axisLine,
  splitLine,
} from "@/components/charts/chartTheme";
import { EmptyState, ErrorState, Skeleton, StatusPill } from "@/components/ui";

/* ------------------------------------------------------------------ */
/*  Chart plumbing shared by every chart on the session screens         */
/* ------------------------------------------------------------------ */

// One height for every session chart. Tall enough that a rotated/thinned time
// axis still has room, and it never collapses on a narrow viewport — the box
// keeps its height in all four states so nothing reflows when data lands.
const CHART_BOX = "h-64 w-full sm:h-72";

/**
 * Category axis labels are the single most common source of overlap: a session
 * can hold hundreds of per-minute samples and echarts will happily paint every
 * one of them on top of the last. `hideOverlap` drops the ones that collide,
 * `interval: "auto"` thins them first, and the fixed rotation keeps the
 * remaining ticks readable at narrow widths without ever stacking.
 */
const timeAxisLabel = {
  ...axisLabel,
  hideOverlap: true,
  interval: "auto",
  rotate: 0,
  margin: 10,
};

/** Axis titles — every chart says what its axes mean. */
const axisName = {
  nameTextStyle: { ...axisLabel, fontSize: 11, padding: [0, 0, 0, 0] },
  nameLocation: "middle",
};

/** Grid with room reserved for the axis names, so nothing clips. */
const sessionGrid = { ...baseGrid, left: 8, right: 20, top: 34, bottom: 26, containLabel: true };

/**
 * ChartFrame — the four async states for a chart, in a box of fixed height.
 *
 * An axis with no data is not an empty state, so `empty` renders a real
 * EmptyState instead of an empty grid.
 */
function ChartFrame({ loading, error, onRetry, isEmpty, empty, children }) {
  if (loading) {
    return (
      <div className={`${CHART_BOX} flex flex-col justify-end gap-2`} aria-busy="true">
        <Skeleton className="h-3 w-24" />
        <div className="flex flex-1 items-end gap-2">
          {[45, 70, 35, 85, 55, 75, 40, 65].map((h, i) => (
            <Skeleton key={i} className="flex-1 rounded-md" style={{ height: `${h}%` }} />
          ))}
        </div>
        <Skeleton className="h-3 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={CHART_BOX}>
        <ErrorState
          className="h-full justify-center"
          title="Couldn't load this chart"
          description={error}
          onRetry={onRetry}
        />
      </div>
    );
  }

  if (isEmpty) {
    return <div className={CHART_BOX}>{empty}</div>;
  }

  return <div className={CHART_BOX}>{children}</div>;
}

/* ------------------------------------------------------------------ */
/*  Session card                                                        */
/* ------------------------------------------------------------------ */

const SESSION_STATUS = {
  active: "active",
  running: "active",
  completed: "success",
  ended: "success",
  idle: "warning",
  paused: "warning",
  error: "error",
  failed: "error",
};

function statusToPill(status) {
  const key = String(status || "").toLowerCase();
  return SESSION_STATUS[key] || "unknown";
}

/**
 * `productivity_sessions.total_duration` is stored in SECONDS.
 *
 * The desktop tracker writes it as the elapsed seconds of the session: sampled
 * rows match `end_time - start_time` in seconds exactly (e.g. 1141 for a 19-min
 * session, 2 for a 2-second one), and some rows carry fractional values such as
 * 359.57 — neither is possible if the column were minutes. Every other reader
 * already treats it as seconds (DashboardOverview.loadTodayTrackedTime,
 * DeveloperActivity's day/range totals, reportsData.js). This card was the only
 * place labelling it "min", which rendered a 19-minute session as "1141 min".
 *
 * Formatted as HH:MM:SS to match the other two screens, so the same session
 * reads the same everywhere.
 */
export function formatSessionDuration(totalSeconds) {
  const secs = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function SessionCard({ session, onClick }) {
  if (!session) return null;

  const isActive = String(session.status || "").toLowerCase() === "active";
  const start = session.start_time ? new Date(session.start_time).toLocaleString() : "Unknown";
  const end = session.end_time ? new Date(session.end_time).toLocaleString() : "Ongoing";

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-xl border border-border bg-card p-5 text-left shadow-card transition-colors duration-150 hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Session ID
          </div>
          <div className="truncate font-mono text-xs tabular-nums text-foreground" title={session.session_id}>
            {session.session_id}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* A running session is unmistakable: pulse + label, never colour alone. */}
          {isActive && (
            <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75 motion-reduce:animate-none" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
            </span>
          )}
          <StatusPill status={statusToPill(session.status)} label={session.status || "Unknown"} size="sm" />
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Start</dt>
          <dd className="truncate tabular-nums text-foreground" title={start}>{start}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">End</dt>
          <dd className="truncate tabular-nums text-foreground" title={end}>{end}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Total duration</dt>
          <dd className="tabular-nums text-foreground">{formatSessionDuration(session.total_duration)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Productivity score</dt>
          <dd className="tabular-nums text-foreground">{session.productivity_score ?? 0}</dd>
        </div>
      </dl>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Keyboard chart                                                      */
/* ------------------------------------------------------------------ */

export function KeyboardActivityChart({ data, loading = false, error = null, onRetry }) {
  const rows = Array.isArray(data) ? data : [];

  const chartData = rows.map((r) => ({
    time: String(r.minute_timestamp).slice(11, 16),
    wpm: Number(r.words_per_minute) || 0,
    activityPct: Number(r.keyboard_activity_percentage) || 0,
  }));

  const option = {
    color: [PALETTE[1], SEMANTIC.success],
    textStyle,
    // Extra right padding so the second (percentage) axis and its name clear
    // the plot area instead of sitting on top of the last data point.
    grid: { ...sessionGrid, right: 52 },
    tooltip: { trigger: "axis", ...baseTooltip },
    legend: { ...baseLegend, data: ["WPM", "Keyboard %"] },
    xAxis: {
      type: "category",
      boundaryGap: false,
      name: "Time",
      nameGap: 22,
      ...axisName,
      data: chartData.map((d) => d.time),
      axisLabel: timeAxisLabel,
      axisLine,
      axisTick: { show: false },
    },
    yAxis: [
      {
        type: "value",
        name: "WPM",
        nameGap: 34,
        ...axisName,
        minInterval: 1,
        axisLabel,
        splitLine,
      },
      {
        type: "value",
        name: "Activity %",
        nameGap: 38,
        ...axisName,
        max: 100,
        position: "right",
        axisLabel: { ...axisLabel, formatter: "{value}%" },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: "WPM",
        type: "line",
        yAxisIndex: 0,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2 },
        data: chartData.map((d) => d.wpm),
      },
      {
        name: "Keyboard %",
        type: "line",
        yAxisIndex: 1,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2 },
        data: chartData.map((d) => d.activityPct),
      },
    ],
  };

  return (
    <ChartFrame
      loading={loading}
      error={error}
      onRetry={onRetry}
      isEmpty={chartData.length === 0}
      empty={
        <EmptyState
          className="h-full justify-center"
          icon={Keyboard}
          title="No keyboard activity yet"
          description="Typing speed and keyboard activity appear here once the desktop tracker records a minute of work."
        />
      }
    >
      <EChart option={option} height="100%" />
    </ChartFrame>
  );
}

/* ------------------------------------------------------------------ */
/*  Mouse chart                                                         */
/* ------------------------------------------------------------------ */

export function MouseActivityChart({ data, loading = false, error = null, onRetry }) {
  const rows = Array.isArray(data) ? data : [];

  const chartData = rows
    .slice()
    .reverse()
    .map((r) => ({
      time: r.timestamp
        ? new Date(r.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
        : "",
      active: Number(r.active_percentage) || 0,
      idle: Number(r.idle_percentage) || 0,
    }));

  const option = {
    color: [SEMANTIC.success, SEMANTIC.danger],
    textStyle,
    grid: sessionGrid,
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      valueFormatter: (v) => `${Number(v).toFixed(1)}%`,
      ...baseTooltip,
    },
    legend: { ...baseLegend, data: ["Active %", "Idle %"] },
    xAxis: {
      type: "category",
      name: "Time",
      nameGap: 22,
      ...axisName,
      data: chartData.map((d) => d.time),
      axisLabel: timeAxisLabel,
      axisLine,
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      name: "Share of minute",
      nameGap: 40,
      ...axisName,
      max: 100,
      axisLabel: { ...axisLabel, formatter: "{value}%" },
      splitLine,
    },
    series: [
      { name: "Active %", type: "bar", stack: "a", data: chartData.map((d) => d.active) },
      {
        name: "Idle %",
        type: "bar",
        stack: "a",
        itemStyle: { borderRadius: [4, 4, 0, 0] },
        data: chartData.map((d) => d.idle),
      },
    ],
  };

  return (
    <ChartFrame
      loading={loading}
      error={error}
      onRetry={onRetry}
      isEmpty={chartData.length === 0}
      empty={
        <EmptyState
          className="h-full justify-center"
          icon={MousePointer2}
          title="No mouse activity yet"
          description="Active and idle share per minute appear here once the desktop tracker reports pointer activity."
        />
      }
    >
      <EChart option={option} height="100%" />
    </ChartFrame>
  );
}

/* ------------------------------------------------------------------ */
/*  App usage list                                                      */
/* ------------------------------------------------------------------ */

export function AppUsageList({ topApps, topBrowser, loading = false, error = null, onRetry }) {
  const apps = Array.isArray(topApps) ? topApps : [];

  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex h-11 items-center justify-between gap-3 rounded-lg border border-border px-3">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-14" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return <ErrorState title="Couldn't load app usage" description={error} onRetry={onRetry} />;
  }

  if (apps.length === 0) {
    return (
      <EmptyState
        icon={AppWindow}
        title="No app usage recorded"
        description="Applications used during this session are listed here, longest first."
      />
    );
  }

  return (
    <div className="space-y-3">
      {topBrowser && (
        <div className="flex h-11 items-center gap-2 rounded-lg border border-info/20 bg-info/10 px-3 text-sm">
          <span className="shrink-0 font-medium text-info">Top browser</span>
          <span className="min-w-0 flex-1 truncate text-foreground" title={topBrowser.browser}>
            {topBrowser.browser}
          </span>
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
            {topBrowser.totalMinutes.toFixed(1)} m
          </span>
        </div>
      )}

      <ul className="divide-y divide-border rounded-lg border border-border">
        {apps.map((a) => (
          // Every row is the same height whatever the name length, and long
          // names truncate with a title rather than pushing the row wider.
          <li key={a.app} className="flex h-11 items-center justify-between gap-3 px-3 text-sm">
            <span className="min-w-0 flex-1 truncate text-foreground" title={a.app}>
              {a.app}
            </span>
            <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
              {a.totalMinutes.toFixed(1)} m
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Website usage                                                       */
/* ------------------------------------------------------------------ */

/**
 * Time per domain for one session.
 *
 * Deliberately shaped like AppUsageList — same row height, same truncation
 * rule, same tabular figures — because the two sit next to each other and a
 * second visual language for the same kind of list would just be noise.
 *
 * The bar is proportional to the longest entry rather than to the session
 * length: session length is not in this data, and scaling to something we do
 * not have would silently misstate how much of the day a domain accounted for.
 */
export function WebsiteUsageList({ sites, loading = false, error = null, onRetry }) {
  const rows = Array.isArray(sites) ? sites : [];

  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex h-11 items-center justify-between gap-3 rounded-lg border border-border px-3">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-14" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return <ErrorState title="Couldn't load website usage" description={error} onRetry={onRetry} />;
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Globe}
        title="No website time recorded"
        description="Domains visited in a browser during this session are listed here, longest first."
      />
    );
  }

  const max = rows.reduce((m, r) => Math.max(m, r.totalMinutes || 0), 0) || 1;

  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {rows.map((s) => (
        <li key={s.site} className="flex h-11 items-center gap-3 px-3 text-sm">
          <span className="min-w-0 flex-1 truncate text-foreground" title={s.site}>
            {s.site}
          </span>
          <span
            className="hidden h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-muted sm:block"
            aria-hidden="true"
          >
            <span
              className="block h-full rounded-full bg-info"
              style={{ width: `${Math.max(4, ((s.totalMinutes || 0) / max) * 100)}%` }}
            />
          </span>
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
            {(s.totalMinutes || 0).toFixed(1)} m
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/*  Screenshot grid                                                     */
/* ------------------------------------------------------------------ */

/**
 * One screenshot tile.
 *
 * The 16:9 box is painted before the image exists and never changes size, so a
 * late-arriving screenshot swaps in behind the skeleton instead of pushing the
 * rest of the page down. The caption block is a fixed two lines for the same
 * reason.
 */
function ScreenshotTile({ shot }) {
  const [state, setState] = useState("loading"); // loading | loaded | failed
  const src = shot.public_url || shot.image_url || shot.thumbnail_url || null;
  const app = shot.app_active || "Unknown app";
  const time = shot.timestamp
    ? new Date(shot.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
    : "—";

  return (
    <figure className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
      <div className="relative aspect-video w-full bg-muted">
        {src && state !== "failed" && (
          <img
            src={src}
            alt={`Screen at ${time} — ${app}`}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-150 ${
              state === "loaded" ? "opacity-100" : "opacity-0"
            }`}
            loading="lazy"
            decoding="async"
            onLoad={() => setState("loaded")}
            onError={() => setState("failed")}
          />
        )}

        {(!src || state === "failed") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted-foreground">
            <CameraOff className="h-5 w-5" aria-hidden="true" />
            <span className="text-xs">No preview</span>
          </div>
        )}

        {src && state === "loading" && (
          <Skeleton className="absolute inset-0 h-full w-full rounded-none" />
        )}
      </div>

      <figcaption className="space-y-0.5 px-2.5 py-2 text-xs">
        <div className="truncate font-medium text-foreground" title={app}>
          {app}
        </div>
        <div className="tabular-nums text-muted-foreground">{time}</div>
      </figcaption>
    </figure>
  );
}

export function ScreenshotGrid({ screenshots, loading = false, error = null, onRetry }) {
  const shots = Array.isArray(screenshots) ? screenshots : [];

  // The skeleton has the same columns and the same 16:9 tiles as the loaded
  // grid, so the page height does not change when the images arrive.
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="overflow-hidden rounded-lg border border-border bg-card">
            <Skeleton className="aspect-video w-full rounded-none" />
            <div className="space-y-1.5 px-2.5 py-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-12" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return <ErrorState title="Couldn't load screenshots" description={error} onRetry={onRetry} />;
  }

  if (shots.length === 0) {
    return (
      <EmptyState
        icon={CameraOff}
        title="No screenshots for this session"
        description="Captures taken by the desktop tracker during this session appear here."
      />
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {shots.map((shot) => (
        <ScreenshotTile key={shot.id || shot.filename} shot={shot} />
      ))}
    </div>
  );
}
