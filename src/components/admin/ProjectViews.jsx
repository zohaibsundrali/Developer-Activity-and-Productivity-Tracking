"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/utils/supabaseClient";
import { getOrgId } from "@/utils/orgContext";
import {
  loadTasks,
  loadSprints,
  loadEpics,
  loadSavedViews,
  saveView,
  deleteView,
  VIEW_TYPES,
  PRIORITIES,
  TASK_TYPES,
} from "@/utils/pmData";
import { loadEmployees } from "@/utils/employeesData";
import { showError } from "@/utils/alerts";
import TaskDetailDrawer from "@/components/admin/TaskDetailDrawer";
import KanbanView from "@/components/admin/views/KanbanView";
import ListView from "@/components/admin/views/ListView";
import TableView from "@/components/admin/views/TableView";
import CalendarView from "@/components/admin/views/CalendarView";
import TimelineView from "@/components/admin/views/TimelineView";
import WorkloadView from "@/components/admin/views/WorkloadView";
import {
  LayoutGrid,
  List as ListIcon,
  Table as TableIcon,
  CalendarDays,
  GanttChartSquare,
  Users,
  Search,
  RefreshCw,
  Bookmark,
  BookmarkPlus,
  Trash2,
} from "lucide-react";

const VIEW_META = {
  kanban: { label: "Kanban", icon: LayoutGrid },
  list: { label: "List", icon: ListIcon },
  table: { label: "Table", icon: TableIcon },
  calendar: { label: "Calendar", icon: CalendarDays },
  timeline: { label: "Timeline", icon: GanttChartSquare },
  workload: { label: "Workload", icon: Users },
};

const INPUT_CLASS =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30";

const EMPTY_FILTERS = { search: "", priority: "all", assignee: "all", sprint: "all", type: "all" };

export default function ProjectViews() {
  const [orgId, setOrgId] = useState(null);
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(null);

  const [tasks, setTasks] = useState([]);
  const [sprints, setSprints] = useState([]);
  const [epics, setEpics] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [views, setViews] = useState([]);

  const [viewType, setViewType] = useState("kanban");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [activeViewId, setActiveViewId] = useState("");

  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loading, setLoading] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);

  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  /* ---- projects ---- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingProjects(true);
      const id = getOrgId();
      if (!cancelled) setOrgId(id);
      const runQuery = (withArchived) => {
        let q = supabase.from("projects").select("id, name").eq("organization_id", id);
        if (withArchived) q = q.eq("archived", false);
        return q.order("created_at", { ascending: false });
      };
      try {
        let { data, error } = await runQuery(true);
        if (error) ({ data, error } = await runQuery(false));
        if (cancelled) return;
        const rows = data || [];
        setProjects(rows);
        setProjectId(rows.length ? rows[0].id : null);
      } catch (err) {
        if (!cancelled) showError("Failed to load projects", err?.message || String(err));
      } finally {
        if (!cancelled) setLoadingProjects(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---- board data ---- */
  const reload = useCallback(async () => {
    if (!projectId) {
      setTasks([]);
      setSprints([]);
      setEpics([]);
      setViews([]);
      return;
    }
    setLoading(true);
    try {
      const id = orgId || getOrgId();
      const [taskRes, sprintRes, epicRes, empRes, savedRes] = await Promise.all([
        loadTasks(projectId),
        loadSprints(projectId),
        loadEpics(projectId),
        loadEmployees(id),
        loadSavedViews(projectId),
      ]);
      setTasks(taskRes?.tasks || []);
      setSprints(Array.isArray(sprintRes) ? sprintRes : []);
      setEpics(Array.isArray(epicRes) ? epicRes : []);
      setEmployees(empRes?.employees || []);
      setViews(Array.isArray(savedRes) ? savedRes : []);
    } catch (err) {
      showError("Failed to load views", err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId, orgId]);

  useEffect(() => {
    reload();
  }, [reload]);

  /* ---- filtering (shared across every view) ---- */
  const filteredTasks = useMemo(() => {
    const term = filters.search.trim().toLowerCase();
    return (tasks || []).filter((t) => {
      if (!t) return false;
      if (term && !(t.task_title || "").toLowerCase().includes(term)) return false;
      if (filters.priority !== "all" && (t.priority || "medium") !== filters.priority) return false;
      if (filters.type !== "all" && (t.task_type || "feature") !== filters.type) return false;
      if (filters.assignee !== "all") {
        if (filters.assignee === "unassigned") {
          if (t.developer_id) return false;
        } else if (t.developer_id !== filters.assignee) return false;
      }
      if (filters.sprint !== "all" && String(t.sprint_id || "") !== filters.sprint) return false;
      return true;
    });
  }, [tasks, filters]);

  /* ---- saved views ---- */
  const applyView = (v) => {
    if (!v) {
      setActiveViewId("");
      return;
    }
    setActiveViewId(v.id);
    setViewType(v.view_type || "kanban");
    setFilters({ ...EMPTY_FILTERS, ...(v.config?.filters || {}) });
  };
  const handleSaveView = async () => {
    const name = typeof window !== "undefined" ? window.prompt("Save this view as:") : null;
    if (!name || !name.trim()) return;
    const { error } = await saveView(projectId, {
      name: name.trim(),
      view_type: viewType,
      config: { filters },
      is_shared: false,
    });
    if (error) return showError("Could not save view", error.message || String(error));
    await reload();
  };
  const handleDeleteView = async () => {
    if (!activeViewId) return;
    const { error } = await deleteView(activeViewId);
    if (error) return showError("Could not delete view", error.message || String(error));
    setActiveViewId("");
    await reload();
  };

  const onOpenTask = useCallback((task) => setSelectedTask(task), []);

  /* ---- render ---- */
  if (loadingProjects) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary/30 border-t-primary" />
      </div>
    );
  }

  if (!projects.length) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center shadow-card">
        <LayoutGrid className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium text-foreground">No projects yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Create a project first to view its work across boards, lists and timelines.
        </p>
      </div>
    );
  }

  const viewProps = {
    tasks: filteredTasks,
    employees,
    sprints,
    epics,
    projectId,
    onOpenTask,
    onChanged: reload,
  };

  const renderView = () => {
    switch (viewType) {
      case "list":
        return <ListView {...viewProps} />;
      case "table":
        return <TableView {...viewProps} />;
      case "calendar":
        return <CalendarView {...viewProps} />;
      case "timeline":
        return <TimelineView {...viewProps} />;
      case "workload":
        return <WorkloadView {...viewProps} />;
      case "kanban":
      default:
        return <KanbanView {...viewProps} />;
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="rounded-xl border border-border bg-card p-3 shadow-card space-y-3">
        {/* row 1: project + view tabs */}
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

          <div className="ml-auto flex flex-wrap items-center gap-1 rounded-lg border border-border bg-background p-1">
            {VIEW_TYPES.map((v) => {
              const meta = VIEW_META[v];
              const Icon = meta.icon;
              const active = viewType === v;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => setViewType(v)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{meta.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* row 2: filters + saved views */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={filters.search}
              onChange={(e) => setFilter("search", e.target.value)}
              placeholder="Search tasks…"
              className={`${INPUT_CLASS} pl-8`}
              aria-label="Search tasks"
            />
          </div>

          <select value={filters.priority} onChange={(e) => setFilter("priority", e.target.value)} className={INPUT_CLASS} aria-label="Filter by priority">
            <option value="all">All priorities</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>

          <select value={filters.type} onChange={(e) => setFilter("type", e.target.value)} className={INPUT_CLASS} aria-label="Filter by type">
            <option value="all">All types</option>
            {TASK_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          <select value={filters.assignee} onChange={(e) => setFilter("assignee", e.target.value)} className={INPUT_CLASS} aria-label="Filter by assignee">
            <option value="all">All assignees</option>
            <option value="unassigned">Unassigned</option>
            {(employees || []).map((emp) => (
              <option key={emp.userId || emp.membershipId} value={emp.userId}>{emp.name}</option>
            ))}
          </select>

          <select value={filters.sprint} onChange={(e) => setFilter("sprint", e.target.value)} className={INPUT_CLASS} aria-label="Filter by sprint">
            <option value="all">All sprints</option>
            {(sprints || []).map((s) => (
              <option key={s.id} value={String(s.id)}>{s.name || `Sprint ${s.id}`}</option>
            ))}
          </select>

          {/* saved views */}
          <div className="ml-auto flex items-center gap-1.5">
            <div className="relative flex items-center">
              <Bookmark className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted-foreground" />
              <select
                value={activeViewId}
                onChange={(e) => applyView(views.find((v) => v.id === e.target.value) || null)}
                className={`${INPUT_CLASS} pl-8`}
                aria-label="Saved views"
              >
                <option value="">Saved views…</option>
                {views.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>
            {activeViewId && (
              <button type="button" onClick={handleDeleteView} title="Delete saved view" className="rounded-lg border border-border bg-background p-2 text-muted-foreground hover:border-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            <button type="button" onClick={handleSaveView} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:border-primary">
              <BookmarkPlus className="h-4 w-4" /> Save view
            </button>
            <button type="button" onClick={reload} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:border-primary disabled:opacity-60">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>
      </div>

      {/* View surface */}
      {loading && !tasks.length ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary/30 border-t-primary" />
        </div>
      ) : (
        renderView()
      )}

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
