"use client";

import { useMemo, useState } from "react";
import { STATUS_META, normalizeStatus } from "@/utils/pmData";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Token helpers                                                              */
/* -------------------------------------------------------------------------- */

// Status badge tones map STATUS_META.tone -> tailwind design tokens.
const STATUS_TONE_CLASS = {
  muted: "bg-muted text-muted-foreground",
  info: "bg-info/15 text-info",
  warning: "bg-warning/15 text-warning",
  success: "bg-success/15 text-success",
};

const PRIORITY_STYLES = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-info/15 text-info",
  high: "bg-warning/15 text-warning",
  urgent: "bg-destructive/15 text-destructive",
};

// Highest first for descending sort.
const PRIORITY_RANK = { urgent: 4, high: 3, medium: 2, low: 1 };

// Pipeline order for sensible status sorting.
const STATUS_ORDER = Object.keys(STATUS_META).reduce((acc, id, i) => {
  acc[id] = i;
  return acc;
}, {});

function formatDue(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const COLUMNS = [
  { key: "title", label: "Title", type: "string" },
  { key: "type", label: "Type", type: "string" },
  { key: "status", label: "Status", type: "status" },
  { key: "priority", label: "Priority", type: "priority" },
  { key: "assignee", label: "Assignee", type: "string" },
  { key: "points", label: "Points", type: "number", align: "right" },
  { key: "due", label: "Due", type: "date" },
  { key: "sprint", label: "Sprint", type: "string" },
  { key: "epic", label: "Epic", type: "string" },
];

/* -------------------------------------------------------------------------- */
/*  Badges                                                                     */
/* -------------------------------------------------------------------------- */

const badgeBase = "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold";

function StatusBadge({ status }) {
  const meta = STATUS_META[normalizeStatus(status)] || STATUS_META.pending;
  return <span className={`${badgeBase} ${STATUS_TONE_CLASS[meta.tone] || STATUS_TONE_CLASS.muted}`}>{meta.label}</span>;
}

function PriorityBadge({ priority }) {
  const p = priority || "medium";
  return <span className={`${badgeBase} ${PRIORITY_STYLES[p] || PRIORITY_STYLES.medium}`}>{p}</span>;
}

function TypeBadge({ type }) {
  if (!type) return <span className="text-muted-foreground">—</span>;
  return <span className={`${badgeBase} bg-muted text-muted-foreground`}>{type}</span>;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export default function TableView({ tasks, employees, sprints, epics, onOpenTask }) {
  const [sort, setSort] = useState({ key: "title", dir: "asc" });

  const empById = useMemo(() => {
    const m = new Map();
    for (const e of employees || []) m.set(e.userId, e.name);
    return m;
  }, [employees]);

  const sprintById = useMemo(() => {
    const m = new Map();
    for (const s of sprints || []) m.set(String(s.id), s.name);
    return m;
  }, [sprints]);

  const epicById = useMemo(() => {
    const m = new Map();
    for (const e of epics || []) m.set(String(e.id), e.name);
    return m;
  }, [epics]);

  // Derive a display row for a task (also used as sort source).
  const rowOf = useMemo(
    () => (t) => ({
      task: t,
      title: t.task_title || "Untitled task",
      type: t.task_type || null,
      assignee: t.developer_id ? empById.get(t.developer_id) || "—" : "Unassigned",
      points: t.story_points == null ? null : Number(t.story_points),
      sprint: t.sprint_id != null ? sprintById.get(String(t.sprint_id)) || "—" : "—",
      epic: t.epic_id != null ? epicById.get(String(t.epic_id)) || "—" : "—",
    }),
    [empById, sprintById, epicById]
  );

  const sortValue = (t, col) => {
    switch (col.key) {
      case "title":
        return t.task_title || "";
      case "type":
        return t.task_type || "";
      case "status":
        return STATUS_ORDER[normalizeStatus(t.status)] ?? 0;
      case "priority":
        return PRIORITY_RANK[t.priority] ?? 0;
      case "assignee":
        return t.developer_id ? empById.get(t.developer_id) || "" : "Unassigned";
      case "points":
        return t.story_points == null ? null : Number(t.story_points);
      case "due": {
        if (!t.due_date) return null;
        const d = new Date(t.due_date).getTime();
        return Number.isNaN(d) ? null : d;
      }
      case "sprint":
        return t.sprint_id != null ? sprintById.get(String(t.sprint_id)) || "" : "";
      case "epic":
        return t.epic_id != null ? epicById.get(String(t.epic_id)) || "" : "";
      default:
        return "";
    }
  };

  const sortedRows = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sort.key) || COLUMNS[0];
    const factor = sort.dir === "asc" ? 1 : -1;
    const cmp = (a, b) => {
      const av = sortValue(a, col);
      const bv = sortValue(b, col);
      // Nulls always sort last, regardless of direction.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
      return String(av).localeCompare(String(bv)) * factor;
    };
    return [...(tasks || [])].sort(cmp).map(rowOf);
  }, [tasks, sort, empById, sprintById, epicById, rowOf]);

  const toggleSort = (key) =>
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  const SortIcon = ({ colKey }) => {
    if (sort.key !== colKey) return <ChevronsUpDown className="h-3 w-3 opacity-40" />;
    return sort.dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />;
  };

  if (!tasks || tasks.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
        <p className="m-5 rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          No tasks
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="sticky top-0 bg-card text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className="cursor-pointer select-none px-3 py-2 text-left"
                >
                  <span className={`inline-flex items-center gap-1 ${col.align === "right" ? "justify-end" : ""}`}>
                    {col.label}
                    <SortIcon colKey={col.key} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => {
              const t = row.task;
              return (
                <tr
                  key={t.id}
                  onClick={() => onOpenTask && onOpenTask(t)}
                  className="cursor-pointer border-t border-border hover:bg-muted/40"
                >
                  <td className="px-3 py-2 font-medium text-foreground">
                    <span className="line-clamp-1">{row.title}</span>
                  </td>
                  <td className="px-3 py-2">
                    <TypeBadge type={row.type} />
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="px-3 py-2">
                    <PriorityBadge priority={t.priority} />
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{row.assignee}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.points == null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        {row.points}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{formatDue(t.due_date)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.sprint}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.epic}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
