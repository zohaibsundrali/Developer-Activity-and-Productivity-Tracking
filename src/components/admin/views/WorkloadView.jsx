"use client";

import { useMemo } from "react";
import { STATUS_META, normalizeStatus } from "@/utils/pmData";
import EChart from "@/components/charts/EChart";
import StatCard from "@/components/shell/StatCard";
import { SEMANTIC, baseGrid, baseTooltip, axisLabel, splitLine, FONT_FAMILY } from "@/components/charts/chartTheme";
import { ListChecks, Users, UserX, Target } from "lucide-react";

// Canonical status columns (order matters for the stacked series + table).
const STATUS_COLUMNS = ["pending", "in_progress", "awaiting_approval", "completed"];

const STATUS_COLOR = {
  pending: SEMANTIC.muted,
  in_progress: SEMANTIC.info,
  awaiting_approval: SEMANTIC.warning,
  completed: SEMANTIC.success,
};

const UNASSIGNED_KEY = "__unassigned__";

export default function WorkloadView({ tasks, employees }) {
  const { rows, totals } = useMemo(() => {
    const nameById = new Map();
    for (const e of employees || []) nameById.set(e.userId, e.name);

    // Group tasks by developer_id (null -> Unassigned bucket).
    const buckets = new Map();
    const ensure = (key, name) => {
      if (!buckets.has(key)) {
        buckets.set(key, {
          key,
          name,
          counts: { pending: 0, in_progress: 0, awaiting_approval: 0, completed: 0 },
          total: 0,
          points: 0,
        });
      }
      return buckets.get(key);
    };

    const totalsAcc = {
      tasks: 0,
      points: 0,
      unassigned: 0,
      assigned: new Set(),
    };

    for (const t of tasks || []) {
      const key = t.developer_id || UNASSIGNED_KEY;
      const name = t.developer_id ? nameById.get(t.developer_id) || "Unknown" : "Unassigned";
      const b = ensure(key, name);
      const col = normalizeStatus(t.status);
      b.counts[col] += 1;
      b.total += 1;
      const pts = t.story_points == null ? 0 : Number(t.story_points) || 0;
      b.points += pts;

      totalsAcc.tasks += 1;
      totalsAcc.points += pts;
      if (t.developer_id) totalsAcc.assigned.add(t.developer_id);
      else totalsAcc.unassigned += 1;
    }

    // Assigned people first (alpha), Unassigned bucket last.
    const assignedRows = [];
    let unassignedRow = null;
    for (const b of buckets.values()) {
      if (b.key === UNASSIGNED_KEY) unassignedRow = b;
      else assignedRows.push(b);
    }
    assignedRows.sort((a, b) => a.name.localeCompare(b.name));
    const ordered = unassignedRow ? [...assignedRows, unassignedRow] : assignedRows;

    return {
      rows: ordered,
      totals: {
        tasks: totalsAcc.tasks,
        points: totalsAcc.points,
        unassigned: totalsAcc.unassigned,
        people: totalsAcc.assigned.size,
      },
    };
  }, [tasks, employees]);

  const busiestTotal = useMemo(() => rows.reduce((m, r) => Math.max(m, r.total), 0), [rows]);

  const chartOption = useMemo(() => {
    const categories = rows.map((r) => r.name);
    const series = STATUS_COLUMNS.map((col) => ({
      name: STATUS_META[col].label,
      type: "bar",
      stack: "total",
      emphasis: { focus: "series" },
      itemStyle: { color: STATUS_COLOR[col] },
      barMaxWidth: 22,
      data: rows.map((r) => r.counts[col]),
    }));

    return {
      textStyle: { fontFamily: FONT_FAMILY },
      tooltip: { ...baseTooltip, trigger: "axis", axisPointer: { type: "shadow" } },
      legend: {
        top: 0,
        textStyle: { fontFamily: FONT_FAMILY, color: "#64748b", fontSize: 11 },
        icon: "roundRect",
        itemWidth: 10,
        itemHeight: 10,
      },
      grid: baseGrid,
      xAxis: {
        type: "value",
        minInterval: 1,
        axisLabel,
        splitLine,
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: categories,
        axisLabel,
      },
      series,
    };
  }, [rows]);

  if (!tasks || tasks.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 shadow-card">
        <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          No tasks to chart
        </p>
      </div>
    );
  }

  const chartHeight = Math.max(280, rows.length * 44);

  return (
    <div className="space-y-4">
      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Tasks" value={totals.tasks} icon={ListChecks} tone="primary" />
        <StatCard title="Assigned People" value={totals.people} icon={Users} tone="info" />
        <StatCard title="Unassigned" value={totals.unassigned} icon={UserX} tone="warning" />
        <StatCard title="Total Points" value={totals.points} icon={Target} tone="violet" />
      </div>

      {/* Chart */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-card">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Workload by assignee</h3>
        <EChart option={chartOption} height={chartHeight} />
      </div>

      {/* Compact table */}
      <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-card text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 text-left">Assignee</th>
                <th className="px-3 py-2 text-right">To Do</th>
                <th className="px-3 py-2 text-right">In Progress</th>
                <th className="px-3 py-2 text-right">In Review</th>
                <th className="px-3 py-2 text-right">Done</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Points</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const busiest = busiestTotal > 0 && r.total === busiestTotal;
                return (
                  <tr
                    key={r.key}
                    className={`border-t border-border ${busiest ? "bg-primary/5" : "hover:bg-muted/40"}`}
                  >
                    <td className="px-3 py-2 font-medium text-foreground">{r.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.counts.pending}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.counts.in_progress}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {r.counts.awaiting_approval}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.counts.completed}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">{r.total}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        {r.points}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
