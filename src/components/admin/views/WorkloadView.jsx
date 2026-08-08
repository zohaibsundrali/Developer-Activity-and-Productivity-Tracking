"use client";

import { useMemo } from "react";
import { STATUS_META, normalizeStatus } from "@/utils/pmData";
import EChart from "@/components/charts/EChart";
import StatCard from "@/components/shell/StatCard";
import { Badge, DataTable } from "@/components/ui";
import {
  SEMANTIC,
  baseGrid,
  baseTooltip,
  axisLabel,
  splitLine,
  FONT_FAMILY,
} from "@/components/charts/chartTheme";
import { ListChecks, Users, UserX, Target } from "lucide-react";
import { Avatar, ViewEmpty, ViewPanel, ViewToolbar } from "@/components/admin/views/viewKit";

// Canonical status columns (order matters for the stacked series + table).
const STATUS_COLUMNS = ["pending", "in_progress", "awaiting_approval", "completed", "rejected"];

const STATUS_COLOR = {
  pending: SEMANTIC.muted,
  in_progress: SEMANTIC.info,
  awaiting_approval: SEMANTIC.warning,
  completed: SEMANTIC.success,
  rejected: SEMANTIC.danger,
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
          counts: { pending: 0, in_progress: 0, awaiting_approval: 0, completed: 0, rejected: 0 },
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
      tooltip: { ...baseTooltip, trigger: "axis", axisPointer: { type: "shadow" }, confine: true },
      legend: {
        top: 0,
        // Five series wrap onto a second line on a narrow card and then sit on
        // top of the first bars; a scrolling legend keeps it to one row.
        type: "scroll",
        textStyle: { fontFamily: FONT_FAMILY, color: axisLabel.color, fontSize: 11 },
        icon: "roundRect",
        itemWidth: 10,
        itemHeight: 10,
      },
      // Extra top gap so the legend never overlaps the plot area.
      grid: { ...baseGrid, top: 40 },
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
        // Long names would otherwise push the plot area off the right edge.
        axisLabel: { ...axisLabel, width: 120, overflow: "truncate" },
      },
      series,
    };
  }, [rows]);

  const toolbar = (
    <ViewToolbar
      icon={Users}
      title="Workload"
      description={`${rows.length} bucket${rows.length === 1 ? "" : "s"}`}
    />
  );

  if (!tasks || tasks.length === 0) {
    return (
      <div className="space-y-4">
        {toolbar}
        <ViewEmpty
          icon={Users}
          title="No workload to chart"
          description="No tasks match the current filters, so there is nothing to spread across the team yet."
        />
      </div>
    );
  }

  const chartHeight = Math.min(720, Math.max(260, rows.length * 44 + 60));

  const tableColumns = [
    {
      key: "name",
      header: "Assignee",
      render: (r) => (
        <div className="flex min-w-0 items-center gap-2">
          <Avatar name={r.key === UNASSIGNED_KEY ? "" : r.name} />
          <span className="truncate font-medium text-foreground">{r.name}</span>
          {busiestTotal > 0 && r.total === busiestTotal ? (
            <Badge variant="warning" size="sm">
              Busiest
            </Badge>
          ) : null}
        </div>
      ),
    },
    ...STATUS_COLUMNS.map((col) => ({
      key: col,
      header: STATUS_META[col].label,
      align: "right",
      render: (r) => <span className="tabular-nums text-muted-foreground">{r.counts[col]}</span>,
    })),
    {
      key: "total",
      header: "Total",
      align: "right",
      render: (r) => <span className="font-semibold tabular-nums text-foreground">{r.total}</span>,
    },
    {
      key: "points",
      header: "Points",
      align: "right",
      render: (r) => (
        <Badge variant="secondary" size="sm" className="tabular-nums">
          {r.points}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {toolbar}

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total tasks" value={totals.tasks} icon={ListChecks} tone="primary" />
        <StatCard title="Assigned people" value={totals.people} icon={Users} tone="info" />
        <StatCard title="Unassigned" value={totals.unassigned} icon={UserX} tone="warning" />
        <StatCard title="Total points" value={totals.points} icon={Target} tone="success" />
      </div>

      {/* Chart */}
      <ViewPanel>
        <h3 className="mb-3 text-sm font-semibold text-foreground">Workload by assignee</h3>
        <EChart option={chartOption} height={chartHeight} />
      </ViewPanel>

      {/* Breakdown */}
      <DataTable columns={tableColumns} rows={rows} keyField="key" />
    </div>
  );
}
