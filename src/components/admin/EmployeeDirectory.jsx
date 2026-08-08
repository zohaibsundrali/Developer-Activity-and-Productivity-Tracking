"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Users,
  Search,
  RefreshCw,
  Pencil,
  Power,
  Building2,
  UserCircle,
} from "lucide-react";
import StatCard from "@/components/shell/StatCard";
import EmployeeProfileEditor from "@/components/admin/EmployeeProfileEditor";
import { getOrgId } from "@/utils/orgContext";
import { loadEmployees, setEmployeeStatus } from "@/utils/employeesData";
import { can } from "@/utils/permissions";
import { resolveOrgFileUrls } from "@/utils/orgFiles";

/**
 * Admin → Employees directory.
 *
 * Self-loading table of the org's non-client members with a compact stats
 * header, a client-side search/filter/sort toolbar, and a per-row editor +
 * quick activate/deactivate toggle (gated behind `manage_employees`).
 */

// role → badge classes
const ROLE_BADGES = {
  owner: "bg-primary/10 text-primary",
  admin: "bg-info/10 text-info",
  manager: "bg-violet-500/10 text-violet-600",
  team_lead: "bg-indigo-500/10 text-indigo-600",
  hr: "bg-pink-500/10 text-pink-600",
  developer: "bg-success/10 text-success",
  employee: "bg-muted text-muted-foreground",
};

function roleBadgeClass(role) {
  return ROLE_BADGES[role] || "bg-muted text-muted-foreground";
}

// status → badge classes
const STATUS_BADGES = {
  active: "bg-success/10 text-success",
  invited: "bg-warning/10 text-warning",
  suspended: "bg-destructive/10 text-destructive",
};

function statusBadgeClass(status) {
  return STATUS_BADGES[status] || "bg-muted text-muted-foreground";
}

// snake_case / lowercase → "Pretty Label"
const prettyLabel = (s) =>
  String(s || "")
    .split("_")
    .map((w) => (w[0]?.toUpperCase() || "") + w.slice(1))
    .join(" ");

const inputClass =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30";

const SORTS = {
  name: "Name A-Z",
  role: "Role",
  joined: "Recently joined",
};

export default function EmployeeDirectory() {
  const [employees, setEmployees] = useState([]);
  const [teams, setTeams] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [togglingId, setTogglingId] = useState(null);

  // toolbar state
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name");

  // editor
  const [selected, setSelected] = useState(null);

  const canManage = can("manage_employees");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const orgId = getOrgId();
      const {
        employees: emps,
        teams: tms,
        departments: depts,
      } = await loadEmployees(orgId);
      setEmployees(Array.isArray(emps) ? emps : []);
      setTeams(Array.isArray(tms) ? tms : []);
      setDepartments(Array.isArray(depts) ? depts : []);
    } catch (e) {
      setError(e?.message || "Failed to load employees.");
      setEmployees([]);
      setTeams([]);
      setDepartments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Employee photos live in the private `org-files` bucket, so their stored
  // value is a path rather than a URL. Sign the whole page in one round trip;
  // rows written before the move still hold a full URL and pass straight through.
  const [photoUrls, setPhotoUrls] = useState(new Map());
  useEffect(() => {
    let cancelled = false;
    const stored = (employees || []).map((e) => e.profile?.photo_url).filter(Boolean);
    if (!stored.length) {
      setPhotoUrls(new Map());
      return undefined;
    }
    resolveOrgFileUrls(stored).then((map) => {
      if (!cancelled) setPhotoUrls(map);
    });
    return () => {
      cancelled = true;
    };
  }, [employees]);

  // Resolve a userId → employee name (for "Reports to").
  const nameByUserId = useMemo(() => {
    const map = new Map();
    (employees || []).forEach((e) => {
      if (e?.userId) map.set(e.userId, e.name);
    });
    return map;
  }, [employees]);

  // Distinct roles present, for the role filter.
  const roles = useMemo(() => {
    const set = new Set();
    (employees || []).forEach((e) => {
      if (e?.role) set.add(e.role);
    });
    return Array.from(set).sort();
  }, [employees]);

  const stats = useMemo(() => {
    const total = employees.length;
    const active = employees.filter((e) => e?.status === "active").length;
    return { total, active };
  }, [employees]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = (employees || []).filter((e) => {
      if (!e) return false;
      if (q) {
        const hay = [
          e.name,
          e.email,
          e.profile?.designation,
        ]
          .map((v) => String(v || "").toLowerCase())
          .join(" ");
        if (!hay.includes(q)) return false;
      }
      if (roleFilter !== "all" && e.role !== roleFilter) return false;
      if (deptFilter !== "all" && String(e.departmentId) !== String(deptFilter))
        return false;
      if (teamFilter !== "all" && String(e.teamId) !== String(teamFilter))
        return false;
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      return true;
    });

    rows = [...rows].sort((a, b) => {
      if (sortBy === "role") {
        return String(a.role || "").localeCompare(String(b.role || ""));
      }
      if (sortBy === "joined") {
        const ta = a.joinedAt ? new Date(a.joinedAt).getTime() : 0;
        const tb = b.joinedAt ? new Date(b.joinedAt).getTime() : 0;
        return tb - ta;
      }
      return String(a.name || "").localeCompare(String(b.name || ""));
    });

    return rows;
  }, [employees, search, roleFilter, deptFilter, teamFilter, statusFilter, sortBy]);

  const handleToggleStatus = useCallback(
    async (emp) => {
      if (!emp || !canManage) return;
      const next = emp.status === "active" ? "suspended" : "active";
      try {
        setTogglingId(emp.membershipId);
        const { error: err } = await setEmployeeStatus(emp, next);
        if (err) {
          setError(err.message || "Failed to update status.");
          return;
        }
        await load();
      } catch (e) {
        setError(e?.message || "Failed to update status.");
      } finally {
        setTogglingId(null);
      }
    },
    [canManage, load]
  );

  const orgId = getOrgId();

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-10 shadow-card">
        <div className="flex flex-col items-center justify-center gap-3 py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary/30 border-t-primary" />
          <p className="text-sm text-muted-foreground">Loading employees…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">
            Employees
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Directory of everyone in your organization.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Total employees"
          value={stats.total}
          icon={Users}
          tone="primary"
        />
        <StatCard
          title="Active"
          value={stats.active}
          icon={UserCircle}
          tone="success"
        />
        <StatCard
          title="Departments"
          value={departments.length}
          icon={Building2}
          tone="info"
        />
        <StatCard title="Teams" value={teams.length} icon={Users} tone="violet" />
      </div>

      {/* Toolbar */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-card">
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
          <div className="relative flex-1 lg:min-w-[220px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, designation…"
              className={`${inputClass} w-full pl-9`}
            />
          </div>

          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className={inputClass}
            aria-label="Filter by role"
          >
            <option value="all">All roles</option>
            {roles.map((r) => (
              <option key={r} value={r}>
                {prettyLabel(r)}
              </option>
            ))}
          </select>

          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className={inputClass}
            aria-label="Filter by department"
          >
            <option value="all">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>

          <select
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            className={inputClass}
            aria-label="Filter by team"
          >
            <option value="all">All teams</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={inputClass}
            aria-label="Filter by status"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="invited">Invited</option>
            <option value="suspended">Suspended</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className={inputClass}
            aria-label="Sort employees"
          >
            {Object.entries(SORTS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-3">Employee</th>
                <th className="px-4 py-3">Designation</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Team</th>
                <th className="px-4 py-3">Reports to</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((emp) => {
                const photo = photoUrls.get(emp.profile?.photo_url) || null;
                const initial =
                  (emp.name || emp.email || "?").trim().charAt(0).toUpperCase() ||
                  "?";
                const reportsToName = emp.reportsTo
                  ? nameByUserId.get(emp.reportsTo) || "—"
                  : "—";
                const isToggling = togglingId === emp.membershipId;

                return (
                  <tr
                    key={emp.membershipId}
                    className="border-b border-border last:border-0 hover:bg-muted/40"
                  >
                    {/* Employee */}
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        {photo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={photo}
                            alt={emp.name || "Employee"}
                            className="h-9 w-9 shrink-0 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                            {initial}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="truncate font-medium text-foreground">
                            {emp.name || "—"}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {emp.email || "—"}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Designation */}
                    <td className="px-4 py-3 text-muted-foreground">
                      {emp.profile?.designation || "—"}
                    </td>

                    {/* Role */}
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${roleBadgeClass(
                          emp.role
                        )}`}
                      >
                        {prettyLabel(emp.role) || "—"}
                      </span>
                    </td>

                    {/* Department */}
                    <td className="px-4 py-3 text-muted-foreground">
                      {emp.departmentName || "—"}
                    </td>

                    {/* Team */}
                    <td className="px-4 py-3 text-muted-foreground">
                      {emp.teamName || "—"}
                    </td>

                    {/* Reports to */}
                    <td className="px-4 py-3 text-muted-foreground">
                      {reportsToName}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(
                          emp.status
                        )}`}
                      >
                        {prettyLabel(emp.status) || "—"}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setSelected(emp)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
                          title="Edit employee"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </button>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => handleToggleStatus(emp)}
                            disabled={isToggling}
                            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                              emp.status === "active"
                                ? "border-destructive/30 text-destructive hover:bg-destructive/10"
                                : "border-success/30 text-success hover:bg-success/10"
                            }`}
                            title={
                              emp.status === "active"
                                ? "Deactivate"
                                : "Activate"
                            }
                          >
                            <Power className="h-3.5 w-3.5" />
                            {isToggling
                              ? "…"
                              : emp.status === "active"
                              ? "Deactivate"
                              : "Activate"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {visible.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
            <Users
              className="h-12 w-12 text-muted-foreground/40"
              strokeWidth={1}
            />
            <p className="text-sm text-muted-foreground">
              {employees.length === 0
                ? "No employees found in this organization yet."
                : "No employees match your filters."}
            </p>
          </div>
        )}
      </div>

      {/* Editor modal */}
      {selected && (
        <EmployeeProfileEditor
          emp={selected}
          employees={employees}
          teams={teams}
          departments={departments}
          orgId={orgId}
          canManage={canManage}
          onClose={() => setSelected(null)}
          onSaved={async () => {
            await load();
          }}
        />
      )}
    </div>
  );
}
