"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/utils/supabaseClient";
import { getOrgId } from "@/utils/orgContext";
import { loadAgile } from "@/utils/pmData";
import { loadEmployees } from "@/utils/employeesData";
import { showError } from "@/utils/alerts";
import SprintPlanning from "@/components/admin/SprintPlanning";
import SprintBoard from "@/components/admin/SprintBoard";
import { SELECT_CLASS, ViewSkeleton } from "@/components/admin/views/viewKit";
// The page <h1> reads the same string the sidebar and topbar do.
import { sectionTitle } from "@/components/shell/navConfig";
import { EmptyState, PageHeader, Skeleton, SkeletonCard, Tabs } from "@/components/ui";
import { LayoutList, Kanban, FolderOpen } from "lucide-react";

/* Agile workspace: project picker + tabbed Backlog/Planning and Sprint Board.
   Reuses pmData (sprints/epics/tasks) + employeesData; the underlying task
   status pipeline is never changed here. */

const TABS = [
  { id: "planning", label: "Backlog & Planning", icon: LayoutList },
  { id: "board", label: "Sprint Board", icon: Kanban },
];

export default function AgileWorkspace() {
  const [orgId, setOrgId] = useState(null);
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(null);

  const [sprints, setSprints] = useState([]);
  const [epics, setEpics] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [employees, setEmployees] = useState([]);

  const [tab, setTab] = useState("planning");
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loading, setLoading] = useState(false);

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

  /* ---- agile data ---- */
  const reload = useCallback(async () => {
    if (!projectId) {
      setSprints([]);
      setEpics([]);
      setTasks([]);
      return;
    }
    setLoading(true);
    try {
      const id = orgId || getOrgId();
      const [{ sprints: s, epics: e, tasks: t }, empRes] = await Promise.all([
        loadAgile(projectId),
        loadEmployees(id),
      ]);
      setSprints(s || []);
      setEpics(e || []);
      setTasks(t || []);
      setEmployees(empRes?.employees || []);
    } catch (err) {
      showError("Failed to load agile data", err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId, orgId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // One header for every state, so the screen always owns its <h1>.
  // No refresh action: this screen never had one, and adding a control that
  // triggers a fetch is a behaviour change, not a header restyle.
  const header = (
    <PageHeader
      title={sectionTitle("sprints", "admin")}
      description="Backlog, epics and the sprint board for one project."
    />
  );

  if (loadingProjects) {
    return (
      <div>
        {header}
        <div className="space-y-6">
          <div className="rounded-xl border border-border bg-card shadow-card">
            <div className="px-4 pt-4">
              <Skeleton className="h-8 w-52" />
            </div>
            <Skeleton className="mx-4 mb-3 mt-3 h-9" />
          </div>
          <SkeletonCard lines={5} />
        </div>
      </div>
    );
  }

  if (!projects.length) {
    return (
      <div>
        {header}
        <EmptyState
          icon={FolderOpen}
          title="No projects yet"
          description="Create a project first to plan sprints and epics."
        />
      </div>
    );
  }

  return (
    <div>
      {header}

      <div className="space-y-6">
        {/* Toolbar — same frame as the Views screen: picker, then a tab row. */}
        <div className="rounded-xl border border-border bg-card shadow-card">
          <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
            <label htmlFor="agile-project" className="sr-only">
              Select project
            </label>
            <select
              id="agile-project"
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
          </div>

          <Tabs
            className="mt-3 px-4"
            aria-label="Agile workspace"
            active={tab}
            onChange={(id) => setTab(id)}
            tabs={TABS.map((t) => {
              const Icon = t.icon;
              return {
                id: t.id,
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {t.label}
                  </span>
                ),
              };
            })}
          />
        </div>

        {loading ? (
          tab === "planning" ? (
            <SkeletonCard lines={6} />
          ) : (
            <ViewSkeleton viewType="kanban" />
          )
        ) : tab === "planning" ? (
          <SprintPlanning
            projectId={projectId}
            sprints={sprints}
            epics={epics}
            tasks={tasks}
            employees={employees}
            onChanged={reload}
          />
        ) : (
          <SprintBoard
            projectId={projectId}
            sprints={sprints}
            tasks={tasks}
            employees={employees}
            onChanged={reload}
          />
        )}
      </div>
    </div>
  );
}
