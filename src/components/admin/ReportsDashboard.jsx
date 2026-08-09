"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  loadReportData,
  defaultRange,
  projectPerformance,
  teamProductivity,
  statusDistribution,
  timeTrackingRows,
  deadlineDelays,
  dailyTrend,
  summaryKpis,
  TRACKING_CAVEAT,
} from "@/utils/reportsData";
import { exportCsv, exportPdf } from "@/utils/reportExport";
import { formatDuration } from "@/utils/pmData";
import StatCard from "@/components/shell/StatCard";
import EChart from "@/components/charts/EChart";
import {
  PRIMARY,
  SEMANTIC,
  baseTooltip,
  axisLabel,
  valueAxis,
  categoryAxis,
  legendFor,
  gridWithLegend,
  donutCenter,
  donutCenterEmphasis,
  FONT_FAMILY,
  roundedBar,
  roundedBarH,
  fmtInt,
  fmtCompact,
  fmtHours,
  heightForRows,
} from "@/components/charts/chartTheme";
import { showError } from "@/utils/alerts";
// The page <h1> reads the same string the sidebar and topbar do.
import { sectionTitle } from "@/components/shell/navConfig";
import { Button, EmptyState, Input, PageHeader, Skeleton, Tabs } from "@/components/ui";
import {
  RefreshCw,
  Download,
  FileText,
  FolderKanban,
  ListChecks,
  CheckCircle2,
  Timer,
  Monitor,
  AlertTriangle,
  LayoutDashboard,
  Users,
  Clock3,
  CalendarClock,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Static config                                                      */
/* ------------------------------------------------------------------ */

/* Sizing only — the kit `Input` owns the border, background and focus ring.
   `w-auto` because Input is `w-full` by default and these sit inline in a
   label. 40px tall on touch, dropping to the kit's own height from sm up so
   the pair still lines up with the buttons sharing this toolbar row. */
const DATE_INPUT_CLASS = "h-10 w-auto min-w-[9.5rem] px-3 text-sm sm:h-8";

const PANEL_CLASS = "rounded-xl border border-border bg-card p-5 shadow-card";

const TABS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "team", label: "Team", icon: Users },
  { id: "time", label: "Time", icon: Clock3 },
  { id: "delays", label: "Delays", icon: CalendarClock },
];

const OVERVIEW_COLUMNS = [
  { key: "date", label: "Date" },
  { key: "completed", label: "Completed tasks" },
  { key: "loggedHours", label: "Logged h" },
  { key: "trackedHours", label: "Tracked h" },
];

const PROJECT_COLUMNS = [
  { key: "project", label: "Project" },
  { key: "status", label: "Status" },
  { key: "progress", label: "Progress %" },
  { key: "total", label: "Total" },
  { key: "done", label: "Done" },
  { key: "overdue", label: "Overdue" },
  { key: "onTimeRate", label: "On-time %" },
  { key: "loggedHours", label: "Logged h" },
  { key: "deadline", label: "Deadline" },
  { key: "daysLate", label: "Days late" },
];

const TEAM_COLUMNS = [
  { key: "name", label: "Name" },
  { key: "role", label: "Role" },
  { key: "total", label: "Total" },
  { key: "done", label: "Done" },
  { key: "completionRate", label: "Completion %" },
  { key: "onTimeRate", label: "On-time %" },
  { key: "points", label: "Points" },
  { key: "loggedHours", label: "Logged h" },
  { key: "trackedHours", label: "Tracked h" },
  { key: "avgProductivity", label: "Avg score" },
];

const TIME_COLUMNS = [
  { key: "date", label: "Date" },
  { key: "developer", label: "Developer" },
  { key: "project", label: "Project" },
  { key: "task", label: "Task" },
  { key: "hours", label: "Hours" },
  { key: "source", label: "Source" },
];

const DELAY_COLUMNS = [
  { key: "task", label: "Task" },
  { key: "project", label: "Project" },
  { key: "assignee", label: "Assignee" },
  { key: "due", label: "Due" },
  { key: "state", label: "State" },
  { key: "daysLate", label: "Days late" },
];

/* ------------------------------------------------------------------ */
/*  Small helpers (native Date only, NaN-guarded)                      */
/* ------------------------------------------------------------------ */

const isNil = (v) => v === null || v === undefined || v === "";

/** Render a nullable cell value; nulls / NaN become an em dash. */
function cell(v) {
  if (isNil(v)) return "—";
  if (typeof v === "number" && !Number.isFinite(v)) return "—";
  return v;
}

/** Nullable percentage. */
function pct(v) {
  if (isNil(v) || (typeof v === "number" && !Number.isFinite(v))) return "—";
  return `${v}%`;
}

/** "YYYY-MM-DD" → "MMM d" (falls back to the raw string). */
function formatDayShort(value) {
  if (!value) return "";
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Validate + order a {from,to} pair before it reaches the data layer. */
function normalizeRange(range) {
  const fallback = defaultRange();
  const from = range?.from || fallback.from;
  const to = range?.to || fallback.to;
  const df = new Date(`${from}T00:00:00`);
  const dt = new Date(`${to}T00:00:00`);
  if (Number.isNaN(df.getTime()) || Number.isNaN(dt.getTime())) return fallback;
  return df > dt ? { from: to, to: from } : { from, to };
}

const sum = (arr) => (Array.isArray(arr) ? arr.reduce((s, n) => s + (Number(n) || 0), 0) : 0);

/**
 * The time and delay tables are row-per-event, so they run into the thousands
 * on a busy month and rendering them all stalls the tab. Paging keeps the DOM
 * bounded; exports and totals still use the complete row set.
 */
const ROWS_PER_PAGE = 50;

/** Compact pager. Renders nothing when everything already fits on one page. */
function TablePager({ page, pageCount, total, shown, onPage }) {
  if (pageCount <= 1) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm">
      <span className="text-muted-foreground">{`Showing ${shown} of ${total} rows`}</span>
      <div className="flex items-center gap-1.5">
        <Button variant="outline" onClick={() => onPage(page - 1)} disabled={page <= 1}>
          Previous
        </Button>
        <span className="px-1 text-xs text-muted-foreground">{`Page ${page} of ${pageCount}`}</span>
        <Button variant="outline" onClick={() => onPage(page + 1)} disabled={page >= pageCount}>
          Next
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function ReportsDashboard() {
  // Lazy init — never call new Date() at module scope.
  const [range, setRange] = useState(() => defaultRange());
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [tab, setTab] = useState("overview");
  const [nonce, setNonce] = useState(0);
  const [timePage, setTimePage] = useState(1);
  const [delayPage, setDelayPage] = useState(1);

  /* ---- data ---- */
  // Refresh re-runs the effect below rather than duplicating the fetch, so the
  // cancellation guard covers every load path.
  const load = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await loadReportData(normalizeRange(range));
        if (!cancelled) setBundle(data || null);
      } catch (err) {
        if (!cancelled) showError("Failed to load reports", err?.message || String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range, nonce]);

  const setRangePart = (key, value) => setRange((r) => ({ ...r, [key]: value }));

  /* ---- derived tables (all guarded against a null bundle) ---- */
  const kpis = useMemo(
    () =>
      bundle
        ? summaryKpis(bundle)
        : { projects: 0, tasks: 0, done: 0, completionRate: 0, loggedHours: 0, trackedHours: 0, overdue: 0 },
    [bundle]
  );

  const projectRows = useMemo(() => (bundle ? projectPerformance(bundle) || [] : []), [bundle]);
  const teamRows = useMemo(() => (bundle ? teamProductivity(bundle) || [] : []), [bundle]);
  const timeRows = useMemo(() => (bundle ? timeTrackingRows(bundle) || [] : []), [bundle]);
  const delayRows = useMemo(() => (bundle ? deadlineDelays(bundle) || [] : []), [bundle]);
  const trend = useMemo(
    () => (bundle ? dailyTrend(bundle) : { days: [], completed: [], loggedHours: [], trackedHours: [] }),
    [bundle]
  );
  // "No data" is a state a chart must say out loud — an axis with nothing on
  // it is not an empty state.
  const dist = useMemo(
    () =>
      bundle
        ? bundle.statusCounts || statusDistribution(bundle.tasks)
        : { pending: 0, in_progress: 0, awaiting_approval: 0, completed: 0 },
    [bundle]
  );

  /** Overview exports as the daily trend series, one row per day. */
  const overviewRows = useMemo(() => {
    const days = Array.isArray(trend?.days) ? trend.days : [];
    return days.map((d, i) => ({
      date: d,
      completed: trend?.completed?.[i] ?? 0,
      loggedHours: trend?.loggedHours?.[i] ?? 0,
      trackedHours: trend?.trackedHours?.[i] ?? 0,
    }));
  }, [trend]);

  const totalTimedHours = useMemo(() => sum(timeRows.map((r) => r.hours)), [timeRows]);

  const hasTrend =
    (trend?.days?.length || 0) > 0 &&
    (sum(trend?.completed) > 0 || sum(trend?.loggedHours) > 0 || sum(trend?.trackedHours) > 0);
  const hasStatus =
    (dist?.pending || 0) + (dist?.in_progress || 0) + (dist?.awaiting_approval || 0) + (dist?.completed || 0) > 0;

  /* ---- paged slices (the totals above stay over the full row set) ---- */
  const timePageCount = Math.max(1, Math.ceil(timeRows.length / ROWS_PER_PAGE));
  const delayPageCount = Math.max(1, Math.ceil(delayRows.length / ROWS_PER_PAGE));
  const timeStart = (Math.min(timePage, timePageCount) - 1) * ROWS_PER_PAGE;
  const delayStart = (Math.min(delayPage, delayPageCount) - 1) * ROWS_PER_PAGE;
  const pagedTimeRows = useMemo(
    () => timeRows.slice(timeStart, timeStart + ROWS_PER_PAGE),
    [timeRows, timeStart]
  );
  const pagedDelayRows = useMemo(
    () => delayRows.slice(delayStart, delayStart + ROWS_PER_PAGE),
    [delayRows, delayStart]
  );

  // A new bundle means new rows underneath — go back to the first page.
  useEffect(() => {
    setTimePage(1);
    setDelayPage(1);
  }, [bundle]);

  /* ---- charts ---- */

  // The trend used to be ONE chart with two y-axes: task counts on the left,
  // hours on the right. Two scales in one frame means the crossing point of the
  // bar and the line is an artefact of the axis maxima, not a fact about the
  // data — the reader cannot help but read a relationship that isn't there.
  // Same numbers, same arrays, now two stacked panels over a shared date axis,
  // so each measure is read against its own baseline.
  const trendDays = useMemo(() => (Array.isArray(trend?.days) ? trend.days : []), [trend]);

  // Shared date axis. A 30- or 90-day range printed every "Mar 4" on top of the
  // next one; hideOverlap thins the ticks instead of stacking them.
  const trendDateAxis = useMemo(
    () => ({
      ...categoryAxis,
      data: trendDays,
      boundaryGap: true,
      axisLabel: {
        ...axisLabel,
        hideOverlap: true,
        interval: "auto",
        formatter: (v) => formatDayShort(v),
      },
    }),
    [trendDays]
  );

  const tasksTrendOption = useMemo(
    () => ({
      textStyle: { fontFamily: FONT_FAMILY },
      tooltip: {
        ...baseTooltip,
        trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (v) => fmtInt(v),
      },
      // One series — the panel heading names it, so a legend would only repeat
      // itself. No legend means the plot can start higher up the panel.
      legend: legendFor(1),
      grid: gridWithLegend(1, { bottom: 8 }),
      xAxis: trendDateAxis,
      yAxis: {
        ...valueAxis,
        minInterval: 1,
        axisLabel: { ...axisLabel, formatter: (v) => fmtCompact(v) },
      },
      series: [
        {
          name: "Completed tasks",
          type: "bar",
          data: Array.isArray(trend?.completed) ? trend.completed : [],
          barMaxWidth: 18,
          itemStyle: roundedBar(PRIMARY),
        },
      ],
    }),
    [trend, trendDateAxis]
  );

  const hoursTrendOption = useMemo(
    () => ({
      textStyle: { fontFamily: FONT_FAMILY },
      tooltip: {
        ...baseTooltip,
        trigger: "axis",
        // Decimal hours are a storage format, not something to show a reader.
        valueFormatter: (v) => fmtHours(v),
      },
      legend: legendFor(2),
      grid: gridWithLegend(2, { bottom: 8 }),
      xAxis: trendDateAxis,
      yAxis: {
        ...valueAxis,
        axisLabel: { ...axisLabel, formatter: (v) => fmtHours(v) },
      },
      series: [
        {
          name: "Logged hours",
          type: "line",
          data: Array.isArray(trend?.loggedHours) ? trend.loggedHours : [],
          color: PRIMARY,
          smooth: true,
          symbol: "none",
          lineStyle: { width: 2 },
          areaStyle: { opacity: 0.06 },
        },
        {
          // Tracked is the reference series the logged line is judged against,
          // so it stays neutral and dashed rather than taking a second hue.
          name: "Tracked hours",
          type: "line",
          data: Array.isArray(trend?.trackedHours) ? trend.trackedHours : [],
          color: SEMANTIC.muted,
          lineStyle: { type: "dashed", width: 2 },
          smooth: true,
          symbol: "none",
        },
      ],
    }),
    [trend, trendDateAxis]
  );

  const statusOption = useMemo(() => {
    // The four counts already on screen — no new aggregation, just the total so
    // the ring has a number in the middle instead of a hole.
    const total =
      (dist?.pending || 0) +
      (dist?.in_progress || 0) +
      (dist?.awaiting_approval || 0) +
      (dist?.completed || 0);
    return {
      textStyle: { fontFamily: FONT_FAMILY },
      tooltip: {
        ...baseTooltip,
        trigger: "item",
        formatter: (p) => `${p.name}<br/><b>${fmtInt(p.value)}</b> tasks · ${p.percent.toFixed(0)}%`,
      },
      // Legend sits under the ring rather than above it: at 375px a top-right
      // legend and a donut compete for the same corner.
      legend: {
        ...legendFor(4),
        top: "auto",
        right: "auto",
        bottom: 0,
        left: "center",
      },
      series: [
        {
          name: "Task status",
          type: "pie",
          radius: ["58%", "78%"],
          center: ["50%", "44%"],
          avoidLabelOverlap: true,
          minAngle: 3,
          // padAngle separates the slices without painting a literal white
          // ring, which broke the moment the card was not white.
          padAngle: 2,
          label: donutCenter(total, fmtInt, "tasks"),
          // The centre total is a fixed readout, not a hover response.
          emphasis: donutCenterEmphasis,
          labelLine: { show: false },
          // Workflow order, coloured by state and not by six unrelated hues:
          // not-started is inert, active work is brand indigo, review is
          // warning, done is success. Same mapping as the Gantt status bars.
          data: [
            { name: "To Do", value: dist?.pending || 0, itemStyle: { color: SEMANTIC.track } },
            { name: "In Progress", value: dist?.in_progress || 0, itemStyle: { color: PRIMARY } },
            {
              name: "In Review",
              value: dist?.awaiting_approval || 0,
              itemStyle: { color: SEMANTIC.warning },
            },
            { name: "Done", value: dist?.completed || 0, itemStyle: { color: SEMANTIC.success } },
          ],
        },
      ],
    };
  }, [dist]);

  const projectTop = useMemo(
    () =>
      [...projectRows]
        .sort((a, b) => (b.total || 0) - (a.total || 0))
        .slice(0, 10)
        .reverse(), // echarts category axis draws bottom-up
    [projectRows]
  );

  const projectChartOption = useMemo(
    () => ({
      textStyle: { fontFamily: FONT_FAMILY },
      tooltip: { ...baseTooltip, trigger: "axis", axisPointer: { type: "shadow" } },
      legend: legendFor(2),
      grid: gridWithLegend(2, { bottom: 30 }),
      xAxis: {
        ...valueAxis,
        name: "Tasks",
        nameLocation: "middle",
        nameGap: 28,
        minInterval: 1,
        axisLabel: { ...axisLabel, formatter: (v) => fmtCompact(v) },
      },
      yAxis: {
        ...categoryAxis,
        data: projectTop.map((r) => r.project),
        // Project names are free text: truncate at a fixed width and let
        // hideOverlap drop any that still collide in a short panel. Truncating
        // beats rotating — the full name is in the tooltip either way.
        axisLabel: { ...axisLabel, width: 130, overflow: "truncate", hideOverlap: true },
      },
      series: [
        {
          name: "Done",
          type: "bar",
          stack: "tasks",
          data: projectTop.map((r) => r.done || 0),
          barMaxWidth: 18,
          itemStyle: { color: PRIMARY, borderRadius: [4, 0, 0, 4] },
        },
        {
          // The remainder is a backdrop, not a second subject: an inert track
          // tint rather than a hue that competes with the completed portion.
          name: "Remaining",
          type: "bar",
          stack: "tasks",
          data: projectTop.map((r) => Math.max(0, (r.total || 0) - (r.done || 0))),
          barMaxWidth: 18,
          itemStyle: { color: SEMANTIC.track, borderRadius: [0, 4, 4, 0] },
        },
      ],
    }),
    [projectTop]
  );

  const teamTop = useMemo(
    () =>
      [...teamRows]
        .sort((a, b) => (b.done || 0) - (a.done || 0))
        .slice(0, 12)
        .reverse(), // echarts category axis draws bottom-up; keep the leader on top
    [teamRows]
  );

  const teamChartOption = useMemo(
    () => ({
      textStyle: { fontFamily: FONT_FAMILY },
      tooltip: {
        ...baseTooltip,
        trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (v) => fmtInt(v),
      },
      // Was a column chart whose twelve names had to be rotated 35° and
      // truncated to 76px to stop them printing over each other — which made
      // them unreadable on a phone and merely awkward on a desktop. Turning the
      // chart on its side gives every name a full horizontal line at the same
      // 11px as every other axis in the app, so the rotation is no longer
      // needed at any width. Truncation and hideOverlap are kept as the guard
      // for very long names.
      legend: legendFor(1),
      grid: gridWithLegend(1, { bottom: 30 }),
      xAxis: {
        ...valueAxis,
        name: "Completed tasks",
        nameLocation: "middle",
        nameGap: 28,
        minInterval: 1,
        axisLabel: { ...axisLabel, formatter: (v) => fmtCompact(v) },
      },
      yAxis: {
        ...categoryAxis,
        data: teamTop.map((r) => r.name || "Unknown"),
        axisLabel: { ...axisLabel, width: 130, overflow: "truncate", hideOverlap: true },
      },
      series: [
        {
          name: "Completed tasks",
          type: "bar",
          data: teamTop.map((r) => r.done || 0),
          barMaxWidth: 18,
          itemStyle: roundedBarH(PRIMARY),
        },
      ],
    }),
    [teamTop]
  );

  /* ---- exports (always follow the active tab) ---- */
  const activeExport = useMemo(() => {
    switch (tab) {
      case "projects":
        return { label: "Projects", columns: PROJECT_COLUMNS, rows: projectRows, file: "project_performance" };
      case "team":
        return { label: "Team", columns: TEAM_COLUMNS, rows: teamRows, file: "team_productivity" };
      case "time":
        return { label: "Time", columns: TIME_COLUMNS, rows: timeRows, file: "time_tracking" };
      case "delays":
        return { label: "Delays", columns: DELAY_COLUMNS, rows: delayRows, file: "deadline_delays" };
      case "overview":
      default:
        return { label: "Overview", columns: OVERVIEW_COLUMNS, rows: overviewRows, file: "activity_overview" };
    }
  }, [tab, projectRows, teamRows, timeRows, delayRows, overviewRows]);

  const handleExportCsv = useCallback(async () => {
    setExporting(true);
    try {
      exportCsv({
        columns: activeExport.columns,
        rows: activeExport.rows || [],
        filename: activeExport.file,
      });
    } catch (err) {
      showError("Export failed", err?.message || String(err));
    } finally {
      setExporting(false);
    }
  }, [activeExport]);

  const handleExportPdf = useCallback(async () => {
    setExporting(true);
    try {
      const safe = normalizeRange(range);
      const rows = activeExport.rows || [];
      await exportPdf({
        title: activeExport.label,
        subtitle: `Range: ${safe.from} → ${safe.to}`,
        columns: activeExport.columns,
        rows,
        filename: activeExport.file,
        meta: [`Rows: ${rows.length}`],
      });
    } catch (err) {
      showError("Export failed", err?.message || String(err));
    } finally {
      setExporting(false);
    }
  }, [activeExport, range]);

  /* ---- render ---- */
  return (
    <div>
      <PageHeader
        title={sectionTitle("reports", "admin")}
        description="Delivery, workload, time and delay analytics across the whole organization."
        actions={
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw
              className={loading ? "animate-spin motion-reduce:animate-none" : undefined}
              aria-hidden="true"
            />
            Refresh
          </Button>
        }
      />

      <div className="space-y-4">
        {/* ---------- Toolbar ---------- */}
        <div className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            {/* The kit `Input`, not a hand-rolled class. These two were the only
                focusable elements in the whole admin portal with no visible focus
                ring — `outline: transparent` and no box-shadow — because their
                local class set one and never landed it. The primitive already
                carries the ring every other control on the page uses. */}
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="font-medium">From</span>
              <Input
                type="date"
                value={range.from || ""}
                max={range.to || undefined}
                onChange={(e) => setRangePart("from", e.target.value)}
                className={DATE_INPUT_CLASS}
                aria-label="Report range start date"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="font-medium">To</span>
              <Input
                type="date"
                value={range.to || ""}
                min={range.from || undefined}
                onChange={(e) => setRangePart("to", e.target.value)}
                className={DATE_INPUT_CLASS}
                aria-label="Report range end date"
              />
            </label>

            <div className="ml-auto flex items-center gap-1.5">
              <Button
                variant="outline"
                onClick={handleExportCsv}
                disabled={exporting || loading}
                title={`Export the ${activeExport.label} table as CSV`}
              >
                <Download aria-hidden="true" /> Export CSV
              </Button>
              <Button
                variant="outline"
                onClick={handleExportPdf}
                disabled={exporting || loading}
                title={`Export the ${activeExport.label} table as PDF`}
              >
                <FileText aria-hidden="true" /> Export PDF
              </Button>
            </div>
          </div>
        </div>

        {/* ---------- KPI strip ---------- */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard title="Projects" value={kpis.projects} icon={FolderKanban} tone="primary" />
          <StatCard title="Tasks" value={kpis.tasks} icon={ListChecks} tone="info" />
          <StatCard
            title="Completed"
            value={kpis.done}
            icon={CheckCircle2}
            tone="success"
            hint={<span className="text-muted-foreground">{`${kpis.completionRate}% complete`}</span>}
          />
          <StatCard
            title="Logged Hours"
            value={kpis.loggedHours}
            icon={Timer}
            tone="violet"
            hint={<span className="text-muted-foreground">in-app timer</span>}
          />
          <StatCard
            title="Tracked Hours"
            value={kpis.trackedHours}
            icon={Monitor}
            tone="warning"
            hint={<span className="text-muted-foreground">desktop tracker</span>}
          />
          <StatCard title="Overdue" value={kpis.overdue} icon={AlertTriangle} tone="destructive" />
        </div>

        {/* ---------- Tab bar ---------- */}
        <Tabs tabs={TABS} active={tab} onChange={setTab} aria-label="Report section" />

        {/* ---------- Tab content ---------- */}
        {loading && !bundle ? (
          // Skeleton shaped like the overview: a wide chart beside a narrow one.
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3" aria-busy="true">
            <div className={`${PANEL_CLASS} xl:col-span-2 space-y-3`}>
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-64" />
              <Skeleton className="h-[300px] w-full rounded-lg" />
            </div>
            <div className={`${PANEL_CLASS} space-y-3`}>
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-48" />
              <Skeleton className="h-[300px] w-full rounded-lg" />
            </div>
          </div>
        ) : (
          <>
            {tab === "overview" && (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <div className={`${PANEL_CLASS} xl:col-span-2`}>
                  <h3 className="text-sm font-semibold text-foreground">Activity trend</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Completed tasks and time spent, per day.
                  </p>
                  {hasTrend ? (
                    /* Two panels over a shared date axis rather than one chart
                       with a second y-axis on the right. Counts and hours are
                       different units, so a single frame would have invented a
                       crossing point between them. */
                    <div className="mt-3 space-y-4">
                      <div>
                        <h4 className="text-xs font-medium text-muted-foreground">Completed tasks</h4>
                        <EChart option={tasksTrendOption} height={168} />
                      </div>
                      <div className="border-t border-border pt-3">
                        <h4 className="text-xs font-medium text-muted-foreground">Hours</h4>
                        <EChart option={hoursTrendOption} height={168} />
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3">
                      <EmptyState
                        className="h-[336px] justify-center"
                        icon={CalendarClock}
                        title="Nothing happened in this range"
                        description="Widen the date range, or wait for tasks to be completed and time to be logged."
                      />
                    </div>
                  )}
                </div>

                <div className={PANEL_CLASS}>
                  <h3 className="text-sm font-semibold text-foreground">Task status</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">Across every task in the organization.</p>
                  <div className="mt-3">
                    {hasStatus ? (
                      <EChart option={statusOption} height={300} />
                    ) : (
                      <EmptyState
                        className="h-[300px] justify-center"
                        icon={ListChecks}
                        title="No tasks yet"
                        description="The status split fills in as soon as tasks exist."
                      />
                    )}
                  </div>
                </div>
              </div>
            )}

            {tab === "projects" && (
              <div className="space-y-4">
                <div className={PANEL_CLASS}>
                  <h3 className="text-sm font-semibold text-foreground">Top projects by workload</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Ten largest projects, split into done and remaining tasks.
                  </p>
                  <div className="mt-3">
                    {projectRows.length > 0 ? (
                      /* Height follows the row count: ten projects in a fixed
                         300px box left each bar a sliver with its name clipped. */
                      <EChart
                        option={projectChartOption}
                        height={heightForRows(projectTop.length, { perRow: 30, chrome: 96, min: 200 })}
                      />
                    ) : (
                      <EmptyState
                        className="h-[300px] justify-center"
                        icon={FolderKanban}
                        title="No projects to rank"
                        description="Create a project and assign tasks to see the workload split."
                      />
                    )}
                  </div>
                </div>

                <div className={PANEL_CLASS}>
                  <h3 className="text-sm font-semibold text-foreground">Project performance</h3>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="sticky top-0 bg-card text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {PROJECT_COLUMNS.map((c) => (
                            <th key={c.key} className="whitespace-nowrap px-3 py-2 text-left">
                              {c.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {projectRows.length === 0 ? (
                          <tr className="border-t border-border">
                            <td
                              colSpan={PROJECT_COLUMNS.length}
                              className="px-3 py-8 text-center text-sm text-muted-foreground"
                            >
                              No projects in this organization yet.
                            </td>
                          </tr>
                        ) : (
                          projectRows.map((r) => (
                            <tr key={r.projectId} className="border-t border-border hover:bg-muted/40">
                              <td className="px-3 py-2 font-medium text-foreground">{cell(r.project)}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{cell(r.status)}</td>
                              <td className="px-3 py-2">
                                <div className="flex min-w-[110px] items-center gap-2">
                                  <div className="h-1.5 flex-1 rounded-full bg-muted">
                                    <div
                                      className="h-1.5 rounded-full bg-primary"
                                      style={{ width: `${Math.max(0, Math.min(100, Number(r.progress) || 0))}%` }}
                                    />
                                  </div>
                                  <span className="tabular-nums text-xs text-muted-foreground">
                                    {Number(r.progress) || 0}%
                                  </span>
                                </div>
                              </td>
                              <td className="px-3 py-2 tabular-nums">{cell(r.total)}</td>
                              <td className="px-3 py-2 tabular-nums">{cell(r.done)}</td>
                              <td className="px-3 py-2 tabular-nums">
                                {r.overdue > 0 ? (
                                  <span className="font-semibold text-destructive">{r.overdue}</span>
                                ) : (
                                  0
                                )}
                              </td>
                              <td className="px-3 py-2 tabular-nums">{pct(r.onTimeRate)}</td>
                              <td className="px-3 py-2 tabular-nums">{cell(r.loggedHours)}</td>
                              <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">
                                {cell(r.deadline)}
                              </td>
                              <td className="px-3 py-2 tabular-nums">
                                {r.daysLate > 0 ? (
                                  <span className="font-semibold text-warning">{r.daysLate}</span>
                                ) : (
                                  "—"
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {tab === "team" && (
              <div className="space-y-4">
                <div className={PANEL_CLASS}>
                  <h3 className="text-sm font-semibold text-foreground">Completed tasks per person</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">Top twelve, most completed first.</p>
                  <div className="mt-3">
                    {teamRows.length > 0 ? (
                      /* One row per person at a readable band, rather than twelve
                         columns squeezed under 35°-rotated names. */
                      <EChart
                        option={teamChartOption}
                        height={heightForRows(teamTop.length, { perRow: 30, chrome: 84, min: 200 })}
                      />
                    ) : (
                      <EmptyState
                        className="h-[300px] justify-center"
                        icon={Users}
                        title="No team members to report on"
                        description="Add people to the organization and assign them tasks."
                      />
                    )}
                  </div>
                </div>

                <div className={PANEL_CLASS}>
                  <h3 className="text-sm font-semibold text-foreground">Team productivity</h3>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="sticky top-0 bg-card text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {TEAM_COLUMNS.map((c) => (
                            <th key={c.key} className="whitespace-nowrap px-3 py-2 text-left">
                              {c.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {teamRows.length === 0 ? (
                          <tr className="border-t border-border">
                            <td
                              colSpan={TEAM_COLUMNS.length}
                              className="px-3 py-8 text-center text-sm text-muted-foreground"
                            >
                              No team members to report on yet.
                            </td>
                          </tr>
                        ) : (
                          teamRows.map((r) => (
                            <tr key={r.userId || r.name} className="border-t border-border hover:bg-muted/40">
                              <td className="whitespace-nowrap px-3 py-2 font-medium text-foreground">{cell(r.name)}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{cell(r.role)}</td>
                              <td className="px-3 py-2 tabular-nums">{cell(r.total)}</td>
                              <td className="px-3 py-2 tabular-nums">{cell(r.done)}</td>
                              <td className="px-3 py-2 tabular-nums">{pct(r.completionRate)}</td>
                              <td className="px-3 py-2 tabular-nums">{pct(r.onTimeRate)}</td>
                              <td className="px-3 py-2 tabular-nums">{cell(r.points)}</td>
                              <td className="px-3 py-2 tabular-nums">{cell(r.loggedHours)}</td>
                              <td className="px-3 py-2 tabular-nums">{cell(r.trackedHours)}</td>
                              <td className="px-3 py-2 tabular-nums">{cell(r.avgProductivity)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">{TRACKING_CAVEAT}</p>
                </div>
              </div>
            )}

            {tab === "time" && (
              <div className={PANEL_CLASS}>
                <h3 className="text-sm font-semibold text-foreground">Time tracking</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Exact per-task intervals recorded by the in-app timer.
                </p>

                {timeRows.length === 0 ? (
                  <div className="mt-4 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                    No timed work in this range — start a timer from any task to record time.
                  </div>
                ) : (
                  <>
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="sticky top-0 bg-card text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {TIME_COLUMNS.map((c) => (
                              <th key={c.key} className="whitespace-nowrap px-3 py-2 text-left">
                                {c.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {pagedTimeRows.map((r, i) => (
                            <tr
                              key={`${r.date}-${r.developer}-${r.task}-${timeStart + i}`}
                              className="border-t border-border hover:bg-muted/40"
                            >
                              <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">
                                {cell(r.date)}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 font-medium text-foreground">
                                {cell(r.developer)}
                              </td>
                              <td className="px-3 py-2">{cell(r.project)}</td>
                              <td className="px-3 py-2">{cell(r.task)}</td>
                              <td className="px-3 py-2 tabular-nums">{cell(r.hours)}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{cell(r.source)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <TablePager
                      page={Math.min(timePage, timePageCount)}
                      pageCount={timePageCount}
                      total={timeRows.length}
                      shown={pagedTimeRows.length}
                      onPage={setTimePage}
                    />
                    <div className="mt-3 flex items-center justify-end gap-2 border-t border-border pt-3 text-sm">
                      <span className="text-muted-foreground">Total:</span>
                      <span className="font-semibold tabular-nums text-foreground">
                        {totalTimedHours.toFixed(2)} h
                      </span>
                      <span className="text-xs text-muted-foreground">
                        ({formatDuration(totalTimedHours * 3600)})
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}

            {tab === "delays" && (
              <div className={PANEL_CLASS}>
                <h3 className="text-sm font-semibold text-foreground">Deadline delays</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Tasks that are still overdue, or that were completed after their due date.
                </p>

                {delayRows.length === 0 ? (
                  <div className="mt-4 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                    No delays 🎉
                  </div>
                ) : (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="sticky top-0 bg-card text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {DELAY_COLUMNS.map((c) => (
                            <th key={c.key} className="whitespace-nowrap px-3 py-2 text-left">
                              {c.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pagedDelayRows.map((r, i) => (
                          <tr
                            key={`${r.task}-${r.due}-${delayStart + i}`}
                            className="border-t border-border hover:bg-muted/40"
                          >
                            <td className="px-3 py-2 font-medium text-foreground">{cell(r.task)}</td>
                            <td className="px-3 py-2">{cell(r.project)}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{cell(r.assignee)}</td>
                            <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">
                              {cell(r.due)}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                r.state === "Overdue"
                                  ? "bg-destructive/15 text-destructive"
                                  : "bg-warning/15 text-warning-on-tint"
                              }`}
                              >
                                {cell(r.state)}
                              </span>
                            </td>
                            <td className="px-3 py-2 tabular-nums">{cell(r.daysLate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {delayRows.length > 0 && (
                  <TablePager
                    page={Math.min(delayPage, delayPageCount)}
                    pageCount={delayPageCount}
                    total={delayRows.length}
                    shown={pagedDelayRows.length}
                    onPage={setDelayPage}
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
