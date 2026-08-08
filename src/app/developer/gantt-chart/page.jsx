"use client";
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import EChart from "@/components/charts/EChart";
import {
  PALETTE,
  textStyle,
  baseGrid,
  baseTooltip,
  axisLabel,
  axisLine,
  splitLine,
} from "@/components/charts/chartTheme";
import { showWarning } from "@/utils/alerts";
import { EmptyState, Skeleton } from "@/components/ui";
import { GanttChartSquare } from "lucide-react";

export default function GanttChartPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tasks, setTasks] = useState([]);
  const [ganttData, setGanttData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isNarrowScreen, setIsNarrowScreen] = useState(false);

  const projectId = searchParams.get('projectId');

  useEffect(() => {
    const update = () => setIsNarrowScreen(window.innerWidth < 640);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    if (!projectId) {
      router.back();
      return;
    }

    // Load submitted tasks from localStorage
    const savedTasks = localStorage.getItem(`project_tasks_${projectId}`);
    const projectData = localStorage.getItem(`project_submitted_${projectId}`);

    if (!projectData || projectData !== 'true') {
      showWarning("Not submitted", "Project work not submitted yet.");
      router.back();
      return;
    }

    if (savedTasks) {
      const parsedTasks = JSON.parse(savedTasks);
      setTasks(parsedTasks);
      prepareGanttData(parsedTasks);
    }

    setLoading(false);
  }, [projectId, router]);

  const prepareGanttData = (taskList) => {
    // Define columns for Gantt chart
    const columns = [
      { type: 'string', label: 'Task ID' },
      { type: 'string', label: 'Task Name' },
      { type: 'string', label: 'Resource' },
      { type: 'date', label: 'Start Date' },
      { type: 'date', label: 'End Date' },
      { type: 'number', label: 'Duration' },
      { type: 'number', label: 'Percent Complete' },
      { type: 'string', label: 'Dependencies' },
    ];

    // Convert tasks to Gantt chart format
    const rows = taskList.map((task, index) => {
      // Start date - agar nahi hai toh assigned date use karo
      const startDate = task.startDate && task.startDate !== 'null'
        ? new Date(task.startDate)
        : new Date();

      // End date - agar nahi hai toh start date + 7 days
      let endDate;
      if (task.endDate && task.endDate !== 'null') {
        endDate = new Date(task.endDate);
      } else {
        endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 7); // Default 1 week
      }

      // Ensure end date is after start date
      if (endDate <= startDate) {
        endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 1);
      }

      // Calculate duration in milliseconds (Google Charts ko automatically calculate karega)
      const duration = endDate - startDate;

      // Progress based on working hours (simplified calculation)
      const progress = task.workingHours ? Math.min(100, parseInt(task.workingHours) * 5) : 0;

      return [
        `Task${task.id}`,
        task.title,
        'Developer',
        startDate,
        endDate,
        duration, // milliseconds mein duration
        progress,
        null, // dependencies
      ];
    });

    setGanttData([columns, ...rows]);
  };

  const formatDate = (dateString) => {
    if (!dateString || dateString === 'null') return 'Not set';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const handleBack = () => {
    router.back();
  };

  const handleExportData = () => {
    const dataStr = JSON.stringify(tasks, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `project-${projectId}-tasks.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Calculate project statistics
  const calculateStats = () => {
    if (tasks.length === 0) return { totalTasks: 0, totalHours: 0, dateRange: 'N/A' };

    const totalHours = tasks.reduce((sum, task) => sum + (parseInt(task.workingHours) || 0), 0);

    // Find earliest start date and latest end date
    const dates = tasks
      .map(task => ({
        start: task.startDate && task.startDate !== 'null' ? new Date(task.startDate) : null,
        end: task.endDate && task.endDate !== 'null' ? new Date(task.endDate) : null
      }))
      .filter(date => date.start && date.end);

    if (dates.length === 0) {
      return { totalTasks: tasks.length, totalHours, dateRange: 'Dates not set' };
    }

    const startDates = dates.map(d => d.start);
    const endDates = dates.map(d => d.end);

    const earliestStart = new Date(Math.min(...startDates));
    const latestEnd = new Date(Math.max(...endDates));

    const dateRange = `${formatDate(earliestStart)} - ${formatDate(latestEnd)}`;

    return { totalTasks: tasks.length, totalHours, dateRange };
  };

  const stats = calculateStats();

  // Build an ECharts horizontal Gantt (offset placeholder + colored duration bar)
  // from the already-prepared Gantt rows (ganttData: [columns, ...rows]).
  const buildGanttOption = () => {
    const rows = ganttData.slice(1);
    const dayMs = 1000 * 60 * 60 * 24;
    const parsed = rows.map((r) => ({
      title: r[1],
      start: new Date(r[3]),
      end: new Date(r[4]),
    }));
    const minTime = Math.min(...parsed.map((p) => p.start.getTime()));
    const minDate = new Date(minTime);
    const withOffsets = parsed.map((p) => ({
      title: p.title,
      startLabel: formatDate(p.start),
      endLabel: formatDate(p.end),
      offset: Math.floor((p.start.getTime() - minTime) / dayMs),
      duration: Math.max(1, Math.ceil((p.end.getTime() - p.start.getTime()) / dayMs)),
    }));

    return {
      color: PALETTE,
      textStyle,
      grid: { ...baseGrid, left: 8, right: 30, top: 20, bottom: 30, containLabel: true },
      tooltip: {
        trigger: "item",
        axisPointer: { type: "shadow" },
        ...baseTooltip,
        formatter: (params) => {
          const row = withOffsets[params.dataIndex];
          if (!row) return "";
          return (
            `<div style="font-weight:600;margin-bottom:4px">${row.title}</div>` +
            `<div>Start: ${row.startLabel}</div>` +
            `<div>End: ${row.endLabel}</div>` +
            `<div>Duration: ${row.duration} days</div>`
          );
        },
      },
      xAxis: {
        type: "value",
        min: 0,
        minInterval: 1,
        name: "Date",
        nameLocation: "middle",
        nameGap: 28,
        nameTextStyle: axisLabel,
        axisLabel: {
          ...axisLabel,
          // "January 5, 2026" on every tick guaranteed a smear. Short form
          // plus hideOverlap keeps the axis readable at any width.
          hideOverlap: true,
          formatter: (value) =>
            new Date(minDate.getTime() + value * dayMs).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            }),
        },
        axisLine,
        splitLine,
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: withOffsets.map((r) => r.title),
        // Task titles are free text: truncate rather than run into the bars.
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
          name: "offset",
          type: "bar",
          stack: "g",
          silent: true,
          itemStyle: { color: "transparent" },
          tooltip: { show: false },
          data: withOffsets.map((r) => r.offset),
        },
        {
          name: "duration",
          type: "bar",
          stack: "g",
          barWidth: 24,
          data: withOffsets.map((r, i) => ({
            value: r.duration,
            itemStyle: { color: PALETTE[i % PALETTE.length], borderRadius: 4 },
          })),
        },
      ],
    };
  };

  // Skeleton shaped like the page below it, so nothing jumps when data lands.
  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8" aria-busy="true">
          <div className="mb-6 space-y-2">
            <Skeleton className="h-8 w-72" />
            <Skeleton className="h-4 w-96" />
          </div>
          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-[320px] w-full rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col gap-4 mb-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              onClick={handleBack}
              className="inline-flex w-fit items-center rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground shadow-card transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to Project
            </button>
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground break-words">Project Gantt Chart</h1>
              <p className="text-muted-foreground mt-1">Visual timeline showing exact dates for each task</p>
            </div>
          </div>

          <button
            onClick={handleExportData}
            className="inline-flex w-full items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors duration-150 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:w-auto"
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export Data
          </button>
        </div>

        {/* Project Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="rounded-xl border border-border bg-card shadow-card p-4">
            <div className="flex items-center">
              <div className="bg-info/10 p-3 rounded-lg mr-4">
                <svg className="w-6 h-6 text-info" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Tasks</p>
                <p className="text-2xl font-bold tabular-nums text-foreground">{stats.totalTasks}</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card shadow-card p-4">
            <div className="flex items-center">
              <div className="bg-success/10 p-3 rounded-lg mr-4">
                <svg className="w-6 h-6 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Hours</p>
                <p className="text-2xl font-bold tabular-nums text-foreground">{stats.totalHours} hrs</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card shadow-card p-4">
            <div className="flex items-center">
              <div className="bg-accent p-3 rounded-lg mr-4">
                <svg className="w-6 h-6 text-accent-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Project Timeline</p>
                <p className="truncate text-sm font-bold tabular-nums text-foreground" title={stats.dateRange}>{stats.dateRange}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Gantt Chart */}
        <div className="rounded-xl border border-border bg-card shadow-elevated p-6 mb-6">
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-foreground mb-2">Project Timeline (Date-wise)</h2>
            <p className="text-muted-foreground">Each bar shows the exact start and end dates for tasks</p>
          </div>

          {ganttData.length > 1 ? (
            <div className="border rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <div className="min-w-[900px]">
                  <EChart option={buildGanttOption()} height={Math.max(240, tasks.length * 38)} />
                </div>
              </div>
            </div>
          ) : (
            <EmptyState
              icon={GanttChartSquare}
              title="No task data available"
              description="Submit project work with tasks to see the timeline plotted here."
            />
          )}
        </div>

        {/* Detailed Tasks Table */}
        <div className="rounded-xl border border-border bg-card shadow-elevated p-6">
          <h2 className="text-xl font-semibold text-foreground mb-4">Task Details with Dates</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] divide-y divide-border">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Task Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Description
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Start Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    End Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Working Hours
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Duration
                  </th>
                </tr>
              </thead>
              <tbody className="bg-card divide-y divide-border">
                {tasks.map((task) => {
                  const startDate = task.startDate && task.startDate !== 'null' ? new Date(task.startDate) : null;
                  const endDate = task.endDate && task.endDate !== 'null' ? new Date(task.endDate) : null;
                  const duration = startDate && endDate ? Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) : 'N/A';

                  return (
                    <tr key={task.id} className="hover:bg-muted/50">
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-foreground break-words max-w-[28rem]">{task.title}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-muted-foreground max-w-xs truncate">{task.description}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm tabular-nums text-foreground">
                          {startDate ? formatDate(startDate) : 'Not set'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm tabular-nums text-foreground">
                          {endDate ? formatDate(endDate) : 'Not set'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm tabular-nums text-foreground">{task.workingHours || 0} hrs</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm tabular-nums text-foreground">
                          {typeof duration === 'number' ? `${duration} days` : duration}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {tasks.length === 0 && (
              <EmptyState
                icon={GanttChartSquare}
                title="No tasks yet"
                description="Tasks submitted for this project appear in this table."
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}