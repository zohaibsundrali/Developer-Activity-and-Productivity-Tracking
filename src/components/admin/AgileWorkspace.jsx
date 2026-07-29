"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/utils/supabaseClient";
import { getOrgId } from "@/utils/orgContext";
import { loadAgile } from "@/utils/pmData";
import { loadEmployees } from "@/utils/employeesData";
import { showError } from "@/utils/alerts";
import SprintPlanning from "@/components/admin/SprintPlanning";
import SprintBoard from "@/components/admin/SprintBoard";
import { LayoutList, Kanban } from "lucide-react";

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

  const inputClass =
    "rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30";

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
        <p className="text-sm font-medium text-foreground">No projects yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Create a project first to plan sprints and epics.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="rounded-xl border border-border bg-card p-3 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={projectId || ""}
            onChange={(e) => setProjectId(e.target.value || null)}
            className={inputClass}
            aria-label="Select project"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || "Untitled project"}
              </option>
            ))}
          </select>

          <div className="ml-auto flex items-center gap-1 rounded-lg border border-border bg-background p-1">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-primary/30 border-t-primary" />
        </div>
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
  );
}
