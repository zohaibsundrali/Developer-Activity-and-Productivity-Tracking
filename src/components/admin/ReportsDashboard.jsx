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
  PALETTE,
  SEMANTIC,
  baseGrid,
  baseTooltip,
  axisLabel,
  splitLine,
  FONT_FAMILY,
  roundedBar,
} from "@/components/charts/chartTheme";
import { showError } from "@/utils/alerts";
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

const INPUT_CLASS =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30";

const BTN_CLASS =
  "inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:border-primary disabled:opacity-60";

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
        <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} className={BTN_CLASS}>
          Previous
        </button>
        <span className="px-1 text-xs text-muted-foreground">{`Page ${page} of ${pageCount}`}</span>
        <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pageCount} className={BTN_CLASS}>
          Next
        </button>
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
  const trendOption = useMemo(() => {
    const days = Array.isArray(trend?.days) ? trend.days : [];
    return {
      textStyle: { fontFamily: FONT_FAMILY },
      tooltip: { ...baseTooltip, trigger: "axis" },
      legend: {
        top: 0,
        icon: "roundRect",
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { color: SEMANTIC.muted, fontSize: 11, fontFamily: FONT_FAMILY },
      },
      grid: baseGrid,
      xAxis: {
        type: "category",
        data: days,
        boundaryGap: true,
        axisLabel: { ...axisLabel, formatter: (v) => formatDayShort(v) },
      },
      yAxis: [
        {
          type: "value",
          name: "Tasks",
          nameTextStyle: axisLabel,
          axisLabel,
          splitLine,
          minInterval: 1,
        },
        {
          type: "value",
          name: "Hours",
          nameTextStyle: axisLabel,
          axisLabel,
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: "Completed tasks",
          type: "bar",
          yAxisIndex: 0,
          data: Array.isArray(trend?.completed) ? trend.completed : [],
          barMaxWidth: 18,
          itemStyle: roundedBar(PALETTE[0]),
        },
        {
          name: "Logged hours",
          type: "line",
          yAxisIndex: 1,
          data: Array.isArray(trend?.loggedHours) ? trend.loggedHours : [],
          color: PALETTE[1],
          smooth: true,
          symbol: "none",
          areaStyle: { opacity: 0.08 },
        },
        {
          name: "Tracked hours",
          type: "line",
          yAxisIndex: 1,
          data: Array.isArray(trend?.trackedHours) ? trend.trackedHours : [],
          color: SEMANTIC.muted,
          lineStyle: { type: "dashed" },
          smooth: true,
          symbol: "none",
        },
      ],
    };
  }, [trend]);

  const statusOption = useMemo(
    () => ({
      textStyle: { fontFamily: FONT_FAMILY },
      tooltip: { ...baseTooltip, trigger: "item" },
      legend: {
        top: 0,
        icon: "roundRect",
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { color: SEMANTIC.muted, fontSize: 11, fontFamily: FONT_FAMILY },
      },
      series: [
        {
          name: "Task status",
          type: "pie",
          radius: ["52%", "76%"],
          center: ["50%", "58%"],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: "#ffffff", borderWidth: 2 },
          label: { show: false },
          data: [
            { name: "To Do", value: dist?.pending || 0, itemStyle: { color: SEMANTIC.muted } },
            { name: "In Progress", value: dist?.in_progress || 0, itemStyle: { color: SEMANTIC.info } },
            {
              name: "In Review",
              value: dist?.awaiting_approval || 0,
              itemStyle: { color: SEMANTIC.warning },
            },
            { name: "Done", value: dist?.completed || 0, itemStyle: { color: SEMANTIC.success } },
          ],
        },
      ],
    }),
    [dist]
  );

  const projectChartOption = useMemo(() => {
    const top = [...projectRows]
      .sort((a, b) => (b.total || 0) - (a.total || 0))
      .slice(0, 10)
      .reverse(); // echarts category axis draws bottom-up
    return {
      textStyle: { fontFamily: FONT_FAMILY },
      tooltip: { ...baseTooltip, trigger: "axis", axisPointer: { type: "shadow" } },
      legend: {
        top: 0,
        icon: "roundRect",
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { color: SEMANTIC.muted, fontSize: 11, fontFamily: FONT_FAMILY },
      },
      grid: baseGrid,
      xAxis: { type: "value", axisLabel, splitLine, minInterval: 1 },
      yAxis: {
        type: "category",
        data: top.map((r) => r.project),
        axisLabel: { ...axisLabel, width: 130, overflow: "truncate" },
      },
      series: [
        {
          name: "Done",
          type: "bar",
          stack: "tasks",
          data: top.map((r) => r.done || 0),
          barMaxWidth: 18,
          itemStyle: { color: PALETTE[0], borderRadius: [4, 0, 0, 4] },
        },
        {
          name: "Remaining",
          type: "bar",
          stack: "tasks",
          data: top.map((r) => Math.max(0, (r.total || 0) - (r.done || 0))),
          barMaxWidth: 18,
          itemStyle: { color: SEMANTIC.muted, borderRadius: [0, 4, 4, 0] },
        },
      ],
    };
  }, [projectRows]);

  const teamChartOption = useMemo(() => {
    const top = [...teamRows].sort((a, b) => (b.done || 0) - (a.done || 0)).slice(0, 12);
    return {
      textStyle: { fontFamily: FONT_FAMILY },
      tooltip: { ...baseTooltip, trigger: "axis", axisPointer: { type: "shadow" } },
      legend: {
        top: 0,
        icon: "roundRect",
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { color: SEMANTIC.muted, fontSize: 11, fontFamily: FONT_FAMILY },
      },
      grid: baseGrid,
      xAxis: {
        type: "category",
        data: top.map((r) => r.name || "Unknown"),
        axisLabel: { ...axisLabel, interval: 0, rotate: top.length > 6 ? 30 : 0 },
      },
      yAxis: { type: "value", name: "Tasks", nameTextStyle: axisLabel, axisLabel, splitLine, minInterval: 1 },
      series: [
        {
          name: "Completed tasks",
          type: "bar",
          data: top.map((r) => r.done || 0),
          barMaxWidth: 28,
          itemStyle: roundedBar(PALETTE[0]),
        },
      ],
    };
  }, [teamRows]);

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
    <div className="space-y-4">
      {/* ---------- Toolbar ---------- */}
      <div className="rounded-xl border border-border bg-card p-3 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="font-medium">From</span>
            <input
              type="date"
              value={range.from || ""}
              max={range.to || undefined}
              onChange={(e) => setRangePart("from", e.target.value)}
              className={INPUT_CLASS}
              aria-label="Report range start date"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="font-medium">To</span>
            <input
              type="date"
              value={range.to || ""}
              min={range.from || undefined}
              onChange={(e) => setRangePart("to", e.target.value)}
              className={INPUT_CLASS}
              aria-label="Report range end date"
            />
          </label>

          <button type="button" onClick={load} disabled={loading} className={BTN_CLASS}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={exporting || loading}
              className={BTN_CLASS}
              title={`Export the ${activeExport.label} table as CSV`}
            >
              <Download className="h-4 w-4" /> Export CSV
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={exporting || loading}
              className={BTN_CLASS}
              title={`Export the ${activeExport.label} table as PDF`}
            >
              <FileText className="h-4 w-4" /> Export PDF
            </button>
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
      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-background p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
                active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* ---------- Tab content ---------- */}
      {loading && !bundle ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary/30 border-t-primary" />
        </div>
      ) : (
        <>
          {tab === "overview" && (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <div className={`${PANEL_CLASS} xl:col-span-2`}>
                <h3 className="text-sm font-semibold text-foreground">Activity trend</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Completed tasks against logged and tracked hours, per day.
                </p>
                <div className="mt-3">
                  <EChart option={trendOption} height={300} />
                </div>
              </div>

              <div className={PANEL_CLASS}>
                <h3 className="text-sm font-semibold text-foreground">Task status</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">Across every task in the organization.</p>
                <div className="mt-3">
                  <EChart option={statusOption} height={300} />
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
                  <EChart option={projectChartOption} height={300} />
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
                <div className="mt-3">
                  <EChart option={teamChartOption} height={300} />
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
                                  : "bg-warning/15 text-warning"
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
  );
}
