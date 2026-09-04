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
  ScrollStrip,
} from "@/components/ui";
import StatCard from "@/components/shell/StatCard";
import { sectionTitle } from "@/components/shell/navConfig";
import { getOrgId } from "@/utils/orgContext";
import { computeProjectHealth } from "@/utils/pmData";
import { loadOrgWorkGraph, projectTeam } from "@/utils/orgWorkGraph";
import { projectStatusMeta, isProjectOpen } from "@/utils/projectStatus";
import {
  roleIcon,
  roleLabel,
  rolePlural,
  roleVariant,
  roleOrder,
} from "@/components/shared/roleMeta";
import {
  Trunk,
  Branches,
  PersonNode,
  EmptyManagerNode,
  ProjectNode,
  RoleBranch,
} from "@/components/admin/orgChart";

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
 * WHAT IT COSTS: five queries for the whole page, no matter how many projects,
 * and they are not issued here — utils/orgWorkGraph.js owns them, because
 * Capacity reads the same graph from the other end and two copies of the
 * joining rules would drift into two screens disagreeing about who is on a
 * project. The note at the top of that file counts the five and says why it is
 * not four.
 *
 * PROGRESS is computed from tasks (done ÷ total) by computeProjectHealth, the
 * same function the Project Hub uses, falling back to the stored `progress`
 * column only when a project has no tasks at all. Two different progress
 * numbers on two screens is worse than no progress number.
 */

const selectClass =
  "h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

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

/**
 * One project, as a chart:
 *
 *      [ project ]
 *           │
 *      [ manager ]              or a "No manager" node
 *           │
 *   ── team leads ──            only when there are any
 *           │
 *   ── one branch per role ──   Developers · Designers · QA · …
 *
 * NO LINE IS DRAWN FROM A TEAM LEAD TO A MEMBER, and that is deliberate.
 * `memberships.reports_to` is what would say who reports to which lead, and
 * drawing a line without it would invent a reporting structure and then be
 * believed. The leads sit as their own level under the manager; the role
 * branches hang from the same trunk, which claims only what is true: these
 * people are all on this project.
 *
 * This chart is PROJECT-shaped and the reporting line is not — somebody's
 * manager is the same person on every project they are on. That is why the
 * ReportingLines panel below this one edits the column instead of this chart
 * drawing it: the two answer different questions and only one of them is about
 * a project.
 */
function ProjectChart({ project, expanded, onToggle }) {
  const { health, manager, byRole, team } = project;
  const status = projectStatusMeta(project.status);
  const risk = RISK_META[health.risk] || RISK_META.low;
  const deadline = formatDate(health.deadline);
  const panelId = `hierarchy-panel-${project.id}`;

  // Team leads are a level, not a role branch — they sit between the manager
  // and everybody else, which is the one thing a chart can say that a list
  // cannot.
  const leads = byRole.find((g) => g.role === "team_lead")?.people || [];
  const roleBranches = byRole.filter((g) => g.role !== "team_lead");

  const facts = (
    <>
      {project.priority && (
        <span className="inline-flex items-center gap-1.5">
          <Flag className="h-4 w-4" aria-hidden="true" />
          <span className="text-foreground">{prettyish(project.priority)}</span>
        </span>
      )}
      <span className="inline-flex items-center gap-1.5">
        <CalendarDays className="h-4 w-4" aria-hidden="true" />
        {deadline ? (
          <span className={health.deadlinePassed ? "font-medium text-destructive" : "text-foreground"}>
            {deadline}
            {health.deadlinePassed ? " — passed" : ""}
          </span>
        ) : (
          "No deadline"
        )}
      </span>
      <span className="inline-flex items-center gap-1.5 tabular-nums">
        <Users className="h-4 w-4" aria-hidden="true" />
        <span className="text-foreground">{team.length + (manager ? 1 : 0)}</span>
        {team.length + (manager ? 1 : 0) === 1 ? "person" : "people"}
      </span>
      <span className="inline-flex items-center gap-1.5 tabular-nums">
        <FolderKanban className="h-4 w-4" aria-hidden="true" />
        <span className="text-foreground">
          {health.done}/{health.total}
        </span>
        tasks
      </span>
      {/* Risk is only worth saying when it is not "fine". */}
      {health.risk !== "low" && (
        <Badge variant={risk.variant} size="sm">
          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          {risk.label}
        </Badge>
      )}
    </>
  );

  return (
    <div className="rounded-2xl border border-border bg-muted/20 p-4 sm:p-6">
      <div className="flex justify-center">
        <ProjectNode
          project={project}
          status={<StatusPill status={status.tone} label={status.label} />}
          health={health}
          expanded={expanded}
          onToggle={onToggle}
          panelId={panelId}
          ChevronIcon={ChevronRight}
          facts={facts}
        />
      </div>

      {expanded && (
        <div id={panelId} className="pt-0">
          <Trunk />

          {/* The manager: one node, on its own level. */}
          <div className="flex justify-center">
            {manager ? <PersonNode person={manager} tone="manager" caption="Project manager" /> : <EmptyManagerNode />}
          </div>

          {team.length === 0 ? (
            <>
              <Trunk />
              <p className="mx-auto max-w-md rounded-xl border border-dashed border-border px-4 py-3 text-center text-sm text-muted-foreground">
                Nobody is on this project yet. People appear here once they hold
                a task on it, or once they are set as its developer.
              </p>
            </>
          ) : (
            <>
              {leads.length > 0 && (
                <>
                  <Trunk />
                  {/* A level, drawn from one trunk — not a line per lead, which
                      would imply a reporting split the data does not have. */}
                  <ScrollStrip fadeFrom="from-muted/20">
                    <Branches className="w-max min-w-full">
                      {leads.map((p) => (
                        <PersonNode key={p.key} person={p} tone="lead" caption="Team lead" />
                      ))}
                    </Branches>
                  </ScrollStrip>
                </>
              )}

              {roleBranches.length > 0 && (
                <>
                  <Trunk />
                  {/* Scrolls rather than wraps: the rail is drawn across ONE
                      row, so a wrapped second row would sit under a line that
                      does not reach it. */}
                  <ScrollStrip fadeFrom="from-muted/20">
                    <Branches className="w-max min-w-full">
                      {roleBranches.map((g) => (
                        <RoleBranch key={g.role} role={g.role} people={g.people} />
                      ))}
                    </Branches>
                  </ScrollStrip>
                </>
              )}
            </>
          )}
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
      const graph = await loadOrgWorkGraph(getOrgId());

      const shaped = graph.projects.map((p) => {
        const { manager, team, tasks } = projectTeam(p, graph);
        const health = computeProjectHealth(p, tasks);

        const sorted = [...team].sort(
          (a, b) =>
            roleOrder(a.role) - roleOrder(b.role) ||
            String(a.name || "").localeCompare(String(b.name || ""))
        );

        const grouped = new Map();
        for (const person of sorted) {
          const role = person.role || "employee";
          if (!grouped.has(role)) grouped.set(role, []);
          grouped.get(role).push(person);
        }
        const byRole = Array.from(grouped, ([role, people]) => ({ role, people })).sort(
          (a, b) => roleOrder(a.role) - roleOrder(b.role)
        );

        return { ...p, health, team: sorted, byRole, manager };
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

  // Split, not sorted. A project nobody answers for is a different KIND of row
  // from one that has a manager: it needs an owner before anything else on it
  // matters, and mixed into the list it reads as just another card. The stat
  // tile counts them; this is where you actually see which ones.
  const unmanaged = useMemo(() => visible.filter((p) => !p.manager), [visible]);
  const managed = useMemo(() => visible.filter((p) => p.manager), [visible]);

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
        <div className="space-y-8">
          {/* Without a manager — first, because it is the list somebody has to
              act on. Hidden entirely when it is empty rather than sitting there
              as a permanent empty box saying nothing is wrong. */}
          {unmanaged.length > 0 && (
            <section aria-labelledby="hierarchy-unmanaged" className="space-y-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h2
                  id="hierarchy-unmanaged"
                  className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-warning-on-tint"
                >
                  <UserX className="h-4 w-4" aria-hidden="true" />
                  Without a manager
                </h2>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {unmanaged.length}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                Nobody answers for these. Reports, approvals and client questions
                on a project with no manager have nowhere to go — set one on the
                project to move it into the list below.
              </p>
              <div className="space-y-3">
                {unmanaged.map((p) => (
                  <ProjectChart
                    key={p.id}
                    project={p}
                    expanded={expanded.has(p.id)}
                    onToggle={() => toggle(p.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {managed.length > 0 && (
            <section aria-labelledby="hierarchy-managed" className="space-y-3">
              {/* The heading only earns its place once there is something above
                  it to distinguish this list from. */}
              {unmanaged.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h2
                    id="hierarchy-managed"
                    className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    <Briefcase className="h-4 w-4" aria-hidden="true" />
                    With a manager
                  </h2>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {managed.length}
                  </span>
                </div>
              )}
              <div className="space-y-3">
                {managed.map((p) => (
                  <ProjectChart
                    key={p.id}
                    project={p}
                    expanded={expanded.has(p.id)}
                    onToggle={() => toggle(p.id)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
