"use client";

import { useMemo, useState } from "react";
import { BOARD_COLUMNS, STATUS_META, normalizeStatus } from "@/utils/pmData";
import { Badge } from "@/components/ui";
import { List as ListIcon } from "lucide-react";
import {
  Avatar,
  DueDate,
  PointsBadge,
  SELECT_CLASS,
  TONE_DOT_CLASS,
  TypeBadge,
  VIEW_ROW_CLASS,
  ViewEmpty,
  ViewToolbar,
  taskRef,
} from "@/components/admin/views/viewKit";

/* -------------------------------------------------------------------------- */
/*  Constants / helpers                                                        */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/*  Task row                                                                   */
/* -------------------------------------------------------------------------- */

function TaskRow({ task, assigneeName, onOpenTask }) {
  const priority = task?.priority || "medium";
  const open = () => onOpenTask && onOpenTask(task);
  const ref = taskRef(task);

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
      className={`${VIEW_ROW_CLASS} cursor-pointer border-b border-border last:border-0`}
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[priority] || PRIORITY_DOT.medium}`}
        title={`${priority} priority`}
        aria-hidden="true"
      />
      <span className="sr-only">{priority} priority</span>

      {ref ? (
        <span className="hidden w-20 shrink-0 font-mono text-[10px] uppercase tracking-wide text-muted-foreground sm:inline">
          {ref}
        </span>
      ) : null}

      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
        {task?.task_title || "Untitled task"}
      </span>

      <span className="hidden shrink-0 sm:inline-flex">
        <TypeBadge type={task?.task_type} />
      </span>

      <PointsBadge points={task?.story_points} />

      <span className="hidden w-36 shrink-0 items-center gap-2 sm:flex">
        <Avatar name={assigneeName} />
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
          {assigneeName || "Unassigned"}
        </span>
      </span>

      <span className="w-20 shrink-0 text-right">
        <DueDate value={task?.due_date || task?.end_date} />
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
      tone: STATUS_META[col.id]?.tone || "muted",
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
      <ViewToolbar
        icon={ListIcon}
        title="List"
        description={`${totalTasks} task${totalTasks === 1 ? "" : "s"}`}
      >
        <label htmlFor="list-group-by" className="text-xs font-medium text-muted-foreground">
          Group by
        </label>
        <select
          id="list-group-by"
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value)}
          className={SELECT_CLASS}
        >
          {GROUP_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </ViewToolbar>

      {totalTasks === 0 || visibleGroups.length === 0 ? (
        <ViewEmpty />
      ) : (
        visibleGroups.map((group) => (
          <div
            key={group.key}
            className="overflow-hidden rounded-xl border border-border bg-card shadow-card"
          >
            <div className="flex h-12 items-center gap-2 border-b border-border bg-muted/30 px-4">
              {group.tone ? (
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    TONE_DOT_CLASS[group.tone] || TONE_DOT_CLASS.muted
                  }`}
                  aria-hidden="true"
                />
              ) : null}
              <h3 className="truncate text-xs font-semibold uppercase tracking-wide text-foreground">
                {group.name}
              </h3>
              <Badge variant="secondary" size="sm" className="ml-auto tabular-nums">
                {group.items.length}
              </Badge>
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
