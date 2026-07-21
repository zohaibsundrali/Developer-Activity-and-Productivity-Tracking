"use client";
import { useState, useMemo } from "react";
import EChart from "@/components/charts/EChart";
import {
  GANTT_STATUS_COLORS,
  textStyle,
  baseGrid,
  baseTooltip,
  axisLabel,
  axisLine,
  splitLine,
} from "@/components/charts/chartTheme";

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
  
  // Status colors
  const statusColors = {
    completed: "#10b981", // green
    awaiting_approval: "#f59e0b", // amber
    in_progress: "#3b82f6", // blue
    pending: "#9ca3af", // gray
    rejected: "#ef4444", // red
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

    return { total, completed, onTime, late, pending, productivityPoints };
  }, [tasks]);

  // ECharts horizontal stacked-bar Gantt option (offset placeholder + colored duration)
  const chartOption = useMemo(() => {
    const onTimeRow = (row) =>
      row.status === "completed"
        ? row.isOnTime
          ? "<div style=\"color:#16a34a\">✓ Completed on time (+1)</div>"
          : "<div style=\"color:#ef4444\">✗ Completed late (-1)</div>"
        : "";

    return {
      textStyle,
      grid: { ...baseGrid, left: 8, right: 30, top: 20, bottom: 8, containLabel: true },
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
        axisLabel: { ...axisLabel, formatter: (value) => `Day ${value}` },
        axisLine,
        splitLine,
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: chartData.map((d) => d.name),
        axisLabel: { ...axisLabel, fontSize: 12 },
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
                lineStyle: { color: "#ef4444", type: "dashed", width: 1 },
                label: { formatter: "Today", color: "#ef4444", fontSize: 12, position: "insideEndTop" },
              }
            : undefined,
        },
      ],
    };
  }, [chartData, todayPosition]);

  if (!tasks || tasks.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card shadow-card p-6">
        <h3 className="text-xl font-bold tracking-tight text-foreground mb-4">Project Timeline</h3>
        <div className="text-center py-12 text-muted-foreground">
          <svg className="w-16 h-16 mx-auto text-muted-foreground mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
          </svg>
          <p>No tasks with dates to display</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
      {/* Header */}
      <div className="bg-primary p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-xl font-bold tracking-tight text-primary-foreground">
              {projectName || "Project"} - Gantt Chart
            </h3>
            <p className="text-primary-foreground/80 text-sm mt-1">Visual timeline of all tasks</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setViewMode("chart")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                viewMode === "chart"
                  ? "bg-card text-primary"
                  : "bg-white/20 text-primary-foreground hover:bg-white/30"
              }`}
            >
              Chart
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                viewMode === "list"
                  ? "bg-card text-primary"
                  : "bg-white/20 text-primary-foreground hover:bg-white/30"
              }`}
            >
              List
            </button>
          </div>
        </div>
      </div>

      {/* Stats Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-6 divide-x divide-border bg-muted/50 border-b border-border">
        <div className="p-4 text-center">
          <p className="text-2xl font-bold text-foreground">{stats.total}</p>
          <p className="text-xs text-muted-foreground">Total Tasks</p>
        </div>
        <div className="p-4 text-center">
          <p className="text-2xl font-bold text-success">{stats.completed}</p>
          <p className="text-xs text-muted-foreground">Completed</p>
        </div>
        <div className="p-4 text-center">
          <p className="text-2xl font-bold text-success">{stats.onTime}</p>
          <p className="text-xs text-muted-foreground">On Time</p>
        </div>
        <div className="p-4 text-center">
          <p className="text-2xl font-bold text-destructive">{stats.late}</p>
          <p className="text-xs text-muted-foreground">Late</p>
        </div>
        <div className="p-4 text-center">
          <p className="text-2xl font-bold text-warning">{stats.pending}</p>
          <p className="text-xs text-muted-foreground">Pending</p>
        </div>
        <div className="p-4 text-center">
          <p className={`text-2xl font-bold ${stats.productivityPoints >= 0 ? 'text-success' : 'text-destructive'}`}>
            {stats.productivityPoints >= 0 ? '+' : ''}{stats.productivityPoints}
          </p>
          <p className="text-xs text-muted-foreground">Points</p>
        </div>
      </div>

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

            {/* Gantt Chart */}
            <div className="overflow-x-auto">
              <div className="h-96 min-w-[700px]">
                <EChart option={chartOption} height="100%" />
              </div>
            </div>
          </>
        ) : (
          /* List View */
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Task</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">Start</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">End</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">Duration</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">On Time</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">Points</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {chartData.map((task, index) => (
                  <tr key={index} className="hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{task.name}</p>
                    </td>
                    <td className="px-4 py-3 text-center text-muted-foreground">{task.startDate}</td>
                    <td className="px-4 py-3 text-center text-muted-foreground">{task.endDate}</td>
                    <td className="px-4 py-3 text-center text-muted-foreground">{task.duration} days</td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className="px-2 py-1 rounded-full text-xs font-medium capitalize"
                        style={{
                          backgroundColor: `${statusColors[task.status]}20`,
                          color: statusColors[task.status]
                        }}
                      >
                        {task.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {task.status === 'completed' ? (
                        task.isOnTime ? (
                          <span className="text-success">✓ Yes</span>
                        ) : (
                          <span className="text-destructive">✗ No</span>
                        )
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {task.status === 'completed' ? (
                        <span className={`font-bold ${task.isOnTime ? 'text-success' : 'text-destructive'}`}>
                          {task.isOnTime ? '+1' : '-1'}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
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
          <strong>Productivity Formula:</strong> Each task = {(100 / (tasks?.length || 1)).toFixed(1)}% weight.
          On-time completion = +weight, Late completion = -weight.
          Current: {stats.onTime} on-time × {(100 / (tasks?.length || 1)).toFixed(1)}% - {stats.late} late × {(100 / (tasks?.length || 1)).toFixed(1)}% =
          <span className={`font-bold ml-1 ${((stats.onTime - stats.late) / (tasks?.length || 1) * 100) >= 0 ? 'text-success' : 'text-destructive'}`}>
            {(((stats.onTime - stats.late) / (stats.completed || 1)) * 100).toFixed(1)}% productivity
          </span>
        </div>
      </div>
    </div>
  );
}
