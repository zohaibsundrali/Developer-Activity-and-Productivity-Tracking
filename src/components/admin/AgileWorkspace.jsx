"use client";

import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { supabase } from "@/utils/supabaseClient";
import { getOrgId } from "@/utils/orgContext";
import { loadAgile } from "@/utils/pmData";
import { loadEmployees } from "@/utils/employeesData";
import { createAgileRequest, loadAgileProjects } from "@/utils/agileWorkspaceRequests";
import SprintPlanning from "@/components/admin/SprintPlanning";
import SprintBoard from "@/components/admin/SprintBoard";
import { SELECT_CLASS, ViewSkeleton } from "@/components/admin/views/viewKit";
// The page <h1> reads the same string the sidebar and topbar do.
import { sectionTitle } from "@/components/shell/navConfig";
import { ErrorState, EmptyState, PageHeader, Skeleton, SkeletonCard, Tabs } from "@/components/ui";
import { LayoutList, Kanban, FolderOpen } from "lucide-react";

/* Agile workspace: project picker + tabbed Backlog/Planning and Sprint Board.
   Reuses pmData (sprints/epics/tasks) + employeesData; the underlying task
   status pipeline is never changed here. */

const TABS = [
  { id: "planning", label: "Backlog & Planning", icon: LayoutList },
  { id: "board", label: "Sprint Board", icon: Kanban },
];

export default function AgileWorkspace() {
  const orgId = getOrgId();
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(null);

  const [sprints, setSprints] = useState([]);
  const [epics, setEpics] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [employees, setEmployees] = useState([]);

  const [tab, setTab] = useState("planning");
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loading, setLoading] = useState(false);

  const [projectError, setProjectError] = useState(null);
  const [dataError, setDataError] = useState(null);
  const [projectOrg, setProjectOrg] = useState(null);
  const [dataScope, setDataScope] = useState(null);
  const scope = `${orgId}:${projectId}`;
  const liveScope = useRef(scope); liveScope.current = scope;
  const projectRequest = useMemo(() => createAgileRequest(), []);
  const dataRequest = useMemo(() => createAgileRequest(), []);
  const clearData = useCallback(() => {
    setSprints([]); setEpics([]); setTasks([]); setEmployees([]);
  }, []);

  const reloadProjects = useCallback(() => projectRequest.run({
    load: () => loadAgileProjects(supabase, orgId),
    isCurrent: () => getOrgId() === orgId,
    onStart: () => { setLoadingProjects(true); setProjectError(null); setProjects([]); setProjectId(null); clearData(); },
    onResult: rows => { setProjects(rows); setProjectId(rows[0]?.id || null); setProjectOrg(orgId); setLoadingProjects(false); },
    onError: error => { setProjects([]); setProjectId(null); setProjectError(error); setProjectOrg(orgId); setLoadingProjects(false); },
  }), [orgId, projectRequest, clearData]);

  useEffect(() => {
    reloadProjects().catch(() => {});
    return () => projectRequest.cancel();
  }, [reloadProjects, projectRequest]);

  const reload = useCallback(() => dataRequest.run({
    load: async () => {
      if (!projectId) return { sprints: [], epics: [], tasks: [], employees: [] };
      const [agile, people] = await Promise.all([loadAgile(projectId), loadEmployees(orgId)]);
      if (people?.error) throw people.error;
      return { ...agile, employees: people?.employees || [] };
    },
    isCurrent: () => getOrgId() === orgId && liveScope.current === scope,
    onStart: () => { setLoading(true); setDataError(null); clearData(); },
    onResult: data => {
      setSprints(data.sprints || []); setEpics(data.epics || []); setTasks(data.tasks || []); setEmployees(data.employees);
      setDataScope(scope); setLoading(false);
    },
    onError: error => { clearData(); setDataError(error); setDataScope(scope); setLoading(false); },
  }), [projectId, orgId, scope, dataRequest, clearData]);

  useEffect(() => {
    reload().catch(() => {});
    return () => dataRequest.cancel();
  }, [reload, dataRequest]);

  // One header for every state, so the screen always owns its <h1>.
  // No refresh action: this screen never had one, and adding a control that
  // triggers a fetch is a behaviour change, not a header restyle.
  const header = (
    <PageHeader
      title={sectionTitle("sprints", "admin")}
      description="Backlog, epics and the sprint board for one project."
    />
  );

  if (loadingProjects || projectOrg !== orgId) {
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

  if (projectError) return <div>{header}<ErrorState title="Could not load projects" description={projectError.message || "Please retry."} onRetry={() => reloadProjects().catch(() => {})} /></div>;

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

        {loading || dataScope !== scope ? (
          tab === "planning" ? (
            <SkeletonCard lines={6} />
          ) : (
            <ViewSkeleton viewType="kanban" />
          )
        ) : dataError ? (
          <ErrorState title="Could not load agile data" description={dataError.message || "Please retry."} onRetry={() => reload().catch(() => {})} />
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
