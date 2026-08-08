"use client";

import { useMemo } from "react";
import { normalizeStatus } from "@/utils/pmData";
import EChart from "@/components/charts/EChart";
import {
  GANTT_STATUS_COLORS,
  SEMANTIC,
  baseGrid,
  baseTooltip,
  axisLabel,
  splitLine,
  FONT_FAMILY,
} from "@/components/charts/chartTheme";
import { GanttChartSquare } from "lucide-react";
import { ViewEmpty, ViewPanel, ViewToolbar } from "@/components/admin/views/viewKit";

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const ONE_DAY = 24 * 60 * 60 * 1000;

// Parse YYYY-MM-DD → ms at local midnight, guarding NaN. Returns null on failure.
function parseYMDms(value) {
  if (!value || typeof value !== "string") return null;
  const parts = value.slice(0, 10).split("-");
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const ms = new Date(y, m - 1, d).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function shortDate(ms) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function fullDate(ms) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString();
}

/* -------------------------------------------------------------------------- */
/*  Timeline view                                                              */
/* -------------------------------------------------------------------------- */

export default function TimelineView({ tasks, onOpenTask }) {
  // Keep only tasks that have both parseable dates. `ordered` is reversed so the
  // first task renders at the top; every downstream array (yAxis, series,
  // tooltip map, click resolution) is built from THIS same ordered array.
  const { ordered, hiddenCount } = useMemo(() => {
    const dated = [];
    let hidden = 0;
    for (const t of tasks || []) {
      if (!t) continue;
      const start = parseYMDms(t.start_date);
      const end = parseYMDms(t.end_date);
      if (start == null || end == null) {
        hidden += 1;
        continue;
      }
      const duration = Math.max(end - start, ONE_DAY); // min 1 day so it's visible
      dated.push({ task: t, start, end, duration });
    }
    return { ordered: dated.slice().reverse(), hiddenCount: hidden };
  }, [tasks]);

  const option = useMemo(() => {
    const titles = ordered.map((r) => r.task.task_title || "Untitled task");

    return {
      textStyle: { fontFamily: FONT_FAMILY },
      // Roomier bottom than baseGrid so the date axis never clips, and
      // containLabel keeps the truncated task names inside the canvas.
      grid: { ...baseGrid, left: 8, right: 24, top: 16, bottom: 28, containLabel: true },
      tooltip: {
        ...baseTooltip,
        trigger: "axis",
        axisPointer: { type: "shadow" },
        confine: true,
        formatter: (params) => {
          const p = Array.isArray(params) ? params[params.length - 1] : params;
          const row = p && ordered[p.dataIndex];
          if (!row) return "";
          const title = row.task.task_title || "Untitled task";
          return (
            `<div style="max-width:240px">` +
            `<div style="font-weight:700;margin-bottom:4px">${title}</div>` +
            `<div style="font-size:12px;line-height:1.5">` +
            `<div><span style="font-weight:500">Start:</span> ${fullDate(row.start)}</div>` +
            `<div><span style="font-weight:500">End:</span> ${fullDate(row.end)}</div>` +
            `</div></div>`
          );
        },
      },
      xAxis: {
        type: "time",
        // hideOverlap is what stops the date ticks colliding into an unreadable
        // smear once a project spans more than a couple of months.
        axisLabel: { ...axisLabel, hideOverlap: true, formatter: (value) => shortDate(value) },
        splitLine: { ...splitLine, show: true },
      },
      yAxis: {
        type: "category",
        data: titles,
        axisLabel: { ...axisLabel, width: 150, overflow: "truncate" },
        axisTick: { show: false },
      },
      series: [
        // Transparent offset positions each bar at its start time.
        {
          type: "bar",
          stack: "time",
          silent: true,
          itemStyle: { color: "transparent" },
          tooltip: { show: false },
          data: ordered.map((r) => r.start),
        },
        // Colored duration bar (status-tinted).
        {
          type: "bar",
          stack: "time",
          barMaxWidth: 18,
          data: ordered.map((r) => ({
            value: r.duration,
            itemStyle: {
              color:
                GANTT_STATUS_COLORS[normalizeStatus(r.task.status)] || SEMANTIC.muted,
              borderRadius: 3,
            },
          })),
        },
      ],
    };
  }, [ordered]);

  const onEvents = useMemo(
    () => ({
      click: (p) => {
        if (p?.componentType === "series") {
          const row = ordered[p.dataIndex];
          if (row && onOpenTask) onOpenTask(row.task);
        }
      },
    }),
    [ordered, onOpenTask]
  );

  // Height follows the row count so two tasks do not float in 600px of nothing
  // and forty are not crushed into an unreadable band.
  const chartHeight = Math.min(900, Math.max(260, ordered.length * 34 + 60));

  const hiddenNote =
    hiddenCount > 0
      ? `${hiddenCount} task${hiddenCount === 1 ? "" : "s"} hidden (no start/end dates)`
      : null;

  const toolbar = (
    <ViewToolbar
      icon={GanttChartSquare}
      title="Timeline"
      description={
        ordered.length
          ? `${ordered.length} scheduled task${ordered.length === 1 ? "" : "s"}`
          : undefined
      }
    >
      {hiddenNote ? <span className="text-xs text-muted-foreground">{hiddenNote}</span> : null}
    </ViewToolbar>
  );

  if (!ordered.length) {
    return (
      <div className="space-y-4">
        {toolbar}
        <ViewEmpty
          icon={GanttChartSquare}
          title="Nothing to plot yet"
          description={
            hiddenCount > 0
              ? `${hiddenCount} matching task${
                  hiddenCount === 1 ? " has" : "s have"
                } no start and end date, so there is nothing to place on a timeline. Add dates to see them here.`
              : "Tasks need a start and an end date before they can appear on the timeline."
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {toolbar}
      <ViewPanel>
        <div className="overflow-x-auto overscroll-x-contain">
          <div className="min-w-[640px]">
            <EChart option={option} height={chartHeight} onEvents={onEvents} />
          </div>
        </div>
      </ViewPanel>
    </div>
  );
}
