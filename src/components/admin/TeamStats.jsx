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
} from "lucide-react";
import { getOrgId } from "@/utils/orgContext";
import { loadEmployees } from "@/utils/employeesData";
import { supabase } from "@/utils/supabaseClient";
import StatCard from "@/components/shell/StatCard";

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

export default function TeamStats() {
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [teams, setTeams] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [logins, setLogins] = useState([]);
  const [metrics, setMetrics] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    const orgId = getOrgId();

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
    }

    // Productivity metrics — aggregate per developer_id. Columns may be absent,
    // so read whatever of productivity_score / active_time / total_time exists.
    let metricRows = [];
    try {
      const { data } = await supabase
        .from("productivity_metrics")
        .select("developer_id, productivity_score, active_time, total_time")
        .eq("organization_id", orgId)
        .limit(5000);
      metricRows = data || [];
    } catch {
      metricRows = [];
    }

    setEmployees(emp);
    setTeams(tms);
    setDepartments(depts);
    setLogins(loginRows);
    setMetrics(metricRows);
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
  const presentCount = presentKeys.size;

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
  const roleRows = Array.from(roleCounts.entries())
    .map(([role, count]) => ({ role, count }))
    .sort((a, b) => b.count - a.count);
  const maxRoleCount = roleRows.reduce((m, r) => Math.max(m, r.count), 0);

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
  const deptRows = Array.from(deptCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  const maxDeptCount = deptRows.reduce((m, r) => Math.max(m, r.count), 0);

  // Aggregate productivity metrics per developer_id.
  const metricAgg = new Map(); // devId -> { scoreSum, scoreN, activeSum }
  for (const row of metrics) {
    const id = row?.developer_id != null ? String(row.developer_id) : null;
    if (!id) continue;
    const agg = metricAgg.get(id) || { scoreSum: 0, scoreN: 0, activeSum: 0 };
    const score = Number(row?.productivity_score);
    if (Number.isFinite(score)) {
      agg.scoreSum += score;
      agg.scoreN += 1;
    }
    const active = Number(row?.active_time);
    if (Number.isFinite(active)) agg.activeSum += active;
    metricAgg.set(id, agg);
  }
  const hasMetrics = metricAgg.size > 0;

  // avg score for a developer id (or null when no score data).
  const avgScoreFor = (devId) => {
    const agg = metricAgg.get(String(devId));
    if (!agg || agg.scoreN === 0) return null;
    return agg.scoreSum / agg.scoreN;
  };
  const activeTimeFor = (devId) => {
    const agg = metricAgg.get(String(devId));
    return agg ? agg.activeSum : 0;
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

  // Productivity ranking: top 5 employees by aggregated score, else active time.
  const rankRows = employees
    .map((e) => {
      const score = avgScoreFor(e.userId);
      const active = activeTimeFor(e.userId);
      return { name: e.name, score, active };
    })
    .filter((r) => r.score != null || r.active > 0)
    .sort((a, b) => {
      const as = a.score != null ? a.score : -1;
      const bs = b.score != null ? b.score : -1;
      if (bs !== as) return bs - as;
      return b.active - a.active;
    })
    .slice(0, 5);

  const attendancePct =
    headcount > 0 ? Math.round((presentCount / headcount) * 100) : 0;

  // ---- Render -------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary/30 border-t-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header + refresh */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <BarChart3 className="h-5 w-5 text-primary" />
            Team Stats
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Organization-wide team, department, attendance &amp; performance
            overview.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground shadow-card transition-colors hover:bg-muted"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <StatCard title="Headcount" value={headcount} icon={Users} tone="primary" />
        <StatCard title="Active" value={activeCount} icon={Activity} tone="success" />
        <StatCard title="Online now" value={onlineCount} icon={Clock} tone="info" />
        <StatCard title="Departments" value={deptCount} icon={Building2} tone="violet" />
        <StatCard title="Teams" value={teamCount} icon={Users} tone="warning" />
      </div>

      {/* Employee distribution by role */}
      <section className="rounded-xl border border-border bg-card p-5 shadow-card">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Users className="h-4 w-4 text-primary" />
          Employee distribution by role
        </h3>
        {roleRows.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No employees to summarize yet.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {roleRows.map((r) => {
              const pct =
                maxRoleCount > 0 ? Math.round((r.count / maxRoleCount) * 100) : 0;
              return (
                <li key={r.role}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-foreground">{prettyLabel(r.role)}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {r.count}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 w-full rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* By department */}
      <section className="rounded-xl border border-border bg-card p-5 shadow-card">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Building2 className="h-4 w-4 text-primary" />
          By department
        </h3>
        {deptRows.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No department data available.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {deptRows.map((d) => {
              const pct =
                maxDeptCount > 0 ? Math.round((d.count / maxDeptCount) * 100) : 0;
              return (
                <li key={d.name}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-foreground">{d.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {d.count}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 w-full rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Team performance */}
      <section className="rounded-xl border border-border bg-card p-5 shadow-card">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <TrendingUp className="h-4 w-4 text-primary" />
          Team performance
        </h3>
        {teamPerf.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No teams configured yet.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {teamPerf.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between py-2.5 text-sm first:pt-0 last:pb-0"
              >
                <span className="text-foreground">{t.name}</span>
                <span className="flex items-center gap-4 text-muted-foreground">
                  <span className="tabular-nums">
                    {t.count} {t.count === 1 ? "member" : "members"}
                  </span>
                  {t.avg != null && (
                    <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-primary">
                      {Math.round(t.avg)} avg
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Attendance today */}
      <section className="rounded-xl border border-border bg-card p-5 shadow-card">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Clock className="h-4 w-4 text-primary" />
          Attendance today
        </h3>
        {headcount === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No employees to track attendance for.
          </p>
        ) : (
          <div className="mt-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-foreground">
                <span className="tabular-nums font-semibold">{presentCount}</span>{" "}
                present
              </span>
              <span className="tabular-nums text-muted-foreground">
                {presentCount} / {headcount} ({attendancePct}%)
              </span>
            </div>
            <div className="mt-1.5 h-2 w-full rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${attendancePct}%` }}
              />
            </div>
            {logins.length === 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                No login activity recorded.
              </p>
            )}
          </div>
        )}
      </section>

      {/* Productivity ranking */}
      <section className="rounded-xl border border-border bg-card p-5 shadow-card">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <BarChart3 className="h-4 w-4 text-primary" />
          Productivity ranking
        </h3>
        {rankRows.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No productivity data available yet.
          </p>
        ) : (
          <ol className="mt-4 space-y-2.5">
            {rankRows.map((r, i) => (
              <li
                key={`${r.name}-${i}`}
                className="flex items-center justify-between text-sm"
              >
                <span className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className="text-foreground">{r.name}</span>
                </span>
                <span className="tabular-nums font-semibold text-foreground">
                  {r.score != null
                    ? `${Math.round(r.score)} score`
                    : `${Math.round(r.active)} active`}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
