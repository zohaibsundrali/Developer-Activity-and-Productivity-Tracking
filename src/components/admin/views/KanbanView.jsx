"use client";

import { useCallback, useMemo, useState } from "react";
import { moveTask, BOARD_COLUMNS, STATUS_META, normalizeStatus } from "@/utils/pmData";
import { showError } from "@/utils/alerts";
import { Flag } from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Constants / helpers                                                        */
/* -------------------------------------------------------------------------- */

const PRIORITY_STYLES = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-info/15 text-info",
  high: "bg-warning/15 text-warning",
  urgent: "bg-destructive/15 text-destructive",
};

// Column count badge tone driven by STATUS_META.tone.
const TONE_STYLES = {
  muted: "bg-muted text-muted-foreground",
  info: "bg-info/15 text-info",
  warning: "bg-warning/15 text-warning",
  success: "bg-success/15 text-success",
  destructive: "bg-destructive/15 text-destructive",
};

/* -------------------------------------------------------------------------- */
/*  Task card                                                                  */
/* -------------------------------------------------------------------------- */

function TaskCard({ task, assigneeName, onOpen, onDragStart, onDragEnd }) {
  const priority = task?.priority || "medium";
  const points = task?.story_points;

  const open = () => onOpen && onOpen(task);

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, task)}
      onDragEnd={onDragEnd}
      onClick={open}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
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
/*  Kanban view                                                                */
/* -------------------------------------------------------------------------- */

export default function KanbanView({ tasks, employees, onOpenTask, onChanged }) {
  const [dragOverCol, setDragOverCol] = useState(null);

  const assigneeName = useCallback(
    (developerId) => {
      if (!developerId) return null;
      const match = (employees || []).find((e) => e.userId === developerId);
      return match?.name || null;
    },
    [employees]
  );

  const columns = useMemo(() => {
    const buckets = {};
    for (const col of BOARD_COLUMNS) buckets[col.id] = [];
    for (const t of tasks || []) {
      if (!t) continue;
      buckets[normalizeStatus(t.status)].push(t);
    }
    return BOARD_COLUMNS.map((col) => ({ ...col, items: buckets[col.id] || [] }));
  }, [tasks]);

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
      const task = (tasks || []).find((t) => String(t.id) === String(id));
      if (!task) return;
      if (normalizeStatus(task.status) === columnId) return; // no move needed

      try {
        const { error } = await moveTask(task.id, { status: columnId });
        if (error) {
          showError("Move failed", error.message || String(error));
          if (onChanged) await onChanged();
          return;
        }
        if (onChanged) await onChanged();
      } catch (err) {
        showError("Move failed", err?.message || String(err));
        if (onChanged) await onChanged();
      }
    },
    [tasks, onChanged]
  );

  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {columns.map((col) => {
        const meta = STATUS_META[col.id] || { label: col.label, tone: "muted" };
        const isOver = dragOverCol === col.id;
        return (
          <div
            key={col.id}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragOverCol !== col.id) setDragOverCol(col.id);
            }}
            onDragLeave={() => setDragOverCol((c) => (c === col.id ? null : c))}
            onDrop={(e) => handleDrop(e, col.id)}
            className={`w-72 shrink-0 rounded-xl border p-3 transition-colors ${
              isOver
                ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                : "border-border bg-muted/30"
            }`}
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">{meta.label}</h3>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
                  TONE_STYLES[meta.tone] || TONE_STYLES.muted
                }`}
              >
                {col.items.length}
              </span>
            </div>

            <div className="max-h-[65vh] space-y-2 overflow-y-auto pr-0.5">
              {col.items.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  assigneeName={assigneeName(task.developer_id)}
                  onOpen={onOpenTask}
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
  );
}
