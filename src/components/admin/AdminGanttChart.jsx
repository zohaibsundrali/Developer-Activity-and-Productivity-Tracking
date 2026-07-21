"use client";
import { useState, useMemo } from "react";
import EChart from "@/components/charts/EChart";
import {
  textStyle,
  baseTooltip,
  axisLabel,
  axisLine,
  splitLine,
  GANTT_STATUS_COLORS,
} from "@/components/charts/chartTheme";

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

  // Status colors mapped to task statuses
  const statusColors = {
    completed: "#10b981", // green
    awaiting_approval: "#f59e0b", // amber
    in_progress: "#3b82f6", // blue
    pending: "#9ca3af", // gray
    rejected: "#ef4444", // red
  };

  // Status labels for display
  const statusLabels = {
    completed: "Completed",
    awaiting_approval: "Awaiting Approval",
    in_progress: "In Progress",
    pending: "Pending",
    rejected: "Rejected",
  };

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
    html += `<div style="font-weight:700;color:#1e293b;margin-bottom:6px">${data.name}</div>`;
    html += `<div style="font-size:12px;color:#1e293b;line-height:1.5">`;
    html += `<div><span style="font-weight:500">Developer:</span> ${data.developer}</div>`;
    if (data.developerEmail) {
      html += `<div style="font-size:11px;color:#64748b">${data.developerEmail}</div>`;
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
        html += `<div><span style="font-weight:500">Completion:</span> <span style="font-weight:600;color:#16a34a">✓ On Time (+1)</span></div>`;
      } else if (data.completionStatus === "Late") {
        html += `<div><span style="font-weight:500">Completion:</span> <span style="font-weight:600;color:#ef4444">✗ Late (-1)</span></div>`;
      } else {
        html += `<div><span style="font-weight:500">Completion:</span> <span style="color:#64748b">${data.completionStatus}</span></div>`;
      }
    }
    if (data.description) {
      html += `<div style="font-size:11px;color:#64748b;margin-top:8px;padding-top:8px;border-top:1px solid #e2e8f0">${data.description}</div>`;
    }
    html += `</div></div>`;
    return html;
  };

  // Build the ECharts Gantt option from the existing computed chartData.
  const ganttOption = {
    textStyle,
    grid: { left: 8, right: 30, top: 20, bottom: 20, containLabel: true },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      ...baseTooltip,
      formatter: ganttTooltipFormatter,
    },
    xAxis: {
      type: "value",
      min: 0,
      axisLabel: { ...axisLabel, formatter: "Day {value}" },
      axisLine,
      splitLine: { ...splitLine, show: true },
    },
    yAxis: {
      type: "category",
      data: chartData.map((d) => d.name),
      inverse: true,
      axisLabel: { ...axisLabel, width: 160, overflow: "truncate" },
      axisLine,
      axisTick: { show: false },
    },
    series: [
      // Transparent placeholder (start offset)
      {
        type: "bar",
        stack: "a",
        barWidth: 28,
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
              barWidth: 28,
              label: {
                show: true,
                position: "inside",
                color: "#ffffff",
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
              barWidth: 28,
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
              barWidth: 28,
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
      lineStyle: { color: "#ef4444", width: 2, type: "dashed" },
      label: {
        formatter: "Today",
        color: "#ef4444",
        fontWeight: "bold",
        position: "start",
      },
    };
  }

  // If no tasks
  if (!tasks || tasks.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border shadow-card p-6">
        <h3 className="text-xl font-bold text-foreground mb-4">Project Gantt Chart</h3>
        <div className="text-center py-12 text-muted-foreground">
          <svg className="w-16 h-16 mx-auto text-muted-foreground/40 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
          </svg>
          <p className="text-lg">No tasks found for this project</p>
          <p className="text-sm text-muted-foreground/70 mt-2">Create tasks with start and end dates to see the Gantt chart</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
      {/* Header */}
      <div className="bg-primary p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-xl font-bold text-primary-foreground">
              {projectName || "Project"} - Gantt Chart
            </h3>
            <p className="text-primary-foreground/80 text-sm mt-1">Visual timeline and task management</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setViewMode("chart")}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                viewMode === "chart"
                  ? "bg-card text-primary"
                  : "bg-white/20 text-primary-foreground hover:bg-white/30"
              }`}
            >
              <svg className="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Chart
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                viewMode === "table"
                  ? "bg-card text-primary"
                  : "bg-white/20 text-primary-foreground hover:bg-white/30"
              }`}
            >
              <svg className="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Table
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-muted/50 border-b border-border p-4">
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="text-sm font-medium text-foreground mr-2">Status:</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-3 py-1.5 border border-input bg-background rounded-lg text-sm focus:border-primary focus:ring-2 focus:ring-primary/30"
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="awaiting_approval">Awaiting Approval</option>
              <option value="completed">Completed</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>

          {showDeveloperFilter && developers && Object.keys(developers).length > 0 && (
            <div>
              <label className="text-sm font-medium text-foreground mr-2">Developer:</label>
              <select
                value={filterDeveloper}
                onChange={(e) => setFilterDeveloper(e.target.value)}
                className="px-3 py-1.5 border border-input bg-background rounded-lg text-sm focus:border-primary focus:ring-2 focus:ring-primary/30"
              >
                <option value="all">All Developers</option>
                {Object.values(developers).map(dev => (
                  <option key={dev.id} value={dev.id}>{dev.name}</option>
                ))}
              </select>
            </div>
          )}

          {(filterStatus !== "all" || (showDeveloperFilter && filterDeveloper !== "all")) && (
            <button
              onClick={() => {
                setFilterStatus("all");
                setFilterDeveloper("all");
              }}
              className="px-3 py-1.5 text-sm text-primary hover:text-primary/80 font-medium"
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* Stats Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 divide-x divide-border bg-muted/50 border-b border-border">
        <div className="p-3 text-center">
          <p className="text-xl font-bold text-foreground">{stats.total}</p>
          <p className="text-xs text-muted-foreground">Total</p>
        </div>
        <div className="p-3 text-center">
          <p className="text-xl font-bold text-muted-foreground">{stats.pending}</p>
          <p className="text-xs text-muted-foreground">Pending</p>
        </div>
        <div className="p-3 text-center">
          <p className="text-xl font-bold text-info">{stats.inProgress}</p>
          <p className="text-xs text-muted-foreground">In Progress</p>
        </div>
        <div className="p-3 text-center">
          <p className="text-xl font-bold text-warning">{stats.awaitingApproval}</p>
          <p className="text-xs text-muted-foreground">Awaiting</p>
        </div>
        <div className="p-3 text-center">
          <p className="text-xl font-bold text-success">{stats.completed}</p>
          <p className="text-xs text-muted-foreground">Completed</p>
        </div>
        <div className="p-3 text-center">
          <p className="text-xl font-bold text-success">{stats.onTime}</p>
          <p className="text-xs text-muted-foreground">On Time</p>
        </div>
        <div className="p-3 text-center">
          <p className="text-xl font-bold text-destructive">{stats.late}</p>
          <p className="text-xs text-muted-foreground">Late</p>
        </div>
        <div className="p-3 text-center">
          <p className={`text-xl font-bold ${stats.productivityPoints >= 0 ? 'text-success' : 'text-destructive'}`}>
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
            <div className="flex flex-wrap gap-4 mb-6">
              {Object.entries(statusColors).map(([status, color]) => (
                <div key={status} className="flex items-center">
                  <div className="w-4 h-4 rounded" style={{ backgroundColor: color }}></div>
                  <span className="ml-2 text-sm text-muted-foreground">
                    {statusLabels[status]}
                  </span>
                </div>
              ))}
            </div>

            {/* Gantt Chart */}
            {chartData.length > 0 ? (
              <div className="overflow-x-auto">
                <div className="h-[600px] min-w-[900px]">
                  <EChart option={ganttOption} height="100%" />
                </div>
              </div>
            ) : (
              <div className="text-center py-12 border-2 border-dashed border-border rounded-lg">
                <svg className="w-16 h-16 text-muted-foreground/40 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <h3 className="text-lg font-medium text-foreground mb-2">No Tasks with Valid Dates</h3>
                <p className="text-muted-foreground">Tasks need start and end dates to appear on the Gantt chart.</p>
              </div>
            )}
          </>
        ) : (
          /* Table View */
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px]">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-foreground">Task</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-foreground">Developer</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-foreground">Start</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-foreground">End</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-foreground">Duration</th>
                  {showProgress && (
                    <th className="px-4 py-3 text-center text-sm font-semibold text-foreground">Progress</th>
                  )}
                  <th className="px-4 py-3 text-center text-sm font-semibold text-foreground">Status</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-foreground">Completion</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-foreground">Points</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {chartData.map((task, index) => (
                  <tr key={task.taskId || index} className="hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{task.name}</p>
                      {task.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{task.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-foreground">{task.developer}</p>
                      {task.developerEmail && (
                        <p className="text-xs text-muted-foreground">{task.developerEmail}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-muted-foreground">{task.startDate}</td>
                    <td className="px-4 py-3 text-center text-sm text-muted-foreground">{task.endDate}</td>
                    <td className="px-4 py-3 text-center text-sm text-muted-foreground">{task.duration} days</td>
                    {showProgress && (
                      <td className="px-4 py-3 text-center text-sm text-muted-foreground">{task.progressPercent}%</td>
                    )}
                    <td className="px-4 py-3 text-center">
                      <span
                        className="px-2.5 py-1 rounded-full text-xs font-medium"
                        style={{
                          backgroundColor: `${statusColors[task.status]}20`,
                          color: statusColors[task.status]
                        }}
                      >
                        {statusLabels[task.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-sm">
                      {task.status === 'completed' && task.completionStatus ? (
                        task.completionStatus === "On Time" ? (
                          <span className="text-success font-semibold">✓ On Time</span>
                        ) : task.completionStatus === "Late" ? (
                          <span className="text-destructive font-semibold">✗ Late</span>
                        ) : (
                          <span className="text-muted-foreground">{task.completionStatus}</span>
                        )
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {task.status === 'completed' && task.completionStatus ? (
                        <span className={`font-bold text-sm ${
                          task.completionStatus === "On Time" ? 'text-success' : 'text-destructive'
                        }`}>
                          {task.completionStatus === "On Time" ? '+1' : '-1'}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {chartData.length === 0 && (
              <div className="text-center py-8">
                <p className="text-muted-foreground">No tasks match the current filters.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="p-4 bg-muted/50 border-t border-border">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <div>
            <strong>Real-time Updates:</strong> This chart automatically updates when tasks change.
          </div>
          <div>
            <strong>Productivity:</strong> On-time = +1 point, Late = -1 point
          </div>
        </div>
      </div>
    </div>
  );
}
