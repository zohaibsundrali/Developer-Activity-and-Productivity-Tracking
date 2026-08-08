"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/utils/supabaseClient";
import { getOrgId } from "@/utils/orgContext";
import {
  loadTasks,
  createTask,
  updateTask,
  changeTaskStatus,
  normalizeStatus,
  loadSprints,
  loadEpics,
  BOARD_COLUMNS,
  PRIORITIES,
} from "@/utils/pmData";
import { loadEmployees } from "@/utils/employeesData";
import TaskDetailDrawer from "@/components/admin/TaskDetailDrawer";
import { showError } from "@/utils/alerts";
import { Plus, Search, RefreshCw, LayoutGrid, Flag, Loader2 } from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Constants / helpers                                                        */
/* -------------------------------------------------------------------------- */

const PRIORITY_STYLES = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-info/15 text-info",
  high: "bg-warning/15 text-warning",
  urgent: "bg-destructive/15 text-destructive",
};

const INPUT_CLASS =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30";

function taskLabels(task) {
  const raw = task?.labels ?? task?.tags;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean).map(String);
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function formatDue(value) {
  if (!value) return null;
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return String(value);
  }
}

/* -------------------------------------------------------------------------- */
/*  Task card                                                                  */
/* -------------------------------------------------------------------------- */

function TaskCard({ task, assigneeName, onOpen, onDragStart, onDragEnd }) {
  const priority = task?.priority || "medium";
  const labels = taskLabels(task);
  const due = formatDue(task?.due_date || task?.end_date);
  const points = task?.story_points;

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, task)}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(task)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(task);
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
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
            {points} pt
          </span>
        )}

        {due && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {due}
          </span>
        )}

        {labels.slice(0, 2).map((label) => (
          <span
            key={label}
            className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground"
          >
            {label}
          </span>
        ))}
      </div>

      <div className="mt-2 text-[11px] text-muted-foreground">
        {assigneeName || "Unassigned"}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Add-task inline affordance                                                 */
/* -------------------------------------------------------------------------- */

function AddTask({ columnId, onCreate }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      setOpen(false);
      return;
    }
    setSaving(true);
    await onCreate(columnId, trimmed);
    setSaving(false);
    setTitle("");
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-border py-2 text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary"
      >
        <Plus className="h-3.5 w-3.5" /> Add
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") {
            setTitle("");
            setOpen(false);
          }
        }}
        placeholder="Task title…"
        className={`w-full ${INPUT_CLASS}`}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
        >
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
          Add
        </button>
        <button
          type="button"
          onClick={() => {
            setTitle("");
            setOpen(false);
          }}
          className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main board                                                                 */
/* -------------------------------------------------------------------------- */

export default function ProjectBoard() {
  const [orgId, setOrgId] = useState(null);
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(null);

  const [tasks, setTasks] = useState([]);
  const [sprints, setSprints] = useState([]);
  const [epics, setEpics] = useState([]);
  const [employees, setEmployees] = useState([]);

  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingBoard, setLoadingBoard] = useState(false);

  // filters
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [sprintFilter, setSprintFilter] = useState("all");

  // drag + drawer
  const [dragOverCol, setDragOverCol] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);

  /* ---- initial project load ------------------------------------------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingProjects(true);
      const id = getOrgId();
      if (!cancelled) setOrgId(id);

      const runQuery = (withArchived) => {
        let q = supabase
          .from("projects")
          .select("id, name")
          .eq("organization_id", id);
        if (withArchived) q = q.eq("archived", false);
        return q.order("created_at", { ascending: false });
      };

      try {
        let { data, error } = await runQuery(true);
        if (error) {
          // `archived` column may not exist on older schemas — retry without it.
          ({ data, error } = await runQuery(false));
        }
        if (cancelled) return;
        const rows = data || [];
        setProjects(rows);
        setProjectId(rows.length ? rows[0].id : null);
      } catch (err) {
        if (!cancelled) {
          setProjects([]);
          setProjectId(null);
          showError("Failed to load projects", err?.message || String(err));
        }
      } finally {
        if (!cancelled) setLoadingProjects(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---- board data loader ---------------------------------------------- */
  const reload = useCallback(async () => {
    if (!projectId) {
      setTasks([]);
      setSprints([]);
      setEpics([]);
      return;
    }
    setLoadingBoard(true);
    try {
      const id = orgId || getOrgId();
      const [taskRes, sprintRes, epicRes, empRes] = await Promise.all([
        loadTasks(projectId),
        loadSprints(projectId),
        loadEpics(projectId),
        loadEmployees(id),
      ]);
      setTasks(taskRes?.tasks || []);
      setSprints(Array.isArray(sprintRes) ? sprintRes : []);
      setEpics(Array.isArray(epicRes) ? epicRes : []);
      setEmployees(empRes?.employees || []);
    } catch (err) {
      showError("Failed to load board", err?.message || String(err));
    } finally {
      setLoadingBoard(false);
    }
  }, [projectId, orgId]);

  useEffect(() => {
    reload();
  }, [reload]);

  /* ---- lookups -------------------------------------------------------- */
  const assigneeName = useCallback(
    (developerId) => {
      if (!developerId) return null;
      const match = (employees || []).find((e) => e.userId === developerId);
      return match?.name || null;
    },
    [employees]
  );

  /* ---- filtering ------------------------------------------------------ */
  const filteredTasks = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (tasks || []).filter((t) => {
      if (!t) return false;
      if (term && !(t.task_title || "").toLowerCase().includes(term)) return false;
      if (priorityFilter !== "all" && (t.priority || "medium") !== priorityFilter)
        return false;
      if (assigneeFilter !== "all") {
        if (assigneeFilter === "unassigned") {
          if (t.developer_id) return false;
        } else if (t.developer_id !== assigneeFilter) {
          return false;
        }
      }
      if (sprintFilter !== "all" && String(t.sprint_id || "") !== sprintFilter)
        return false;
      return true;
    });
  }, [tasks, search, priorityFilter, assigneeFilter, sprintFilter]);

  const columns = useMemo(() => {
    const buckets = {};
    for (const col of BOARD_COLUMNS) buckets[col.id] = [];
    for (const t of filteredTasks) {
      buckets[normalizeStatus(t.status)].push(t);
    }
    return BOARD_COLUMNS.map((col) => ({ ...col, items: buckets[col.id] || [] }));
  }, [filteredTasks]);

  /* ---- create task ---------------------------------------------------- */
  const handleCreate = useCallback(
    async (columnId, title) => {
      if (!projectId) return;
      try {
        const { error } = await createTask(projectId, {
          task_title: title,
          status: columnId,
        });
        if (error) {
          showError("Could not add task", error.message || String(error));
          return;
        }
        await reload();
      } catch (err) {
        showError("Could not add task", err?.message || String(err));
      }
    },
    [projectId, reload]
  );

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

      // Optimistic local update for snappiness.
      setTasks((prev) =>
        (prev || []).map((t) =>
          String(t.id) === String(id) ? { ...t, status: columnId } : t
        )
      );

      try {
        const { error } = await changeTaskStatus(task.id, columnId);
        if (error) {
          showError("Move failed", error.message || String(error));
          await reload(); // revert to server truth
          return;
        }
        await reload();
      } catch (err) {
        showError("Move failed", err?.message || String(err));
        await reload();
      }
    },
    [tasks, reload]
  );

  /* ---- render helpers ------------------------------------------------- */
  const spinner = (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary/30 border-t-primary" />
    </div>
  );

  if (loadingProjects) {
    return <div className="space-y-4">{spinner}</div>;
  }

  if (!projects.length) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-card p-8 text-center shadow-card">
          <LayoutGrid className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium text-foreground">
            No projects yet
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a project first to start planning work on the board.
          </p>
        </div>
      </div>
    );
  }

  /* ---- main render ---------------------------------------------------- */
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="rounded-xl border border-border bg-card p-3 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={projectId || ""}
            onChange={(e) => setProjectId(e.target.value || null)}
            className={INPUT_CLASS}
            aria-label="Select project"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || "Untitled project"}
              </option>
            ))}
          </select>

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks…"
              className={`${INPUT_CLASS} pl-8`}
              aria-label="Search tasks"
            />
          </div>

          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className={INPUT_CLASS}
            aria-label="Filter by priority"
          >
            <option value="all">All priorities</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          <select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            className={INPUT_CLASS}
            aria-label="Filter by assignee"
          >
            <option value="all">All assignees</option>
            <option value="unassigned">Unassigned</option>
            {(employees || []).map((emp) => (
              <option key={emp.userId || emp.membershipId} value={emp.userId}>
                {emp.name}
              </option>
            ))}
          </select>

          <select
            value={sprintFilter}
            onChange={(e) => setSprintFilter(e.target.value)}
            className={INPUT_CLASS}
            aria-label="Filter by sprint"
          >
            <option value="all">All sprints</option>
            {(sprints || []).map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name || `Sprint ${s.id}`}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={reload}
            disabled={loadingBoard}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:border-primary disabled:opacity-60"
          >
            <RefreshCw
              className={`h-4 w-4 ${loadingBoard ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </div>
      </div>

      {/* Board */}
      {loadingBoard && !tasks.length ? (
        spinner
      ) : (
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
                onDragLeave={() => setDragOverCol((c) => (c === col.id ? null : c))}
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
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {col.items.length}
                  </span>
                </div>

                <div className="max-h-[65vh] space-y-2 overflow-y-auto pr-0.5">
                  {col.items.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      assigneeName={assigneeName(task.developer_id)}
                      onOpen={setSelectedTask}
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

                {!col.reviewOnly && (
                  <AddTask columnId={col.id} onCreate={handleCreate} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Detail drawer */}
      {selectedTask && (
        <TaskDetailDrawer
          task={selectedTask}
          members={employees}
          sprints={sprints}
          epics={epics}
          allTasks={tasks}
          onClose={() => setSelectedTask(null)}
          onChanged={reload}
        />
      )}
    </div>
  );
}
