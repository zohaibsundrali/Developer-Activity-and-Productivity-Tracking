"use client";

import { useCallback, useMemo, useState } from "react";
import { changeTaskStatus, BOARD_COLUMNS, STATUS_META, normalizeStatus } from "@/utils/pmData";
import { showError } from "@/utils/alerts";
import { Board, TaskCard } from "@/components/admin/views/viewKit";

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

      const target = BOARD_COLUMNS.find((c) => c.id === columnId);
      if (target?.reviewOnly) {
        showError(
          "Not a drop target",
          `"${target.label}" is decided in Task Reviews, not by moving a card.`
        );
        return;
      }

      try {
        const { error } = await changeTaskStatus(task.id, columnId);
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
          onOpen={onOpenTask}
          onDragStart={handleDragStart}
          onDragEnd={() => setDragOverCol(null)}
        />
      )),
    };
  });

  return <Board columns={boardColumns} ariaLabel="Kanban board" />;
}
