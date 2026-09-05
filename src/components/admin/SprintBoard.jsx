"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  changeTaskStatus,
  normalizeStatus,
  BOARD_COLUMNS,
  STATUS_META,
  computeBurndown,
} from "@/utils/pmData";
import { showError } from "@/utils/alerts";
import EChart from "@/components/charts/EChart";
import StatCard from "@/components/shell/StatCard";
import {
  PRIMARY,
  SEMANTIC,
  baseTooltip,
  axisLabel,
  valueAxis,
  categoryAxis,
  legendFor,
  gridWithLegend,
  fmtInt,
  FONT_FAMILY,
} from "@/components/charts/chartTheme";
import { Badge, EmptyState } from "@/components/ui";
import { Board, SELECT_CLASS, TaskCard } from "@/components/admin/views/viewKit";
import {
  Target,
  CheckCircle2,
  Loader,
  TrendingUp,
  Flag,
  Activity,
  LineChart,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Constants / helpers                                                        */
/* -------------------------------------------------------------------------- */

const DONE_STATUSES = new Set(["completed", "reviewed"]);

const SPRINT_STATUS_VARIANT = {
  planned: "secondary",
  active: "info",
  completed: "success",
};

// Short "MMM d" axis label from a YYYY-MM-DD string (kept raw for the tooltip).
function formatDayShort(value) {
  if (!value) return "";
  const d = new Date(value + "T00:00:00");
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function pointsValue(task) {
  const p = task?.story_points;
  return p != null && p !== "" ? Number(p) || 0 : 0;
}

/* -------------------------------------------------------------------------- */
/*  Main board                                                                 */
/* -------------------------------------------------------------------------- */

export default function SprintBoard({
  projectId,
  sprints,
  tasks,
  employees,
  onChanged,
}) {
  const sprintList = useMemo(
    () => (Array.isArray(sprints) ? sprints : []),
    [sprints]
  );

  // Default to the first active sprint, else the first sprint.
  const defaultSprintId = useMemo(() => {
    if (!sprintList.length) return null;
    const active = sprintList.find((s) => s.status === "active");
    return String((active || sprintList[0]).id);
  }, [sprintList]);

  const [selectedId, setSelectedId] = useState(defaultSprintId);
  const [dragOverCol, setDragOverCol] = useState(null);

  // Optimistic status overrides keyed by task id (applied over the tasks prop).
  const [statusOverrides, setStatusOverrides] = useState({});

  // Keep the selection valid if the sprint list changes underneath us.
  useEffect(() => {
    setSelectedId((prev) => {
      if (prev && sprintList.some((s) => String(s.id) === String(prev))) {
        return prev;
      }
      return defaultSprintId;
    });
  }, [sprintList, defaultSprintId]);

  // Clear optimistic overrides whenever fresh task data arrives.
  useEffect(() => {
    setStatusOverrides({});
  }, [tasks]);

  const selectedSprint = useMemo(
    () => sprintList.find((s) => String(s.id) === String(selectedId)) || null,
    [sprintList, selectedId]
  );

  // Tasks for the selected sprint, with any optimistic status applied.
  const sprintTasks = useMemo(() => {
    if (!selectedSprint) return [];
    return (Array.isArray(tasks) ? tasks : [])
      .filter((t) => t && String(t.sprint_id || "") === String(selectedSprint.id))
      .map((t) =>
        statusOverrides[t.id] != null
          ? { ...t, status: statusOverrides[t.id] }
          : t
      );
  }, [tasks, selectedSprint, statusOverrides]);

  /* ---- lookups -------------------------------------------------------- */
  const assigneeName = useCallback(
    (developerId) => {
      if (!developerId) return null;
      const match = (employees || []).find((e) => e.userId === developerId);
      return match?.name || null;
    },
    [employees]
  );

  /* ---- stats ---------------------------------------------------------- */
  const stats = useMemo(() => {
    let totalPoints = 0;
    let completedPoints = 0;
    let completed = 0;
    let inProgress = 0;
    for (const t of sprintTasks) {
      const pts = pointsValue(t);
      totalPoints += pts;
      if (DONE_STATUSES.has(t.status)) {
        completed += 1;
        completedPoints += pts;
      }
      if (t.status === "in_progress") inProgress += 1;
    }
    const progress =
      totalPoints > 0 ? Math.round((completedPoints / totalPoints) * 100) : 0;
    return { totalPoints, completed, inProgress, progress };
  }, [sprintTasks]);

  /* ---- burndown option ------------------------------------------------ */
  const burndown = useMemo(
    () => computeBurndown(selectedSprint, sprintTasks),
    [selectedSprint, sprintTasks]
  );

  const burndownOption = useMemo(() => {
    const { days, ideal, actual } = burndown;
    return {
      textStyle: { fontFamily: FONT_FAMILY },
      tooltip: {
        ...baseTooltip,
        trigger: "axis",
        valueFormatter: (v) => (v == null ? "—" : `${fmtInt(v)} pts`),
      },
      // Two series, so the legend earns its place. gridWithLegend opens the top
      // that baseGrid's 28px left too tight — the legend used to sit on the
      // plot area. The bottom keeps the date ticks off the panel edge.
      legend: legendFor(2),
      grid: gridWithLegend(2, { bottom: 16 }),
      xAxis: {
        ...categoryAxis,
        boundaryGap: false,
        data: days,
        // A three-week sprint has 21 ticks; hideOverlap thins them instead of
        // stacking the dates into an unreadable smear.
        axisLabel: { ...axisLabel, hideOverlap: true, formatter: (v) => formatDayShort(v) },
      },
      yAxis: {
        ...valueAxis,
        // The unit is named in the panel heading instead of as an axis name,
        // which used to collide with the legend on a narrow card.
        minInterval: 1,
      },
      series: [
        {
          // The ideal line is a reference, not a measurement: neutral and
          // dashed so the eye reads the actual line against it.
          name: "Ideal",
          type: "line",
          data: ideal,
          lineStyle: { type: "dashed", width: 2 },
          color: SEMANTIC.muted,
          symbol: "none",
        },
        {
          name: "Remaining",
          type: "line",
          data: actual,
          color: PRIMARY,
          lineStyle: { width: 2 },
          areaStyle: { opacity: 0.06 },
          connectNulls: false,
          smooth: true,
        },
      ],
    };
  }, [burndown]);

  /* ---- board columns -------------------------------------------------- */
  const columns = useMemo(() => {
    const buckets = {};
    for (const col of BOARD_COLUMNS) buckets[col.id] = [];
    for (const t of sprintTasks) buckets[normalizeStatus(t.status)].push(t);
    return BOARD_COLUMNS.map((col) => ({ ...col, items: buckets[col.id] || [] }));
  }, [sprintTasks]);

  /* ---- drag & drop ---------------------------------------------------- */
  const handleDragStart = useCallback((e, task) => {
    if (!task?.id) return;
    e.dataTransfer.setData("text/plain", String(task.id));
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDrop = useCallback(
    async (e, columnId) => {
      e.preventDefault();
      setDragOverCol(null);
      const id = e.dataTransfer.getData("text/plain");
      if (!id) return;
      const task = sprintTasks.find((t) => String(t.id) === String(id));
      if (!task) return;
      if (normalizeStatus(task.status) === columnId) return; // no move needed

      const target = BOARD_COLUMNS.find((c) => c.id === columnId);
      if (target?.reviewOnly) {
        showError(
          "Not a drop target",
          `"${target.label}" is decided in Task Reviews, not by moving a card.`
        );
        return;
      }

      // Optimistic local update for snappiness.
      setStatusOverrides((prev) => ({ ...prev, [task.id]: columnId }));

      // Drop the optimistic position so the reloaded server truth is what shows.
      // Without this a rejected move (illegal transition, network error) left the
      // card stuck in the target column — sprintTasks kept overlaying the stale
      // override — until the sprint was switched or the page reloaded.
      const clearOverride = () =>
        setStatusOverrides((prev) => {
          const next = { ...prev };
          delete next[task.id];
          return next;
        });

      try {
        const { error } = await changeTaskStatus(task.id, columnId);
        if (error) {
          showError("Move failed", error.message || String(error));
          clearOverride();
          await onChanged?.(); // revert to server truth
          return;
        }
        clearOverride();
        await onChanged?.();
      } catch (err) {
        showError("Move failed", err?.message || String(err));
        clearOverride();
        await onChanged?.();
      }
    },
    [sprintTasks, onChanged]
  );

  /* ---- empty state ---------------------------------------------------- */
  if (!sprintList.length) {
    return (
      <EmptyState
        icon={Activity}
        title="No sprints yet"
        description="Plan a sprint in the Backlog & Planning tab, then the board and its burndown will appear here."
      />
    );
  }

  const boardColumns = columns.map((col) => {
    const meta = STATUS_META[col.id] || { label: col.label, tone: "muted" };
    return {
      id: col.id,
      label: meta.label,
      tone: meta.tone,
      count: col.items.length,
      reviewOnly: col.reviewOnly,
      isOver: dragOverCol === col.id,
      dropProps: {
        onDragOver: (e) => {
          e.preventDefault();
          if (col.reviewOnly) return; // never signals a valid drop
          if (dragOverCol !== col.id) setDragOverCol(col.id);
        },
        onDragLeave: () => setDragOverCol((c) => (c === col.id ? null : c)),
        onDrop: (e) => handleDrop(e, col.id),
      },
      children: col.items.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          assigneeName={assigneeName(task.developer_id)}
          onDragStart={handleDragStart}
          onDragEnd={() => setDragOverCol(null)}
        />
      )),
    };
  });

  /* ---- main render ---------------------------------------------------- */
  return (
    <div className="space-y-6">
      {/* Sprint selector */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="sprint-board-select" className="sr-only">
            Select sprint
          </label>
          <select
            id="sprint-board-select"
            value={selectedId || ""}
            onChange={(e) => setSelectedId(e.target.value || null)}
            className={`${SELECT_CLASS} font-medium`}
          >
            {sprintList.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name || `Sprint ${s.id}`}
              </option>
            ))}
          </select>

          {selectedSprint?.status ? (
            <Badge variant={SPRINT_STATUS_VARIANT[selectedSprint.status] || "secondary"}>
              {selectedSprint.status}
            </Badge>
          ) : null}

          {selectedSprint?.goal && (
            <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
              <Flag className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="line-clamp-1">{selectedSprint.goal}</span>
            </p>
          )}
        </div>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard title="Total points" value={stats.totalPoints} icon={Target} tone="primary" />
        <StatCard title="Completed" value={stats.completed} icon={CheckCircle2} tone="success" />
        <StatCard title="In progress" value={stats.inProgress} icon={Loader} tone="info" />
        <StatCard title="Progress" value={`${stats.progress}%`} icon={TrendingUp} tone="warning" />
      </div>

      {/* Burndown */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h3 className="text-sm font-semibold text-foreground">Burndown</h3>
          <p className="text-xs text-muted-foreground">Story points remaining per day</p>
        </div>
        {burndown.totalPoints === 0 ? (
          <EmptyState
            icon={LineChart}
            title="No data yet"
            description="Nothing in this sprint carries story points, so there is no burndown to draw. Estimate a few tasks in Backlog & Planning."
          />
        ) : (
          <EChart option={burndownOption} height={300} />
        )}
      </div>

      {/* Board */}
      <Board columns={boardColumns} ariaLabel="Sprint board" />
    </div>
  );
}
