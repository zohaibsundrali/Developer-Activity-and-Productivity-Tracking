"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  STATUS_META,
  PRIORITIES,
} from "@/utils/pmData";
import { loadEmployees } from "@/utils/employeesData";
import TaskDetailDrawer from "@/components/admin/TaskDetailDrawer";
import { showError } from "@/utils/alerts";
import { Board, SELECT_CLASS, TaskCard } from "@/components/admin/views/viewKit";
// The page <h1> reads the same string the sidebar and topbar do.
import { sectionTitle } from "@/components/shell/navConfig";
import { Button, EmptyState, Input, PageHeader, Skeleton, Toolbar } from "@/components/ui";
import { Plus, RefreshCw, LayoutGrid, Loader2 } from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Add-task inline affordance                                                 */
/* -------------------------------------------------------------------------- */

function AddTask({ columnId, columnLabel, onCreate }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

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
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add task
        <span className="sr-only">to {columnLabel}</span>
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <Input
        autoFocus
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
        aria-label={`New task in ${columnLabel}`}
      />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={submit} disabled={saving}>
          {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
          Add
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setTitle("");
            setOpen(false);
          }}
        >
          Cancel
        </Button>
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
  const boardSkeleton = (
    <div className="flex gap-4 overflow-hidden pb-2">
      {BOARD_COLUMNS.map((col, i) => (
        <div
          key={col.id}
          className={`w-full shrink-0 rounded-xl border border-border bg-muted/30 p-3 sm:w-80 ${
            i === 0 ? "" : "hidden sm:block"
          }`}
        >
          <div className="mb-3 flex items-center gap-2">
            <Skeleton className="h-2 w-2 rounded-full" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="ml-auto h-4 w-6 rounded-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );

  // One header for every state, so the screen always owns its <h1>.
  const header = (
    <PageHeader
      title={sectionTitle("board", "admin")}
      description="Drag work across the pipeline for one project."
      actions={
        <Button
          variant="outline"
          onClick={reload}
          disabled={loadingBoard || loadingProjects || !projects.length}
        >
          <RefreshCw
            className={loadingBoard ? "animate-spin motion-reduce:animate-none" : undefined}
            aria-hidden="true"
          />
          Refresh
        </Button>
      }
    />
  );

  if (loadingProjects) {
    return (
      <div>
        {header}
        <div className="space-y-6">
          <div className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5">
            <div className="flex flex-wrap items-center gap-3">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-8 w-64" />
              <Skeleton className="ml-auto h-8 w-28" />
            </div>
          </div>
          {boardSkeleton}
        </div>
      </div>
    );
  }

  if (!projects.length) {
    return (
      <div>
        {header}
        <EmptyState
          icon={LayoutGrid}
          title="No projects yet"
          description="Create a project first to start planning work on the board."
        />
      </div>
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
          onOpen={setSelectedTask}
          onDragStart={handleDragStart}
          onDragEnd={() => setDragOverCol(null)}
        />
      )),
      footer: col.reviewOnly ? null : (
        <AddTask columnId={col.id} columnLabel={meta.label} onCreate={handleCreate} />
      ),
    };
  });

  /* ---- main render ---------------------------------------------------- */
  return (
    <div>
      {header}

      <div className="space-y-6">
        {/* Toolbar — the card is the primitive's own now, not hand-rolled here. */}
        <div>
          <Toolbar
            search={{
              value: search,
              onChange: (value) => setSearch(value),
              placeholder: "Search tasks…",
              label: "Search tasks",
            }}
            filters={
              <>
                <label htmlFor="board-project" className="sr-only">
                  Select project
                </label>
                <select
                  id="board-project"
                  value={projectId || ""}
                  onChange={(e) => setProjectId(e.target.value || null)}
                  className={`${SELECT_CLASS} font-medium`}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name || "Untitled project"}
                    </option>
                  ))}
                </select>

                <label htmlFor="board-priority" className="sr-only">
                  Filter by priority
                </label>
                <select
                  id="board-priority"
                  value={priorityFilter}
                  onChange={(e) => setPriorityFilter(e.target.value)}
                  className={SELECT_CLASS}
                >
                  <option value="all">All priorities</option>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>

                <label htmlFor="board-assignee" className="sr-only">
                  Filter by assignee
                </label>
                <select
                  id="board-assignee"
                  value={assigneeFilter}
                  onChange={(e) => setAssigneeFilter(e.target.value)}
                  className={SELECT_CLASS}
                >
                  <option value="all">All assignees</option>
                  <option value="unassigned">Unassigned</option>
                  {(employees || []).map((emp) => (
                    <option key={emp.userId || emp.membershipId} value={emp.userId}>
                      {emp.name}
                    </option>
                  ))}
                </select>

                <label htmlFor="board-sprint" className="sr-only">
                  Filter by sprint
                </label>
                <select
                  id="board-sprint"
                  value={sprintFilter}
                  onChange={(e) => setSprintFilter(e.target.value)}
                  className={SELECT_CLASS}
                >
                  <option value="all">All sprints</option>
                  {(sprints || []).map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {s.name || `Sprint ${s.id}`}
                    </option>
                  ))}
                </select>
              </>
            }
          />
        </div>

        {/* Board */}
        {loadingBoard && !tasks.length ? (
          boardSkeleton
        ) : (
          <Board columns={boardColumns} ariaLabel="Project board" />
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
    </div>
  );
}
