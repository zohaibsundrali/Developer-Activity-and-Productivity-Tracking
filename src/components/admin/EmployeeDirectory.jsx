"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Users,
  RefreshCw,
  Pencil,
  Power,
  Building2,
  UserCircle,
  FilterX,
  UserPlus,
  Trash2,
  LayoutGrid,
  Rows3,
} from "lucide-react";
import StatCard from "@/components/shell/StatCard";
import EmployeeProfileEditor from "@/components/admin/EmployeeProfileEditor";
import AddEmployeeDialog from "@/components/admin/AddEmployeeDialog";
import {
  PageHeader,
  Toolbar,
  DataTable,
  Badge,
  StatusPill,
  EmptyState,
  ErrorState,
  Button,
  Skeleton,
  SkeletonTable,
  SkeletonList,
} from "@/components/ui";
// The page <h1> reads the same string the sidebar and topbar do.
import { sectionTitle } from "@/components/shell/navConfig";
import { getOrgId } from "@/utils/orgContext";
import { loadEmployees, setEmployeeStatus } from "@/utils/employeesData";
import { can, getRole } from "@/utils/permissions";
import { grantableStaffRoles } from "@/utils/roles";
import { roleIcon, roleVariant, rolePlural, roleOrder } from "@/components/shared/roleMeta";
import { confirmAndDeleteDeveloper } from "@/utils/developerDeletion";
import { resolveOrgFileUrls } from "@/utils/orgFiles";

/**
 * Admin → Employees directory.
 *
 * Self-loading table of the org's non-client members with a compact stats
 * header, a client-side search/filter/sort toolbar, and a per-row editor +
 * quick activate/deactivate toggle (gated behind `manage_employees`).
 *
 * Presentation notes: the row is the unit an HR manager scans, so it reads
 * avatar → name → role → team → status left to right, and drops to a card list
 * below `md` where eight columns stop being legible.
 */

const STATUS_PILLS = {
  active: "active",
  invited: "pending",
  inactive: "inactive",
  suspended: "error",
};

function statusPill(status) {
  return STATUS_PILLS[status] || "unknown";
}

// snake_case / lowercase → "Pretty Label"
const prettyLabel = (s) =>
  String(s || "")
    .split("_")
    .map((w) => (w[0]?.toUpperCase() || "") + w.slice(1))
    .join(" ");

const selectClass =
  "h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const SORTS = {
  name: "Name A-Z",
  role: "Role",
  joined: "Recently joined",
};

/** Avatar + name + email — the identity cell, shared by the table and the cards. */
function EmployeeIdentity({ emp, photo, size = "md" }) {
  const initial =
    (emp.name || emp.email || "?").trim().charAt(0).toUpperCase() || "?";
  const box = size === "lg" ? "h-11 w-11" : "h-9 w-9";

  return (
    <div className="flex min-w-0 items-center gap-3">
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt=""
          className={`${box} shrink-0 rounded-full border border-border object-cover`}
        />
      ) : (
        <div
          aria-hidden="true"
          className={`${box} flex shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary`}
        >
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
  );
}

/** One labelled fact inside an employee card. */
function CardFact({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-sm text-foreground">{children}</dd>
    </div>
  );
}

/**
 * "12 Developers, 3 Designers, 1 HR" — one tile per role actually present.
 *
 * It is a button, not a card: the count answers "how many developers are
 * there", and the next question is always "which ones", so pressing it filters
 * the list below. Pressing the active one clears the filter again.
 *
 * Colour carries nothing here. Every tile is the same neutral surface and the
 * role is named in words, which keeps the palette's status colours meaning
 * status.
 */
function RoleTile({ role, count, active, onClick }) {
  const Icon = roleIcon(role);
  const label = rolePlural(role);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-3 rounded-xl border bg-card p-4 text-left shadow-card transition-all duration-150 motion-reduce:transition-none hover:shadow-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
        active ? "border-primary ring-1 ring-primary" : "border-border"
      }`}
    >
      <span
        aria-hidden="true"
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
          active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
        }`}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-2xl font-bold leading-none tracking-tight text-foreground tabular-nums">
          {count}
        </span>
        <span className="mt-1 block truncate text-sm font-medium text-muted-foreground">
          {label}
        </span>
      </span>
      {/* The tile is a filter, and a pressed filter that looks like a statistic
          is how somebody ends up reading a filtered list as the whole org. */}
      <span className="sr-only">
        {active ? "Filter applied. Press to show everyone." : `Show only ${label}.`}
      </span>
    </button>
  );
}

/**
 * One person, as a card. Used by both the desktop grid and the phone list, so
 * the two cannot drift into showing different facts about the same employee.
 */
function EmployeeCard({
  emp,
  photo,
  reportsToName,
  canManage,
  canDelete,
  isToggling,
  isDeleting,
  onEdit,
  onToggle,
  onDelete,
}) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-card p-4 shadow-card transition-shadow duration-150 motion-reduce:transition-none hover:shadow-elevated">
      <div className="flex items-start justify-between gap-3">
        <EmployeeIdentity emp={emp} photo={photo} size="lg" />
        <StatusPill
          status={statusPill(emp.status)}
          label={prettyLabel(emp.status) || "Unknown"}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {emp.role && (
          <Badge variant={roleVariant(emp.role)} size="sm">
            {prettyLabel(emp.role)}
          </Badge>
        )}
        {emp.profile?.designation && (
          <span className="truncate text-sm text-muted-foreground">
            {emp.profile.designation}
          </span>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4">
        <CardFact label="Department">{emp.departmentName || "—"}</CardFact>
        <CardFact label="Team">{emp.teamName || "—"}</CardFact>
        <CardFact label="Reports to">{reportsToName}</CardFact>
        {/* The one fact the old developer list had that this screen did not. */}
        <CardFact label="Projects">
          <span className="font-medium tabular-nums">{emp.projectCount ?? 0}</span>
        </CardFact>
      </dl>

      {/* mt-auto keeps the buttons on the bottom edge, so a card whose owner
          has no department does not sit with its actions halfway up the grid
          row. */}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        <Button
          variant="outline"
          size="sm"
          onClick={onEdit}
          aria-label={`Edit ${emp.name || "employee"}`}
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
          Edit
        </Button>
        {canManage && (
          <Button
            variant={emp.status === "active" ? "destructive" : "outline"}
            size="sm"
            onClick={onToggle}
            disabled={isToggling}
            aria-label={`${emp.status === "active" ? "Deactivate" : "Activate"} ${
              emp.name || "employee"
            }`}
          >
            <Power className="h-4 w-4" aria-hidden="true" />
            {isToggling
              ? "Saving…"
              : emp.status === "active"
              ? "Deactivate"
              : "Activate"}
          </Button>
        )}
        {canDelete && emp.userType === "developer" && (
          // Deliberately last, quiet, and NOT the destructive variant —
          // Deactivate is the one that should be reached for. This removes
          // their projects, tasks, submissions and activity log, and the two
          // confirmations behind it say so with the counts.
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            disabled={isDeleting}
            aria-label={`Delete ${emp.name || "employee"} permanently`}
          >
            <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
            {isDeleting ? "Deleting…" : "Delete"}
          </Button>
        )}
      </div>
    </div>
  );
}

export default function EmployeeDirectory() {
  const [employees, setEmployees] = useState([]);
  const [teams, setTeams] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  // Set before any await, so a second click on another card cannot start a
  // second deletion while the first one is still in its confirmations.
  const deletionInProgress = useRef(false);

  // toolbar state
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name");

  // Cards or table. Cards by default: this page answers "who works here", and
  // a face with a role under it answers that faster than a row does. The table
  // is still one click away for anyone scanning eight fields at once.
  const [view, setView] = useState("cards");

  // editor
  const [selected, setSelected] = useState(null);
  const [adding, setAdding] = useState(false);

  const canManage = can("manage_employees");
  // Separate from `manage_employees` on purpose: suspending somebody and
  // destroying their work are not the same decision. Both happen to be
  // owner/admin/HR today, and reading the right capability is what keeps that
  // true if either list changes.
  const canDelete = can("delete_developer");

  // The "Add employee" button appears only if this person could actually
  // complete the form. `manage_employees` is owner/admin/hr; the second half
  // mirrors the provision route, which refuses to grant a role ranking at or
  // above the caller's own — without it, a role with no grantable options
  // would open a dialog with an empty dropdown.
  const canAdd = canManage && grantableStaffRoles(getRole()).length > 0;

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

  // How many of each role there are.
  //
  // Counted from the roles PRESENT, not from the ROLES list — an org with no
  // designers should not be told it has "0 Designers", because a row of zeros
  // is what makes the numbers that matter hard to find. A role nobody in the
  // codebase has heard of still gets a tile, which is how you would find out
  // that somebody had been given one.
  const roleCounts = useMemo(() => {
    const counts = new Map();
    (employees || []).forEach((e) => {
      const r = e?.role || "unassigned";
      counts.set(r, (counts.get(r) || 0) + 1);
    });
    return Array.from(counts, ([role, count]) => ({ role, count })).sort(
      (a, b) => roleOrder(a.role) - roleOrder(b.role) || a.role.localeCompare(b.role)
    );
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

  const handleDelete = useCallback(
    async (emp) => {
      // `userType === "developer"` is the whole precondition: the route deletes
      // a row from `developers`, and an owner or admin's account lives in
      // `admin_users`, so pointing it at one would find nothing.
      if (!canDelete || !emp || emp.userType !== "developer") return;
      if (deletionInProgress.current) return;

      deletionInProgress.current = true;
      setDeletingId(emp.membershipId);
      try {
        const { deleted } = await confirmAndDeleteDeveloper({
          // The membership carries `user_id`, which IS developers.id — the
          // primary key the route resolves by. added_by/added_by_admin are not
          // loaded here, so the "only what you added" pre-check does not fire
          // and the route's own check against the verified token is the one
          // that decides. Selecting those columns to pre-empt it would break
          // the whole directory on an install that predates them, because
          // PostgREST refuses the entire request over one unknown column.
          developer: { id: emp.userId, name: emp.name, email: emp.email },
          actor: JSON.parse(sessionStorage.getItem("adminUser") || "null"),
        });
        if (deleted) await load();
      } finally {
        deletionInProgress.current = false;
        setDeletingId(null);
      }
    },
    [canDelete, load]
  );

  const orgId = getOrgId();

  // Filter chrome is purely local view state — resetting it touches nothing
  // that is fetched, saved or permission-checked.
  const filtersActive =
    search.trim() !== "" ||
    roleFilter !== "all" ||
    deptFilter !== "all" ||
    teamFilter !== "all" ||
    statusFilter !== "all";

  const clearFilters = () => {
    setSearch("");
    setRoleFilter("all");
    setDeptFilter("all");
    setTeamFilter("all");
    setStatusFilter("all");
  };

  const header = (
    <PageHeader
      title={sectionTitle("employees", "admin")}
      description="Everyone in your organization — add an account, change a role, deactivate or remove."
      actions={
        <>
          <Button
            variant="outline"
            onClick={load}
            disabled={loading}
            aria-label="Refresh employee directory"
          >
            <RefreshCw
              className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            Refresh
          </Button>
          {canAdd && (
            <Button onClick={() => setAdding(true)}>
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              Add employee
            </Button>
          )}
        </>
      }
    />
  );

  // ── Loading ────────────────────────────────────────────────────────────────
  // Skeletons shaped like the stats row, the toolbar and the table, so the page
  // does not reflow the moment data lands.
  if (loading) {
    return (
      <div className="space-y-6">
        {header}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-xl border border-border bg-card p-5 shadow-card"
            >
              <Skeleton className="h-11 w-11 rounded-xl" />
              <Skeleton className="mt-4 h-8 w-20" />
              <Skeleton className="mt-2 h-4 w-28" />
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-card">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <Skeleton className="h-10 w-full lg:max-w-sm" />
            <div className="flex flex-wrap gap-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-10 w-32" />
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 shadow-card">
          <div className="hidden md:block">
            <SkeletonTable rows={8} cols={6} />
          </div>
          <div className="md:hidden">
            <SkeletonList rows={5} />
          </div>
        </div>

        <span className="sr-only" role="status">
          Loading employees…
        </span>
      </div>
    );
  }

  // ── Error (nothing loaded) ─────────────────────────────────────────────────
  if (error && employees.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState
          title="Couldn't load employees"
          description={error}
          onRetry={load}
        />
      </div>
    );
  }

  const columns = [
    {
      key: "employee",
      header: "Employee",
      width: "24%",
      render: (emp) => (
        <EmployeeIdentity
          emp={emp}
          photo={photoUrls.get(emp.profile?.photo_url) || null}
        />
      ),
    },
    {
      key: "designation",
      header: "Designation",
      render: (emp) => (
        <span className="block max-w-[16ch] truncate text-foreground lg:max-w-none">
          {emp.profile?.designation || (
            <span className="text-muted-foreground">—</span>
          )}
        </span>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (emp) =>
        emp.role ? (
          <Badge variant={roleVariant(emp.role)} size="sm">
            {prettyLabel(emp.role)}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "department",
      header: "Department",
      render: (emp) =>
        emp.departmentName || <span className="text-muted-foreground">—</span>,
    },
    {
      key: "team",
      header: "Team",
      render: (emp) =>
        emp.teamName || <span className="text-muted-foreground">—</span>,
    },
    {
      key: "projects",
      header: "Projects",
      render: (emp) => (
        <span className="font-medium tabular-nums text-foreground">
          {emp.projectCount ?? 0}
        </span>
      ),
    },
    {
      key: "reportsTo",
      header: "Reports to",
      render: (emp) => {
        const name = emp.reportsTo ? nameByUserId.get(emp.reportsTo) : null;
        return name || <span className="text-muted-foreground">—</span>;
      },
    },
    {
      key: "status",
      header: "Status",
      render: (emp) => (
        <StatusPill
          status={statusPill(emp.status)}
          label={prettyLabel(emp.status) || "Unknown"}
        />
      ),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      render: (emp) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSelected(emp)}
            aria-label={`Edit ${emp.name || "employee"}`}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Edit
          </Button>
          {canManage && (
            <Button
              variant={emp.status === "active" ? "destructive" : "outline"}
              size="sm"
              onClick={() => handleToggleStatus(emp)}
              disabled={togglingId === emp.membershipId}
              aria-label={`${
                emp.status === "active" ? "Deactivate" : "Activate"
              } ${emp.name || "employee"}`}
            >
              <Power className="h-4 w-4" aria-hidden="true" />
              {togglingId === emp.membershipId
                ? "Saving…"
                : emp.status === "active"
                ? "Deactivate"
                : "Activate"}
            </Button>
          )}
          {canDelete && emp.userType === "developer" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleDelete(emp)}
              disabled={deletingId === emp.membershipId}
              aria-label={`Delete ${emp.name || "employee"} permanently`}
            >
              <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
              {deletingId === emp.membershipId ? "Deleting…" : "Delete"}
            </Button>
          )}
        </div>
      ),
    },
  ];

  const emptyState = (
    <EmptyState
      icon={Users}
      title={
        employees.length === 0
          ? "No employees yet"
          : "No employees match your filters"
      }
      description={
        employees.length === 0
          ? "Nobody has joined this organization yet. Invited members appear here as soon as they accept."
          : "Try a different search term, or widen the role, department, team and status filters."
      }
      action={
        employees.length > 0 && filtersActive ? (
          <Button variant="outline" onClick={clearFilters}>
            <FilterX className="h-4 w-4" aria-hidden="true" />
            Clear filters
          </Button>
        ) : null
      }
    />
  );

  return (
    <div className="space-y-6">
      {header}

      {/* A failed status toggle keeps the loaded directory on screen. */}
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
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
          tone="warning"
        />
        <StatCard title="Teams" value={teams.length} icon={Users} tone="primary" />
      </div>

      {/* By role — the headcount question, and a filter for the answer. */}
      {roleCounts.length > 0 && (
        <section aria-labelledby="employees-by-role" className="space-y-3">
          <h2
            id="employees-by-role"
            className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
          >
            By role
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {roleCounts.map(({ role, count }) => (
              <RoleTile
                key={role}
                role={role}
                count={count}
                active={roleFilter === role}
                onClick={() =>
                  setRoleFilter((current) => (current === role ? "all" : role))
                }
              />
            ))}
          </div>
        </section>
      )}

      {/* Toolbar */}
      <Toolbar
        search={{
          value: search,
          // Toolbar hands back the string value first, not the event.
          onChange: (value) => setSearch(value),
          placeholder: "Search name, email, designation…",
        }}
        filters={
          <>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className={selectClass}
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
              className={selectClass}
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
              className={selectClass}
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
              className={selectClass}
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
              className={selectClass}
              aria-label="Sort employees"
            >
              {Object.entries(SORTS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </>
        }
        actions={
          <>
            {filtersActive && (
              <Button variant="ghost" onClick={clearFilters}>
                <FilterX className="h-4 w-4" aria-hidden="true" />
                Clear filters
              </Button>
            )}
            {/* md and up only: below it the cards are the only layout that
                fits, so a control that cannot change anything is hidden
                rather than shown disabled. */}
            <div
              role="group"
              aria-label="Layout"
              className="hidden rounded-lg border border-border p-0.5 md:flex"
            >
              {[
                { id: "cards", label: "Cards", Icon: LayoutGrid },
                { id: "table", label: "Table", Icon: Rows3 },
              ].map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setView(id)}
                  aria-pressed={view === id}
                  title={`${label} view`}
                  className={`flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                    view === id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
          </>
        }
      />

      {/* Result count — the quiet line that tells you the filters did something. */}
      <p className="-mt-3 text-sm text-muted-foreground" aria-live="polite">
        {visible.length === employees.length
          ? `${employees.length} ${employees.length === 1 ? "person" : "people"}`
          : `${visible.length} of ${employees.length} ${
              employees.length === 1 ? "person" : "people"
            }`}
      </p>

      {/* Table — md and up, and only when asked for. Eight columns are
          unreadable on a phone, so below md the cards are the only layout. */}
      {view === "table" && (
        <div className="hidden md:block">
          {/* DataTable owns its own overflow-x-auto wrapper. */}
          <DataTable
            columns={columns}
            rows={visible}
            keyField="membershipId"
            empty={emptyState}
          />
        </div>
      )}

      {/* Cards — the default above md, and the only layout below it. One list
          rendered once: a second copy of the card for the phone is how the two
          came to show different facts about the same person. */}
      <div className={view === "table" ? "md:hidden" : ""}>
        {visible.length === 0 ? (
          emptyState
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((emp) => (
              <EmployeeCard
                key={emp.membershipId}
                emp={emp}
                photo={photoUrls.get(emp.profile?.photo_url) || null}
                reportsToName={
                  emp.reportsTo ? nameByUserId.get(emp.reportsTo) || "—" : "—"
                }
                canManage={canManage}
                canDelete={canDelete}
                isToggling={togglingId === emp.membershipId}
                isDeleting={deletingId === emp.membershipId}
                onEdit={() => setSelected(emp)}
                onToggle={() => handleToggleStatus(emp)}
                onDelete={() => handleDelete(emp)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add — the form that used to be its own "Add Developer" sidebar screen. */}
      <AddEmployeeDialog
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={load}
      />

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
