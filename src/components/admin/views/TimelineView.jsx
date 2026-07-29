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
      grid: { ...baseGrid, left: 8, right: 24, top: 16, bottom: 24, containLabel: true },
      tooltip: {
        ...baseTooltip,
        trigger: "axis",
        axisPointer: { type: "shadow" },
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
        axisLabel: { ...axisLabel, formatter: (value) => shortDate(value) },
        splitLine: { ...splitLine, show: true },
      },
      yAxis: {
        type: "category",
        data: titles,
        axisLabel: { ...axisLabel, width: 160, overflow: "truncate" },
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

  const chartHeight = Math.max(280, ordered.length * 36);

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-card">
      <div className="mb-4 flex items-center gap-1.5 text-foreground">
        <GanttChartSquare className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Timeline</h3>
      </div>

      {ordered.length > 0 ? (
        <>
          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <EChart option={option} height={chartHeight} onEvents={onEvents} />
            </div>
          </div>
          {hiddenCount > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              {hiddenCount} task{hiddenCount === 1 ? "" : "s"} hidden (no dates)
            </p>
          )}
        </>
      ) : (
        <div className="rounded-lg border-2 border-dashed border-border py-12 text-center">
          <p className="text-sm text-muted-foreground">
            No tasks with start and end dates to plot.
          </p>
          {hiddenCount > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {hiddenCount} task{hiddenCount === 1 ? "" : "s"} hidden (no dates)
            </p>
          )}
        </div>
      )}
    </div>
  );
}
