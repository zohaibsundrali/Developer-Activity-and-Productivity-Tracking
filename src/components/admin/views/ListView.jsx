"use client";

import { useMemo, useState } from "react";
import { BOARD_COLUMNS, STATUS_META, normalizeStatus } from "@/utils/pmData";
import { Layers } from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Constants / helpers                                                        */
/* -------------------------------------------------------------------------- */

const INPUT_CLASS =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30";

const PRIORITY_DOT = {
  low: "bg-muted-foreground",
  medium: "bg-info",
  high: "bg-warning",
  urgent: "bg-destructive",
};

const GROUP_OPTIONS = [
  { id: "status", label: "Status" },
  { id: "sprint", label: "Sprint" },
  { id: "epic", label: "Epic" },
  { id: "assignee", label: "Assignee" },
  { id: "none", label: "None" },
];

function formatDue(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* -------------------------------------------------------------------------- */
/*  Task row                                                                   */
/* -------------------------------------------------------------------------- */

function TaskRow({ task, assigneeName, onOpenTask }) {
  const priority = task?.priority || "medium";
  const points = task?.story_points;
  const due = formatDue(task?.due_date || task?.end_date);
  const open = () => onOpenTask && onOpenTask(task);

  return (
    <div
      onClick={open}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      className="flex cursor-pointer items-center gap-3 border-b border-border px-4 py-2.5 last:border-0 hover:bg-muted/40"
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[priority] || PRIORITY_DOT.medium}`}
        aria-hidden="true"
      />

      <span className="flex-1 truncate text-sm font-medium text-foreground">
        {task?.task_title || "Untitled task"}
      </span>

      {task?.task_type && (
        <span className="hidden rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground sm:inline-flex">
          {task.task_type}
        </span>
      )}

      {points != null && points !== "" && (
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary tabular-nums">
          {points} pt
        </span>
      )}

      <span className="hidden w-28 truncate text-right text-[11px] text-muted-foreground sm:inline-block">
        {assigneeName || "Unassigned"}
      </span>

      <span className="w-14 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
        {due || ""}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Grouping                                                                   */
/* -------------------------------------------------------------------------- */

function buildGroups(groupBy, tasks, { sprints, epics, employees }) {
  const list = (tasks || []).filter(Boolean);

  if (groupBy === "status") {
    const buckets = {};
    for (const col of BOARD_COLUMNS) buckets[col.id] = [];
    for (const t of list) buckets[normalizeStatus(t.status)].push(t);
    return BOARD_COLUMNS.map((col) => ({
      key: col.id,
      name: STATUS_META[col.id]?.label || col.label,
      items: buckets[col.id] || [],
    }));
  }

  if (groupBy === "none") {
    return [{ key: "all", name: "All tasks", items: list }];
  }

  // sprint | epic | assignee — dynamic id-based buckets with a null fallback.
  const config = {
    sprint: {
      field: "sprint_id",
      source: sprints,
      idKey: "id",
      nameKey: "name",
      nullName: "Backlog",
    },
    epic: {
      field: "epic_id",
      source: epics,
      idKey: "id",
      nameKey: "name",
      nullName: "No epic",
    },
    assignee: {
      field: "developer_id",
      source: employees,
      idKey: "userId",
      nameKey: "name",
      nullName: "Unassigned",
    },
  }[groupBy];

  const nameFor = new Map(
    (config.source || []).map((row) => [String(row[config.idKey]), row[config.nameKey]])
  );

  const buckets = new Map();
  const order = [];
  const push = (key, name, task) => {
    if (!buckets.has(key)) {
      buckets.set(key, { key, name, items: [] });
      order.push(key);
    }
    buckets.get(key).items.push(task);
  };

  for (const t of list) {
    const raw = t[config.field];
    if (raw == null || raw === "") {
      push("__none__", config.nullName, t);
    } else {
      const key = String(raw);
      push(key, nameFor.get(key) || config.nullName, t);
    }
  }

  return order.map((key) => buckets.get(key));
}

/* -------------------------------------------------------------------------- */
/*  List view                                                                  */
/* -------------------------------------------------------------------------- */

export default function ListView({ tasks, employees, sprints, epics, onOpenTask }) {
  const [groupBy, setGroupBy] = useState("status");

  const assigneeName = useMemo(() => {
    const map = new Map((employees || []).map((e) => [e.userId, e.name]));
    return (developerId) => (developerId ? map.get(developerId) || null : null);
  }, [employees]);

  const groups = useMemo(
    () => buildGroups(groupBy, tasks, { sprints, epics, employees }),
    [groupBy, tasks, sprints, epics, employees]
  );

  const visibleGroups = groups.filter((g) => g.items.length > 0);
  const totalTasks = (tasks || []).filter(Boolean).length;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-2">
        <label htmlFor="list-group-by" className="text-sm font-medium text-muted-foreground">
          Group by
        </label>
        <select
          id="list-group-by"
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value)}
          className={INPUT_CLASS}
        >
          {GROUP_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* Groups */}
      {totalTasks === 0 || visibleGroups.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center shadow-card">
          <Layers className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium text-foreground">No tasks</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Tasks will appear here once they are created.
          </p>
        </div>
      ) : (
        visibleGroups.map((group) => (
          <div
            key={group.key}
            className="overflow-hidden rounded-xl border border-border bg-card shadow-card"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <h3 className="text-sm font-semibold text-foreground">{group.name}</h3>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground tabular-nums">
                {group.items.length}
              </span>
            </div>

            <div>
              {group.items.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  assigneeName={assigneeName(task.developer_id)}
                  onOpenTask={onOpenTask}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
