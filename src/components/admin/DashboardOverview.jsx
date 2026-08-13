"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertOctagon,
  Bell,
  FolderKanban,
  Inbox,
  Network,
  RefreshCw,
  TriangleAlert,
  Users,
} from "lucide-react";

import StatCard from "@/components/shell/StatCard";
import { Button, EmptyState, ErrorState, PageHeader, Skeleton } from "@/components/ui";
import { canAccessAdminSection, sectionTitle } from "@/components/shell/navConfig";
import { getOrgContext, getOrgId } from "@/utils/orgContext";
import { setVisibleInterval } from "@/hooks/useVisibleInterval";
import SignalsPanel from "@/components/admin/SignalsPanel";
import {
  PROPOSAL_BUCKETS,
  TASK_BUCKETS,
  bugSummary,
  loadAdminOverview,
  overviewKpis,
  peopleRows,
  projectRows,
  taskBuckets,
} from "@/utils/adminOverview";
import { projectTeam } from "@/utils/orgWorkGraph";
import {
  BucketTile,
  Deadline,
  Panel,
  PanelHead,
  Meter,
  PersonChip,
  PriorityChip,
  ProjectStatus,
  RiskChip,
  ago,
  initialsOf,
} from "@/components/admin/overviewPanels";

/**
 * The admin Overview — company-wide operational visibility.
 *
 * WHAT IT REPLACED
 *
 * Three stat cards and a copy of the signed-in person's own profile. All three
 * counters were scoped to `created_by = me`: "My Developers", "My Projects",
 * "Pending Notifications". For the founder, who created everything, that read
 * as the whole organization by accident. For a second admin who joined later it
 * read 0, 0, 0 — an empty product with a full database behind it. And the third
 * card duplicated the bell in the topbar.
 *
 * So the scope is now the ORGANIZATION, and every panel answers a question an
 * admin actually opens this screen with: what is late, who is buried, what is
 * waiting on my decision, what broke.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 *   Money.    Revenue, invoices and plan spend live on Billing, which is
 *             owner/admin/finance. This screen is also seen by HR. An
 *             operations dashboard that quietly carries financials is how a
 *             number reaches somebody who was never meant to see it.
 *   Profile.  "How your account appears to your team" moved out. It says who
 *             you are, not how the work is going, and Account already owns it.
 *
 * EVERY PANEL IS A DOOR, and every door is role-checked — see the note in
 * overviewPanels.jsx. HR sees the counts and does not see links to screens the
 * middleware would bounce them from.
 *
 * ONE SNAPSHOT. All of it comes from a single load (utils/adminOverview.js, 8
 * queries, counted), so the KPI row and the tables underneath it can never
 * disagree about how many projects there are.
 */

const REFRESH_MS = 60_000;

/** How many rows each panel shows before it defers to the screen that owns it. */
const PREVIEW = 5;

export default function DashboardOverview({ user }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState(null);

  const role = getOrgContext()?.role || null;
  const can = useCallback((section) => canAccessAdminSection(section, role), [role]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const orgId = getOrgId();
      const snapshot = await loadAdminOverview(orgId, {
        adminId: user?.id || null,
        adminEmail: user?.email || null,
      });
      setData(snapshot);
    } catch (e) {
      setError(e?.message || "Could not load the dashboard.");
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  }, [user?.id, user?.email]);

  useEffect(() => {
    load();
    // Paused while the tab is hidden. This is eight queries; running them at a
    // wall nobody is looking at is the most expensive kind of idle.
    return setVisibleInterval(load, REFRESH_MS);
  }, [load]);

  const view = useMemo(() => {
    if (!data) return null;
    const { graph, proposals, activity, notifications } = data;
    return {
      kpis: overviewKpis({ graph, proposals }),
      projects: projectRows(graph),
      people: peopleRows(graph),
      tasks: taskBuckets(graph),
      bugs: bugSummary(graph),
      proposals,
      activity,
      notifications,
      graph,
    };
  }, [data]);

  const showSkeleton = !hasLoaded;

  return (
    <div className="space-y-6">
      <PageHeader
        title={sectionTitle("overview", "admin")}
        /* A subtitle was removed from this header once, for restating the word
           above it and carrying a ticking clock. This one states the SCOPE,
           which is the thing that actually changed and the thing "Overview"
           does not say: these numbers are the whole company's, not yours. */
        description="Company-wide — every project, person and queue in your organization."
        actions={
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw
              className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`}
              aria-hidden="true"
            />
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        }
      />

      {/* ABOVE the counters, deliberately. Everything below this line reports a
          number; this reads the numbers and says what needs doing. */}
      <SignalsPanel />

      {error && !loading ? (
        <ErrorState title="Couldn't load the dashboard" description={error} onRetry={load} />
      ) : (
        <>
          <KpiRow kpis={view?.kpis} loading={showSkeleton} can={can} />

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <div className="space-y-5 xl:col-span-2">
              <ProjectsPanel rows={view?.projects} loading={showSkeleton} can={can} />
              <TasksPanel buckets={view?.tasks} loading={showSkeleton} can={can} />
              <PeoplePanel rows={view?.people} loading={showSkeleton} can={can} />
              <HierarchyPanel view={view} loading={showSkeleton} can={can} />
            </div>

            <div className="space-y-5">
              <ProposalsPanel proposals={view?.proposals} loading={showSkeleton} can={can} />
              <QaPanel summary={view?.bugs} loading={showSkeleton} can={can} />
              <NotificationsPanel rows={view?.notifications} loading={showSkeleton} />
              <ActivityPanel rows={view?.activity} graph={view?.graph} loading={showSkeleton} />
              <ReportsPanel view={view} loading={showSkeleton} can={can} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * KPIs
 * ------------------------------------------------------------------ */

/**
 * The six headline numbers, each one a link to the screen that explains it.
 *
 * `invertTrend` is not used and no trend is passed: nothing here is measured
 * against a previous period, and an arrow drawn from a number the code invented
 * is worse than no arrow. `hint` carries real context instead.
 */
function KpiRow({ kpis, loading, can }) {
  const k = kpis || {};
  const tiles = [
    {
      title: "Total projects",
      value: k.totalProjects ?? 0,
      icon: FolderKanban,
      tone: "primary",
      href: "/admin/dashboard?section=all-projects",
      section: "all-projects",
      hint: `${k.activeProjects ?? 0} still in flight`,
    },
    {
      title: "Active projects",
      value: k.activeProjects ?? 0,
      icon: Activity,
      tone: "info",
      href: "/admin/dashboard?section=all-projects",
      section: "all-projects",
      hint: "Not completed, closed or cancelled",
    },
    {
      title: "Pending proposals",
      value: k.pendingProposals ?? 0,
      icon: Inbox,
      tone: k.pendingProposals > 0 ? "warning" : "muted",
      href: "/admin/dashboard?section=requests",
      section: "requests",
      hint: "Waiting on your decision",
    },
    {
      title: "Team members",
      value: k.teamMembers ?? 0,
      icon: Users,
      tone: "primary",
      href: "/admin/dashboard?section=employees",
      section: "employees",
      hint: "Active memberships",
    },
    {
      title: "Overdue tasks",
      value: k.overdueTasks ?? 0,
      icon: AlertOctagon,
      tone: k.overdueTasks > 0 ? "destructive" : "success",
      href: "/admin/dashboard?section=views",
      section: "views",
      hint: "Past their due date, still open",
    },
    {
      title: "At-risk projects",
      value: k.atRiskProjects ?? 0,
      icon: TriangleAlert,
      tone: k.atRiskProjects > 0 ? "warning" : "success",
      href: "/admin/dashboard?section=project-hub",
      section: "project-hub",
      hint: "Late, slipping, or on hold",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {tiles.map((t) => {
        const card = (
          <StatCard
            title={t.title}
            value={t.value}
            icon={t.icon}
            tone={t.tone}
            hint={<span className="text-muted-foreground">{t.hint}</span>}
            loading={loading}
          />
        );
        // The whole tile is the target when the viewer may follow it, which is
        // a far bigger hit area than a link inside it — and nothing at all when
        // they may not, rather than a link that bounces.
        return can(t.section) && !loading ? (
          <Link
            key={t.title}
            href={t.href}
            className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {card}
          </Link>
        ) : (
          <div key={t.title}>{card}</div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * All projects
 * ------------------------------------------------------------------ */

function ProjectsPanel({ rows, loading, can }) {
  const list = (rows || []).slice(0, PREVIEW);
  return (
    <Panel>
      <PanelHead
        title="All projects"
        hint="Riskiest first, then by how soon they are due."
        href="/admin/dashboard?section=all-projects"
        canOpen={can("all-projects")}
      />
      {loading ? (
        <RowsSkeleton rows={4} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description="Accept a client proposal or create a project to see it here."
        />
      ) : (
        <ul className="divide-y divide-border">
          {list.map((p) => (
            <li key={p.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-foreground" title={p.name}>
                      {p.name}
                    </span>
                    <ProjectStatus meta={p.statusMeta} />
                    <PriorityChip value={p.priority} />
                  </div>
                  <div className="mt-1.5">
                    <PersonChip person={p.manager} sublabel="Project manager" />
                  </div>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Deadline date={p.deadline} daysLeft={p.daysLeft} />
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {p.openTasks} open
                    {p.overdueTasks > 0 && (
                      <span className="ml-1 font-semibold text-destructive">
                        · {p.overdueTasks} overdue
                      </span>
                    )}
                  </span>
                </div>
              </div>

              <Meter className="mt-2.5" value={p.progress} label={`${p.name} progress`} />

              {p.risks.length > 0 && (
                <div className="mt-2">
                  <RiskChip reasons={p.risks} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <MoreRow shown={list.length} total={rows?.length} noun="project" />
    </Panel>
  );
}


/* ------------------------------------------------------------------ *
 * Tasks & deadlines
 * ------------------------------------------------------------------ */

function TasksPanel({ buckets, loading, can }) {
  const b = buckets || {};
  return (
    <Panel>
      <PanelHead
        title="Tasks & deadlines"
        hint="Across every project."
        href="/admin/dashboard?section=views"
        canOpen={can("views")}
      />
      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[76px] rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {TASK_BUCKETS.map((bucket) => (
              <BucketTile
                key={bucket.id}
                label={bucket.label}
                value={(b[bucket.id] || []).length}
                tone={bucket.tone}
                href="/admin/dashboard?section=views"
                canOpen={can("views")}
              />
            ))}
          </div>
          {/* Said on screen, not only in the source: this product has no
              `blocked` status (the lifecycle is pending → in_progress →
              awaiting_approval → reviewed → completed/rejected), so "Sent back"
              is rejected work its author has to pick up again — not work
              waiting on a dependency. */}
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Sent back</span> is work a reviewer
            rejected. There is no separate “blocked” state — nothing records what a task is
            waiting on.
          </p>
        </>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * Team & workload — ONE table, not two
 * ------------------------------------------------------------------ */

function PeoplePanel({ rows, loading, can }) {
  const list = (rows || []).slice(0, PREVIEW);
  return (
    <Panel>
      <PanelHead
        title="Team & workload"
        hint="Who is here, what they carry, and how much of it is late."
        href="/admin/dashboard?section=capacity"
        canOpen={can("capacity")}
      />
      {loading ? (
        <RowsSkeleton rows={4} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nobody here yet"
          description="Add an employee to see their workload."
        />
      ) : (
        <ul className="divide-y divide-border">
          {list.map((p) => (
            <li key={p.userId} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5 text-xs font-semibold text-primary"
              >
                {initialsOf(p.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">{p.name}</span>
                <span className="block truncate text-xs capitalize text-muted-foreground">
                  {String(p.role || "").replace(/_/g, " ")}
                  {p.projectCount > 0 && (
                    <> · {p.projectCount} {p.projectCount === 1 ? "project" : "projects"}</>
                  )}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-semibold tabular-nums text-foreground">
                  {p.openTasks}
                </span>
                <span className="block text-[11px] text-muted-foreground">open</span>
              </span>
              {/* The label AND the count, always. The thresholds behind "Heavy"
                  are a convention, not a measurement — nothing here records how
                  long a task takes — so the reader must be able to disagree
                  with the word by reading the number beside it. */}
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                  LEVEL_CHIP[p.level?.tone] || LEVEL_CHIP.muted
                }`}
                title={p.overdue > 0 ? `${p.overdue} overdue` : undefined}
              >
                {p.level?.label || "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <MoreRow shown={list.length} total={rows?.length} noun="person" plural="people" />
    </Panel>
  );
}

const LEVEL_CHIP = {
  muted: "bg-muted text-muted-foreground",
  success: "bg-success/10 text-success",
  info: "bg-info/10 text-info",
  warning: "bg-warning/10 text-warning",
  error: "bg-destructive/10 text-destructive",
};

/* ------------------------------------------------------------------ *
 * Project hierarchy
 * ------------------------------------------------------------------ */

/**
 * Project → manager → team, compact.
 *
 * A preview, NOT a second org chart. Team Structure draws the real one with
 * connecting lines and collapsible role branches; duplicating that here would
 * be a second implementation of the same geometry to fall out of step. This
 * shows the top project and the shape of its team, and hands over.
 *
 * The roles are grouped from the same `projectTeam` helper Team Structure uses,
 * so the two can never disagree about who is on a project.
 */
function HierarchyPanel({ view, loading, can }) {
  const graph = view?.graph;
  const project = view?.projects?.[0];
  const source = project && graph ? graph.projectById?.get(String(project.id)) : null;
  const team = source && graph ? projectTeam(source, graph) : null;

  const byRole = useMemo(() => {
    const groups = new Map();
    // `projectTeam` returns { manager, team, tasks } and has already REMOVED
    // the manager from `team` — every screen renders them above it, and
    // leaving them in both places is how a two-person project reports three.
    for (const member of team?.team || []) {
      const key = member.role || "member";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(member);
    }
    return Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [team]);

  return (
    <Panel>
      <PanelHead
        title="Project hierarchy"
        hint="Project → manager → team, by role."
        href="/admin/dashboard?section=hierarchy"
        canOpen={can("hierarchy")}
      >
        Open org chart
      </PanelHead>

      {loading ? (
        <RowsSkeleton rows={3} />
      ) : !project ? (
        <EmptyState
          icon={Network}
          title="Nothing to chart yet"
          description="A project with people on it will appear here."
        />
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{project.name}</span>
              <ProjectStatus meta={project.statusMeta} />
            </div>
          </div>

          {/* The trunk. A real line, not a gap — the same device the full org
              chart uses, so the preview reads as the same drawing. */}
          <div className="ml-5 border-l border-border pl-5">
            <div className="relative -ml-[21px] flex items-center gap-3">
              <span aria-hidden="true" className="h-px w-4 bg-border" />
              <PersonChip person={team?.manager} sublabel="Project manager" />
            </div>

            {byRole.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Nobody is assigned to this project yet.
              </p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {byRole.map(([role, members]) => (
                  <li key={role} className="relative -ml-[21px] flex items-start gap-3">
                    <span aria-hidden="true" className="mt-3.5 h-px w-4 shrink-0 bg-border" />
                    <div className="min-w-0 flex-1 rounded-lg border border-border bg-card p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold capitalize text-muted-foreground">
                          {String(role).replace(/_/g, " ")}
                        </span>
                        <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                          {members.length}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {members.slice(0, 6).map((m) => (
                          <span
                            key={m.userId}
                            className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs text-foreground"
                          >
                            <span aria-hidden="true" className="font-semibold text-primary">
                              {initialsOf(m.name)}
                            </span>
                            <span className="max-w-[10rem] truncate">{m.name}</span>
                          </span>
                        ))}
                        {members.length > 6 && (
                          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            +{members.length - 6}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {view?.projects?.length > 1 && (
            <p className="text-xs text-muted-foreground">
              Showing the project that needs attention most. {view.projects.length - 1} other{" "}
              {view.projects.length - 1 === 1 ? "project" : "projects"} on the org chart.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * Proposals
 * ------------------------------------------------------------------ */

function ProposalsPanel({ proposals, loading, can }) {
  const counts = useMemo(() => {
    const out = {};
    for (const bucket of PROPOSAL_BUCKETS) {
      out[bucket.id] = (proposals || []).filter((p) => bucket.statuses.includes(p.status)).length;
    }
    return out;
  }, [proposals]);

  const waiting = (proposals || [])
    .filter((p) => PROPOSAL_BUCKETS[0].statuses.includes(p.status))
    .slice(0, 3);

  return (
    <Panel>
      <PanelHead
        title="Proposals"
        hint="Grouped by whose move it is."
        href="/admin/dashboard?section=requests"
        canOpen={can("requests")}
      />
      {loading ? (
        <RowsSkeleton rows={3} />
      ) : (
        <>
          <ul className="space-y-1.5">
            {PROPOSAL_BUCKETS.map((bucket) => (
              <li
                key={bucket.id}
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/50"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">{bucket.label}</span>
                  <span className="block text-xs text-muted-foreground">{bucket.hint}</span>
                </span>
                <span className="shrink-0 text-lg font-bold tabular-nums text-foreground">
                  {counts[bucket.id]}
                </span>
              </li>
            ))}
          </ul>

          {waiting.length > 0 && (
            <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
              {waiting.map((p) => (
                <li key={p.id} className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-sm text-foreground" title={p.title}>
                    {p.title || "Untitled proposal"}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{ago(p.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * QA & issues
 * ------------------------------------------------------------------ */

function QaPanel({ summary, loading, can }) {
  const s = summary || {};
  return (
    <Panel>
      <PanelHead
        title="QA & issues"
        hint="Bugs are tasks with a type, not a separate list."
        href="/admin/dashboard?section=bugs"
        canOpen={can("bugs")}
      />
      {loading ? (
        <Skeleton className="h-[76px] rounded-lg" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <BucketTile
              label="Open bugs"
              value={s.open ?? 0}
              tone={s.open > 0 ? "error" : "success"}
              href="/admin/dashboard?section=bugs"
              canOpen={can("bugs")}
            />
            <BucketTile
              label="Waiting on QA"
              value={s.inQa ?? 0}
              tone={s.inQa > 0 ? "warning" : "muted"}
              href="/admin/dashboard?section=task-reviews"
              canOpen={can("task-reviews")}
            />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            A bug is closed in <span className="font-medium text-foreground">Task Reviews</span>,
            where the retest is recorded — not on the Bugs queue.
          </p>
        </>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * Notifications
 * ------------------------------------------------------------------ */

function NotificationsPanel({ rows, loading }) {
  const list = rows || [];
  return (
    <Panel>
      <PanelHead title="Your notifications" hint="Unread, newest first." href="/notifications" />
      {loading ? (
        <RowsSkeleton rows={3} />
      ) : list.length === 0 ? (
        <EmptyState icon={Bell} title="Nothing unread" description="You are up to date." />
      ) : (
        <ul className="space-y-2.5">
          {list.slice(0, 4).map((n) => (
            <li key={n.id} className="flex gap-2.5">
              <span
                aria-hidden="true"
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
              />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">
                  {n.title || "Notification"}
                </span>
                {n.message && (
                  <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">
                    {n.message}
                  </span>
                )}
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {ago(n.created_at)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * Recent activity
 * ------------------------------------------------------------------ */

/** `pm_activity.action` is a snake_case verb. Rendered as a sentence, not a slug. */
function humanAction(action) {
  return String(action || "")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

function ActivityPanel({ rows, graph, loading }) {
  const list = rows || [];
  return (
    <Panel>
      <PanelHead title="Recent activity" hint="The last things that happened." />
      {loading ? (
        <RowsSkeleton rows={4} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="Nothing recorded yet"
          description="Project and task actions will appear here as they happen."
        />
      ) : (
        <ul className="space-y-2.5">
          {list.slice(0, 6).map((a) => {
            const project = a.project_id ? graph?.projectById?.get(String(a.project_id)) : null;
            const actor = a.actor_id ? graph?.personById?.get(String(a.actor_id)) : null;
            return (
              <li key={a.id} className="flex gap-2.5 text-sm">
                <span
                  aria-hidden="true"
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50"
                />
                <span className="min-w-0">
                  <span className="block text-foreground">
                    {humanAction(a.action)}
                    {project && (
                      <span className="text-muted-foreground"> · {project.name}</span>
                    )}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {actor ? `${actor.name} · ` : ""}
                    {ago(a.created_at)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * Reports
 * ------------------------------------------------------------------ */

/**
 * Three numbers and a door.
 *
 * Not a chart. Reports & Analytics already draws delivery, workload, time and
 * delay across the organization, and a second smaller version of the same chart
 * here would be a chart nobody can act on next to a link to the one they can.
 */
function ReportsPanel({ view, loading, can }) {
  const projects = view?.projects || [];
  const done = projects.filter((p) => ["completed", "closed"].includes(p.status)).length;
  const onTime = projects.filter((p) => p.risks.length === 0).length;
  const avg = projects.length
    ? Math.round(projects.reduce((s, p) => s + p.progress, 0) / projects.length)
    : 0;

  return (
    <Panel>
      <PanelHead
        title="Performance"
        hint="Headlines only."
        href="/admin/dashboard?section=reports"
        canOpen={can("reports")}
      >
        Full reports
      </PanelHead>
      {loading ? (
        <RowsSkeleton rows={3} />
      ) : (
        <ul className="space-y-2.5">
          <StatLine label="Average project progress" value={`${avg}%`} />
          <StatLine label="Projects on track" value={`${onTime} of ${projects.length}`} />
          <StatLine label="Delivered" value={done} />
        </ul>
      )}
    </Panel>
  );
}

function StatLine({ label, value }) {
  return (
    <li className="flex items-baseline justify-between gap-3 border-b border-border pb-2.5 last:border-0 last:pb-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-foreground">{value}</span>
    </li>
  );
}

/* ------------------------------------------------------------------ *
 * Shared bits
 * ------------------------------------------------------------------ */

function RowsSkeleton({ rows = 3 }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * "Showing 5 of 12".
 *
 * A truncated list that does not say it is truncated reads as the whole set,
 * which is how somebody concludes there are five projects when there are
 * twelve. Silent capping is the failure; saying so is the fix.
 */
function MoreRow({ shown, total, noun, plural }) {
  const count = Number(total) || 0;
  if (count <= shown) return null;
  const word = count === 1 ? noun : plural || `${noun}s`;
  return (
    <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
      Showing {shown} of {count} {word}.
    </p>
  );
}
