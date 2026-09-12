"use client";
import { useAuth } from "@/contexts/AuthContext";
import { getOrgContext } from "@/utils/orgContext";
import { reportIdentity, validateReportAggregate, currentReportState } from "@/utils/reportViewState";
import PlanFeatureBoundary from "@/components/billing/PlanFeatureBoundary";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { defaultRange, TRACKING_CAVEAT } from "@/utils/reportsData";
import { loadReportOverview, loadReportPage, loadReportExportRows } from "@/utils/reportApiData";
import { exportReportCsv } from "@/utils/reportCsvDownload";
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
  // Preserve the selected dates. Invalid/reversed input must produce the API's
  // explicit validation error, not a different report under unchanged controls.
  return { from: range?.from ?? fallback.from, to: range?.to ?? fallback.to };
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

function ReportsDashboardContent() {
  // Lazy init — never call new Date() at module scope.
  const [range, setRange] = useState(() => defaultRange());
  const [result, setResult] = useState(null);
  const { user, authStatus } = useAuth();
  const [exporting, setExporting] = useState(false);
  const exportLock = useRef(false);
  const [tab, setTab] = useState("overview");
  const [nonce, setNonce] = useState(0);
  const [pageSelection, setPageSelection] = useState(null);
  const [tableResult, setTableResult] = useState(null);

  /* ---- data ---- */
  const context = getOrgContext();
  // AuthContext subscribes to login/logout events; storage is also checked at
  // response/export time to close the interval before that reactive update.
  const identity = authStatus === "authenticated" && user ? reportIdentity(context) : null;
  const requestedRange = useMemo(() => normalizeRange(range), [range]);
  const baseScope = JSON.stringify([identity, range.from, range.to, nonce]);
  const pageKey = `${baseScope}:${tab}`;
  const page = pageSelection?.key === pageKey ? pageSelection.page : 1;
  const setPage = value => setPageSelection({ key: pageKey, page: value });
  const scope = `${pageKey}:${page}`;
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const liveScope = useRef(scope);
  liveScope.current = scope;
  const liveBaseScope = useRef(baseScope);
  liveBaseScope.current = baseScope;
  const overviewState = currentReportState(result, baseScope, !!identity);
  const tableState = currentReportState(tableResult, scope, !!identity);
  const bundle = overviewState.bundle;
  const loading = overviewState.loading || (tab !== "overview" && tableState.loading);
  const error = overviewState.error || (tab !== "overview" ? tableState.error : "");
  const isBaseCurrent = useCallback(() => mounted.current && liveBaseScope.current === baseScope && identity !== null && reportIdentity(getOrgContext()) === identity, [baseScope, identity]);
  const isCurrent = useCallback(() => mounted.current && liveScope.current === scope && identity !== null && reportIdentity(getOrgContext()) === identity, [scope, identity]);
  const load = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    if (!identity) return;
    (async () => {
      try {
        const data = await loadReportOverview(requestedRange);
        if (!cancelled && isBaseCurrent()) {
          validateReportAggregate(data, context.organizationId, requestedRange, "overview");
          setResult({ scope: baseScope, bundle: data, error: "" });
        }
      } catch (err) {
        if (!cancelled && isBaseCurrent()) {
          setResult({ scope: baseScope, bundle: null, error: err?.message || "Failed to load reports. Please retry." });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [baseScope, identity, requestedRange, isBaseCurrent, context?.organizationId]);

  useEffect(() => {
    let cancelled = false;
    if (!identity || tab === "overview") return;
    (async () => {
      try {
        const offset = (page - 1) * ROWS_PER_PAGE;
        const data = await loadReportPage(requestedRange, tab, { offset, limit: ROWS_PER_PAGE });
        if (!cancelled && isCurrent()) {
          validateReportAggregate(data, context.organizationId, requestedRange, tab, offset, ROWS_PER_PAGE);
          if (page > 1 && offset >= data.total) {
            setPageSelection({ key: pageKey, page: Math.max(1, Math.ceil(data.total / ROWS_PER_PAGE)) });
            return;
          }
          setTableResult({ scope, bundle: data, error: "" });
        }
      } catch (err) {
        if (!cancelled && isCurrent()) setTableResult({ scope, bundle: null, error: err?.message || "Failed to load report page." });
      }
    })();
    return () => { cancelled = true; };
  }, [scope, identity, requestedRange, tab, page, pageKey, isCurrent, context?.organizationId]);

  const setRangePart = (key, value) => setRange((r) => ({ ...r, [key]: value }));

  /* Overview totals and charts are independent of the visible table page. */
  const kpis = bundle?.kpis || {};
  const trend = useMemo(() => bundle?.trend || { days: [], completed: [], loggedHours: [], trackedHours: [] }, [bundle]);
  const dist = useMemo(() => bundle?.statusCounts || {}, [bundle]);
  const rows = useMemo(() => tableState.bundle?.rows || [], [tableState.bundle]);
  const projectRows = useMemo(() => tab === "projects" ? rows : [], [tab, rows]);
  const teamRows = useMemo(() => tab === "team" ? rows : [], [tab, rows]);
  const timeRows = useMemo(() => tab === "time" ? rows : [], [tab, rows]);
  const delayRows = useMemo(() => tab === "delays" ? rows : [], [tab, rows]);
  const pagedTimeRows = timeRows;
  const pagedDelayRows = delayRows;
  const tableTotal = tableState.bundle?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(tableTotal / ROWS_PER_PAGE));
  const overviewRows = useMemo(() => trend.days.map((date, i) => ({ date,
    completed: trend.completed[i], loggedHours: trend.loggedHours[i], trackedHours: trend.trackedHours[i],
  })), [trend]);
  const totalTimedHours = bundle?.totals?.timedHours ?? 0;
  const hasTrend = trend.days.length > 0 && (sum(trend.completed) > 0 || sum(trend.loggedHours) > 0 || sum(trend.trackedHours) > 0);
  const hasStatus = (dist.pending || 0) + (dist.in_progress || 0) + (dist.awaiting_approval || 0) + (dist.completed || 0) + (dist.rejected || 0) > 0;

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
    // The five counts already on screen — no new aggregation, just the total so
    // the ring has a number in the middle instead of a hole.
    const total =
      (dist?.pending || 0) +
      (dist?.in_progress || 0) +
      (dist?.awaiting_approval || 0) +
      (dist?.completed || 0) +
      (dist?.rejected || 0);
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
        ...legendFor(5),
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
            { name: "Rejected", value: dist?.rejected || 0, itemStyle: { color: SEMANTIC.danger } },
          ],
        },
      ],
    };
  }, [dist]);

  const projectTop = useMemo(() => [...(bundle?.projectTop || [])].reverse(), [bundle]);

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

  const teamTop = useMemo(() => [...(bundle?.teamTop || [])].reverse(), [bundle]);

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
    if (!bundle || loading || error || exportLock.current || !isCurrent()) return;
    exportLock.current = true;
    setExporting(true);
    try {
      if (tab !== "overview") {
        await exportReportCsv(requestedRange, tab, { shouldContinue: isCurrent, filename: activeExport.file });
        return;
      }
      exportCsv({
        columns: activeExport.columns,
        rows: activeExport.rows || [],
        filename: activeExport.file,
        shouldContinue: () => isCurrent() && !!bundle && !loading && !error,
      });
    } catch (err) {
      if (isCurrent()) showError("Export failed", err?.message || String(err));
    } finally {
      exportLock.current = false;
      if (mounted.current) setExporting(false);
    }
  }, [activeExport, bundle, loading, error, isCurrent, tab, requestedRange]);

  const handleExportPdf = useCallback(async () => {
    if (!bundle || loading || error || exportLock.current || !isCurrent()) return;
    exportLock.current = true;
    setExporting(true);
    try {
      const safe = normalizeRange(range);
      const rows = tab === "overview" ? overviewRows : await loadReportExportRows(requestedRange, tab, isCurrent);
      if (!rows || !isCurrent()) return;
      await exportPdf({
        title: activeExport.label,
        subtitle: `Range: ${safe.from} → ${safe.to}`,
        columns: activeExport.columns,
        rows,
        filename: activeExport.file,
        meta: [`Rows: ${rows.length}`],
        shouldContinue: isCurrent,
      });
    } catch (err) {
      if (isCurrent()) showError("Export failed", err?.message || String(err));
    } finally {
      exportLock.current = false;
      if (mounted.current) setExporting(false);
    }
  }, [activeExport, range, bundle, loading, error, isCurrent, tab, requestedRange, overviewRows]);

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
                disabled={exporting || loading || !!error || !bundle}
                title={`Export the ${activeExport.label} table as CSV`}
              >
                <Download aria-hidden="true" /> Export CSV
              </Button>
              <Button
                variant="outline"
                onClick={handleExportPdf}
                disabled={exporting || loading || !!error || !bundle}
                title={`Export the ${activeExport.label} table as PDF`}
              >
                <FileText aria-hidden="true" /> Export PDF
              </Button>
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">Report dates and daily totals use UTC.</p>
        {error && <div role="alert" className={PANEL_CLASS}><p className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={load} disabled={!identity} className="mt-3">Retry reports</Button></div>}

        {/* ---------- KPI strip ---------- */}
        {bundle && <>
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

        </>}

        {/* ---------- Tab content ---------- */}
        {loading ? (
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
        ) : bundle && !error ? (
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
                    {projectTop.length > 0 ? (
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
                  <TablePager page={page} pageCount={pageCount} total={tableTotal} shown={rows.length} onPage={setPage} />
                </div>
              </div>
            )}

            {tab === "team" && (
              <div className="space-y-4">
                <div className={PANEL_CLASS}>
                  <h3 className="text-sm font-semibold text-foreground">Completed tasks per person</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">Top twelve, most completed first.</p>
                  <div className="mt-3">
                    {teamTop.length > 0 ? (
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
                            <tr key={`${r.userType}:${r.userId}`} className="border-t border-border hover:bg-muted/40">
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
                  <TablePager page={page} pageCount={pageCount} total={tableTotal} shown={rows.length} onPage={setPage} />
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
                              key={r.id}
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
                      page={page}
                      pageCount={pageCount}
                      total={tableTotal}
                      shown={pagedTimeRows.length}
                      onPage={setPage}
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
                            key={r.id}
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
                    page={page}
                    pageCount={pageCount}
                    total={tableTotal}
                    shown={pagedDelayRows.length}
                    onPage={setPage}
                  />
                )}
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

export default function ReportsDashboard() {
  return <PlanFeatureBoundary feature="reports"><ReportsDashboardContent /></PlanFeatureBoundary>;
}
