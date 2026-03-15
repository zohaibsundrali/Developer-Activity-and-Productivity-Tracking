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
} from "recharts";

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

  // Custom tooltip
  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white border rounded-lg shadow-lg p-3 max-w-xs">
          <p className="font-semibold text-gray-800">{data.name}</p>
          <div className="text-sm text-gray-600 mt-1 space-y-1">
            <p>Start: {data.startDate}</p>
            <p>End: {data.endDate}</p>
            <p>Duration: {data.duration} days</p>
            <p className="capitalize">
              Status: <span className={`font-medium ${
                data.status === 'completed' ? 'text-green-600' :
                data.status === 'rejected' ? 'text-red-600' :
                data.status === 'awaiting_approval' ? 'text-amber-600' :
                'text-gray-600'
              }`}>{data.status.replace('_', ' ')}</span>
            </p>
            {data.status === 'completed' && (
              <p>
                {data.isOnTime ? (
                  <span className="text-green-600">✓ Completed on time (+1)</span>
                ) : (
                  <span className="text-red-600">✗ Completed late (-1)</span>
                )}
              </p>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  if (!tasks || tasks.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h3 className="text-xl font-bold text-gray-800 mb-4">Project Timeline</h3>
        <div className="text-center py-12 text-gray-500">
          <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
          </svg>
          <p>No tasks with dates to display</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-lg overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-500 to-purple-600 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold text-white">
              {projectName || "Project"} - Gantt Chart
            </h3>
            <p className="text-white/80 text-sm mt-1">Visual timeline of all tasks</p>
          </div>
          <div className="flex space-x-2">
            <button
              onClick={() => setViewMode("chart")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                viewMode === "chart"
                  ? "bg-white text-purple-600"
                  : "bg-white/20 text-white hover:bg-white/30"
              }`}
            >
              Chart
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                viewMode === "list"
                  ? "bg-white text-purple-600"
                  : "bg-white/20 text-white hover:bg-white/30"
              }`}
            >
              List
            </button>
          </div>
        </div>
      </div>

      {/* Stats Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-6 divide-x divide-gray-200 bg-gray-50 border-b">
        <div className="p-4 text-center">
          <p className="text-2xl font-bold text-gray-800">{stats.total}</p>
          <p className="text-xs text-gray-500">Total Tasks</p>
        </div>
        <div className="p-4 text-center">
          <p className="text-2xl font-bold text-green-600">{stats.completed}</p>
          <p className="text-xs text-gray-500">Completed</p>
        </div>
        <div className="p-4 text-center">
          <p className="text-2xl font-bold text-green-500">{stats.onTime}</p>
          <p className="text-xs text-gray-500">On Time</p>
        </div>
        <div className="p-4 text-center">
          <p className="text-2xl font-bold text-red-500">{stats.late}</p>
          <p className="text-xs text-gray-500">Late</p>
        </div>
        <div className="p-4 text-center">
          <p className="text-2xl font-bold text-amber-500">{stats.pending}</p>
          <p className="text-xs text-gray-500">Pending</p>
        </div>
        <div className="p-4 text-center">
          <p className={`text-2xl font-bold ${stats.productivityPoints >= 0 ? 'text-green-600' : 'text-red-600'}`}>
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
            <div className="flex flex-wrap gap-4 mb-4">
              {Object.entries(statusColors).map(([status, color]) => (
                <div key={status} className="flex items-center">
                  <div className="w-4 h-4 rounded" style={{ backgroundColor: color }}></div>
                  <span className="ml-2 text-sm text-gray-600 capitalize">
                    {status.replace('_', ' ')}
                  </span>
                </div>
              ))}
            </div>

            {/* Gantt Chart */}
            <div className="h-96">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  layout="vertical"
                  barSize={24}
                  margin={{ top: 20, right: 30, left: 150, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    domain={[0, 'dataMax + 5']}
                    tickFormatter={(value) => `Day ${value}`}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={140}
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  
                  {/* Today line */}
                  {todayPosition && (
                    <ReferenceLine
                      x={todayPosition}
                      stroke="#ef4444"
                      strokeDasharray="5 5"
                      label={{ value: 'Today', fill: '#ef4444', fontSize: 12 }}
                    />
                  )}

                  {/* Invisible bar for offset */}
                  <Bar dataKey="start" stackId="a" fill="transparent" />
                  
                  {/* Duration bar */}
                  <Bar dataKey="duration" stackId="a" radius={[4, 4, 4, 4]}>
                    {chartData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={statusColors[entry.status] || statusColors.pending}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        ) : (
          /* List View */
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Task</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">Start</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">End</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">Duration</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">On Time</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">Points</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {chartData.map((task, index) => (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800">{task.name}</p>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-600">{task.startDate}</td>
                    <td className="px-4 py-3 text-center text-gray-600">{task.endDate}</td>
                    <td className="px-4 py-3 text-center text-gray-600">{task.duration} days</td>
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
                          <span className="text-green-600">✓ Yes</span>
                        ) : (
                          <span className="text-red-600">✗ No</span>
                        )
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {task.status === 'completed' ? (
                        <span className={`font-bold ${task.isOnTime ? 'text-green-600' : 'text-red-600'}`}>
                          {task.isOnTime ? '+1' : '-1'}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
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
      <div className="p-4 bg-gray-50 border-t">
        <div className="text-sm text-gray-600">
          <strong>Productivity Formula:</strong> Each task = {(100 / (tasks?.length || 1)).toFixed(1)}% weight.
          On-time completion = +weight, Late completion = -weight.
          Current: {stats.onTime} on-time × {(100 / (tasks?.length || 1)).toFixed(1)}% - {stats.late} late × {(100 / (tasks?.length || 1)).toFixed(1)}% = 
          <span className={`font-bold ml-1 ${((stats.onTime - stats.late) / (tasks?.length || 1) * 100) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {(((stats.onTime - stats.late) / (stats.completed || 1)) * 100).toFixed(1)}% productivity
          </span>
        </div>
      </div>
    </div>
  );
}
