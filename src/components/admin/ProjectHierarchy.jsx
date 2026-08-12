"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  RefreshCw,
  Users,
  UserX,
  FolderKanban,
  CalendarDays,
  Flag,
  Network,
  FilterX,
  AlertTriangle,
  Briefcase,
} from "lucide-react";

import {
  PageHeader,
  Toolbar,
  Button,
  Badge,
  StatusPill,
  EmptyState,
  ErrorState,
  Skeleton,
} from "@/components/ui";
import StatCard from "@/components/shell/StatCard";
import { sectionTitle } from "@/components/shell/navConfig";
import { supabase } from "@/utils/supabaseClient";
import { getOrgId } from "@/utils/orgContext";
import { loadEmployees } from "@/utils/employeesData";
import { computeProjectHealth } from "@/utils/pmData";
import { projectStatusMeta, isProjectOpen } from "@/utils/projectStatus";
import {
  roleIcon,
  roleLabel,
  rolePlural,
  roleVariant,
  roleOrder,
} from "@/components/shared/roleMeta";

/**
 * Team Structure — who is on what, project by project.
 *
 *      Project  →  Project Manager  →  Team, grouped by role
 *
 * WHERE THE TEAM COMES FROM, AND WHY IT IS DERIVED
 *
 * There is no `project_members` table. A person is on a project because of one
 * of three facts, and this screen unions all three:
 *
 *   1. `projects.manager_id`            — the project manager
 *   2. `projects.assigned_developer_id` — the original single assignee, from
 *                                         before a project could have a team
 *   3. `developer_tasks.developer_id`   — anyone holding a task on it
 *
 * (3) is the one that matters in practice and it is also the honest one: the
 * team of a project is the people doing its work. It does mean somebody who has
 * been added but given nothing to do will not appear, and that is worth knowing
 * rather than papering over — the card says so when it happens.
 *
 * WHAT IT COSTS: four queries for the whole page, no matter how many projects.
 * The obvious shape — a query per project for its tasks and another for its
 * team — is what makes a screen like this take eight seconds on a real
 * organisation.
 *
 * PROGRESS is computed from tasks (done ÷ total) by computeProjectHealth, the
 * same function the Project Hub uses, falling back to the stored `progress`
 * column only when a project has no tasks at all. Two different progress
 * numbers on two screens is worse than no progress number.
 */

const selectClass =
  "h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const PRIORITY_VARIANTS = {
  urgent: "destructive",
  critical: "destructive",
  high: "warning",
  medium: "secondary",
  normal: "secondary",
  low: "outline",
  lowest: "outline",
};

const RISK_META = {
  low: { variant: "success", label: "On track" },
  medium: { variant: "warning", label: "At risk" },
  high: { variant: "destructive", label: "Off track" },
};

const prettyish = (s) =>
  String(s || "")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

function formatDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/** Initials, for somebody with no photo. */
function initialsOf(name, email) {
  const src = String(name || email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase() || "?";
}

function Avatar({ person, size = "md" }) {
  const box = size === "lg" ? "h-10 w-10 text-sm" : "h-8 w-8 text-xs";
  return (
    <span
      aria-hidden="true"
      className={`${box} flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary ring-2 ring-card`}
    >
      {initialsOf(person?.name, person?.email)}
    </span>
  );
}

/**
 * The progress bar.
 *
 * The number is beside it, always. A bar alone is a shape somebody has to
 * estimate, and "roughly three quarters" is not what anybody wants to report
 * upward. The bar carries role="progressbar" with its value so a screen reader
 * gets the same fact rather than a decorative div.
 */
function ProgressBar({ value, label }) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  return (
    <div className="flex items-center gap-3">
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-11 shrink-0 text-right text-sm font-semibold tabular-nums text-foreground">
        {pct}%
      </span>
    </div>
  );
}

/** Overlapping avatars — the team at a glance, without expanding the card. */
function AvatarStack({ people, max = 5 }) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  if (!people.length) return null;

  return (
    <div className="flex items-center">
      <div className="flex -space-x-2">
        {shown.map((p) => (
          <span key={p.key} title={`${p.name}${p.role ? ` — ${roleLabel(p.role)}` : ""}`}>
            <Avatar person={p} />
          </span>
        ))}
      </div>
      {rest > 0 && (
        <span className="ml-2 text-xs font-medium text-muted-foreground tabular-nums">
          +{rest}
        </span>
      )}
      <span className="sr-only">
        {people.length} {people.length === 1 ? "person" : "people"} on this project
      </span>
    </div>
  );
}

/** One person inside an expanded card. */
function PersonRow({ person }) {
  const Icon = roleIcon(person.role);
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2">
      <Avatar person={person} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {person.name}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {person.designation || person.email || "—"}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {person.taskCount > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {person.taskCount} {person.taskCount === 1 ? "task" : "tasks"}
          </span>
        )}
        <Badge variant={roleVariant(person.role)} size="sm">
          <Icon className="h-3 w-3" aria-hidden="true" />
          {roleLabel(person.role)}
        </Badge>
      </span>
    </li>
  );
}

/** One project: collapsed summary, expandable to the people. */
function ProjectCard({ project, expanded, onToggle }) {
  const { health, manager, byRole, team } = project;
  const status = projectStatusMeta(project.status);
  const risk = RISK_META[health.risk] || RISK_META.low;
  const deadline = formatDate(health.deadline);
  const panelId = `hierarchy-panel-${project.id}`;

  return (
    <div className="rounded-xl border border-border bg-card shadow-card transition-shadow duration-150 motion-reduce:transition-none hover:shadow-elevated">
      {/* The whole header is the toggle: a chevron alone is a small target and
          the rest of the row looks clickable anyway. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-start gap-3 rounded-xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:p-5"
      >
        <ChevronRight
          className={`mt-0.5 h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none ${
            expanded ? "rotate-90" : ""
          }`}
          aria-hidden="true"
        />

        <span className="min-w-0 flex-1 space-y-3">
          {/* Name + the badges that qualify it */}
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="truncate text-base font-semibold text-foreground">
              {project.name || "Untitled project"}
            </span>
            <StatusPill status={status.tone} label={status.label} />
            {project.priority && (
              <Badge variant={PRIORITY_VARIANTS[String(project.priority).toLowerCase()] || "secondary"} size="sm">
                <Flag className="h-3 w-3" aria-hidden="true" />
                {prettyish(project.priority)}
              </Badge>
            )}
            {/* Risk is only worth saying when it is not "fine". */}
            {health.risk !== "low" && (
              <Badge variant={risk.variant} size="sm">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                {risk.label}
              </Badge>
            )}
          </span>

          <ProgressBar value={health.progress} label={`${project.name} progress`} />

          {/* The one-line facts. Deadline, tasks, PM, team. */}
          <span className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4" aria-hidden="true" />
              {deadline ? (
                <span className={health.deadlinePassed ? "font-medium text-destructive" : ""}>
                  {deadline}
                  {health.deadlinePassed ? " — passed" : ""}
                </span>
              ) : (
                "No deadline"
              )}
            </span>
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              <FolderKanban className="h-4 w-4" aria-hidden="true" />
              {health.done} of {health.total} tasks
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Briefcase className="h-4 w-4" aria-hidden="true" />
              {manager ? manager.name : <span className="italic">No manager</span>}
            </span>
          </span>
        </span>

        <span className="hidden shrink-0 pt-1 sm:block">
          <AvatarStack people={team} />
        </span>
      </button>

      {/* Expanded: the hierarchy itself */}
      {expanded && (
        <div id={panelId} className="border-t border-border px-4 pb-5 pt-4 sm:px-5">
          {/* Manager first and on its own — that is the hierarchy. */}
          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Project Manager
            </h4>
            {manager ? (
              <ul className="space-y-2">
                <PersonRow person={manager} />
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                No project manager set. Assign one on the project so reports and
                approvals have somewhere to go.
              </p>
            )}
          </section>

          <section className="mt-5 space-y-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Team
            </h4>

            {byRole.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                Nobody is on this project yet. People appear here once they hold
                a task on it, or once they are set as its developer.
              </p>
            ) : (
              byRole.map(({ role, people }) => {
                const Icon = roleIcon(role);
                return (
                  <div key={role} className="space-y-2">
                    <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      {rolePlural(role)}
                      <span className="text-muted-foreground tabular-nums">
                        {people.length}
                      </span>
                    </p>
                    <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                      {people.map((p) => (
                        <PersonRow key={p.key} person={p} />
                      ))}
                    </ul>
                  </div>
                );
              })
            )}
          </section>
        </div>
      )}
    </div>
  );
}

export default function ProjectHierarchy() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");
  const [managerFilter, setManagerFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const orgId = getOrgId();
      if (!orgId) throw new Error("Your session has no organization. Sign in again.");

      // Four queries for the whole page. See the note at the top of the file.
      const [projRes, taskRes, empRes] = await Promise.all([
        supabase
          .from("projects")
          .select(
            "id, name, status, progress, priority, deadline, end_date, manager_id, " +
              "assigned_developer_id, assigned_developer_email, archived"
          )
          .eq("organization_id", orgId)
          .order("created_at", { ascending: false }),
        supabase
          .from("developer_tasks")
          .select("id, project_id, developer_id, status, due_date")
          .eq("organization_id", orgId)
          .limit(5000),
        loadEmployees(orgId),
      ]);

      if (projRes.error) throw projRes.error;

      const employees = empRes?.employees || [];
      const byUserId = new Map();
      const byEmail = new Map();
      for (const e of employees) {
        if (e.userId) byUserId.set(String(e.userId), e);
        if (e.email) byEmail.set(String(e.email).toLowerCase(), e);
      }

      // Tasks grouped by project, once.
      const tasksByProject = new Map();
      for (const t of taskRes.data || []) {
        if (!t.project_id) continue;
        const key = String(t.project_id);
        if (!tasksByProject.has(key)) tasksByProject.set(key, []);
        tasksByProject.get(key).push(t);
      }

      const shaped = (projRes.data || [])
        .filter((p) => !p.archived)
        .map((p) => {
          const tasks = tasksByProject.get(String(p.id)) || [];
          const health = computeProjectHealth(p, tasks);

          // Union of the three facts that put somebody on a project.
          const members = new Map();
          const add = (emp, taskCount = 0) => {
            if (!emp?.userId) return;
            const key = String(emp.userId);
            const seen = members.get(key);
            if (seen) {
              seen.taskCount += taskCount;
              return;
            }
            members.set(key, {
              key,
              userId: emp.userId,
              name: emp.name,
              email: emp.email,
              role: emp.role,
              designation: emp.profile?.designation || null,
              taskCount,
            });
          };

          const manager = p.manager_id ? byUserId.get(String(p.manager_id)) : null;

          if (p.assigned_developer_id) add(byUserId.get(String(p.assigned_developer_id)));
          else if (p.assigned_developer_email)
            add(byEmail.get(String(p.assigned_developer_email).toLowerCase()));

          for (const t of tasks) {
            if (!t.developer_id) continue;
            add(byUserId.get(String(t.developer_id)), 1);
          }

          // The manager is shown above the team, so they are not repeated in it.
          if (manager?.userId) members.delete(String(manager.userId));

          const team = Array.from(members.values()).sort(
            (a, b) =>
              roleOrder(a.role) - roleOrder(b.role) ||
              String(a.name || "").localeCompare(String(b.name || ""))
          );

          const grouped = new Map();
          for (const person of team) {
            const role = person.role || "employee";
            if (!grouped.has(role)) grouped.set(role, []);
            grouped.get(role).push(person);
          }
          const byRole = Array.from(grouped, ([role, people]) => ({ role, people })).sort(
            (a, b) => roleOrder(a.role) - roleOrder(b.role)
          );

          return {
            ...p,
            health,
            team,
            byRole,
            manager: manager
              ? {
                  key: String(manager.userId),
                  userId: manager.userId,
                  name: manager.name,
                  email: manager.email,
                  role: manager.role,
                  designation: manager.profile?.designation || null,
                  taskCount: 0,
                }
              : null,
          };
        });

      setProjects(shaped);
    } catch (e) {
      setError(e?.message || "Could not load the team structure.");
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const managers = useMemo(() => {
    const m = new Map();
    for (const p of projects) if (p.manager) m.set(p.manager.key, p.manager.name);
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) =>
      String(a.name).localeCompare(String(b.name))
    );
  }, [projects]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((p) => {
      if (statusFilter === "open" && !isProjectOpen(p.status)) return false;
      if (statusFilter === "unstaffed" && (p.team.length > 0 || p.manager)) return false;
      if (managerFilter === "none" && p.manager) return false;
      if (managerFilter !== "all" && managerFilter !== "none") {
        if (p.manager?.key !== managerFilter) return false;
      }
      if (q) {
        const hay = [p.name, p.manager?.name, ...p.team.map((t) => t.name)]
          .map((v) => String(v || "").toLowerCase())
          .join(" ");
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [projects, search, statusFilter, managerFilter]);

  const stats = useMemo(() => {
    const open = projects.filter((p) => isProjectOpen(p.status));
    const people = new Set();
    let unmanaged = 0;
    for (const p of open) {
      if (!p.manager) unmanaged += 1;
      if (p.manager) people.add(p.manager.key);
      for (const t of p.team) people.add(t.key);
    }
    const avg = open.length
      ? Math.round(open.reduce((s, p) => s + (p.health.progress || 0), 0) / open.length)
      : 0;
    return { openProjects: open.length, people: people.size, unmanaged, avg };
  }, [projects]);

  const filtersActive =
    search.trim() !== "" || statusFilter !== "open" || managerFilter !== "all";

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("open");
    setManagerFilter("all");
  };

  const toggle = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allExpanded = visible.length > 0 && visible.every((p) => expanded.has(p.id));

  const header = (
    <PageHeader
      title={sectionTitle("hierarchy", "admin")}
      description="Every project, its manager, and the people working on it."
      actions={
        <>
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw
              className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            Refresh
          </Button>
          {visible.length > 0 && (
            <Button
              variant="outline"
              onClick={() =>
                setExpanded(allExpanded ? new Set() : new Set(visible.map((p) => p.id)))
              }
            >
              {allExpanded ? "Collapse all" : "Expand all"}
            </Button>
          )}
        </>
      }
    />
  );

  if (loading) {
    return (
      <div className="space-y-6">
        {header}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-5 shadow-card">
              <Skeleton className="h-11 w-11 rounded-xl" />
              <Skeleton className="mt-4 h-8 w-20" />
              <Skeleton className="mt-2 h-4 w-28" />
            </div>
          ))}
        </div>
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
        <span className="sr-only" role="status">
          Loading team structure…
        </span>
      </div>
    );
  }

  if (error && projects.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState
          title="Couldn't load the team structure"
          description={error}
          onRetry={load}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Open projects" value={stats.openProjects} icon={FolderKanban} tone="primary" />
        <StatCard title="People assigned" value={stats.people} icon={Users} tone="info" />
        <StatCard title="Average progress" value={`${stats.avg}%`} icon={Network} tone="success" />
        {/* A project nobody answers for is the thing this screen exists to
            surface, so it gets a tile rather than being buried in a filter. */}
        <StatCard
          title="Without a manager"
          value={stats.unmanaged}
          icon={UserX}
          tone={stats.unmanaged > 0 ? "warning" : "muted"}
        />
      </div>

      <Toolbar
        search={{
          value: search,
          onChange: (value) => setSearch(value),
          placeholder: "Search project, manager or team member…",
        }}
        filters={
          <>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={selectClass}
              aria-label="Filter projects"
            >
              <option value="open">Open projects</option>
              <option value="all">All projects</option>
              <option value="unstaffed">Nobody assigned</option>
            </select>

            <select
              value={managerFilter}
              onChange={(e) => setManagerFilter(e.target.value)}
              className={selectClass}
              aria-label="Filter by project manager"
            >
              <option value="all">All managers</option>
              <option value="none">No manager</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </>
        }
        actions={
          filtersActive ? (
            <Button variant="ghost" onClick={clearFilters}>
              <FilterX className="h-4 w-4" aria-hidden="true" />
              Clear filters
            </Button>
          ) : null
        }
      />

      <p className="-mt-3 text-sm text-muted-foreground" aria-live="polite">
        {visible.length === projects.length
          ? `${projects.length} ${projects.length === 1 ? "project" : "projects"}`
          : `${visible.length} of ${projects.length} projects`}
      </p>

      {visible.length === 0 ? (
        <EmptyState
          icon={Network}
          title={projects.length === 0 ? "No projects yet" : "No projects match your filters"}
          description={
            projects.length === 0
              ? "Create a project, or accept a client proposal, and its team will appear here."
              : "Try a different search term, or widen the status and manager filters."
          }
          action={
            projects.length > 0 && filtersActive ? (
              <Button variant="outline" onClick={clearFilters}>
                <FilterX className="h-4 w-4" aria-hidden="true" />
                Clear filters
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="space-y-3">
          {visible.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              expanded={expanded.has(p.id)}
              onToggle={() => toggle(p.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
