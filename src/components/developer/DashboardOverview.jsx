"use client";

import { useEffect, useMemo, useState } from "react";
import { setVisibleInterval } from "@/hooks/useVisibleInterval";
import { supabase } from "@/utils/supabaseClient";
import { projectStatusMeta } from "@/utils/projectStatus";
import {
  overviewDay,
  overviewWork,
  overviewDuration,
  loadOverviewTasks,
  loadOverviewTime,
} from "@/utils/developerOverview";
import { canAccessAdminSection } from "@/components/shell/navConfig";
import {
  ArrowUpRight,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FolderKanban,
  RefreshCw,
  Timer,
} from "lucide-react";
import StatCard from "@/components/shell/StatCard";
import {
  Button,
  EmptyState,
  PageHeader,
  Section,
  Skeleton,
  StatusPill,
} from "@/components/ui";

const panel = "rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6";
const empty = {
  tasks: null,
  time: null,
  taskError: null,
  timeError: null,
  busy: true,
};
export default function DashboardOverview({
  user,
  assignedProjects = [],
  projectsLoading = false,
  projectsError = null,
  onSectionChange,
  onViewProjectDetails,
  onRefreshProjects,
}) {
  const profileId = user?.id,
    organizationId = user?.organization_id,
    email = user?.email;
  const timezone = user?.organization_timezone || "UTC";
  const identityKey = `${organizationId}:${profileId}:${email}:${timezone}`;
  const [snapshot, setSnapshot] = useState({ ...empty, key: identityKey });
  const [refresh, setRefresh] = useState(0);
  const state = snapshot.key === identityKey ? snapshot : empty;
  const role = user?.membership_role || "developer";
  const canOpen = (section) =>
    !!onSectionChange && canAccessAdminSection(section, role);
  useEffect(() => {
    let active = true,
      running = false,
      again = false;
    const current = () => active;
    setSnapshot({ ...empty, key: identityKey });
    async function load() {
      if (running) {
        again = true;
        return;
      }
      running = true;
      const day = overviewDay(new Date(), timezone);
      const identity = { organizationId, profileId, email };
      const results = await Promise.allSettled([
        loadOverviewTasks(supabase, identity, current),
        loadOverviewTime(supabase, identity, day, current),
      ]);
      if (active)
        setSnapshot({
          key: identityKey,
          day,
          busy: false,
          tasks: results[0].status === "fulfilled" ? results[0].value : null,
          taskError:
            results[0].status === "rejected" ? results[0].reason.message : null,
          time: results[1].status === "fulfilled" ? results[1].value : null,
          timeError:
            results[1].status === "rejected" ? results[1].reason.message : null,
        });
      running = false;
      if (again && active) {
        again = false;
        void load();
      }
    }
    void load();
    const stop = setVisibleInterval(load, 10000);
    const channel = supabase
      .channel(`developer-overview:${organizationId}:${profileId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "developer_tasks",
          filter: `developer_id=eq.${profileId}`,
        },
        load,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "productivity_sessions",
          filter: `user_id=eq.${profileId}`,
        },
        load,
      )
      .subscribe();
    return () => {
      active = false;
      stop();
      supabase.removeChannel(channel);
    };
  }, [identityKey, organizationId, profileId, email, timezone, refresh]);
  const work = useMemo(
    () => (state.tasks ? overviewWork(state.tasks, state.day.day) : null),
    [state.tasks, state.day],
  );
  const projects = useMemo(() => {
    const activity = new Map();
    for (const task of state.tasks || [])
      activity.set(
        task.project_id,
        Math.max(
          activity.get(task.project_id) || 0,
          Date.parse(task.updated_at) || 0,
        ),
      );
    return [...assignedProjects]
      .sort(
        (a, b) =>
          Math.max(
            activity.get(b.id) || 0,
            Date.parse(b.updated_at || b.created_at) || 0,
          ) -
          Math.max(
            activity.get(a.id) || 0,
            Date.parse(a.updated_at || a.created_at) || 0,
          ),
      )
      .slice(0, 3);
  }, [assignedProjects, state.tasks]);
  const firstName = (user?.name || user?.full_name || "Your workspace").split(
    " ",
  )[0];
  const refreshAll = () => {
    setRefresh((n) => n + 1);
    onRefreshProjects?.();
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="A clear view of your priorities, progress and recorded time."
        actions={
          <Button variant="outline" onClick={refreshAll} disabled={state.busy}>
            <RefreshCw size={16} className={state.busy ? "animate-spin" : ""} />
            Refresh
          </Button>
        }
      />
      <section className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          Your day, in focus
        </p>
        <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          Welcome back, {firstName}.
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Start with what needs your attention, then pick up your next task.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {canOpen("my-work") && (
            <Button
              onClick={() => onSectionChange("my-work")}
              className="text-white dark:text-white"
            >
              Open My Work
              <ArrowUpRight size={16} />
            </Button>
          )}
          {canOpen("timesheet") && (
            <Button
              variant="outline"
              onClick={() => onSectionChange("timesheet")}
            >
              My timesheet
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            {user?.organization_name || "Your workspace"} ·{" "}
            {state.day?.timezone || timezone}
          </span>
        </div>
      </section>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Open tasks"
          value={work?.total ?? "—"}
          hint="Work waiting on you"
          icon={Clock}
          tone="primary"
          loading={state.busy}
        />
        <StatCard
          title="Needs attention"
          value={work?.attention.length ?? "—"}
          hint="Overdue, returned or due today"
          icon={AlertTriangle}
          tone="warning"
          loading={state.busy}
        />
        <StatCard
          title="Awaiting review"
          value={work?.counts.in_review ?? "—"}
          hint="Submitted work with your reviewer"
          icon={CheckCircle2}
          tone="success"
          loading={state.busy}
        />
        <StatCard
          title="Tracked today"
          value={overviewDuration(state.time?.seconds)}
          hint={`Synced tracker time · ${state.day?.timezone || timezone}`}
          icon={Timer}
          tone="info"
          loading={state.busy}
        />
      </div>
      {state.taskError && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
        >
          {state.taskError}{" "}
          <button className="font-semibold underline" onClick={refreshAll}>
            Retry
          </button>
        </div>
      )}
      {state.timeError && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
        >
          {state.timeError}{" "}
          <button className="font-semibold underline" onClick={refreshAll}>
            Retry time
          </button>
        </div>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        Tracker totals include saved seconds for sessions started today in{" "}
        {state.day?.timezone || timezone}. They update when the tracker syncs;
        task timers are separate in My timesheet.
        {state.time &&
          ` Checked ${new Date(state.time.checkedAt).toLocaleTimeString()}.`}
      </p>
      <div className="grid items-start gap-6 xl:grid-cols-[1.35fr_1fr]">
        <Section
          title="Needs attention"
          description="The work to look at first."
          className={panel}
          actions={
            canOpen("my-work") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSectionChange("my-work")}
              >
                View all
                <ArrowUpRight size={15} />
              </Button>
            )
          }
        >
          {state.busy ? (
            <Skeleton className="h-48 w-full" />
          ) : state.taskError ? (
            <p className="text-sm text-muted-foreground">
              Task priorities are unavailable until the data reloads.
            </p>
          ) : work?.attention.length ? (
            <ul className="divide-y divide-border">
              {work.attention.slice(0, 5).map(({ task, label, tone }) => (
                <li
                  key={task.id}
                  className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-foreground">
                      {task.task_title || "Untitled task"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {assignedProjects.find((p) => p.id === task.project_id)
                        ?.name || "Assigned work"}
                    </p>
                  </div>
                  <StatusPill
                    status={tone}
                    label={label}
                    size="sm"
                    className="shrink-0"
                  />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={CheckCircle2}
              title="Nothing urgent right now"
              description="No overdue, returned or due-today tasks. Your other work is ready in My Work."
            />
          )}
        </Section>
        <Section
          title="Work at a glance"
          description="Your current task pipeline."
          className={panel}
        >
          {state.busy ? (
            <Skeleton className="h-48 w-full" />
          ) : !work ? (
            <p className="text-sm text-muted-foreground">
              Your task summary is unavailable.
            </p>
          ) : (
            <dl className="space-y-4">
              {[
                [
                  "In progress",
                  work.buckets.in_progress.length +
                    work.buckets.due_soon.filter(
                      (t) => t.status === "in_progress",
                    ).length +
                    work.buckets.overdue.filter(
                      (t) => t.status === "in_progress",
                    ).length,
                ],
                ["Due today", work.dueToday],
                [
                  "Due in the next 7 days",
                  work.counts.due_soon - work.dueToday,
                ],
                ["Sent back", work.counts.sent_back],
                ["Completed", work.completed],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-4 border-b border-border pb-3 last:border-0 last:pb-0"
                >
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="text-lg font-semibold tabular-nums text-foreground">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </Section>
      </div>
      <Section
        title="Recent projects"
        description="Pick up where you left off."
        className={panel}
        actions={
          canOpen("projects") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSectionChange("projects")}
            >
              All projects
              <ArrowUpRight size={15} />
            </Button>
          )
        }
      >
        {projectsLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : projectsError ? (
          <div role="alert" className="text-sm">
            {projectsError}{" "}
            <button className="underline" onClick={refreshAll}>
              Retry projects
            </button>
          </div>
        ) : projects.length ? (
          <div className="grid gap-4 md:grid-cols-3">
            {projects.map((project) => {
              const meta = projectStatusMeta(project.status);
              return (
                <button
                  key={project.id}
                  onClick={() => onViewProjectDetails?.(project)}
                  disabled={!onViewProjectDetails}
                  className="min-w-0 rounded-xl border border-border bg-background/40 p-4 text-left transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <FolderKanban className="text-primary" size={21} />
                    <StatusPill
                      status={meta.tone}
                      label={meta.label}
                      size="sm"
                    />
                  </div>
                  <h3 className="truncate text-sm font-semibold">
                    {project.name}
                  </h3>
                  <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                    {project.description ||
                      "Open the project to review tasks and progress."}
                  </p>
                  <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary">
                    Open project
                    <ArrowUpRight size={14} />
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={FolderKanban}
            title="No projects yet"
            description="Your assigned projects will appear here."
          />
        )}
      </Section>
    </div>
  );
}
