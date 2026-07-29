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
import StatCard from "@/components/shell/StatCard";
import { showError } from "@/utils/alerts";
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
} from "lucide-react";

/* Project Hub — a self-contained overview for one project: health, key stats,
   milestones/phases, an activity timeline and template/clone actions. Reuses
   pmData + employeesData; never touches the underlying task status pipeline. */

const INPUT_CLASS =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30";
const PRIMARY_BTN =
  "rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60";
const SECONDARY_BTN =
  "rounded-lg border border-border bg-background px-3 py-1.5 text-sm hover:border-primary";
const PANEL = "rounded-xl border border-border bg-card p-5 shadow-card";
const BADGE = "rounded-full px-2 py-0.5 text-[10px] font-semibold";

const STATUS_TONE = {
  muted: "bg-muted text-muted-foreground",
  info: "bg-info/15 text-info",
  warning: "bg-warning/15 text-warning",
  success: "bg-success/15 text-success",
};

const RISK_META = {
  low: { cls: "bg-success/15 text-success", label: "On track" },
  medium: { cls: "bg-warning/15 text-warning", label: "At risk" },
  high: { cls: "bg-destructive/15 text-destructive", label: "Off track" },
};

const MILESTONE_STATUS_META = {
  pending: { label: "Pending", dot: "bg-muted-foreground" },
  in_progress: { label: "In Progress", dot: "bg-info" },
  completed: { label: "Completed", dot: "bg-success" },
};

const EMPTY_FORM = { id: null, title: "", description: "", due_date: "", status: "pending" };

/* ---- native-Date helpers (NaN-guarded; never called at module scope) ---- */
function safeDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
function formatDate(value) {
  const d = safeDate(value);
  if (!d) return null;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
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
        .select("id, name, status, progress, deadline, end_date, start_date, is_template, archived")
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
        if (!cancelled) showError("Failed to load projects", err?.message || String(err));
      } finally {
        if (!cancelled) setLoadingProjects(false);
      }
    })();
    return () => {
      cancelled = true;
    };
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
  if (loadingProjects) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary/30 border-t-primary" />
      </div>
    );
  }

  if (!projects.length) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center shadow-card">
        <Flag className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium text-foreground">No projects yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Create a project first to see its hub, health and milestones.
        </p>
      </div>
    );
  }

  const statusMeta = project ? STATUS_META[project.status] : null;
  const statusTone = statusMeta ? STATUS_TONE[statusMeta.tone] || STATUS_TONE.muted : STATUS_TONE.muted;
  const risk = RISK_META[health.risk] || RISK_META.low;
  const deadlineLabel = formatDate(health.deadline) || "No deadline";

  return (
    <div className="space-y-4">
      {/* Toolbar: project picker */}
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
          <button
            type="button"
            onClick={reload}
            disabled={loading}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:border-primary disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {loading && !tasks.length && !milestones.length ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary/30 border-t-primary" />
        </div>
      ) : (
        <>
          {/* 1) Health card */}
          <div className={PANEL}>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-foreground">
                {project?.name || "Untitled project"}
              </h2>
              {statusMeta && (
                <span className={`${BADGE} ${statusTone}`}>{statusMeta.label}</span>
              )}
              <span className={`${BADGE} ${risk.cls} ml-auto`}>{risk.label}</span>
            </div>

            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span className="font-medium text-muted-foreground">Progress</span>
                <span className="font-semibold text-foreground tabular-nums">{health.progress}%</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.max(0, Math.min(100, health.progress))}%` }}
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
              <span className="text-muted-foreground">
                Deadline: <span className="font-medium text-foreground">{deadlineLabel}</span>
              </span>
              {health.deadlinePassed && (
                <span className="text-xs font-semibold text-destructive">Deadline passed</span>
              )}
            </div>
          </div>

          {/* 2) Stat card row */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard title="Total Tasks" value={health.total} icon={ListChecks} tone="primary" />
            <StatCard title="Done" value={health.done} icon={CheckCircle2} tone="success" />
            <StatCard title="In Progress" value={health.inProgress} icon={Loader} tone="info" />
            <StatCard title="Overdue" value={health.overdue} icon={AlertTriangle} tone="destructive" />
            <StatCard
              title="Milestones"
              value={`${doneMilestones}/${milestones.length}`}
              icon={Flag}
              tone="violet"
            />
          </div>

          {/* 3) Milestones / phases */}
          <div className={PANEL}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-foreground">Milestones &amp; Phases</h3>
              {!showForm && (
                <button type="button" onClick={openAdd} className={`${PRIMARY_BTN} ml-auto inline-flex items-center gap-1.5`}>
                  <Plus className="h-4 w-4" /> Add milestone
                </button>
              )}
            </div>

            {showForm && (
              <form onSubmit={submitForm} className="mt-4 space-y-3 rounded-lg border border-border bg-background p-4">
                <input
                  value={form.title}
                  onChange={(e) => setField("title", e.target.value)}
                  placeholder="Milestone title"
                  className={`${INPUT_CLASS} w-full`}
                  aria-label="Milestone title"
                />
                <textarea
                  value={form.description}
                  onChange={(e) => setField("description", e.target.value)}
                  placeholder="Description (optional)"
                  rows={2}
                  className={`${INPUT_CLASS} w-full`}
                  aria-label="Milestone description"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={form.due_date}
                    onChange={(e) => setField("due_date", e.target.value)}
                    className={INPUT_CLASS}
                    aria-label="Due date"
                  />
                  <select
                    value={form.status}
                    onChange={(e) => setField("status", e.target.value)}
                    className={INPUT_CLASS}
                    aria-label="Milestone status"
                  >
                    {MILESTONE_STATUS.map((s) => (
                      <option key={s} value={s}>
                        {MILESTONE_STATUS_META[s]?.label || labelize(s)}
                      </option>
                    ))}
                  </select>
                  <div className="ml-auto flex items-center gap-2">
                    <button type="button" onClick={cancelForm} className={SECONDARY_BTN}>
                      Cancel
                    </button>
                    <button type="submit" disabled={busy} className={PRIMARY_BTN}>
                      {form.id ? "Save" : "Add"}
                    </button>
                  </div>
                </div>
              </form>
            )}

            {milestones.length ? (
              <ul className="mt-4 space-y-2">
                {milestones.map((m) => {
                  const meta = MILESTONE_STATUS_META[m.status] || MILESTONE_STATUS_META.pending;
                  const completed = m.status === "completed";
                  const due = formatDate(m.due_date);
                  return (
                    <li
                      key={m.id}
                      className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5"
                    >
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-sm font-medium ${completed ? "text-muted-foreground line-through" : "text-foreground"}`}>
                          {m.title || "Untitled milestone"}
                        </p>
                        {m.description && (
                          <p className="truncate text-xs text-muted-foreground">{m.description}</p>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {due || "No due date"}
                      </span>
                      <select
                        value={MILESTONE_STATUS.includes(m.status) ? m.status : "pending"}
                        onChange={(e) => changeMilestoneStatus(m, e.target.value)}
                        disabled={busy}
                        className={`${INPUT_CLASS} py-1`}
                        aria-label="Change milestone status"
                      >
                        {MILESTONE_STATUS.map((s) => (
                          <option key={s} value={s}>
                            {MILESTONE_STATUS_META[s]?.label || labelize(s)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => openEdit(m)}
                        title="Edit milestone"
                        className="rounded-lg border border-border bg-background p-1.5 text-muted-foreground hover:border-primary hover:text-foreground"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeMilestone(m)}
                        disabled={busy}
                        title="Delete milestone"
                        className="rounded-lg border border-border bg-background p-1.5 text-muted-foreground hover:border-destructive hover:text-destructive disabled:opacity-60"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              !showForm && (
                <div className="mt-4 rounded-lg border border-dashed border-border p-6 text-center">
                  <p className="text-sm font-medium text-foreground">No milestones yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Break this project into phases to track progress.
                  </p>
                </div>
              )
            )}
          </div>

          {/* 4) Activity timeline */}
          <div className={PANEL}>
            <div className="flex items-center gap-2">
              <ActivityIcon className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-base font-semibold text-foreground">Activity</h3>
            </div>

            {activity.length ? (
              <ul className="mt-4 space-y-3">
                {activity.map((a) => {
                  const actor =
                    a.actor_name || actorNameById.get(a.actor_id) || "Someone";
                  const meta = a.meta || {};
                  const hint = meta.title || meta.to || meta.name || null;
                  return (
                    <li key={a.id} className="flex gap-3">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-foreground">
                          <span className="font-medium">{actor}</span>{" "}
                          <span className="text-muted-foreground">{labelize(a.action).toLowerCase()}</span>{" "}
                          <span>{a.entity_type}</span>
                          {hint && (
                            <span className="text-muted-foreground"> — {String(hint)}</span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {relativeTime(a.created_at)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">No activity yet</p>
            )}
          </div>

          {/* 5) Template & clone */}
          <div className={PANEL}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-foreground">Template &amp; Clone</h3>
              <span
                className={`${BADGE} ${project?.is_template ? STATUS_TONE.info : STATUS_TONE.muted}`}
              >
                {project?.is_template ? "Template" : "Not a template"}
              </span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Mark this project as a reusable template, or clone it (with its tasks) into a fresh project.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={toggleTemplate}
                disabled={busy || !project}
                className={`${SECONDARY_BTN} inline-flex items-center gap-1.5 disabled:opacity-60`}
              >
                <BookmarkCheck className="h-4 w-4" />
                {project?.is_template ? "Unmark template" : "Mark as template"}
              </button>
              <button
                type="button"
                onClick={handleClone}
                disabled={busy || !project}
                className={`${PRIMARY_BTN} inline-flex items-center gap-1.5`}
              >
                <Copy className="h-4 w-4" /> Clone project
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
