"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  changeTaskStatus,
  normalizeStatus,
  BOARD_COLUMNS,
  computeBurndown,
} from "@/utils/pmData";
import { showError } from "@/utils/alerts";
import EChart from "@/components/charts/EChart";
import StatCard from "@/components/shell/StatCard";
import {
  PALETTE,
  SEMANTIC,
  baseGrid,
  baseTooltip,
  axisLabel,
  splitLine,
  FONT_FAMILY,
} from "@/components/charts/chartTheme";
import {
  Target,
  CheckCircle2,
  Loader,
  TrendingUp,
  Flag,
  Activity,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Constants / helpers                                                        */
/* -------------------------------------------------------------------------- */

const DONE_STATUSES = new Set(["completed", "reviewed"]);

const PRIORITY_STYLES = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-info/15 text-info",
  high: "bg-warning/15 text-warning",
  urgent: "bg-destructive/15 text-destructive",
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
/*  Task card                                                                  */
/* -------------------------------------------------------------------------- */

function TaskCard({ task, assigneeName, onDragStart, onDragEnd }) {
  const priority = task?.priority || "medium";
  const points = task?.story_points;

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, task)}
      onDragEnd={onDragEnd}
      className="rounded-lg border border-border bg-card p-3 shadow-card cursor-grab active:cursor-grabbing hover:shadow-elevated transition-shadow"
    >
      <p className="text-sm font-medium text-foreground line-clamp-2">
        {task?.task_title || "Untitled task"}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            PRIORITY_STYLES[priority] || PRIORITY_STYLES.medium
          }`}
        >
          <Flag className="h-2.5 w-2.5" />
          {priority}
        </span>

        {points != null && points !== "" && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary tabular-nums">
            {points} pt
          </span>
        )}
      </div>

      <div className="mt-2 text-[11px] text-muted-foreground">
        {assigneeName || "Unassigned"}
      </div>
    </div>
  );
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
      tooltip: { ...baseTooltip, trigger: "axis" },
      legend: {
        top: 0,
        icon: "roundRect",
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { color: SEMANTIC.muted, fontSize: 11, fontFamily: FONT_FAMILY },
      },
      grid: baseGrid,
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: days,
        axisLabel: { ...axisLabel, formatter: (v) => formatDayShort(v) },
      },
      yAxis: {
        type: "value",
        name: "Points",
        nameTextStyle: axisLabel,
        axisLabel,
        splitLine,
      },
      series: [
        {
          name: "Ideal",
          type: "line",
          data: ideal,
          lineStyle: { type: "dashed" },
          color: SEMANTIC.muted,
          symbol: "none",
        },
        {
          name: "Remaining",
          type: "line",
          data: actual,
          color: PALETTE[0],
          areaStyle: { opacity: 0.08 },
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

      try {
        const { error } = await changeTaskStatus(task.id, columnId);
        if (error) {
          showError("Move failed", error.message || String(error));
          await onChanged?.(); // revert to server truth
          return;
        }
        await onChanged?.();
      } catch (err) {
        showError("Move failed", err?.message || String(err));
        await onChanged?.();
      }
    },
    [sprintTasks, onChanged]
  );

  /* ---- empty state ---------------------------------------------------- */
  if (!sprintList.length) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
        <Activity className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">
          No sprints yet — plan one in the Backlog tab.
        </p>
      </div>
    );
  }

  /* ---- main render ---------------------------------------------------- */
  return (
    <div className="space-y-4">
      {/* Sprint selector */}
      <div className="rounded-xl border border-border bg-card p-3 shadow-card">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedId || ""}
            onChange={(e) => setSelectedId(e.target.value || null)}
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
            aria-label="Select sprint"
          >
            {sprintList.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name || `Sprint ${s.id}`}
                {s.status ? ` · ${s.status}` : ""}
              </option>
            ))}
          </select>

          {selectedSprint?.goal && (
            <p className="text-sm text-muted-foreground line-clamp-1">
              {selectedSprint.goal}
            </p>
          )}
        </div>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          title="Total Points"
          value={stats.totalPoints}
          icon={Target}
          tone="primary"
        />
        <StatCard
          title="Completed"
          value={stats.completed}
          icon={CheckCircle2}
          tone="success"
        />
        <StatCard
          title="In Progress"
          value={stats.inProgress}
          icon={Loader}
          tone="info"
        />
        <StatCard
          title="Progress %"
          value={`${stats.progress}%`}
          icon={TrendingUp}
          tone="violet"
        />
      </div>

      {/* Burndown */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-card">
        <h3 className="text-sm font-semibold text-foreground">Burndown</h3>
        {burndown.totalPoints === 0 ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-muted-foreground">
              No pointed tasks in this sprint yet
            </p>
          </div>
        ) : (
          <div className="mt-3">
            <EChart option={burndownOption} height={300} />
          </div>
        )}
      </div>

      {/* Board */}
      <div className="flex gap-4 overflow-x-auto pb-2">
        {columns.map((col) => {
          const isOver = dragOverCol === col.id;
          return (
            <div
              key={col.id}
              onDragOver={(e) => {
                e.preventDefault();
                if (col.reviewOnly) return; // never signals a valid drop
                if (dragOverCol !== col.id) setDragOverCol(col.id);
              }}
              onDragLeave={() =>
                setDragOverCol((c) => (c === col.id ? null : c))
              }
              onDrop={(e) => handleDrop(e, col.id)}
              className={`w-72 shrink-0 rounded-xl border p-3 transition-colors ${
                isOver
                  ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                  : "border-border bg-muted/30"
              }`}
            >
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">
                  {col.label}
                </h3>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
                  {col.items.length}
                </span>
              </div>

              <div className="max-h-[65vh] space-y-2 overflow-y-auto pr-0.5">
                {col.items.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    assigneeName={assigneeName(task.developer_id)}
                    onDragStart={handleDragStart}
                    onDragEnd={() => setDragOverCol(null)}
                  />
                ))}

                {!col.items.length && (
                  <p className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
                    No tasks
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
