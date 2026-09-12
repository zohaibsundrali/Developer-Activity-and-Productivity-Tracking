"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { Activity, BarChart3, Keyboard, Users } from "lucide-react";

import {
  Badge,
  EmptyState,
  ErrorState,
  PageHeader,
  Section,
  Skeleton,
} from "@/components/ui";
import StatCard from "@/components/shell/StatCard";
import KeyboardCoverageNotice from "@/components/shared/KeyboardCoverageNotice";
import { authFetch } from "@/utils/authFetch";
import { allowed } from "@/utils/permissions";
import { myActivityPanels, loadMyTypedTeam } from "@/utils/monitoringUiAccess";
import { supabase } from "@/utils/supabaseClient";
import { getOrgContext } from "@/utils/orgContext";

/**
 * My Activity — the last three `*_own` keys that had a permission and no screen.
 *
 * WHAT THIS FINISHES. PR #74 introduced nine `*_own` keys because `user_type`
 * was standing in for authorization and there was no way to say "your own
 * work" as a permission. Six of them got a surface at the time. Three did not:
 *
 *   productivity.view_own   your own delivery metrics
 *   monitoring.view_own     your own recorded activity
 *   team.view_own           who else is on your projects
 *
 * A key with no screen is the exact fault #74 existed to fix, and it has been
 * listed as open in every pull request since. This is the screen.
 *
 * THE BACKEND WAS ALREADY DONE. /api/productivity falls back to
 * `productivity.view_own` and scopes to the caller's own identity from the
 * token; /api/keyboard-stats self-scopes when the caller has no
 * `monitoring.view`. Both were written in #74. Nothing here asks for a wider
 * key than the person already holds, and nothing here passes an identity — the
 * routes take it from the JWT.
 *
 * WHY THE TEAM LIST IS TWO CLIENT QUERIES AND NOT A ROUTE. `project_members`
 * is readable org-wide by any non-client member, and 071 says why in its own
 * words: "knowing who is on which project is ordinary workplace information".
 * So filtering to YOUR projects here is for relevance, not for secrecy — there
 * is nothing to protect that RLS is not already protecting, and a route that
 * added no rule would only add a place for one to go missing.
 */

const pct = (v) => (v === null || v === undefined ? "—" : `${Math.round(Number(v))}%`);

export default function MyActivity() {
  const panels = myActivityPanels(allowed);
  const context = getOrgContext();
  const scope = `${context?.organizationId}:${context?.userType}:${context?.userId}:${panels.productivity}:${panels.activity}:${panels.team}`;
  const liveScope = useRef(scope); liveScope.current = scope;
  const generation = useRef(0);
  const [loadedScope, setLoadedScope] = useState(null);
  const [productivity, setProductivity] = useState(null);
  const [activity, setActivity] = useState(null);
  const [team, setTeam] = useState(null);
  const [loading, setLoading] = useState(true);
  /** Which panels could not load, so a partial screen says which part is missing. */
  const [failed, setFailed] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    const missing = [];
    const ticket = ++generation.current;
    const active = () => ticket === generation.current && liveScope.current === scope;
    setProductivity(null); setActivity(null); setTeam(null); setFailed([]);

    // keyboard-stats is a ranged query — it answers 400 without a start/end, so
    // "no window" left the Recorded activity panel dead for every role. Ask for
    // the last 30 days; the panel prints back the range it received.
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    const activityWindow = `start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`;

    // Each panel fails on its own. One dead endpoint should not blank a screen
    // whose other two thirds are fine — and saying WHICH third is missing is
    // the difference between a bug report and a shrug.
    const [prodRes, actRes] = await Promise.allSettled([
      panels.productivity ? authFetch("/api/productivity?type=developer") : Promise.resolve(null),
      panels.activity ? authFetch(`/api/keyboard-stats?${activityWindow}`) : Promise.resolve(null),
    ]);

    if (!active()) return;
    if (panels.productivity) try {
      if (prodRes.status !== "fulfilled") throw new Error("unreachable");
      const json = await prodRes.value.json().catch(() => ({}));
      if (!prodRes.value.ok || !json?.success) throw new Error(json?.error || "failed");
      if (!active()) return;
      setProductivity(json);
    } catch {
      if (!active()) return;
      setProductivity(null);
      missing.push("your delivery metrics");
    }

    if (panels.activity) try {
      if (actRes.status !== "fulfilled") throw new Error("unreachable");
      const json = await actRes.value.json().catch(() => ({}));
      if (!actRes.value.ok) throw new Error(json?.error || "failed");
      if (!active()) return;
      setActivity(json);
    } catch {
      if (!active()) return;
      setActivity(null);
      missing.push("your recorded activity");
    }

    if (panels.team) try {
      const result = await loadMyTypedTeam(supabase, getOrgContext());
      if (!active()) return;
      setTeam(result);
    } catch {
      if (!active()) return;
      setTeam(null); missing.push('your team');
    }
    if (!active()) return;
    setLoadedScope(scope);
    setFailed(missing);
    setLoading(false);
  }, [scope, panels.productivity, panels.activity, panels.team]);

  useEffect(() => {
    load();
    return () => { generation.current += 1; };
  }, [load]);

  const byProject = useMemo(() => {
    const map = new Map();
    for (const row of team || []) {
      const name = row.projects?.name || "Project";
      if (!map.has(row.project_id)) map.set(row.project_id, { id: row.project_id, name, members: [] });
      map.get(row.project_id).members.push(row);
    }
    return [...map.values()];
  }, [team]);

  const keystrokes = useMemo(() => {
    const rows = activity?.data || [];
    return rows.reduce((sum, r) => sum + (Number(r.keystrokes ?? r.key_count ?? 0) || 0), 0);
  }, [activity]);

  if (loading || loadedScope !== scope) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  // Only when EVERY panel failed. Two out of three working is a screen worth
  // showing, with a line saying what is not on it.
  if (failed.length > 0 && failed.length === Object.values(panels).filter(Boolean).length) {
    return (
      <ErrorState
        title="Nothing could be loaded"
        description="Your permitted activity panels could not be loaded. Retry or check your access."
        onRetry={load}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Activity"
        description="Your delivery metrics, your recorded activity, and who you are working alongside."
      />

      {failed.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Could not load {failed.join(" or ")}. The rest of this screen is fine.
        </div>
      )}

      {panels.productivity && productivity && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Productivity"
              value={pct(productivity.productivityPercentage)}
              icon={BarChart3}
              hint="Completed on time against everything assigned"
            />
            <StatCard title="Projects" value={productivity.totalProjects ?? 0} icon={Users} />
            <StatCard title="Completed" value={productivity.totalCompleted ?? 0} icon={Activity} />
            <StatCard
              title="Still open"
              value={productivity.totalPending ?? 0}
              icon={Activity}
              tone="muted"
            />
          </div>

          {Array.isArray(productivity.projectsBreakdown) &&
            productivity.projectsBreakdown.length > 0 && (
              <Section title="By project">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">Project</th>
                        <th className="py-2 pr-4 font-medium">Tasks</th>
                        <th className="py-2 pr-4 font-medium">Completed</th>
                        <th className="py-2 pr-4 font-medium">Open</th>
                        <th className="py-2 pr-4 font-medium">Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {productivity.projectsBreakdown.map((p) => (
                        <tr key={p.projectId} className="border-b border-border/60">
                          <td className="py-2 pr-4 text-foreground">{p.projectName || "Project"}</td>
                          <td className="py-2 pr-4 tabular-nums">{p.totalTasks}</td>
                          <td className="py-2 pr-4 tabular-nums">{p.completed}</td>
                          <td className="py-2 pr-4 tabular-nums text-muted-foreground">{p.pending}</td>
                          <td className="py-2 pr-4 tabular-nums">{pct(p.productivityPercentage)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            )}
        </>
      )}

      {panels.activity && <Section
        title="Recorded activity"
        description="What the desktop tracker has recorded against your account."
      >
        <KeyboardCoverageNotice truncated={activity?.truncated} loadedCount={activity?.data?.length ?? 0} />
        {failed.includes("your recorded activity") ? <ErrorState description="Could not load your recorded activity." onRetry={load} /> : !activity || (activity.data || []).length === 0 ? (
          <EmptyState
            icon={Keyboard}
            title="Nothing recorded"
            description="Activity appears here when the desktop tracker is running and signed in as you. Nothing is recorded from this browser."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard title="Loaded activity records" value={activity.data.length} icon={Activity} />
            <StatCard
              title={activity.truncated === true ? "Keystrokes in loaded records" : "Keystrokes"}
              value={keystrokes.toLocaleString()}
              icon={Keyboard}
              hint={
                activity.dateRange
                  ? `${activity.dateRange.start?.slice(0, 10)} — ${activity.dateRange.end?.slice(0, 10)}`
                  : undefined
              }
            />
          </div>
        )}
      </Section>}

      {panels.team && <Section
        title="Who I am working with"
        description="Everybody on the projects you are a member of."
      >
        {failed.includes("your team") ? <ErrorState description="Could not load your team." onRetry={load} /> : !team || byProject.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No project team yet"
            description="You appear here once you are added to a project alongside somebody else."
          />
        ) : (
          <div className="space-y-4">
            {byProject.map((p) => (
              <div key={p.id} className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium text-foreground">{p.name}</p>
                <ul className="mt-2 space-y-1">
                  {p.members.map((m) => (
                    <li
                      key={`${p.name}-${m.user_type}-${m.user_id}`}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="min-w-0 truncate text-foreground">
                        {/* An email is a poor name and a real one. Falling back
                            to the uuid would be worse than saying nothing. */}
                        {m.email || "Someone on this project"}
                        {m.isMe && <span className="ml-2 text-xs text-muted-foreground">you</span>}
                      </span>
                      <Badge variant="outline">{m.project_role}</Badge>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  {p.members.length} {p.members.length === 1 ? "person" : "people"} on this project
                </p>
              </div>
            ))}
          </div>
        )}
      </Section>}
    </div>
  );
}
