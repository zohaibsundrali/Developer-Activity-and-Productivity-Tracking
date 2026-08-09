"use client";
import { useState, useMemo } from "react";
import { GanttChartSquare } from "lucide-react";
import EChart from "@/components/charts/EChart";
import {
  GANTT_STATUS_COLORS,
  SEMANTIC,
  textStyle,
  baseGrid,
  baseTooltip,
  axisLabel,
  axisLine,
  splitLine,
} from "@/components/charts/chartTheme";
import { EmptyState, StatusPill, Tabs } from "@/components/ui";

// Task status → StatusPill state, so the list view carries a glyph and not
// just a tinted chip.
const GANTT_STATUS_PILL = {
  completed: "success",
  reviewed: "success",
  awaiting_approval: "pending",
  in_progress: "active",
  pending: "inactive",
  rejected: "error",
};

/**
 * Enhanced Gantt Chart Component
 * 
 * Features:
 * - Visual timeline with task bars
 * - Color-coded status indicators
 * - On-time/Late completion markers
 * - Today line for reference
 * - Productivity points display
 */
export default function EnhancedGanttChart({ tasks, projectName }) {
  const [viewMode, setViewMode] = useState("chart"); // chart, list

  // Status colours come from the shared chart theme so the bars, the legend and
  // the list chips can never drift apart (they used to be two separate maps).
  const statusColors = {
    completed: GANTT_STATUS_COLORS.completed,
    awaiting_approval: GANTT_STATUS_COLORS.awaiting_approval,
    in_progress: GANTT_STATUS_COLORS.in_progress,
    pending: GANTT_STATUS_COLORS.pending,
    rejected: GANTT_STATUS_COLORS.rejected,
  };

  // Calculate chart data
  const chartData = useMemo(() => {
    if (!tasks || tasks.length === 0) return [];

    // Find the date range
    const validTasks = tasks.filter(t => 
      (t.start_date || t.startDate) && (t.end_date || t.endDate)
    );

    if (validTasks.length === 0) return [];

    const startDates = validTasks.map(t => new Date(t.start_date || t.startDate));
    const endDates = validTasks.map(t => new Date(t.end_date || t.endDate));
    const minDate = new Date(Math.min(...startDates.map(d => d.getTime())));
    const maxDate = new Date(Math.max(...endDates.map(d => d.getTime())));

    // Add padding
    minDate.setDate(minDate.getDate() - 1);
    maxDate.setDate(maxDate.getDate() + 1);

    const totalDays = Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24));

    return validTasks.map((task, index) => {
      const startDate = new Date(task.start_date || task.startDate);
      const endDate = new Date(task.end_date || task.endDate);
      const startDay = Math.ceil((startDate - minDate) / (1000 * 60 * 60 * 24));
      const duration = Math.max(1, Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1);

      // Calculate if completed on time
      let isOnTime = null;
      if (task.status === 'completed') {
        const completionDate = task.actual_completion_date 
          ? new Date(task.actual_completion_date)
          : task.submitted_at 
          ? new Date(task.submitted_at)
          : null;
        
        if (completionDate) {
          isOnTime = completionDate <= endDate;
        } else {
          isOnTime = task.is_on_time;
        }
      }

      return {
        name: task.task_title || task.title,
        start: startDay,
        duration: duration,
        status: task.status || 'pending',
        isOnTime: isOnTime,
        productivityPoints: task.productivity_points || 0,
        startDate: startDate.toLocaleDateString(),
        endDate: endDate.toLocaleDateString(),
        index: index,
      };
    });
  }, [tasks]);

  // Calculate today's position
  const todayPosition = useMemo(() => {
    if (!tasks || tasks.length === 0) return null;

    const validTasks = tasks.filter(t => 
      (t.start_date || t.startDate) && (t.end_date || t.endDate)
    );

    if (validTasks.length === 0) return null;

    const startDates = validTasks.map(t => new Date(t.start_date || t.startDate));
    const minDate = new Date(Math.min(...startDates.map(d => d.getTime())));
    minDate.setDate(minDate.getDate() - 1);

    const today = new Date();
    const daysSinceStart = Math.ceil((today - minDate) / (1000 * 60 * 60 * 24));

    return daysSinceStart;
  }, [tasks]);

  // Calculate statistics
  const stats = useMemo(() => {
    const total = tasks?.length || 0;
    const completed = tasks?.filter(t => t.status === 'completed').length || 0;
    const onTime = tasks?.filter(t => t.status === 'completed' && t.is_on_time).length || 0;
    const late = completed - onTime;
    const pending = tasks?.filter(t => ['pending', 'in_progress', 'awaiting_approval'].includes(t.status)).length || 0;
    const productivityPoints = onTime - late;

    // The footer states the formula in words — each task carries 100/total
    // percent of weight, on-time adds it and late subtracts it — but the number
    // it printed divided by the COMPLETED count instead, so the sentence and the
    // figure beside it disagreed whenever some tasks were still open (5 tasks, 2
    // completed on time read "100.0%" under a sentence describing 40%). The
    // percentage is computed once here, from the denominator the sentence names,
    // and the footer's colour and value both read it.
    const taskWeight = total > 0 ? 100 / total : 0;
    const productivityPct = total > 0 ? ((onTime - late) / total) * 100 : 0;

    return { total, completed, onTime, late, pending, productivityPoints, taskWeight, productivityPct };
  }, [tasks]);

  // ECharts horizontal stacked-bar Gantt option (offset placeholder + colored duration)
  const chartOption = useMemo(() => {
    const onTimeRow = (row) =>
      row.status === "completed"
        ? row.isOnTime
          ? `<div style="color:${SEMANTIC.success}">✓ Completed on time (+1)</div>`
          : `<div style="color:${SEMANTIC.danger}">✗ Completed late (−1)</div>`
        : "";

    return {
      textStyle,
      // Extra bottom padding leaves room for the x-axis title.
      grid: { ...baseGrid, left: 8, right: 30, top: 20, bottom: 28, containLabel: true },
      tooltip: {
        trigger: "item",
        axisPointer: { type: "shadow" },
        ...baseTooltip,
        formatter: (params) => {
          const row = chartData[params.dataIndex];
          if (!row) return "";
          return (
            `<div style="font-weight:600;margin-bottom:4px">${row.name}</div>` +
            `<div>Start: ${row.startDate}</div>` +
            `<div>End: ${row.endDate}</div>` +
            `<div>Duration: ${row.duration} days</div>` +
            `<div style="text-transform:capitalize">Status: ${row.status.replace("_", " ")}</div>` +
            onTimeRow(row)
          );
        },
      },
      xAxis: {
        type: "value",
        min: 0,
        name: "Days from project start",
        nameLocation: "middle",
        nameGap: 26,
        nameTextStyle: axisLabel,
        minInterval: 1,
        // hideOverlap stops "Day 12"/"Day 13" printing on top of each other
        // once a long project squeezes the axis at narrow widths.
        axisLabel: { ...axisLabel, hideOverlap: true, formatter: (value) => `Day ${value}` },
        axisLine,
        splitLine,
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: chartData.map((d) => d.name),
        // Task titles are free text and used to run into the plot area. They
        // now truncate at a fixed width with the full name in the tooltip.
        axisLabel: {
          ...axisLabel,
          fontSize: 12,
          width: 150,
          overflow: "truncate",
          hideOverlap: true,
        },
        axisLine,
        axisTick: { show: false },
      },
      series: [
        {
          // Transparent placeholder = start offset
          name: "offset",
          type: "bar",
          stack: "g",
          silent: true,
          itemStyle: { color: "transparent" },
          tooltip: { show: false },
          data: chartData.map((d) => d.start),
        },
        {
          // Colored duration bar
          name: "duration",
          type: "bar",
          stack: "g",
          barWidth: 24,
          data: chartData.map((d) => ({
            value: d.duration,
            itemStyle: {
              color: GANTT_STATUS_COLORS[d.status] || GANTT_STATUS_COLORS.pending,
              borderRadius: 4,
            },
          })),
          markLine: todayPosition
            ? {
                symbol: "none",
                silent: true,
                data: [{ xAxis: todayPosition }],
                lineStyle: { color: SEMANTIC.danger, type: "dashed", width: 1 },
                label: { formatter: "Today", color: SEMANTIC.danger, fontSize: 12, position: "insideEndTop" },
              }
            : undefined,
        },
      ],
    };
  }, [chartData, todayPosition]);

  if (!tasks || tasks.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5">
        <h3 className="mb-4 text-base font-semibold tracking-tight text-foreground">Project timeline</h3>
        <EmptyState
          icon={GanttChartSquare}
          title="No tasks to plot yet"
          description="Once tasks on this project have a start and end date, their timeline appears here."
        />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold tracking-tight text-foreground">
            {projectName || "Project"} — timeline
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">Every task, plotted against the project calendar.</p>
        </div>
        <Tabs
          tabs={[
            { id: "chart", label: "Chart" },
            { id: "list", label: "List" },
          ]}
          active={viewMode}
          onChange={setViewMode}
          aria-label="Timeline view"
          className="shrink-0"
        />
      </div>

      {/* Stats banner — tabular figures so the six numbers line up. */}
      <dl className="grid grid-cols-2 divide-x divide-y divide-border border-b border-border bg-muted/40 sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
        {[
          { label: "Total tasks", value: stats.total, className: "text-foreground" },
          { label: "Completed", value: stats.completed, className: "text-success" },
          { label: "On time", value: stats.onTime, className: "text-success" },
          { label: "Late", value: stats.late, className: "text-destructive" },
          { label: "Pending", value: stats.pending, className: "text-warning" },
          {
            label: "Points",
            value: `${stats.productivityPoints >= 0 ? "+" : ""}${stats.productivityPoints}`,
            className: stats.productivityPoints >= 0 ? "text-success" : "text-destructive",
          },
        ].map((s) => (
          <div key={s.label} className="p-4 text-center">
            <dd className={`text-2xl font-semibold tabular-nums ${s.className}`}>{s.value}</dd>
            <dt className="text-xs text-muted-foreground">{s.label}</dt>
          </div>
        ))}
      </dl>

      {/* Content */}
      <div className="p-4 sm:p-6">
        {viewMode === "chart" ? (
          <>
            {/* Legend */}
            <div className="flex flex-wrap gap-4 mb-4">
              {Object.entries(statusColors).map(([status, color]) => (
                <div key={status} className="flex items-center">
                  <div className="w-4 h-4 rounded" style={{ backgroundColor: color }}></div>
                  <span className="ml-2 text-sm text-muted-foreground capitalize">
                    {status.replace('_', ' ')}
                  </span>
                </div>
              ))}
            </div>

            {/* Gantt chart.
                Height grows with the number of rows: at a fixed h-96 anything
                past ~10 tasks squeezed the category axis until the task names
                collided. 34px per row keeps every label on its own line, and
                the floor stops a one-task chart from collapsing. */}
            <div className="overflow-x-auto">
              <div className="min-w-[700px]">
                <EChart
                  option={chartOption}
                  height={Math.max(260, chartData.length * 34 + 80)}
                />
              </div>
            </div>
          </>
        ) : (
          /* List View */
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] divide-y divide-border text-sm">
              <thead>
                <tr className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-4 py-3 text-left">Task</th>
                  <th scope="col" className="px-4 py-3 text-left">Start</th>
                  <th scope="col" className="px-4 py-3 text-left">End</th>
                  <th scope="col" className="px-4 py-3 text-right">Duration</th>
                  <th scope="col" className="px-4 py-3 text-left">Status</th>
                  <th scope="col" className="px-4 py-3 text-left">On time</th>
                  <th scope="col" className="px-4 py-3 text-right">Points</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {chartData.map((task, index) => (
                  <tr key={index} className="h-12 transition-colors duration-150 hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <p className="max-w-[24rem] truncate font-medium text-foreground" title={task.name}>
                        {task.name}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted-foreground">{task.startDate}</td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted-foreground">{task.endDate}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {task.duration} days
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill
                        status={GANTT_STATUS_PILL[task.status] || "unknown"}
                        label={task.status.replace("_", " ")}
                        size="sm"
                        className="capitalize"
                      />
                    </td>
                    <td className="px-4 py-3">
                      {task.status === "completed" ? (
                        task.isOnTime ? (
                          <span className="text-success">✓ Yes</span>
                        ) : (
                          <span className="text-destructive">✗ No</span>
                        )
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {task.status === "completed" ? (
                        <span
                          className={`font-semibold tabular-nums ${
                            task.isOnTime ? "text-success" : "text-destructive"
                          }`}
                        >
                          {task.isOnTime ? "+1" : "−1"}
                        </span>
                      ) : (
                        <span className="tabular-nums text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Productivity Formula */}
      <div className="p-4 bg-muted/50 border-t border-border">
        <div className="text-sm text-muted-foreground">
          <strong>Productivity Formula:</strong> Each task = {stats.taskWeight.toFixed(1)}% weight.
          On-time completion = +weight, Late completion = -weight.
          Current: {stats.onTime} on-time × {stats.taskWeight.toFixed(1)}% - {stats.late} late × {stats.taskWeight.toFixed(1)}% =
          <span className={`font-bold ml-1 ${stats.productivityPct >= 0 ? 'text-success' : 'text-destructive'}`}>
            {stats.productivityPct.toFixed(1)}% productivity
          </span>
        </div>
      </div>
    </div>
  );
}
