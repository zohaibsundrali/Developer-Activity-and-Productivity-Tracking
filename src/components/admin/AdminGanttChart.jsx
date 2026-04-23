"use client";
import { useState, useEffect, useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  Legend,
  LabelList,
} from "recharts";

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

  const ProgressLabel = ({ x, y, width, height, value }) => {
    if (!showProgress) return null;
    const pct = Number(value);
    if (!Number.isFinite(pct)) return null;
    if (width < 28) return null;

    return (
      <text
        x={x + width / 2}
        y={y + height / 2 + 4}
        textAnchor="middle"
        fill="#ffffff"
        fontSize={11}
        fontWeight={700}
      >
        {pct}%
      </text>
    );
  };

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

  // Custom tooltip for chart
  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white border-2 border-gray-200 rounded-lg shadow-xl p-4 max-w-xs">
          <p className="font-bold text-gray-900 mb-2">{data.name}</p>
          <div className="text-sm text-gray-700 space-y-1">
            <p><span className="font-medium">Developer:</span> {data.developer}</p>
            {data.developerEmail && (
              <p className="text-xs text-gray-500">{data.developerEmail}</p>
            )}
            <p><span className="font-medium">Start:</span> {data.startDate}</p>
            <p><span className="font-medium">End:</span> {data.endDate}</p>
            <p><span className="font-medium">Duration:</span> {data.duration} days</p>
            {showProgress && (
              <p><span className="font-medium">Progress:</span> {data.progressPercent}%</p>
            )}
            <p className="capitalize">
              <span className="font-medium">Status:</span>{" "}
              <span className={`font-semibold ${
                data.status === 'completed' ? 'text-green-600' :
                data.status === 'rejected' ? 'text-red-600' :
                data.status === 'awaiting_approval' ? 'text-amber-600' :
                data.status === 'in_progress' ? 'text-blue-600' :
                'text-gray-600'
              }`}>
                {statusLabels[data.status] || data.status}
              </span>
            </p>
            {data.status === 'completed' && data.completionStatus && (
              <p>
                <span className="font-medium">Completion:</span>{" "}
                {data.completionStatus === "On Time" ? (
                  <span className="text-green-600 font-semibold">✓ On Time (+1)</span>
                ) : data.completionStatus === "Late" ? (
                  <span className="text-red-600 font-semibold">✗ Late (-1)</span>
                ) : (
                  <span className="text-gray-600">{data.completionStatus}</span>
                )}
              </p>
            )}
            {data.description && (
              <p className="text-xs text-gray-500 mt-2 pt-2 border-t">{data.description}</p>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  // If no tasks
  if (!tasks || tasks.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h3 className="text-xl font-bold text-gray-800 mb-4">Project Gantt Chart</h3>
        <div className="text-center py-12 text-gray-500">
          <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
          </svg>
          <p className="text-lg">No tasks found for this project</p>
          <p className="text-sm text-gray-400 mt-2">Create tasks with start and end dates to see the Gantt chart</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-lg overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#009578] to-[#0e7762] p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold text-white">
              {projectName || "Project"} - Gantt Chart
            </h3>
            <p className="text-white/80 text-sm mt-1">Visual timeline and task management</p>
          </div>
          <div className="flex space-x-2">
            <button
              onClick={() => setViewMode("chart")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                viewMode === "chart"
                  ? "bg-white text-[#009578]"
                  : "bg-white/20 text-white hover:bg-white/30"
              }`}
            >
              <svg className="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Chart
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                viewMode === "table"
                  ? "bg-white text-[#009578]"
                  : "bg-white/20 text-white hover:bg-white/30"
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
      <div className="bg-gray-50 border-b p-4">
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="text-sm font-medium text-gray-700 mr-2">Status:</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#009578] focus:border-[#009578]"
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
              <label className="text-sm font-medium text-gray-700 mr-2">Developer:</label>
              <select
                value={filterDeveloper}
                onChange={(e) => setFilterDeveloper(e.target.value)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#009578] focus:border-[#009578]"
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
              className="px-3 py-1.5 text-sm text-[#009578] hover:text-[#0e7762] font-medium"
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* Stats Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 divide-x divide-gray-200 bg-gray-50 border-b">
        <div className="p-3 text-center">
          <p className="text-xl font-bold text-gray-800">{stats.total}</p>
          <p className="text-xs text-gray-500">Total</p>
        </div>
        <div className="p-3 text-center">
          <p className="text-xl font-bold text-gray-400">{stats.pending}</p>
          <p className="text-xs text-gray-500">Pending</p>
        </div>
        <div className="p-3 text-center">
          <p className="text-xl font-bold text-blue-600">{stats.inProgress}</p>
          <p className="text-xs text-gray-500">In Progress</p>
        </div>
        <div className="p-3 text-center">
          <p className="text-xl font-bold text-amber-600">{stats.awaitingApproval}</p>
          <p className="text-xs text-gray-500">Awaiting</p>
        </div>
        <div className="p-3 text-center">
          <p className="text-xl font-bold text-green-600">{stats.completed}</p>
          <p className="text-xs text-gray-500">Completed</p>
        </div>
        <div className="p-3 text-center">
          <p className="text-xl font-bold text-green-500">{stats.onTime}</p>
          <p className="text-xs text-gray-500">On Time</p>
        </div>
        <div className="p-3 text-center">
          <p className="text-xl font-bold text-red-500">{stats.late}</p>
          <p className="text-xs text-gray-500">Late</p>
        </div>
        <div className="p-3 text-center">
          <p className={`text-xl font-bold ${stats.productivityPoints >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {stats.productivityPoints >= 0 ? '+' : ''}{stats.productivityPoints}
          </p>
          <p className="text-xs text-gray-500">Points</p>
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {viewMode === "chart" ? (
          <>
            {/* Legend */}
            <div className="flex flex-wrap gap-4 mb-6">
              {Object.entries(statusColors).map(([status, color]) => (
                <div key={status} className="flex items-center">
                  <div className="w-4 h-4 rounded" style={{ backgroundColor: color }}></div>
                  <span className="ml-2 text-sm text-gray-600">
                    {statusLabels[status]}
                  </span>
                </div>
              ))}
            </div>

            {/* Gantt Chart */}
            {chartData.length > 0 ? (
              <div className="h-[600px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartData}
                    layout="vertical"
                    barSize={28}
                    margin={{ top: 20, right: 30, left: 180, bottom: 20 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
                    <XAxis
                      type="number"
                      domain={[0, 'dataMax + 5']}
                      tickFormatter={(value) => `Day ${value}`}
                      tick={{ fontSize: 12 }}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={170}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip content={<CustomTooltip />} />

                    {/* Today line */}
                    {todayPosition && (
                      <ReferenceLine
                        x={todayPosition}
                        stroke="#ef4444"
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        label={{
                          value: 'Today',
                          fill: '#ef4444',
                          fontSize: 12,
                          fontWeight: 'bold',
                          position: 'top'
                        }}
                      />
                    )}

                    {/* Invisible bar for offset (start position) */}
                    <Bar dataKey="start" stackId="a" fill="transparent" />

                    {showProgress ? (
                      <>
                        {/* Filled progress segment */}
                        <Bar dataKey="progressDuration" stackId="a">
                          {chartData.map((entry, index) => (
                            <Cell
                              key={`progress-cell-${index}`}
                              fill={statusColors[entry.status] || statusColors.pending}
                              radius={entry.remainingDuration === 0 ? [4, 4, 4, 4] : [4, 0, 0, 4]}
                            />
                          ))}
                        </Bar>

                        {/* Remaining segment (same color, lighter) */}
                        <Bar dataKey="remainingDuration" stackId="a">
                          {chartData.map((entry, index) => (
                            <Cell
                              key={`remaining-cell-${index}`}
                              fill={statusColors[entry.status] || statusColors.pending}
                              fillOpacity={0.25}
                              radius={entry.progressDuration === 0 ? [4, 4, 4, 4] : [0, 4, 4, 0]}
                            />
                          ))}
                          <LabelList dataKey="progressPercent" content={<ProgressLabel />} />
                        </Bar>
                      </>
                    ) : (
                      /* Default Admin duration bar */
                      <Bar dataKey="duration" stackId="a" radius={[4, 4, 4, 4]}>
                        {chartData.map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={statusColors[entry.status] || statusColors.pending}
                          />
                        ))}
                      </Bar>
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="text-center py-12 border-2 border-dashed border-gray-300 rounded-lg">
                <svg className="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Tasks with Valid Dates</h3>
                <p className="text-gray-500">Tasks need start and end dates to appear on the Gantt chart.</p>
              </div>
            )}
          </>
        ) : (
          /* Table View */
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Task</th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Developer</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">Start</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">End</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">Duration</th>
                  {showProgress && (
                    <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">Progress</th>
                  )}
                  <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">Status</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">Completion</th>
                  <th className="px-4 py-3 text-center text-sm font-semibold text-gray-700">Points</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {chartData.map((task, index) => (
                  <tr key={task.taskId || index} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800">{task.name}</p>
                      {task.description && (
                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">{task.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-gray-700">{task.developer}</p>
                      {task.developerEmail && (
                        <p className="text-xs text-gray-500">{task.developerEmail}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-gray-600">{task.startDate}</td>
                    <td className="px-4 py-3 text-center text-sm text-gray-600">{task.endDate}</td>
                    <td className="px-4 py-3 text-center text-sm text-gray-600">{task.duration} days</td>
                    {showProgress && (
                      <td className="px-4 py-3 text-center text-sm text-gray-600">{task.progressPercent}%</td>
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
                          <span className="text-green-600 font-semibold">✓ On Time</span>
                        ) : task.completionStatus === "Late" ? (
                          <span className="text-red-600 font-semibold">✗ Late</span>
                        ) : (
                          <span className="text-gray-500">{task.completionStatus}</span>
                        )
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {task.status === 'completed' && task.completionStatus ? (
                        <span className={`font-bold text-sm ${
                          task.completionStatus === "On Time" ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {task.completionStatus === "On Time" ? '+1' : '-1'}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {chartData.length === 0 && (
              <div className="text-center py-8">
                <p className="text-gray-500">No tasks match the current filters.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="p-4 bg-gray-50 border-t">
        <div className="flex items-center justify-between text-sm text-gray-600">
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
