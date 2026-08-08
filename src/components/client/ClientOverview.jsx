"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FolderKanban,
  ListTodo,
  CheckSquare,
  AlertTriangle,
  CalendarClock,
  Activity,
  ArrowRight,
} from "lucide-react";
import { authFetch } from "@/utils/authFetch";
import StatCard from "@/components/shell/StatCard";
import {
  Spinner,
  EmptyState,
  ErrorState,
  StatusBadge,
  HealthBadge,
  ProgressBar,
  healthMeta,
  kindMeta,
  formatDate,
  formatDateTime,
  formatRelativeTime,
  deadlineLabel,
} from "./ClientShared";

const isCompleted = (s) => ["completed", "done"].includes(String(s || "").toLowerCase());

// Worst health first: the one project that needs the client's attention should
// never be pushed below six healthy ones.
const HEALTH_RANK = { overdue: 0, at_risk: 1, on_track: 2 };
const healthRank = (health) => {
  const rank = HEALTH_RANK[String(health || "").toLowerCase()];
  return rank === undefined ? 3 : rank;
};

const timeOf = (value) => {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const MAX_PROJECT_CARDS = 6;
const MAX_ACTIVITY_PROJECTS = 3;
const MAX_ACTIVITY_ROWS = 6;

export default function ClientOverview({ user, onViewProject, onSectionChange }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [approvals, setApprovals] = useState([]);
  const [approvalsLoading, setApprovalsLoading] = useState(true);
  const [approvalsError, setApprovalsError] = useState("");

  const [activity, setActivity] = useState([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState("");

  const loadProjects = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const res = await authFetch("/api/client/projects");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Failed to load your projects.");
        return;
      }
      setProjects(Array.isArray(data.projects) ? data.projects : []);
    } catch {
      setError("Something went wrong while loading your dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadApprovals = useCallback(async () => {
    try {
      setApprovalsLoading(true);
      setApprovalsError("");
      const res = await authFetch("/api/client/approvals");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setApprovalsError(data?.error || "Failed to load approvals.");
        return;
      }
      setApprovals(Array.isArray(data.approvals) ? data.approvals : []);
    } catch {
      setApprovalsError("Something went wrong while loading approvals.");
    } finally {
      setApprovalsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
    loadApprovals();
  }, [loadProjects, loadApprovals]);

  const projectNames = useMemo(() => {
    const map = new Map();
    projects.forEach((p) => map.set(p.id, p.name));
    return map;
  }, [projects]);

  const openProjects = useMemo(() => projects.filter((p) => !isCompleted(p.status)), [projects]);

  const activeProjects = useMemo(() => {
    return [...openProjects].sort((a, b) => {
      const health = healthRank(a.health) - healthRank(b.health);
      if (health !== 0) return health;
      const aTime = timeOf(a.deadline);
      const bTime = timeOf(b.deadline);
      if (aTime === bTime) return 0;
      if (aTime === null) return 1;
      if (bTime === null) return -1;
      return aTime - bTime;
    });
  }, [openProjects]);

  const upcomingDeadlines = useMemo(() => {
    return openProjects
      .filter((p) => timeOf(p.deadline) !== null)
      .map((p) => ({ project: p, at: timeOf(p.deadline) }))
      .sort((a, b) => a.at - b.at)
      .slice(0, 5);
  }, [openProjects]);

  const totals = useMemo(() => {
    let openTasks = 0;
    let pendingApprovals = 0;
    let needsAttention = 0;
    projects.forEach((p) => {
      openTasks += Number(p.open_tasks) || 0;
      pendingApprovals += Number(p.pending_approvals) || 0;
      if (p.health === "at_risk" || p.health === "overdue") needsAttention += 1;
    });
    return { openTasks, pendingApprovals, needsAttention };
  }, [projects]);

  const pendingApprovals = useMemo(() => {
    return approvals
      .filter((a) => a.status === "pending")
      .map((a) => ({ approval: a, at: timeOf(a.created_at) ?? 0 }))
      .sort((a, b) => b.at - a.at)
      .slice(0, 5)
      .map((entry) => entry.approval);
  }, [approvals]);

  // Only the projects still in flight are polled for activity, and only a few
  // of them: the overview is a summary, not a full feed. The per-project
  // Activity tab is the complete, pageable view.
  const activityProjectKey = useMemo(
    () =>
      activeProjects
        .slice(0, MAX_ACTIVITY_PROJECTS)
        .map((p) => p.id)
        .join(","),
    [activeProjects]
  );

  const loadActivity = useCallback(async () => {
    const ids = activityProjectKey ? activityProjectKey.split(",") : [];
    if (ids.length === 0) {
      setActivity([]);
      setActivityError("");
      setActivityLoading(false);
      return;
    }
    try {
      setActivityLoading(true);
      setActivityError("");
      const pages = await Promise.all(
        ids.map(async (id) => {
          const res = await authFetch(`/api/client/projects/${id}/timeline?limit=5`);
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.error || "Failed to load recent activity.");
          const events = Array.isArray(data.events) ? data.events : [];
          return events.map((event) => ({ event, projectId: id }));
        })
      );
      setActivity(pages.flat());
    } catch (err) {
      setActivityError(err?.message || "Something went wrong while loading recent activity.");
    } finally {
      setActivityLoading(false);
    }
  }, [activityProjectKey]);

  useEffect(() => {
    loadActivity();
  }, [loadActivity]);

  const recentActivity = useMemo(() => {
    return [...activity]
      .sort((a, b) => (timeOf(b.event.created_at) ?? 0) - (timeOf(a.event.created_at) ?? 0))
      .slice(0, MAX_ACTIVITY_ROWS);
  }, [activity]);

  const greetingName = user?.name || user?.full_name || "there";
  const orgName = user?.organization_name;

  if (loading) return <Spinner label="Loading your dashboard…" />;
  if (error) return <ErrorState message={error} onRetry={loadProjects} />;

  return (
    <div className="space-y-8">
      <div className="rounded-xl border border-border bg-card p-5 shadow-card sm:p-6">
        <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          Welcome back, {greetingName}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {orgName
            ? `Here's the latest across your projects with ${orgName}.`
            : "Here's the latest across your projects."}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Active Projects" value={openProjects.length} icon={FolderKanban} tone="primary" />
        <StatCard title="Open Tasks" value={totals.openTasks} icon={ListTodo} tone="info" />
        <StatCard
          title="Pending Approvals"
          value={totals.pendingApprovals}
          icon={CheckSquare}
          tone={totals.pendingApprovals > 0 ? "warning" : "success"}
        />
        <StatCard
          title="Needs Attention"
          value={totals.needsAttention}
          icon={AlertTriangle}
          tone={totals.needsAttention > 0 ? "destructive" : "success"}
        />
      </div>

      {/* Active projects */}
      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold tracking-tight text-foreground">Active Projects</h3>
          {projects.length > 0 && (
            <button
              onClick={() => onSectionChange?.("projects")}
              className="inline-flex shrink-0 items-center text-sm font-medium text-primary hover:underline"
            >
              View all
              <ArrowRight className="ml-1 h-4 w-4" />
            </button>
          )}
        </div>

        {activeProjects.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title="No active projects"
            message="Once your agency links a project to your account, it will appear here."
          />
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {activeProjects.slice(0, MAX_PROJECT_CARDS).map((project) => {
              const meta = healthMeta(project.health);
              return (
                <button
                  key={project.id}
                  onClick={() => onViewProject?.(project.id)}
                  className="group rounded-xl border border-border bg-card p-5 text-left shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-elevated"
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <h4 className="line-clamp-2 text-base font-bold text-foreground">{project.name}</h4>
                    <StatusBadge status={project.status} />
                  </div>

                  <ProgressBar value={project.progress} tone={meta?.barTone} />

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                    <HealthBadge health={project.health} />
                    {project.deadline && (
                      <span className="text-xs text-muted-foreground">
                        {deadlineLabel(project.deadline) || formatDate(project.deadline)}
                      </span>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                    <span>
                      <span className="font-semibold text-foreground">{Number(project.open_tasks) || 0}</span> open tasks
                    </span>
                    <span>
                      <span className="font-semibold text-foreground">{Number(project.pending_approvals) || 0}</span> awaiting you
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Upcoming deadlines */}
        <section className="rounded-xl border border-border bg-card p-5 shadow-card">
          <h3 className="mb-4 flex items-center gap-2 text-base font-bold tracking-tight text-foreground">
            <CalendarClock className="h-5 w-5 text-primary" />
            Upcoming Deadlines
          </h3>

          {upcomingDeadlines.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No deadlines scheduled on your active projects.
            </p>
          ) : (
            <ul className="space-y-2">
              {upcomingDeadlines.map(({ project }) => (
                <li key={project.id}>
                  <button
                    onClick={() => onViewProject?.(project.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-background p-3 text-left transition-colors hover:bg-muted"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{project.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{formatDate(project.deadline)}</p>
                    </div>
                    <HealthBadge health={project.health} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Pending approvals */}
        <section className="rounded-xl border border-border bg-card p-5 shadow-card">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-base font-bold tracking-tight text-foreground">
              <CheckSquare className="h-5 w-5 text-primary" />
              Pending Approvals
            </h3>
            <button
              onClick={() => onSectionChange?.("approvals")}
              className="inline-flex shrink-0 items-center text-sm font-medium text-primary hover:underline"
            >
              Review
              <ArrowRight className="ml-1 h-4 w-4" />
            </button>
          </div>

          {approvalsLoading ? (
            <Spinner label="Loading approvals…" className="py-8" />
          ) : approvalsError ? (
            <ErrorState message={approvalsError} onRetry={loadApprovals} />
          ) : pendingApprovals.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nothing is waiting on your sign-off right now.
            </p>
          ) : (
            <ul className="space-y-2">
              {pendingApprovals.map((approval) => (
                <li
                  key={approval.id}
                  className="rounded-lg border border-border bg-background p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{approval.title}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{approval.project_name}</p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatRelativeTime(approval.created_at)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Recent activity */}
      <section className="rounded-xl border border-border bg-card p-5 shadow-card">
        <h3 className="mb-4 flex items-center gap-2 text-base font-bold tracking-tight text-foreground">
          <Activity className="h-5 w-5 text-primary" />
          Recent Activity
        </h3>

        {activityLoading ? (
          <Spinner label="Loading recent activity…" className="py-8" />
        ) : activityError ? (
          <ErrorState message={activityError} onRetry={loadActivity} />
        ) : recentActivity.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nothing has happened on your projects yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {recentActivity.map(({ event, projectId }) => {
              const meta = kindMeta(event.kind);
              const Icon = meta.icon;
              return (
                <li key={event.id} className="flex items-start gap-3">
                  <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${meta.tone}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                      <p className="min-w-0 text-sm font-semibold text-foreground">{event.title}</p>
                      <span
                        className="whitespace-nowrap text-xs text-muted-foreground"
                        title={formatDateTime(event.created_at)}
                      >
                        {formatRelativeTime(event.created_at)}
                      </span>
                    </div>
                    <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                      <span className="font-medium text-primary">{projectNames.get(projectId)}</span>
                      {event.actor_name && <span>· {event.actor_name}</span>}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
