"use client";

import { useMemo, useState } from "react";
import { STATUS_META, normalizeStatus } from "@/utils/pmData";
import { Badge, DataTable } from "@/components/ui";
import { ChevronUp, ChevronDown, ChevronsUpDown, Eye, EyeOff, Table as TableIcon } from "lucide-react";
import {
  Avatar,
  DueDate,
  PriorityBadge,
  TaskStatusPill,
  TypeBadge,
  ViewEmpty,
  ViewToolbar,
  taskRef,
} from "@/components/admin/views/viewKit";

/* -------------------------------------------------------------------------- */
/*  Sort metadata                                                              */
/* -------------------------------------------------------------------------- */

// Highest first for descending sort.
const PRIORITY_RANK = { urgent: 4, high: 3, medium: 2, low: 1 };

// The client's verdict on a task, which is a different axis from `status`: a
// task can be internally in review and already rejected by the client.
const CLIENT_APPROVAL_META = {
  pending: { label: "Awaiting", variant: "info" },
  approved: { label: "Approved", variant: "success" },
  changes_requested: { label: "Changes", variant: "warning" },
  rejected: { label: "Rejected", variant: "destructive" },
};

// Ordered so that one click into descending pulls the tasks a client is unhappy
// about to the top of the project, which is the reason a manager sorts here.
const CLIENT_APPROVAL_RANK = {
  pending: 1,
  approved: 2,
  changes_requested: 3,
  rejected: 4,
};

// Pipeline order for sensible status sorting.
const STATUS_ORDER = Object.keys(STATUS_META).reduce((acc, id, i) => {
  acc[id] = i;
  return acc;
}, {});

const COLUMNS = [
  // The widest thing in the table and the only cell that identifies the row, so
  // it gets a real allocation instead of an equal eleventh of the width. Without
  // it every title clipped to a single word — "Authenticati…", "Dashboard…",
  // "Database…" — while ~450px of the same table was em dashes.
  { key: "title", label: "Title", type: "string", width: "28rem" },
  // Sits next to the title on purpose: the title is the thing the portal
  // actually publishes, so the marker belongs against the words being exposed.
  { key: "clientVisible", label: "Client", type: "flag", align: "center", width: "72px" },
  { key: "type", label: "Type", type: "string" },
  { key: "status", label: "Status", type: "status" },
  // Next to the team's own status, never merged into it: one column is where
  // the work has got to, the other is what the client said about it.
  { key: "clientApproval", label: "Client approval", type: "approval" },
  { key: "priority", label: "Priority", type: "priority" },
  { key: "assignee", label: "Assignee", type: "string" },
  { key: "points", label: "Points", type: "number", align: "right", width: "88px" },
  { key: "due", label: "Due", type: "date", align: "right", width: "104px" },
  { key: "sprint", label: "Sprint", type: "string" },
  { key: "epic", label: "Epic", type: "string" },
];

/* -------------------------------------------------------------------------- */
/*  Cells                                                                      */
/* -------------------------------------------------------------------------- */

// A row carrying no client_visible value at all predates migration 032. Drawing
// it as "internal" would state something the row does not actually say, so the
// unknown case gets the same em dash every other empty cell here uses.
function ClientVisibleFlag({ value }) {
  if (value !== true && value !== false) {
    return (
      <span className="text-muted-foreground" title="No client-visibility setting on this task">
        —
      </span>
    );
  }
  const label = value
    ? "Visible to client — shown in the client portal"
    : "Internal only — not shown in the client portal";
  const Icon = value ? Eye : EyeOff;
  return (
    <span
      className={`inline-flex items-center ${value ? "text-success" : "text-muted-foreground"}`}
      title={label}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

// No client decision on a task is the ordinary case - most tasks are never put
// in front of a client - so it reads as the same em dash every other empty cell
// here uses, not as a state of its own.
function ClientApprovalBadge({ status }) {
  const meta = CLIENT_APPROVAL_META[status];
  if (!meta) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge variant={meta.variant} size="sm" title={`Client: ${meta.label}`}>
      {meta.label}
    </Badge>
  );
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
      id: t.id,
      task: t,
      title: t.task_title || "Untitled task",
      type: t.task_type || null,
      assignee: t.developer_id ? empById.get(t.developer_id) || null : null,
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
      case "clientVisible":
        // Sorting this column is the audit: one click pulls every task the
        // client can read to the top of the project.
        if (t.client_visible !== true && t.client_visible !== false) return null;
        return t.client_visible ? 1 : 0;
      case "type":
        return t.task_type || "";
      case "status":
        return STATUS_ORDER[normalizeStatus(t.status)] ?? 0;
      case "clientApproval":
        // Null, so tasks the client has never ruled on fall to the bottom in
        // both directions rather than crowding out the ones that need a reply.
        return CLIENT_APPROVAL_RANK[t.client_approval_status] ?? null;
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

  /**
   * Columns that are an em dash in EVERY row. On a project where nobody uses
   * sprints, epics, story points or client approvals, five of the eleven
   * columns are pure width — ~450px of nothing — and they are what squeezed the
   * title down to one word. They carry no information, so below `xl` they are
   * dropped and their width goes back to the title. Nothing is hidden that any
   * row actually fills, and on a wide screen every column still appears.
   */
  const emptyColumns = useMemo(() => {
    const empty = new Set();
    if (!sortedRows.length) return empty;
    // Only the columns that CAN be empty. Title, status and priority always
    // render something, so they are never candidates.
    const isFilled = {
      clientVisible: (r) => r.task.client_visible === true || r.task.client_visible === false,
      clientApproval: (r) => Boolean(CLIENT_APPROVAL_META[r.task.client_approval_status]),
      type: (r) => Boolean(r.type),
      assignee: (r) => Boolean(r.assignee),
      points: (r) => r.points != null,
      due: (r) => Boolean(r.task.due_date),
      sprint: (r) => r.sprint !== "—",
      epic: (r) => r.epic !== "—",
    };
    for (const [key, filled] of Object.entries(isFilled)) {
      if (!sortedRows.some(filled)) empty.add(key);
    }
    return empty;
  }, [sortedRows]);

  const toggleSort = (key) =>
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  const SortHeader = ({ col }) => {
    const activeSort = sort.key === col.key;
    const Icon = !activeSort ? ChevronsUpDown : sort.dir === "asc" ? ChevronUp : ChevronDown;
    return (
      <button
        type="button"
        onClick={() => toggleSort(col.key)}
        aria-label={`Sort by ${col.label}`}
        className={`inline-flex items-center gap-1 rounded transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
          activeSort ? "text-foreground" : ""
        }`}
      >
        {col.label}
        <Icon className={`h-3 w-3 ${activeSort ? "" : "opacity-40"}`} aria-hidden="true" />
      </button>
    );
  };

  const renderers = {
    title: (row) => (
      <div className="flex min-w-0 items-center gap-2">
        <span className="hidden shrink-0 font-mono text-[10px] uppercase tracking-wide text-muted-foreground lg:inline">
          {taskRef(row.task)}
        </span>
        <span className="line-clamp-1 font-medium text-foreground">{row.title}</span>
      </div>
    ),
    clientVisible: (row) => <ClientVisibleFlag value={row.task.client_visible} />,
    type: (row) => (row.type ? <TypeBadge type={row.type} /> : <span className="text-muted-foreground">—</span>),
    status: (row) => <TaskStatusPill status={row.task.status} />,
    clientApproval: (row) => <ClientApprovalBadge status={row.task.client_approval_status} />,
    priority: (row) => <PriorityBadge priority={row.task.priority} />,
    assignee: (row) => (
      <div className="flex min-w-0 items-center gap-2">
        <Avatar name={row.assignee} />
        <span className="truncate text-muted-foreground">{row.assignee || "Unassigned"}</span>
      </div>
    ),
    points: (row) =>
      row.points == null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <Badge variant="secondary" size="sm" className="tabular-nums">
          {row.points}
        </Badge>
      ),
    due: (row) =>
      row.task.due_date ? <DueDate value={row.task.due_date} /> : <span className="text-muted-foreground">—</span>,
    sprint: (row) => <span className="truncate text-muted-foreground">{row.sprint}</span>,
    epic: (row) => <span className="truncate text-muted-foreground">{row.epic}</span>,
  };

  const columns = COLUMNS.map((col) => {
    const hideWhenNarrow = emptyColumns.has(col.key) ? "hidden xl:table-cell" : undefined;
    return {
      key: col.key,
      header: <SortHeader col={col} />,
      align: col.align,
      width: col.width,
      headerClassName: hideWhenNarrow,
      cellClassName: hideWhenNarrow,
      render: renderers[col.key],
    };
  });

  const total = (tasks || []).length;

  const hiddenLabels = COLUMNS.filter((c) => emptyColumns.has(c.key)).map((c) => c.label);

  return (
    <div className="space-y-4">
      <ViewToolbar
        icon={TableIcon}
        title="Table"
        description={`${total} task${total === 1 ? "" : "s"} · sorted by ${
          (COLUMNS.find((c) => c.key === sort.key) || COLUMNS[0]).label
        } ${sort.dir === "asc" ? "ascending" : "descending"}`}
      />

      <DataTable
        columns={columns}
        rows={sortedRows}
        keyField="id"
        // The title alone is allotted 28rem, so the table needs a floor to hold
        // that against ten other columns; the shell scrolls (and now says so).
        tableClassName="min-w-[58rem]"
        caption={
          hiddenLabels.length
            ? `${hiddenLabels.join(", ")} ${
                hiddenLabels.length === 1 ? "is" : "are"
              } empty for every task here and hidden below extra-large screens.`
            : undefined
        }
        onRowClick={(row) => onOpenTask && onOpenTask(row.task)}
        empty={<ViewEmpty />}
      />
    </div>
  );
}
