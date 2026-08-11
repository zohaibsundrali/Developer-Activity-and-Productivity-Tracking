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
  endLabel,
  fmtPct,
  stackGap,
  verticalGradient,
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

  // `tracked_at`, not `minute_timestamp` — that column does not exist on
  // keyboard_stats. Reading it gave String(undefined).slice(11,16) === "", so
  // every point on the time axis was labelled with an empty string and the
  // axis rendered as a row of blanks.
  const chartData = rows.map((r) => ({
    time: String(r.tracked_at || "").slice(11, 16),
    wpm: Number(r.words_per_minute) || 0,
    activityPct: Number(r.keyboard_activity_percentage) || 0,
  }));

  const times = chartData.map((d) => d.time);

  // SMALL MULTIPLES, NOT A SECOND Y-AXIS.
  //
  // This used to plot words-per-minute and keyboard-activity-percent on one
  // plot with two different y-scales. A dual-axis chart lets whoever chose the
  // two ranges decide which line appears to be "above" the other — slide one
  // scale and the crossing points move — so the shape it shows is an artefact
  // of the axis bounds rather than a fact about the data. There is no correct
  // pair of bounds, which is why the answer is two plots and not better bounds.
  //
  // Stacked, sharing one category axis, with the axis pointer linked so hovering
  // either panel reads both at the same minute — the comparison the dual axis
  // was reaching for, without the distortion.
  const panel = (name, key, color, gridIndex, fmt) => ({
    name,
    type: "line",
    xAxisIndex: gridIndex,
    yAxisIndex: gridIndex,
    smooth: true,
    showSymbol: false,
    lineStyle: { width: 2, color },
    itemStyle: { color },
    areaStyle: { color: verticalGradient(color) },
    data: chartData.map((d) => d[key]),
    tooltip: { valueFormatter: fmt },
    // The current value, printed once at the right-hand end. No legend: each
    // panel holds one line and its own title already names it.
    endLabel: endLabel(fmt),
  });

  const option = {
    textStyle,
    // Each panel is a single series, so its own title names it and no legend
    // box is needed — a legend for one line is furniture.
    title: [
      { text: "Words per minute", top: 0, left: 0, textStyle: axisName },
      { text: "Keyboard activity", top: "52%", left: 0, textStyle: axisName },
    ],
    tooltip: { trigger: "axis", ...baseTooltip },
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    grid: [
      // Right padding leaves room for the end labels outside the plot.
      { left: 8, right: 48, top: 22, height: "30%", containLabel: true },
      { left: 8, right: 48, top: "74%", bottom: 8, containLabel: true },
    ],
    xAxis: [
      {
        type: "category",
        gridIndex: 0,
        boundaryGap: false,
        data: times,
        axisLabel: { show: false },
        axisLine,
        axisTick: { show: false },
      },
      {
        type: "category",
        gridIndex: 1,
        boundaryGap: false,
        data: times,
        axisLabel: timeAxisLabel,
        axisLine,
        axisTick: { show: false },
      },
    ],
    yAxis: [
      {
        type: "value",
        gridIndex: 0,
        splitNumber: 3,
        minInterval: 1,
        axisLabel,
        splitLine,
        axisLine: { show: false },
        axisTick: { show: false },
      },
      {
        type: "value",
        gridIndex: 1,
        splitNumber: 3,
        max: 100,
        axisLabel: { ...axisLabel, formatter: "{value}%" },
        splitLine,
        axisLine: { show: false },
        axisTick: { show: false },
      },
    ],
    series: [
      panel("WPM", "wpm", PALETTE[0], 0, (v) => `${Math.round(Number(v) || 0)} wpm`),
      panel("Keyboard activity", "activityPct", PALETTE[5], 1, (v) => fmtPct(v)),
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

  // Active is the measure; idle is the remainder, and it is painted as inert
  // track rather than as `danger`.
  //
  // Two reasons. First, the two series always sum to 100, so the stack is
  // always full height and only ONE number is actually being shown — giving
  // the complement a saturated hue doubles the ink for no added information.
  // Second, red is reserved for states that are wrong, and idle is not wrong:
  // it is reading, thinking, being in a meeting. Colouring it as a fault makes
  // the chart argue a position the data does not support, about a named person,
  // on a screen their manager reads.
  const option = {
    color: [SEMANTIC.success, SEMANTIC.track],
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
      {
        name: "Active %",
        type: "bar",
        stack: "a",
        itemStyle: { ...stackGap },
        data: chartData.map((d) => d.active),
      },
      {
        name: "Idle %",
        type: "bar",
        stack: "a",
        itemStyle: { ...stackGap, borderRadius: [4, 4, 0, 0] },
        data: chartData.map((d) => d.idle),
      },
    ],
    barCategoryGap: "35%",
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
