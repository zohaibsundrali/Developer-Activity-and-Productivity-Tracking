"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Users,
  Building2,
  Activity,
  TrendingUp,
  Clock,
  BarChart3,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { getOrgId } from "@/utils/orgContext";
import { loadEmployees } from "@/utils/employeesData";
import { supabase } from "@/utils/supabaseClient";
import StatCard from "@/components/shell/StatCard";
import { ShareBar, LeaderRow } from "@/components/admin/statViz";
import { sectionTitle } from "@/components/shell/sectionTitles";
import {
  PageHeader,
  Section,
  EmptyState,
  ErrorState,
  Button,
  Skeleton,
} from "@/components/ui";

/**
 * Admin "Team Stats" — organization-wide team / department / attendance /
 * performance overview. Self-loading; renders defensively so missing tables,
 * columns, or query errors degrade to friendly empty states rather than crash.
 */

// Pretty role/label helper: snake_case -> Title Case.
const prettyLabel = (s) =>
  String(s || "")
    .split("_")
    .map((w) => (w[0] ? w[0].toUpperCase() : "") + w.slice(1))
    .join(" ");

// Pick the first defined timestamp on a login row (login_time OR created_at).
const loginTs = (row) => row?.login_time || row?.created_at || null;

// Resolve a login row's developer identity to either an id or a lowercased email.
const loginDevId = (row) =>
  row?.developer_id != null && row.developer_id !== ""
    ? String(row.developer_id)
    : null;
const loginEmail = (row) =>
  row?.developer_email ? String(row.developer_email).toLowerCase() : null;

function isSameLocalDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export const pct = (part, whole) =>
  whole > 0 ? Math.round((part / whole) * 100) : 0;

/**
 * Group counts -> ranked rows carrying the ONE percentage this panel means:
 * each bucket's share of the whole population.
 *
 * The share is computed here, once, and is both what the row prints and what
 * the bar is drawn to. Previously the label printed share-of-headcount while
 * the bar was scaled to the largest bucket, so a two-person org with one Owner
 * and one Developer printed "50%" beside two bars that were each drawn full
 * width — the panel stating two different numbers about the same row.
 *
 * A "relative to the biggest bucket" bar is a legitimate chart, but only when
 * nothing on the row claims to be a percentage of anything else. This panel is
 * described as "Share of headcount in each role", so share is the scale.
 */
export function distributionRows(counts, total) {
  return Array.from(counts instanceof Map ? counts.entries() : Object.entries(counts || {}))
    .map(([key, count]) => ({ key, count, share: pct(count, total) }))
    .sort((a, b) => b.count - a.count);
}

/*
 * `BarRow` USED TO LIVE HERE, and both panels that used it — by role, by
 * department — now draw a <ShareBar> instead. It is deleted rather than left
 * exported "in case": nothing imports it, and an exported component with no
 * caller is invisible to lint and to the eye, so it survives until somebody
 * copies it.
 *
 * The guarantee it carried is NOT deleted. Its whole reason for existing was
 * that the bar had to be drawn to the share it printed — a two-person org with
 * one Owner and one Developer once printed "50%" beside two full-width bars.
 * ShareBar keeps that property by construction (segment width and legend
 * percentage are the same call), and the assertions that measured it moved
 * with it — see tests/progressBarWidths.test.js.
 */

/** Chart-shaped skeleton: a few label/bar pairs. */
function ChartSkeleton({ rows = 4 }) {
  return (
    <ul className="space-y-4">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i}>
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-10" />
          </div>
          <Skeleton className="mt-1.5 h-2 w-full rounded-full" />
        </li>
      ))}
    </ul>
  );
}

export default function TeamStats() {
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [teams, setTeams] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [logins, setLogins] = useState([]);
  // Real attendance rows for today (migration 075). Empty for an organization
  // that has not started recording, which is what the fallback below is for.
  const [attendance, setAttendance] = useState([]);
  const [metrics, setMetrics] = useState([]);
  // Which of the three sources threw. Purely for the error state — every
  // fallback below is exactly what it was before.
  const [failedSources, setFailedSources] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    const orgId = getOrgId();
    const failed = [];

    // Employees / teams / departments — loadEmployees already returns safe
    // defaults, but wrap defensively in case of an unexpected throw.
    let emp = [];
    let tms = [];
    let depts = [];
    try {
      const res = await loadEmployees(orgId);
      emp = res?.employees || [];
      tms = res?.teams || [];
      depts = res?.departments || [];
    } catch {
      emp = [];
      tms = [];
      depts = [];
      failed.push("employees");
    }

    // Attendance / online — developer_logins.
    //
    // This asked for every login row the organization had ever recorded, with
    // no date filter and no limit, to answer two questions that only ever look
    // at "the last 15 minutes" and "today". On a long-lived tenant that table
    // is one row per sign-in, forever. The window below is what the component
    // actually reads, and the columns are the ones this table really has —
    // developer_email and created_at do not exist on it.
    const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    let loginRows = [];
    try {
      const { data } = await supabase
        .from("developer_logins")
        .select("developer_id, login_time")
        .eq("organization_id", orgId)
        .gte("login_time", sinceIso)
        .order("login_time", { ascending: false })
        .limit(2000);
      loginRows = data || [];
    } catch {
      loginRows = [];
      failed.push("attendance");
    }

    // The REAL attendance table, which the login window above is only a proxy
    // for. Kept side by side rather than replacing it: an organization that has
    // not recorded a day yet would otherwise watch this number drop to zero on
    // the day 075 was applied, which reads as a bug rather than as an empty
    // table. Once they check in once, the real rows win.
    let attendanceRows = [];
    try {
      const todayKey = (() => {
        const d = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      })();
      const { data } = await supabase
        .from("attendance_records")
        .select("user_id, status")
        .eq("organization_id", orgId)
        .eq("work_date", todayKey)
        .limit(2000);
      attendanceRows = data || [];
    } catch {
      attendanceRows = [];
    }

    // Productivity metrics — aggregate per developer_id.
    //
    // The columns are `productivity_percentage` and `productivity_points`.
    // This used to ask for productivity_score / active_time / total_time,
    // none of which exist on this table, and PostgREST rejects the whole
    // request over any one of them. The try/catch did not help: supabase-js
    // RETURNS an error object rather than throwing, so `data` was null,
    // `metricRows` was [], and the panel reported "No productivity data yet"
    // no matter how much data the organization had.
    let metricRows = [];
    try {
      const { data } = await supabase
        .from("productivity_metrics")
        .select("developer_id, productivity_percentage, productivity_points")
        .eq("organization_id", orgId)
        .limit(5000);
      metricRows = data || [];
    } catch {
      metricRows = [];
      failed.push("productivity");
    }

    setEmployees(emp);
    setTeams(tms);
    setDepartments(depts);
    setLogins(loginRows);
    setAttendance(attendanceRows);
    setMetrics(metricRows);
    setFailedSources(failed);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ---- Derived data (all computed defensively) ----------------------------

  const now = Date.now();
  const FIFTEEN_MIN = 15 * 60 * 1000;
  const today = new Date();

  // Build quick lookups from employees for id/email -> employee.
  const empById = new Map();
  const empByEmail = new Map();
  for (const e of employees) {
    if (e?.userId != null) empById.set(String(e.userId), e);
    if (e?.email) empByEmail.set(String(e.email).toLowerCase(), e);
  }

  const matchEmployeeForLogin = (row) => {
    const id = loginDevId(row);
    if (id && empById.has(id)) return empById.get(id);
    const email = loginEmail(row);
    if (email && empByEmail.has(email)) return empByEmail.get(email);
    return null;
  };

  // A stable identity key for a login row (prefer id, else email).
  const loginKey = (row) => loginDevId(row) || loginEmail(row);

  // Online now: distinct developers with a login in the last 15 minutes.
  const onlineKeys = new Set();
  // Present today: distinct developers with any login on today's date.
  const presentKeys = new Set();
  for (const row of logins) {
    const ts = loginTs(row);
    if (!ts) continue;
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) continue;
    const key = loginKey(row);
    if (!key) continue;
    if (now - d.getTime() <= FIFTEEN_MIN) onlineKeys.add(key);
    if (isSameLocalDay(d, today)) presentKeys.add(key);
  }
  const onlineCount = onlineKeys.size;

  /**
   * PRESENT means "recorded as at work today", and falls back to "signed in
   * today" only while there is nothing recorded.
   *
   * These are two different questions and they had one answer. A sign-in cannot
   * see somebody who is at work with the app closed, and it counts somebody who
   * checked a notification at midnight. `attendance_records` is the answer to
   * the question the card actually asks; the login window stays as the answer
   * for a tenant that has not adopted the module yet, and the caption below
   * says which one is on screen so the number is never quietly ambiguous.
   */
  const recordedPresent = attendance.filter(
    (r) => r?.status === "present" || r?.status === "remote"
  ).length;
  const usingRecords = attendance.length > 0;
  const presentCount = usingRecords ? recordedPresent : presentKeys.size;

  const headcount = employees.length;
  const activeCount = employees.filter((e) => e?.status === "active").length;
  const deptCount = departments.length;
  const teamCount = teams.length;

  // Distribution by role.
  const roleCounts = new Map();
  for (const e of employees) {
    const r = e?.role || "unknown";
    roleCounts.set(r, (roleCounts.get(r) || 0) + 1);
  }
  const roleRows = distributionRows(roleCounts, headcount);

  // By department (join via departmentId, fall back to departmentName; the rest
  // are "Unassigned").
  const deptNameById = new Map(
    departments.map((d) => [String(d.id), d.name || "Department"])
  );
  const deptCounts = new Map();
  for (const e of employees) {
    let label = "Unassigned";
    if (e?.departmentId != null && deptNameById.has(String(e.departmentId))) {
      label = deptNameById.get(String(e.departmentId));
    } else if (e?.departmentName) {
      label = e.departmentName;
    }
    deptCounts.set(label, (deptCounts.get(label) || 0) + 1);
  }
  const deptRows = distributionRows(deptCounts, headcount);

  // Aggregate productivity metrics per developer_id.
  const metricAgg = new Map(); // devId -> { scoreSum, scoreN, pointsSum }
  for (const row of metrics) {
    const id = row?.developer_id != null ? String(row.developer_id) : null;
    if (!id) continue;
    const agg = metricAgg.get(id) || { scoreSum: 0, scoreN: 0, pointsSum: 0 };
    const score = Number(row?.productivity_percentage);
    if (Number.isFinite(score)) {
      agg.scoreSum += score;
      agg.scoreN += 1;
    }
    // Points, not time. This table records no duration at all, so the
    // tiebreaker is named for what it actually holds rather than for the
    // column the query used to imagine.
    const points = Number(row?.productivity_points);
    if (Number.isFinite(points)) agg.pointsSum += points;
    metricAgg.set(id, agg);
  }
  const hasMetrics = metricAgg.size > 0;

  // avg score for a developer id (or null when no score data).
  const avgScoreFor = (devId) => {
    const agg = metricAgg.get(String(devId));
    if (!agg || agg.scoreN === 0) return null;
    return agg.scoreSum / agg.scoreN;
  };
  const pointsFor = (devId) => {
    const agg = metricAgg.get(String(devId));
    return agg ? agg.pointsSum : 0;
  };

  // Team performance: member count + optional avg score.
  const teamPerf = teams.map((t) => {
    const members = employees.filter((e) => String(e?.teamId) === String(t.id));
    const scores = members
      .map((m) => avgScoreFor(m.userId))
      .filter((s) => s != null);
    const avg =
      scores.length > 0
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : null;
    return { id: t.id, name: t.name || "Team", count: members.length, avg };
  });

  // Productivity ranking: top 5 employees by aggregated score, else points.
  const rankRows = employees
    .map((e) => {
      const score = avgScoreFor(e.userId);
      const points = pointsFor(e.userId);
      return { name: e.name, score, points };
    })
    .filter((r) => r.score != null || r.points > 0)
    .sort((a, b) => {
      const as = a.score != null ? a.score : -1;
      const bs = b.score != null ? b.score : -1;
      if (bs !== as) return bs - as;
      return b.points - a.points;
    })
    .slice(0, 5);

  const attendancePct =
    headcount > 0 ? Math.round((presentCount / headcount) * 100) : 0;

  const maxTeamCount = teamPerf.reduce((m, t) => Math.max(m, t.count), 0);

  // ---- Render -------------------------------------------------------------

  const header = (
    <PageHeader
      title={sectionTitle("team-stats", "admin")}
      description="Organization-wide team, department, attendance & performance overview."
      actions={
        <Button
          variant="outline"
          onClick={load}
          disabled={loading}
          aria-label="Refresh team stats"
        >
          <RefreshCw
            className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          Refresh
        </Button>
      }
    />
  );

  // Loading — skeletons shaped like the stat row and the charts, so nothing
  // jumps when the numbers arrive.
  if (loading) {
    return (
      <div className="space-y-6">
        {header}

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="rounded-xl border border-border bg-card p-5 shadow-card"
            >
              <Skeleton className="h-11 w-11 rounded-xl" />
              <Skeleton className="mt-4 h-8 w-16" />
              <Skeleton className="mt-2 h-4 w-24" />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-xl border border-border bg-card p-5 shadow-card"
            >
              <Skeleton className="h-4 w-44" />
              <div className="mt-5">
                <ChartSkeleton rows={4} />
              </div>
            </div>
          ))}
        </div>

        <span className="sr-only" role="status">
          Loading team stats…
        </span>
      </div>
    );
  }

  // Everything that feeds this page comes from the directory. If that call
  // failed there is nothing to chart, so offer a retry instead of five empty
  // panels pretending the org has no people.
  if (failedSources.includes("employees") && headcount === 0) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState
          title="Couldn't load team stats"
          description="The employee directory could not be read, so none of these figures can be calculated."
          onRetry={load}
        />
      </div>
    );
  }

  const partialFailures = failedSources.filter((s) => s !== "employees");

  return (
    <div className="space-y-6">
      {header}

      {partialFailures.length > 0 && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-on-tint"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            {partialFailures.length === 1
              ? `The ${partialFailures[0]} data couldn't be loaded — those panels are empty.`
              : "Attendance and productivity data couldn't be loaded — those panels are empty."}
          </span>
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Retry
          </Button>
        </div>
      )}

      {/* Stat row */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <StatCard title="Headcount" value={headcount} icon={Users} tone="primary" />
        <StatCard title="Active" value={activeCount} icon={Activity} tone="success" />
        <StatCard title="Online now" value={onlineCount} icon={Clock} tone="info" />
        <StatCard title="Departments" value={deptCount} icon={Building2} tone="warning" />
        <StatCard title="Teams" value={teamCount} icon={Users} tone="primary" />
      </div>

      {/* Attendance today — the number an HR manager checks first. */}
      <Section
        title="Attendance today"
        description={
          usingRecords
            ? "People recorded as present or remote today."
            : "No attendance recorded yet — showing people with a sign-in since midnight."
        }
      >
        {headcount === 0 ? (
          <EmptyState
            icon={Clock}
            title="Nobody to track yet"
            description="Attendance appears here once the organization has employees."
          />
        ) : (
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-3xl font-bold tabular-nums text-foreground">
                {presentCount}
                <span className="ml-2 text-sm font-medium text-muted-foreground">
                  of {headcount} present
                </span>
              </p>
              <p className="text-sm font-semibold tabular-nums text-foreground">
                {attendancePct}%
              </p>
            </div>
            <div
              className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label="Attendance today"
              aria-valuenow={attendancePct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-150"
                style={{ width: `${attendancePct}%` }}
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
              <span>
                <span className="font-semibold tabular-nums text-foreground">
                  {onlineCount}
                </span>{" "}
                online in the last 15 minutes
              </span>
              {logins.length === 0 && <span>No login activity recorded.</span>}
            </div>
          </div>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Employee distribution by role */}
        <Section
          title="Distribution by role"
          description="Share of headcount in each role."
        >
          {roleRows.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No employees to summarize"
              description="Roles appear here as soon as people join the organization."
            />
          ) : (
            // A SHARE, drawn as one bar. It was a fourth stacked list of
            // identical rows; "how is the headcount divided" is a different
            // question from "who is ahead" and now looks different. The
            // Employees screen answers "how many of each" with its role tiles —
            // this answers "what proportion", which is why both earn a place.
            <ShareBar
              rows={roleRows.map((r) => ({
                key: r.key,
                label: prettyLabel(r.key),
                count: r.count,
              }))}
              total={headcount}
            />
          )}
        </Section>

        {/* By department */}
        <Section
          title="By department"
          description="Where people sit across the org."
        >
          {deptRows.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No department data"
              description="Assign departments on an employee's profile to populate this."
            />
          ) : (
            // The same question as "by role", asked of a different column, so
            // it is drawn the same way. Consistency is the point: two panels
            // answering "how is the whole divided" that look different suggest
            // they mean different things.
            <ShareBar
              rows={deptRows.map((d) => ({ key: d.key, label: d.key, count: d.count }))}
              total={headcount}
            />
          )}
        </Section>

        {/* Team performance */}
        <Section
          title="Team performance"
          description={
            hasMetrics
              ? "Members per team, with average productivity score where recorded."
              : "Members per team."
          }
        >
          {teamPerf.length === 0 ? (
            <EmptyState
              icon={TrendingUp}
              title="No teams configured"
              description="Create a team to compare size and performance side by side."
            />
          ) : (
            <ul className="space-y-4">
              {teamPerf.map((t) => (
                <li key={t.id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span
                      className="min-w-0 truncate text-sm text-foreground"
                      title={t.name}
                    >
                      {t.name}
                    </span>
                    <span className="flex shrink-0 items-baseline gap-3">
                      <span className="text-sm tabular-nums text-muted-foreground">
                        {t.count} {t.count === 1 ? "member" : "members"}
                      </span>
                      {t.avg != null && (
                        <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-primary">
                          {Math.round(t.avg)} avg
                        </span>
                      )}
                    </span>
                  </div>
                  <div
                    className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-label={`${t.name}: ${t.count} members`}
                    aria-valuenow={t.count}
                    aria-valuemin={0}
                    aria-valuemax={maxTeamCount || 1}
                  >
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-150"
                      style={{ width: `${pct(t.count, maxTeamCount)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Productivity ranking */}
        <Section
          title="Productivity ranking"
          description="Top five by average score, falling back to productivity points."
        >
          {rankRows.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="No productivity data yet"
              description="Rankings appear once tracked activity has been recorded for this organization."
            />
          ) : (
            <ol className="-mx-2 space-y-0.5">
              {rankRows.map((r, i) => (
                <LeaderRow
                  key={`${r.name}-${i}`}
                  rank={i + 1}
                  label={r.name || "Unnamed"}
                  initials={(r.name || "?").trim().slice(0, 2).toUpperCase()}
                  value={r.score != null ? Math.round(r.score) : Math.round(r.active)}
                  unit={r.score != null ? "score" : "active"}
                />
              ))}
            </ol>
          )}
        </Section>
      </div>
    </div>
  );
}
