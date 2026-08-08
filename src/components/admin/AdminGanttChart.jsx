"use client";
import { useState, useMemo } from "react";
import EChart from "@/components/charts/EChart";
import {
  textStyle,
  baseTooltip,
  axisLabel,
  axisLine,
  splitLine,
  SEMANTIC,
  GANTT_STATUS_COLORS,
} from "@/components/charts/chartTheme";
import { Badge, Button, DataTable, EmptyState, Tabs } from "@/components/ui";
import { SELECT_CLASS } from "@/components/admin/views/viewKit";
import { GanttChartSquare, BarChart3, Table as TableIcon, FileX } from "lucide-react";

/**
 * Admin Gantt Chart Component
 *
 * Features:
 * - Visual timeline with task bars
 * - Color-coded status indicators (pending, in_progress, awaiting_approval, completed, rejected)
 * - Developer assignment display
 * - On-time/Late completion markers
 * - Today line for reference
 * - Productivity points display
 * - Real-time updates via Supabase subscriptions
 */

// Status labels for display
const statusLabels = {
  completed: "Completed",
  awaiting_approval: "Awaiting Approval",
  in_progress: "In Progress",
  pending: "Pending",
  rejected: "Rejected",
};

// The DOM legend and the status chips use design tokens; only the canvas, which
// cannot read a CSS variable, uses the mirrored hex values from chartTheme.
const STATUS_DOT_CLASS = {
  completed: "bg-success",
  awaiting_approval: "bg-warning",
  in_progress: "bg-info",
  pending: "bg-muted-foreground",
  rejected: "bg-destructive",
};

const STATUS_BADGE_VARIANT = {
  completed: "success",
  awaiting_approval: "warning",
  in_progress: "info",
  pending: "secondary",
  rejected: "destructive",
};

// The theme's surface colour, reused as the label colour drawn on top of a
// filled bar. Referenced rather than re-typed so there is still one source.
const ON_BAR_TEXT = baseTooltip.backgroundColor;
const TOOLTIP_INK = textStyle.color;
const TOOLTIP_MUTED = axisLabel.color;
const TOOLTIP_RULE = splitLine.lineStyle.color;

export default function AdminGanttChart({
  tasks,
  projectName,
  developers,
  showProgress = false,
  showDeveloperFilter = true,
}) {
  const [viewMode, setViewMode] = useState("chart"); // chart, list, table
  const [filterStatus, setFilterStatus] = useState("all"); // all, pending, in_progress, completed, etc.
  const [filterDeveloper, setFilterDeveloper] = useState("all");

  const statusProgress = {
    completed: 100,
    awaiting_approval: 80,
    in_progress: 50,
    pending: 0,
    rejected: 0,
  };

  const getProgressPercent = (task) => {
    const explicit = task?.progress_percentage;
    if (explicit !== undefined && explicit !== null && explicit !== "") {
      const n = Number(explicit);
      if (Number.isFinite(n)) return Math.max(0, Math.min(100, Math.round(n)));
    }
    return statusProgress[task?.status] ?? 0;
  };

  // Status colors mapped to task statuses (canvas only — see note above).
  const statusColors = GANTT_STATUS_COLORS;

  // Filter tasks based on selected filters
  const filteredTasks = useMemo(() => {
    let filtered = tasks || [];

    if (filterStatus !== "all") {
      filtered = filtered.filter(t => t.status === filterStatus);
    }

    if (filterDeveloper !== "all") {
      filtered = filtered.filter(t => t.developer_id === filterDeveloper);
    }

    return filtered;
  }, [tasks, filterStatus, filterDeveloper]);

  // Calculate chart data from tasks
  const chartData = useMemo(() => {
    if (!filteredTasks || filteredTasks.length === 0) return [];

    // Find tasks with valid dates
    const validTasks = filteredTasks.filter(t =>
      t.start_date && t.end_date
    );

    if (validTasks.length === 0) return [];

    // Find date range
    const startDates = validTasks.map(t => new Date(t.start_date));
    const endDates = validTasks.map(t => new Date(t.end_date));
    const minDate = new Date(Math.min(...startDates.map(d => d.getTime())));
    const maxDate = new Date(Math.max(...endDates.map(d => d.getTime())));

    // Add padding
    minDate.setDate(minDate.getDate() - 1);
    maxDate.setDate(maxDate.getDate() + 1);

    return validTasks.map((task, index) => {
      const startDate = new Date(task.start_date);
      const endDate = new Date(task.end_date);
      const startDay = Math.ceil((startDate - minDate) / (1000 * 60 * 60 * 24));
      const duration = Math.max(1, Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1);

      const progressPercent = getProgressPercent(task);
      const progressDurationRaw = (duration * progressPercent) / 100;
      const progressDuration = Math.max(0, Math.min(duration, Math.round(progressDurationRaw * 10) / 10));
      const remainingDuration = Math.max(0, Math.round((duration - progressDuration) * 10) / 10);

      // Calculate if completed on time
      let isOnTime = null;
      let completionStatus = null;

      if (task.status === 'completed') {
        const completionDate = task.actual_completion_date
          ? new Date(task.actual_completion_date)
          : task.submitted_at
            ? new Date(task.submitted_at)
            : null;

        if (completionDate) {
          isOnTime = completionDate <= endDate;
          completionStatus = isOnTime ? "On Time" : "Late";
        } else {
          isOnTime = task.is_on_time !== null ? task.is_on_time : null;
          completionStatus = isOnTime === true ? "On Time" : isOnTime === false ? "Late" : "Unknown";
        }
      }

      // Get developer info
      const developer = developers && task.developer_id ? developers[task.developer_id] : null;

      return {
        name: task.task_title || 'Untitled Task',
        start: startDay,
        duration: duration,
        progressDuration,
        remainingDuration,
        status: task.status || 'pending',
        progressPercent,
        isOnTime: isOnTime,
        completionStatus: completionStatus,
        productivityPoints: task.productivity_points || 0,
        startDate: startDate.toLocaleDateString(),
        endDate: endDate.toLocaleDateString(),
        developer: developer?.name || 'Unassigned',
        developerEmail: developer?.email || '',
        index: index,
        taskId: task.id,
        description: task.task_description || '',
      };
    });
  }, [filteredTasks, developers]);

  // Calculate today's position on the chart
  const todayPosition = useMemo(() => {
    if (!filteredTasks || filteredTasks.length === 0) return null;

    const validTasks = filteredTasks.filter(t =>
      t.start_date && t.end_date
    );

    if (validTasks.length === 0) return null;

    const startDates = validTasks.map(t => new Date(t.start_date));
    const minDate = new Date(Math.min(...startDates.map(d => d.getTime())));
    minDate.setDate(minDate.getDate() - 1);

    const today = new Date();
    const daysSinceStart = Math.ceil((today - minDate) / (1000 * 60 * 60 * 24));

    return daysSinceStart;
  }, [filteredTasks]);

  // Calculate statistics
  const stats = useMemo(() => {
    const total = filteredTasks?.length || 0;
    const completed = filteredTasks?.filter(t => t.status === 'completed').length || 0;
    const inProgress = filteredTasks?.filter(t => t.status === 'in_progress').length || 0;
    const awaitingApproval = filteredTasks?.filter(t => t.status === 'awaiting_approval').length || 0;
    const pending = filteredTasks?.filter(t => t.status === 'pending').length || 0;
    const rejected = filteredTasks?.filter(t => t.status === 'rejected').length || 0;
    const onTime = filteredTasks?.filter(t => t.status === 'completed' && t.is_on_time === true).length || 0;
    const late = filteredTasks?.filter(t => t.status === 'completed' && t.is_on_time === false).length || 0;
    const productivityPoints = onTime - late;

    return {
      total,
      completed,
      inProgress,
      awaitingApproval,
      pending,
      rejected,
      onTime,
      late,
      productivityPoints
    };
  }, [filteredTasks]);

  // ECharts tooltip formatter — reads the original chartData row by index and
  // reproduces the previous CustomTooltip content (title, dates, status, completion).
  const ganttTooltipFormatter = (params) => {
    const p = Array.isArray(params) ? params[0] : params;
    const data = p && chartData[p.dataIndex];
    if (!data) return "";

    const statusColor = statusColors[data.status] || statusColors.pending;
    let html = `<div style="max-width:240px">`;
    html += `<div style="font-weight:700;color:${TOOLTIP_INK};margin-bottom:6px">${data.name}</div>`;
    html += `<div style="font-size:12px;color:${TOOLTIP_INK};line-height:1.5">`;
    html += `<div><span style="font-weight:500">Developer:</span> ${data.developer}</div>`;
    if (data.developerEmail) {
      html += `<div style="font-size:11px;color:${TOOLTIP_MUTED}">${data.developerEmail}</div>`;
    }
    html += `<div><span style="font-weight:500">Start:</span> ${data.startDate}</div>`;
    html += `<div><span style="font-weight:500">End:</span> ${data.endDate}</div>`;
    html += `<div><span style="font-weight:500">Duration:</span> ${data.duration} days</div>`;
    if (showProgress) {
      html += `<div><span style="font-weight:500">Progress:</span> ${data.progressPercent}%</div>`;
    }
    html += `<div><span style="font-weight:500">Status:</span> <span style="font-weight:600;color:${statusColor}">${statusLabels[data.status] || data.status}</span></div>`;
    if (data.status === "completed" && data.completionStatus) {
      if (data.completionStatus === "On Time") {
        html += `<div><span style="font-weight:500">Completion:</span> <span style="font-weight:600;color:${SEMANTIC.success}">✓ On Time (+1)</span></div>`;
      } else if (data.completionStatus === "Late") {
        html += `<div><span style="font-weight:500">Completion:</span> <span style="font-weight:600;color:${SEMANTIC.danger}">✗ Late (-1)</span></div>`;
      } else {
        html += `<div><span style="color:${TOOLTIP_MUTED}">${data.completionStatus}</span></div>`;
      }
    }
    if (data.description) {
      html += `<div style="font-size:11px;color:${TOOLTIP_MUTED};margin-top:8px;padding-top:8px;border-top:1px solid ${TOOLTIP_RULE}">${data.description}</div>`;
    }
    html += `</div></div>`;
    return html;
  };

  // Bar thickness follows the row count, so two tasks are not drawn as two
  // ribbons in a 600px void and forty are not crushed into invisible slivers.
  const barWidth = chartData.length > 24 ? 12 : chartData.length > 12 ? 18 : 28;
  const chartHeight = Math.min(900, Math.max(280, chartData.length * (barWidth + 14) + 60));

  // Build the ECharts Gantt option from the existing computed chartData.
  const ganttOption = {
    textStyle,
    grid: { left: 8, right: 30, top: 20, bottom: 28, containLabel: true },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      ...baseTooltip,
      confine: true,
      formatter: ganttTooltipFormatter,
    },
    xAxis: {
      type: "value",
      min: 0,
      minInterval: 1,
      axisLabel: { ...axisLabel, hideOverlap: true, formatter: "Day {value}" },
      axisLine,
      splitLine: { ...splitLine, show: true },
    },
    yAxis: {
      type: "category",
      data: chartData.map((d) => d.name),
      inverse: true,
      axisLabel: { ...axisLabel, width: 150, overflow: "truncate" },
      axisLine,
      axisTick: { show: false },
    },
    series: [
      // Transparent placeholder (start offset)
      {
        type: "bar",
        stack: "a",
        barWidth,
        silent: true,
        itemStyle: { color: "transparent" },
        tooltip: { show: false },
        data: chartData.map((d) => d.start),
      },
      ...(showProgress
        ? [
            // Filled progress segment
            {
              type: "bar",
              stack: "a",
              barWidth,
              label: {
                show: barWidth >= 18,
                position: "inside",
                color: ON_BAR_TEXT,
                fontSize: 11,
                fontWeight: 700,
                formatter: (p) => {
                  const d = chartData[p.dataIndex];
                  return d ? `${d.progressPercent}%` : "";
                },
              },
              data: chartData.map((entry) => ({
                value: entry.progressDuration,
                itemStyle: {
                  color:
                    GANTT_STATUS_COLORS[entry.status] ||
                    GANTT_STATUS_COLORS.pending,
                  borderRadius:
                    entry.remainingDuration === 0
                      ? [4, 4, 4, 4]
                      : [4, 0, 0, 4],
                },
              })),
            },
            // Remaining segment (same color, lighter)
            {
              type: "bar",
              stack: "a",
              barWidth,
              data: chartData.map((entry) => ({
                value: entry.remainingDuration,
                itemStyle: {
                  color:
                    GANTT_STATUS_COLORS[entry.status] ||
                    GANTT_STATUS_COLORS.pending,
                  opacity: 0.25,
                  borderRadius:
                    entry.progressDuration === 0
                      ? [4, 4, 4, 4]
                      : [0, 4, 4, 0],
                },
              })),
            },
          ]
        : [
            // Default Admin duration bar
            {
              type: "bar",
              stack: "a",
              barWidth,
              data: chartData.map((entry) => ({
                value: entry.duration,
                itemStyle: {
                  color:
                    GANTT_STATUS_COLORS[entry.status] ||
                    GANTT_STATUS_COLORS.pending,
                  borderRadius: [4, 4, 4, 4],
                },
              })),
            },
          ]),
    ],
  };

  // Attach the "Today" reference line as a markLine on the last colored series.
  if (todayPosition) {
    ganttOption.series[ganttOption.series.length - 1].markLine = {
      silent: true,
      symbol: "none",
      data: [{ xAxis: todayPosition }],
      lineStyle: { color: SEMANTIC.danger, width: 2, type: "dashed" },
      label: {
        formatter: "Today",
        color: SEMANTIC.danger,
        fontWeight: "bold",
        position: "start",
      },
    };
  }

  // If no tasks
  if (!tasks || tasks.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5">
        <h3 className="mb-4 text-base font-semibold text-foreground">Project Gantt chart</h3>
        <EmptyState
          icon={GanttChartSquare}
          title="No tasks found for this project"
          description="Create tasks with start and end dates and they will be plotted here."
        />
      </div>
    );
  }

  const tableColumns = [
    {
      key: "name",
      header: "Task",
      render: (row) => (
        <div className="min-w-0">
          <p className="font-medium text-foreground">{row.name}</p>
          {row.description && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{row.description}</p>
          )}
        </div>
      ),
    },
    {
      key: "developer",
      header: "Developer",
      render: (row) => (
        <div className="min-w-0">
          <p className="text-sm text-foreground">{row.developer}</p>
          {row.developerEmail && (
            <p className="truncate text-xs text-muted-foreground">{row.developerEmail}</p>
          )}
        </div>
      ),
    },
    {
      key: "startDate",
      header: "Start",
      align: "right",
      render: (row) => <span className="tabular-nums text-muted-foreground">{row.startDate}</span>,
    },
    {
      key: "endDate",
      header: "End",
      align: "right",
      render: (row) => <span className="tabular-nums text-muted-foreground">{row.endDate}</span>,
    },
    {
      key: "duration",
      header: "Duration",
      align: "right",
      render: (row) => (
        <span className="tabular-nums text-muted-foreground">{row.duration} days</span>
      ),
    },
    ...(showProgress
      ? [
          {
            key: "progressPercent",
            header: "Progress",
            align: "right",
            render: (row) => (
              <span className="tabular-nums text-muted-foreground">{row.progressPercent}%</span>
            ),
          },
        ]
      : []),
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <Badge variant={STATUS_BADGE_VARIANT[row.status] || "secondary"} size="sm">
          {statusLabels[row.status] || row.status}
        </Badge>
      ),
    },
    {
      key: "completionStatus",
      header: "Completion",
      render: (row) =>
        row.status === "completed" && row.completionStatus ? (
          row.completionStatus === "On Time" ? (
            <Badge variant="success" size="sm">
              On time
            </Badge>
          ) : row.completionStatus === "Late" ? (
            <Badge variant="destructive" size="sm">
              Late
            </Badge>
          ) : (
            <span className="text-muted-foreground">{row.completionStatus}</span>
          )
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "points",
      header: "Points",
      align: "right",
      render: (row) =>
        row.status === "completed" && row.completionStatus ? (
          <span
            className={`font-semibold tabular-nums ${
              row.completionStatus === "On Time" ? "text-success" : "text-destructive"
            }`}
          >
            {row.completionStatus === "On Time" ? "+1" : "-1"}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  const statTiles = [
    { label: "Total", value: stats.total, className: "text-foreground" },
    { label: "Pending", value: stats.pending, className: "text-muted-foreground" },
    { label: "In progress", value: stats.inProgress, className: "text-info" },
    { label: "Awaiting", value: stats.awaitingApproval, className: "text-warning" },
    { label: "Completed", value: stats.completed, className: "text-success" },
    { label: "On time", value: stats.onTime, className: "text-success" },
    { label: "Late", value: stats.late, className: "text-destructive" },
    {
      label: "Points",
      value: `${stats.productivityPoints >= 0 ? "+" : ""}${stats.productivityPoints}`,
      className: stats.productivityPoints >= 0 ? "text-success" : "text-destructive",
    },
  ];

  const filtersActive =
    filterStatus !== "all" || (showDeveloperFilter && filterDeveloper !== "all");

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-foreground">
            {projectName || "Project"} — Gantt chart
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Visual timeline and task management
          </p>
        </div>
      </div>

      <Tabs
        className="px-4 sm:px-6"
        aria-label="Gantt display"
        active={viewMode}
        onChange={(id) => setViewMode(id)}
        tabs={[
          {
            id: "chart",
            label: (
              <span className="inline-flex items-center gap-1.5">
                <BarChart3 className="h-4 w-4" aria-hidden="true" /> Chart
              </span>
            ),
          },
          {
            id: "table",
            label: (
              <span className="inline-flex items-center gap-1.5">
                <TableIcon className="h-4 w-4" aria-hidden="true" /> Table
              </span>
            ),
          },
        ]}
      />

      {/* Filters */}
      <div className="border-b border-border bg-muted/30 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="gantt-status" className="text-sm font-medium text-foreground">
            Status
          </label>
          <select
            id="gantt-status"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="awaiting_approval">Awaiting Approval</option>
            <option value="completed">Completed</option>
            <option value="rejected">Rejected</option>
          </select>

          {showDeveloperFilter && developers && Object.keys(developers).length > 0 && (
            <>
              <label htmlFor="gantt-developer" className="text-sm font-medium text-foreground">
                Developer
              </label>
              <select
                id="gantt-developer"
                value={filterDeveloper}
                onChange={(e) => setFilterDeveloper(e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="all">All developers</option>
                {Object.values(developers).map(dev => (
                  <option key={dev.id} value={dev.id}>{dev.name}</option>
                ))}
              </select>
            </>
          )}

          {filtersActive && (
            <Button
              variant="ghost"
              size="lg"
              onClick={() => {
                setFilterStatus("all");
                setFilterDeveloper("all");
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {/* Stats banner */}
      <div className="grid grid-cols-2 divide-x divide-y divide-border border-b border-border bg-muted/30 sm:grid-cols-4 lg:grid-cols-8 lg:divide-y-0">
        {statTiles.map((tile) => (
          <div key={tile.label} className="p-3 text-center">
            <p className={`text-xl font-semibold tabular-nums ${tile.className}`}>{tile.value}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{tile.label}</p>
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="p-4 sm:p-6">
        {viewMode === "chart" ? (
          <>
            {/* Legend */}
            <ul className="mb-5 flex flex-wrap gap-x-4 gap-y-2">
              {Object.keys(statusLabels).map((status) => (
                <li key={status} className="flex items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      STATUS_DOT_CLASS[status] || "bg-muted-foreground"
                    }`}
                    aria-hidden="true"
                  />
                  <span className="text-sm text-muted-foreground">{statusLabels[status]}</span>
                </li>
              ))}
            </ul>

            {/* Gantt chart */}
            {chartData.length > 0 ? (
              <div className="overflow-x-auto overscroll-x-contain">
                <div className="min-w-[640px]">
                  <EChart option={ganttOption} height={chartHeight} />
                </div>
              </div>
            ) : (
              <EmptyState
                icon={FileX}
                title="No tasks with valid dates"
                description={
                  filtersActive
                    ? "No task matching these filters has both a start and an end date."
                    : "Tasks need a start and an end date to appear on the Gantt chart."
                }
              />
            )}
          </>
        ) : (
          <DataTable
            columns={tableColumns}
            rows={chartData}
            keyField="taskId"
            empty={
              <EmptyState
                icon={FileX}
                title="No tasks match the current filters"
                description="Clear a filter, or give these tasks start and end dates."
              />
            }
          />
        )}
      </div>

      {/* Footer info */}
      <div className="border-t border-border bg-muted/30 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <p>
            <strong className="font-medium text-foreground">Real-time updates:</strong> this chart
            refreshes when tasks change.
          </p>
          <p>
            <strong className="font-medium text-foreground">Productivity:</strong> on time = +1
            point, late = −1 point.
          </p>
        </div>
      </div>
    </div>
  );
}
