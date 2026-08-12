"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/utils/supabaseClient";
import { getOrgId, getOrgContext } from "@/utils/orgContext";
import {
  loadTasks,
  loadMilestones,
  saveMilestone,
  deleteMilestone,
  loadActivity,
  computeProjectHealth,
  setProjectTemplate,
  cloneProject,
  MILESTONE_STATUS,
  STATUS_META,
} from "@/utils/pmData";
import { loadEmployees } from "@/utils/employeesData";
import ProjectDiscussion from "@/components/admin/ProjectDiscussion";
import ProjectClosurePanel from "@/components/shared/ProjectClosurePanel";
import StatCard from "@/components/shell/StatCard";
import { showError } from "@/utils/alerts";
import { authFetch } from "@/utils/authFetch";
import { hasRole } from "@/utils/permissions";
import {
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Badge,
  StatusPill,
  EmptyState,
  ErrorState,
  Skeleton,
  SkeletonCard,
  SkeletonList,
  Field,
  Button,
  Input,
} from "@/components/ui";
// The page <h1> reads the same string the sidebar and topbar do.
import { sectionTitle } from "@/components/shell/navConfig";
import {
  ListChecks,
  CheckCircle2,
  Loader,
  AlertTriangle,
  Flag,
  Plus,
  Pencil,
  Trash2,
  Copy,
  BookmarkCheck,
  RefreshCw,
  Activity as ActivityIcon,
  MessagesSquare,
} from "lucide-react";

/* Project Hub — a self-contained overview for one project: health, key stats,
   milestones/phases, an activity timeline and template/clone actions. Reuses
   pmData + employeesData; never touches the underlying task status pipeline. */

// Native controls the kit has no primitive for (select / textarea).
const CONTROL_CLASS =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

/* pmData tones -> Badge variants (tokens only, no literal colours). */
const STATUS_BADGE_VARIANT = {
  muted: "secondary",
  info: "info",
  warning: "warning",
  success: "success",
};

const RISK_META = {
  low: { variant: "success", label: "On track" },
  medium: { variant: "warning", label: "At risk" },
  high: { variant: "destructive", label: "Off track" },
};

const MILESTONE_STATUS_META = {
  pending: { label: "Pending", pill: "pending" },
  in_progress: { label: "In Progress", pill: "active" },
  completed: { label: "Completed", pill: "success" },
};

const EMPTY_FORM = { id: null, title: "", description: "", due_date: "", status: "pending" };

/* ---- native-Date helpers (NaN-guarded; never called at module scope) ---- */
function safeDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
// Pinned to en-US rather than the runtime default: an undefined locale renders
// a different string on the server than in the browser (and a different one per
// user), which is both a hydration mismatch and an inconsistent product.
function formatDate(value) {
  const d = safeDate(value);
  if (!d) return null;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// Progress arrives either from the task rollup or from the stored column, which
// is nullable — fold anything unusable to a real 0–100 number before it reaches
// a width or a label.
function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// "3 of 8", never "3/8".
function countOf(done, total) {
  const d = Number(done) || 0;
  const t = Number(total) || 0;
  return `${d} of ${t}`;
}
function relativeTime(value) {
  const d = safeDate(value);
  if (!d) return "";
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mon = Math.round(day / 30);
  if (mon < 12) return `${mon}mo ago`;
  return `${Math.round(mon / 12)}y ago`;
}
function labelize(str) {
  return String(str || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ---- date input helpers (timestamptz <-> yyyy-mm-dd) ---- */
function toDateInput(value) {
  const d = safeDate(value);
  if (!d) return "";
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}
function fromDateInput(value) {
  if (!value) return null;
  const d = safeDate(value);
  return d ? d.toISOString() : null;
}

export default function ProjectOverview() {
  const [orgId, setOrgId] = useState(null);
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(null);

  const [tasks, setTasks] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [activity, setActivity] = useState([]);
  const [employees, setEmployees] = useState([]);

  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // Error surfaces for the two fetches below. Both are fed from errors that were
  // already being caught and toasted; neither changes what is fetched.
  const [projectsError, setProjectsError] = useState("");
  const [loadError, setLoadError] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  /* ---- projects (self-contained picker) ---- */
  const loadProjects = useCallback(async (preferId) => {
    const id = getOrgId();
    setOrgId(id);
    const runQuery = (withArchived) => {
      let q = supabase
        .from("projects")
        .select("id, name, status, progress, deadline, end_date, start_date, is_template, archived, manager_id")
        .eq("organization_id", id);
      if (withArchived) q = q.eq("archived", false);
      return q.order("created_at", { ascending: false });
    };
    let { data, error } = await runQuery(true);
    if (error) ({ data, error } = await runQuery(false));
    if (error) throw error;
    const rows = data || [];
    setProjects(rows);
    setProjectId((prev) => {
      const wanted = preferId || prev;
      if (wanted && rows.some((r) => r.id === wanted)) return wanted;
      return rows.length ? rows[0].id : null;
    });
    return rows;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingProjects(true);
      try {
        await loadProjects();
      } catch (err) {
        if (!cancelled) {
          showError("Failed to load projects", err?.message || String(err));
          setProjectsError(err?.message || String(err));
        }
      } finally {
        if (!cancelled) setLoadingProjects(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadProjects]);

  // Retry for the projects error state — calls the same loadProjects() with the
  // same (absent) argument the mount effect uses.
  const retryProjects = useCallback(() => {
    setProjectsError("");
    setLoadingProjects(true);
    loadProjects()
      .catch((err) => {
        showError("Failed to load projects", err?.message || String(err));
        setProjectsError(err?.message || String(err));
      })
      .finally(() => setLoadingProjects(false));
  }, [loadProjects]);

  /* ---- per-project data ---- */
  const reload = useCallback(async () => {
    if (!projectId) {
      setTasks([]);
      setMilestones([]);
      setActivity([]);
      return;
    }
    setLoading(true);
    setLoadError("");
    try {
      const id = orgId || getOrgId();
      const [taskRes, msRes, actRes, empRes] = await Promise.all([
        loadTasks(projectId),
        loadMilestones(projectId),
        loadActivity({ projectId, limit: 40 }),
        loadEmployees(id),
      ]);
      setTasks(taskRes?.tasks || []);
      setMilestones(Array.isArray(msRes) ? msRes : []);
      setActivity(Array.isArray(actRes) ? actRes : []);
      setEmployees(empRes?.employees || []);
    } catch (err) {
      showError("Failed to load project", err?.message || String(err));
      setLoadError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId, orgId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const project = useMemo(
    () => projects.find((p) => p.id === projectId) || null,
    [projects, projectId]
  );
  const health = useMemo(() => computeProjectHealth(project, tasks), [project, tasks]);

  /* ---- project manager ---- */
  const [savingManager, setSavingManager] = useState(false);

  // Same list the server accepts, and the server is the one that counts —
  // /api/projects/[id]/manager re-checks the role against the caller's token.
  // This only keeps the dropdown from offering somebody who would be refused.
  const managerOptions = useMemo(
    () =>
      (employees || [])
        .filter(
          (e) =>
            e.status === "active" &&
            ["owner", "admin", "manager", "team_lead"].includes(e.role)
        )
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))),
    [employees]
  );

  // Owner/admin only, narrower than creating a project. A manager who could
  // reassign projects could hand themselves every project in the organization.
  const canAssignManager = hasRole("owner", "admin");

  const saveManager = useCallback(
    async (managerId) => {
      if (!projectId) return;
      setSavingManager(true);
      try {
        const res = await authFetch(`/api/projects/${projectId}/manager`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ managerId }),
        });
        const data = await res.json().catch(() => ({}));
        // authFetch RESOLVES on a 4xx rather than throwing, so the response has
        // to be inspected — otherwise a 403 looks like a successful save.
        if (!res.ok) {
          showError("Not changed", data?.error || "The manager could not be changed.");
          return;
        }
        // Re-read rather than patching local state: the row is the truth, and
        // the closure panel below reads manager_id too.
        await loadProjects(projectId);
      } catch (err) {
        showError("Not changed", err?.message || String(err));
      } finally {
        setSavingManager(false);
      }
    },
    [projectId, loadProjects]
  );

  const actorNameById = useMemo(() => {
    const m = new Map();
    (employees || []).forEach((e) => {
      if (e.userId) m.set(e.userId, e.name);
    });
    return m;
  }, [employees]);

  const doneMilestones = useMemo(
    () => milestones.filter((m) => m.status === "completed").length,
    [milestones]
  );

  /* ---- milestone actions ---- */
  const openAdd = () => {
    setForm(EMPTY_FORM);
    setShowForm(true);
  };
  const openEdit = (m) => {
    setForm({
      id: m.id,
      title: m.title || "",
      description: m.description || "",
      due_date: toDateInput(m.due_date),
      status: MILESTONE_STATUS.includes(m.status) ? m.status : "pending",
    });
    setShowForm(true);
  };
  const cancelForm = () => {
    setForm(EMPTY_FORM);
    setShowForm(false);
  };

  const submitForm = async (e) => {
    e?.preventDefault?.();
    if (!projectId) return;
    if (!form.title.trim()) return showError("Title required", "Give the milestone a title.");
    setBusy(true);
    try {
      const patch = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        due_date: fromDateInput(form.due_date),
        status: form.status,
        sort_order: form.id ? undefined : milestones.length,
      };
      if (form.id) patch.id = form.id;
      const { error } = await saveMilestone(projectId, patch);
      if (error) return showError("Could not save milestone", error.message || String(error));
      cancelForm();
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const changeMilestoneStatus = async (m, status) => {
    setBusy(true);
    try {
      const { error } = await saveMilestone(projectId, {
        id: m.id,
        title: m.title,
        description: m.description ?? null,
        due_date: m.due_date ?? null,
        status,
        sort_order: m.sort_order,
      });
      if (error) return showError("Could not update milestone", error.message || String(error));
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const removeMilestone = async (m) => {
    setBusy(true);
    try {
      const { error } = await deleteMilestone(m.id);
      if (error) return showError("Could not delete milestone", error.message || String(error));
      await reload();
    } finally {
      setBusy(false);
    }
  };

  /* ---- template / clone ---- */
  const toggleTemplate = async () => {
    if (!project) return;
    setBusy(true);
    try {
      const { error } = await setProjectTemplate(projectId, !project.is_template);
      if (error) return showError("Could not update template", error.message || String(error));
      await loadProjects(projectId);
    } catch (err) {
      showError("Could not update template", err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleClone = async () => {
    if (!project) return;
    const name = typeof window !== "undefined" ? window.prompt("New project name:") : null;
    if (!name || !name.trim()) return;
    setBusy(true);
    try {
      const { project: created, error } = await cloneProject(projectId, name.trim(), {
        copyTasks: true,
      });
      if (error) return showError("Could not clone project", error.message || String(error));
      await loadProjects(created?.id);
    } catch (err) {
      showError("Could not clone project", err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  /* ---- render ---- */
  const pageHeader = (
    <PageHeader
      title={sectionTitle("project-hub", "admin")}
      description="Health, milestones, activity and templates for one project."
      actions={
        <Button variant="outline" onClick={reload} disabled={loading}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Refresh
        </Button>
      }
    />
  );

  if (loadingProjects) {
    return (
      <div>
        {pageHeader}
        <div className="space-y-6">
          <Card>
            <CardContent>
              <Skeleton className="h-9 w-64 rounded-lg" />
            </CardContent>
          </Card>
          <SkeletonCard />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
          <Card>
            <CardContent>
              <SkeletonList rows={4} />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (projectsError) {
    return (
      <div>
        {pageHeader}
        <div className="space-y-6">
          <ErrorState
            title="Couldn't load projects"
            description={projectsError}
            onRetry={retryProjects}
          />
        </div>
      </div>
    );
  }

  if (!projects.length) {
    return (
      <div>
        {pageHeader}
        <div className="space-y-6">
          <EmptyState
            icon={Flag}
            title="No projects yet"
            description="Create a project first to see its hub, health and milestones."
          />
        </div>
      </div>
    );
  }

  const statusMeta = project ? STATUS_META[project.status] : null;
  const statusVariant = statusMeta
    ? STATUS_BADGE_VARIANT[statusMeta.tone] || "secondary"
    : "secondary";
  const risk = RISK_META[health.risk] || RISK_META.low;
  const deadlineLabel = formatDate(health.deadline) || "Not set";
  const healthProgress = clampPercent(health.progress);

  return (
    <div>
      {pageHeader}

      <div className="space-y-6">
        {/* Project picker */}
        <Card>
          <CardContent>
            <Field label="Project" htmlFor="project-picker">
              <select
                id="project-picker"
                value={projectId || ""}
                onChange={(e) => setProjectId(e.target.value || null)}
                className={CONTROL_CLASS}
                aria-label="Select project"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || "Untitled project"}
                  </option>
                ))}
              </select>
            </Field>
          </CardContent>
        </Card>

        {loadError ? (
          <ErrorState
            title="Couldn't load this project"
            description={loadError}
            onRetry={reload}
          />
        ) : loading && !tasks.length && !milestones.length ? (
          <div className="space-y-6">
            <SkeletonCard />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {[0, 1, 2, 3, 4].map((i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
            <Card>
              <CardContent>
                <SkeletonList rows={4} />
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <SkeletonList rows={3} />
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="animate-fade-in space-y-6">
            {/* 1) Health card */}
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-lg">
                    {project?.name || "Untitled project"}
                  </CardTitle>
                  {statusMeta && (
                    <Badge size="sm" variant={statusVariant}>
                      {statusMeta.label}
                    </Badge>
                  )}
                  <Badge size="sm" variant={risk.variant} className="ml-auto">
                    {risk.label}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div>
                  <div className="mb-1.5 flex items-baseline justify-between text-sm">
                    <span className="text-muted-foreground">Progress</span>
                    <span className="font-semibold tabular-nums text-foreground">{healthProgress}%</span>
                  </div>
                  <div
                    className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuenow={healthProgress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Project progress"
                  >
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${healthProgress}%` }}
                    />
                  </div>
                </div>

                {/* Project manager. Until this existed, `manager_id` was
                    written in exactly ONE place — accepting a client proposal —
                    so every other project could never have a manager, and one
                    whose manager left could never get a new one. */}
                <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
                  <Field label="Project manager" htmlFor="project-manager" className="min-w-[16rem] flex-1">
                    <select
                      id="project-manager"
                      className={`${CONTROL_CLASS} w-full`}
                      value={project?.manager_id || ""}
                      onChange={(e) => saveManager(e.target.value || null)}
                      disabled={!canAssignManager || savingManager}
                    >
                      <option value="">
                        {canAssignManager ? "— No manager —" : "No manager"}
                      </option>
                      {managerOptions.map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.name} · {labelize(m.role)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {savingManager && (
                    <span className="pb-2 text-sm text-muted-foreground" role="status">
                      Saving…
                    </span>
                  )}
                  {!canAssignManager && (
                    // Said, not hidden. A control that is simply absent reads as
                    // a missing feature rather than a permission.
                    <p className="pb-2 text-sm text-muted-foreground">
                      Only an owner or admin can change this.
                    </p>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                  <span className="text-muted-foreground">
                    Deadline:{" "}
                    <span className="font-medium tabular-nums text-foreground">{deadlineLabel}</span>
                  </span>
                  {health.deadlinePassed && (
                    <Badge size="sm" variant="destructive">Deadline passed</Badge>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* 2) Stat card row */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              <StatCard title="Total Tasks" value={health.total} icon={ListChecks} tone="primary" />
              <StatCard title="Done" value={health.done} icon={CheckCircle2} tone="success" />
              <StatCard title="In Progress" value={health.inProgress} icon={Loader} tone="info" />
              <StatCard title="Overdue" value={health.overdue} icon={AlertTriangle} tone="destructive" />
              <StatCard
                title="Milestones"
                value={countOf(doneMilestones, milestones.length)}
                icon={Flag}
                tone="accent"
              />
            </div>

            {/* 3) Closure — sits directly under the milestone count it depends
                   on, because "why can't I mark this complete?" is answered by
                   that number and the open-bug count beside it. */}
            <ProjectClosurePanel projectId={projectId} onChanged={reload} />

            {/* 4) Milestones / phases */}
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>Milestones &amp; Phases</CardTitle>
                  {!showForm && (
                    <Button type="button" onClick={openAdd} className="ml-auto">
                      <Plus className="h-4 w-4" aria-hidden="true" /> Add milestone
                    </Button>
                  )}
                </div>
              </CardHeader>

              <CardContent>
                {showForm && (
                  <form
                    onSubmit={submitForm}
                    className="animate-fade-in space-y-3 rounded-lg border border-border bg-muted/40 p-4"
                  >
                    <Field label="Milestone title" htmlFor="milestone-title" required>
                      <Input
                        id="milestone-title"
                        value={form.title}
                        onChange={(e) => setField("title", e.target.value)}
                        placeholder="Milestone title"
                      />
                    </Field>
                    <Field label="Description" htmlFor="milestone-description">
                      <textarea
                        id="milestone-description"
                        value={form.description}
                        onChange={(e) => setField("description", e.target.value)}
                        placeholder="Description (optional)"
                        rows={2}
                        className={`${CONTROL_CLASS} w-full`}
                      />
                    </Field>
                    <div className="flex flex-wrap items-end gap-3">
                      <Field label="Due date" htmlFor="milestone-due">
                        <Input
                          id="milestone-due"
                          type="date"
                          value={form.due_date}
                          onChange={(e) => setField("due_date", e.target.value)}
                        />
                      </Field>
                      <Field label="Status" htmlFor="milestone-status">
                        <select
                          id="milestone-status"
                          value={form.status}
                          onChange={(e) => setField("status", e.target.value)}
                          className={CONTROL_CLASS}
                        >
                          {MILESTONE_STATUS.map((s) => (
                            <option key={s} value={s}>
                              {MILESTONE_STATUS_META[s]?.label || labelize(s)}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <div className="ml-auto flex items-center gap-2">
                        <Button type="button" variant="outline" onClick={cancelForm}>
                          Cancel
                        </Button>
                        <Button type="submit" disabled={busy}>
                          {form.id ? "Save" : "Add"}
                        </Button>
                      </div>
                    </div>
                  </form>
                )}

                {milestones.length ? (
                  <ul className={`space-y-2 ${showForm ? "mt-4" : ""}`}>
                    {milestones.map((m) => {
                      const meta = MILESTONE_STATUS_META[m.status] || MILESTONE_STATUS_META.pending;
                      const completed = m.status === "completed";
                      const due = formatDate(m.due_date);
                      const milestoneTitle = m.title || "Untitled milestone";
                      return (
                        // Five controls on one line is a desktop layout. Below
                        // sm the row stacks — status/title/due on top, the
                        // controls beneath — rather than scrolling sideways.
                        <li
                          key={m.id}
                          className="flex flex-col gap-3 rounded-lg border border-border bg-card px-3 py-3 transition-colors duration-150 hover:bg-muted/40 sm:flex-row sm:items-center"
                        >
                          <div className="flex min-w-0 flex-1 items-start gap-3">
                            <StatusPill
                              size="sm"
                              status={meta.pill}
                              label={meta.label}
                              className="mt-0.5 shrink-0"
                            />
                            <div className="min-w-0">
                              <p className={`truncate text-sm font-medium ${completed ? "text-muted-foreground line-through" : "text-foreground"}`}>
                                {milestoneTitle}
                              </p>
                              {m.description && (
                                <p className="truncate text-sm text-muted-foreground">{m.description}</p>
                              )}
                              {/* Always rendered, so the rows line up whether or
                                  not a milestone has a date. */}
                              <p className="text-sm tabular-nums text-muted-foreground">
                                Due {due || "not set"}
                              </p>
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-2">
                            <select
                              value={MILESTONE_STATUS.includes(m.status) ? m.status : "pending"}
                              onChange={(e) => changeMilestoneStatus(m, e.target.value)}
                              disabled={busy}
                              className={`${CONTROL_CLASS} flex-1 py-1 sm:flex-none`}
                              aria-label={`Change status of milestone ${milestoneTitle}`}
                            >
                              {MILESTONE_STATUS.map((s) => (
                                <option key={s} value={s}>
                                  {MILESTONE_STATUS_META[s]?.label || labelize(s)}
                                </option>
                              ))}
                            </select>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => openEdit(m)}
                              title="Edit milestone"
                              aria-label={`Edit milestone ${milestoneTitle}`}
                            >
                              <Pencil className="h-4 w-4" aria-hidden="true" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => removeMilestone(m)}
                              disabled={busy}
                              title="Delete milestone"
                              aria-label={`Delete milestone ${milestoneTitle}`}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  !showForm && (
                    <EmptyState
                      icon={Flag}
                      title="No milestones yet"
                      description="Break this project into phases to track progress."
                      action={
                        <Button type="button" variant="outline" onClick={openAdd}>
                          <Plus className="h-4 w-4" aria-hidden="true" /> Add milestone
                        </Button>
                      }
                    />
                  )
                )}
              </CardContent>
            </Card>

            {/* 4) Internal discussion — founder ↔ project manager ↔ team.
                 Placed above Activity on purpose: Activity is a log of what
                 the system noticed, this is where people actually talk, and
                 the thing you want to answer is nearly always the message. */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <MessagesSquare className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <CardTitle>Discussion</CardTitle>
                </div>
                <CardDescription>
                  Talk to the project manager and the team about this project.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* Bounded height so a long thread scrolls inside the card
                    instead of pushing Activity and Templates off the screen. */}
                <div className="h-[420px]">
                  <ProjectDiscussion projectId={projectId} />
                </div>
              </CardContent>
            </Card>

            {/* 5) Activity timeline */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <ActivityIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <CardTitle>Activity</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                {activity.length ? (
                  <ul className="space-y-3">
                    {activity.map((a) => {
                      const actor =
                        a.actor_name || actorNameById.get(a.actor_id) || "Someone";
                      const meta = a.meta || {};
                      const hint = meta.title || meta.to || meta.name || null;
                      // Both of these are nullable on the row, and both used to
                      // render as a gap in the sentence.
                      const action = labelize(a.action).toLowerCase() || "changed";
                      const entity = labelize(a.entity_type).toLowerCase() || "an item";
                      const when = relativeTime(a.created_at);
                      return (
                        <li key={a.id} className="flex gap-3">
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-foreground">
                              <span className="font-medium">{actor}</span>{" "}
                              <span className="text-muted-foreground">{action}</span>{" "}
                              <span>{entity}</span>
                              {hint && (
                                <span className="text-muted-foreground"> — {String(hint)}</span>
                              )}
                            </p>
                            {when && (
                              <p className="text-sm tabular-nums text-muted-foreground">{when}</p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <EmptyState
                    icon={ActivityIcon}
                    title="No activity yet"
                    description="Task, milestone and status changes on this project will show up here."
                  />
                )}
              </CardContent>
            </Card>

            {/* 5) Template & clone */}
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>Template &amp; Clone</CardTitle>
                  <Badge size="sm" variant={project?.is_template ? "info" : "secondary"}>
                    {project?.is_template ? "Template" : "Not a template"}
                  </Badge>
                </div>
                <CardDescription>
                  Mark this project as a reusable template, or clone it (with its tasks) into a fresh project.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={toggleTemplate}
                    disabled={busy || !project}
                  >
                    <BookmarkCheck className="h-4 w-4" aria-hidden="true" />
                    {project?.is_template ? "Unmark template" : "Mark as template"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleClone}
                    disabled={busy || !project}
                  >
                    <Copy className="h-4 w-4" aria-hidden="true" /> Clone project
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
