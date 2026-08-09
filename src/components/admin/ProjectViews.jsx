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
import { SELECT_CLASS, ViewSkeleton } from "@/components/admin/views/viewKit";
// The page <h1> reads the same string the sidebar and topbar do.
import { sectionTitle } from "@/components/shell/navConfig";
import { Button, EmptyState, PageHeader, Skeleton, Tabs, Toolbar } from "@/components/ui";
import {
  LayoutGrid,
  List as ListIcon,
  Table as TableIcon,
  CalendarDays,
  GanttChartSquare,
  Users,
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

  const activeFilterCount = useMemo(
    () =>
      Object.entries(filters).filter(([k, v]) =>
        k === "search" ? Boolean(String(v).trim()) : v !== "all"
      ).length,
    [filters]
  );

  /* ---- render ---- */
  // One header for every state, so the screen always owns its <h1>.
  const header = (
    <PageHeader
      title={sectionTitle("views", "admin")}
      description="The same project work across boards, lists, tables, calendars and timelines."
      actions={
        <Button
          variant="outline"
          onClick={reload}
          disabled={loading || loadingProjects || !projects.length}
        >
          <RefreshCw
            className={loading ? "animate-spin motion-reduce:animate-none" : undefined}
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
              <Skeleton className="ml-auto h-8 w-64" />
            </div>
            <Skeleton className="mt-4 h-8 w-full" />
          </div>
          <ViewSkeleton viewType="kanban" />
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
          description="Create a project first to view its work across boards, lists, calendars and timelines."
        />
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
    <div>
      {header}

      <div className="space-y-6">
        {/* One toolbar for all six views: project, view tabs, filters, saved views. */}
        <div className="rounded-xl border border-border bg-card shadow-card">
          {/* row 1: project + saved views */}
          <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
            <label htmlFor="views-project" className="sr-only">
              Select project
            </label>
            <select
              id="views-project"
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

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <div className="relative flex items-center">
                <Bookmark
                  className="pointer-events-none absolute left-2.5 h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <label htmlFor="views-saved" className="sr-only">
                  Saved views
                </label>
                <select
                  id="views-saved"
                  value={activeViewId}
                  onChange={(e) => applyView(views.find((v) => v.id === e.target.value) || null)}
                  className={`${SELECT_CLASS} pl-8`}
                >
                  <option value="">Saved views…</option>
                  {views.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
              {activeViewId && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleDeleteView}
                  aria-label="Delete saved view"
                  title="Delete saved view"
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              )}
              <Button variant="outline" onClick={handleSaveView}>
                <BookmarkPlus aria-hidden="true" /> Save view
              </Button>
            </div>
          </div>

          {/* row 2: the view switcher */}
          <Tabs
            className="mt-3 px-4"
            aria-label="Project view"
            tabs={VIEW_TYPES.map((v) => {
              const meta = VIEW_META[v];
              const Icon = meta.icon;
              return {
                id: v,
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span className="hidden sm:inline">{meta.label}</span>
                    <span className="sr-only sm:hidden">{meta.label}</span>
                  </span>
                ),
              };
            })}
            active={viewType}
            onChange={(id) => setViewType(id)}
          />

          {/* row 3: the filters every view shares */}
          <div className="px-4 py-3">
            <Toolbar
              search={{
                value: filters.search,
                onChange: (value) => setFilter("search", value),
                placeholder: "Search tasks…",
                label: "Search tasks",
              }}
              filters={
                <>
                  <label htmlFor="views-priority" className="sr-only">
                    Filter by priority
                  </label>
                  <select
                    id="views-priority"
                    value={filters.priority}
                    onChange={(e) => setFilter("priority", e.target.value)}
                    className={SELECT_CLASS}
                  >
                    <option value="all">All priorities</option>
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>

                  <label htmlFor="views-type" className="sr-only">
                    Filter by type
                  </label>
                  <select
                    id="views-type"
                    value={filters.type}
                    onChange={(e) => setFilter("type", e.target.value)}
                    className={SELECT_CLASS}
                  >
                    <option value="all">All types</option>
                    {TASK_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>

                  <label htmlFor="views-assignee" className="sr-only">
                    Filter by assignee
                  </label>
                  <select
                    id="views-assignee"
                    value={filters.assignee}
                    onChange={(e) => setFilter("assignee", e.target.value)}
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

                  <label htmlFor="views-sprint" className="sr-only">
                    Filter by sprint
                  </label>
                  <select
                    id="views-sprint"
                    value={filters.sprint}
                    onChange={(e) => setFilter("sprint", e.target.value)}
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
              actions={
                activeFilterCount > 0 ? (
                  <Button variant="ghost" size="default" onClick={() => setFilters(EMPTY_FILTERS)}>
                    Clear filters
                  </Button>
                ) : null
              }
            />
          </div>
        </div>

        {/* View surface */}
        {loading && !tasks.length ? <ViewSkeleton viewType={viewType} /> : renderView()}

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
