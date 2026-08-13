"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RefreshCw,
  Users,
  FilterX,
  Gauge,
  AlertTriangle,
  FolderKanban,
  ChevronRight,
  UserCheck,
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
import { LoadStrip } from "@/components/admin/statViz";
import { sectionTitle } from "@/components/shell/navConfig";
import { getOrgId } from "@/utils/orgContext";
import {
  loadOrgWorkGraph,
  personLoad,
  loadLevel,
  LOAD_LEVELS,
  isOverdue,
} from "@/utils/orgWorkGraph";
import { roleIcon, roleLabel, roleVariant, roleOrder } from "@/components/shared/roleMeta";
import { projectStatusMeta } from "@/utils/projectStatus";

/**
 * Capacity — who is free, who is buried, before you assign anything.
 *
 * THE OTHER END OF THE SAME GRAPH. Team Structure answers "for this project,
 * who is on it?"; this answers "for this person, what are they carrying?".
 * Both read utils/orgWorkGraph.js, so they cannot come to disagree about who is
 * on a project — which is the least debuggable kind of bug, because each screen
 * looks right on its own.
 *
 * WHY THE PER-PROJECT WORKLOAD VIEW WAS NOT ENOUGH. There is already a Workload
 * view inside Project Views, and it is genuinely useful — but it is scoped to
 * ONE project. The question that decides an assignment is the opposite one:
 * this developer looks free on my project, but what else are they on? Answering
 * it meant opening every project in turn and adding up by hand.
 *
 * THE LOAD LABELS ARE A CONVENTION, NOT A MEASUREMENT. Nothing in this product
 * records how long a task takes, so "6 open tasks" is a heavy week for one
 * person and a quiet one for another. The label exists to sort the list and
 * surface the extremes; the raw counts sit beside it on every row so the reader
 * can disagree with it. That is deliberate and it is said on screen, not just
 * here — a number presented as a verdict gets used as one.
 */

const selectClass =
  "h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const SORTS = {
  load: "Busiest first",
  free: "Most available first",
  overdue: "Most overdue first",
  name: "Name A-Z",
};

function initialsOf(name, email) {
  const src = String(name || email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase() || "?";
}

/**
 * The load bar.
 *
 * Capped at ten, and the cap is drawn rather than hidden: somebody with
 * eighteen open tasks and somebody with eleven both fill the bar, and the
 * number beside it is what separates them. A bar that silently rescales to its
 * own maximum makes the worst case look normal.
 */
function LoadBar({ openTasks, level }) {
  const pct = Math.min(100, (Math.min(openTasks, 10) / 10) * 100);
  const tone =
    level.tone === "error"
      ? "bg-destructive"
      : level.tone === "warning"
      ? "bg-warning"
      : level.tone === "info"
      ? "bg-info"
      : level.tone === "success"
      ? "bg-success"
      : "bg-muted-foreground/40";

  return (
    <div
      role="progressbar"
      aria-valuenow={openTasks}
      aria-valuemin={0}
      aria-valuetext={`${openTasks} open ${openTasks === 1 ? "task" : "tasks"} — ${level.label}`}
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className={`h-full rounded-full ${tone} transition-[width] duration-300 motion-reduce:transition-none`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** One person: their load, their projects, and — expanded — the actual work. */
function PersonCard({ person, expanded, onToggle }) {
  const { load, level, projects } = person;
  const Icon = roleIcon(person.role);
  const panelId = `capacity-panel-${person.userId}`;

  return (
    <div className="rounded-xl border border-border bg-card shadow-card transition-shadow duration-150 motion-reduce:transition-none hover:shadow-elevated">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-start gap-3 rounded-xl p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <ChevronRight
          className={`mt-1 h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none ${
            expanded ? "rotate-90" : ""
          }`}
          aria-hidden="true"
        />
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
        >
          {initialsOf(person.name, person.email)}
        </span>

        <span className="min-w-0 flex-1 space-y-2.5">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="truncate font-semibold text-foreground">{person.name}</span>
            <Badge variant={roleVariant(person.role)} size="sm">
              <Icon className="h-3 w-3" aria-hidden="true" />
              {roleLabel(person.role)}
            </Badge>
            <StatusPill status={level.tone} label={level.label} />
          </span>

          <LoadBar openTasks={load.openTasks} level={level} />

          {/* The raw numbers, always, beside the label that summarised them. */}
          <span className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
            <span className="tabular-nums">
              <span className="font-semibold text-foreground">{load.openTasks}</span> open
            </span>
            <span className={`tabular-nums ${load.overdue > 0 ? "text-destructive" : ""}`}>
              <span className="font-semibold">{load.overdue}</span> overdue
            </span>
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              <FolderKanban className="h-4 w-4" aria-hidden="true" />
              {load.projectCount} {load.projectCount === 1 ? "project" : "projects"}
            </span>
            {load.managingCount > 0 && (
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <UserCheck className="h-4 w-4" aria-hidden="true" />
                manages {load.managingCount}
              </span>
            )}
          </span>
        </span>
      </button>

      {expanded && (
        <div id={panelId} className="border-t border-border px-4 pb-5 pt-4">
          {projects.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
              No open work. {person.name} is available.
            </p>
          ) : (
            <ul className="space-y-2">
              {projects.map((entry) => {
                const status = projectStatusMeta(entry.project?.status);
                return (
                  <li
                    key={entry.projectId}
                    className="rounded-lg border border-border bg-background px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                        {entry.project?.name || "Unknown project"}
                      </span>
                      <StatusPill status={status.tone} label={status.label} />
                      {entry.managing && (
                        <Badge variant="secondary" size="sm">
                          Manages
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {entry.openTasks} open
                        {entry.overdue > 0 && (
                          <span className="ml-1.5 font-semibold text-destructive">
                            {entry.overdue} overdue
                          </span>
                        )}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function TeamCapacity() {
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [sortBy, setSortBy] = useState("load");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const graph = await loadOrgWorkGraph(getOrgId());
      const today = new Date().toISOString().slice(0, 10);

      const shaped = graph.people
        // Somebody suspended is not available capacity, and listing them as
        // "Free" is how work gets assigned to a locked-out account.
        .filter((p) => p.status === "active")
        .map((person) => {
          const load = personLoad(person, graph, today);
          const level = loadLevel(load);

          // Their open work, grouped by the project it belongs to.
          const byProject = new Map();
          for (const t of load.tasks) {
            if (!t.project_id) continue;
            const key = String(t.project_id);
            if (!byProject.has(key)) {
              byProject.set(key, { projectId: key, openTasks: 0, overdue: 0, managing: false });
            }
            const entry = byProject.get(key);
            entry.openTasks += 1;
            if (isOverdue(t, today)) entry.overdue += 1;
          }
          // A project they manage but hold no task on still belongs on the list.
          for (const p of graph.projects) {
            if (!p.manager_id || String(p.manager_id) !== String(person.userId)) continue;
            const key = String(p.id);
            if (!byProject.has(key)) {
              byProject.set(key, { projectId: key, openTasks: 0, overdue: 0, managing: true });
            } else {
              byProject.get(key).managing = true;
            }
          }

          const projects = Array.from(byProject.values())
            .map((e) => ({ ...e, project: graph.projectById.get(e.projectId) || null }))
            .sort((a, b) => b.overdue - a.overdue || b.openTasks - a.openTasks);

          return { ...person, load, level, projects };
        });

      setPeople(shaped);
    } catch (e) {
      setError(e?.message || "Could not load capacity.");
      setPeople([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const roles = useMemo(() => {
    const set = new Set(people.map((p) => p.role).filter(Boolean));
    return Array.from(set).sort((a, b) => roleOrder(a) - roleOrder(b));
  }, [people]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = people.filter((p) => {
      if (roleFilter !== "all" && p.role !== roleFilter) return false;
      if (q) {
        const hay = `${p.name} ${p.email}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    rows = [...rows].sort((a, b) => {
      if (sortBy === "name") return String(a.name).localeCompare(String(b.name));
      if (sortBy === "overdue") {
        return b.load.overdue - a.load.overdue || b.load.openTasks - a.load.openTasks;
      }
      if (sortBy === "free") {
        // Ascending load. Ties broken by fewer projects, because somebody on
        // one project with two tasks has more room than somebody spread over
        // four with the same count.
        return (
          a.level.rank - b.level.rank ||
          a.load.openTasks - b.load.openTasks ||
          a.load.projectCount - b.load.projectCount
        );
      }
      return (
        b.level.rank - a.level.rank ||
        b.load.overdue - a.load.overdue ||
        b.load.openTasks - a.load.openTasks
      );
    });

    return rows;
  }, [people, search, roleFilter, sortBy]);

  // Ordered by rank so the strip reads free -> overloaded left to right, which
  // is the direction the sentence "we have room / we do not" is read in.
  const levelCounts = useMemo(() => {
    const order = Object.values(LOAD_LEVELS).sort((a, b) => a.rank - b.rank);
    return order.map((l) => ({
      ...l,
      count: people.filter((p) => p.level.id === l.id).length,
    }));
  }, [people]);

  const stats = useMemo(() => {
    const free = people.filter((p) => p.level.id === LOAD_LEVELS.free.id).length;
    const overloaded = people.filter((p) => p.level.id === LOAD_LEVELS.overloaded.id).length;
    const overdue = people.reduce((s, p) => s + p.load.overdue, 0);
    const open = people.reduce((s, p) => s + p.load.openTasks, 0);
    return { free, overloaded, overdue, open };
  }, [people]);

  const filtersActive = search.trim() !== "" || roleFilter !== "all" || sortBy !== "load";

  const clearFilters = () => {
    setSearch("");
    setRoleFilter("all");
    setSortBy("load");
  };

  const toggle = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const header = (
    <PageHeader
      title={sectionTitle("capacity", "admin")}
      description="What everyone is carrying across every project, before you add to it."
      actions={
        <Button variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
          Refresh
        </Button>
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
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
        <span className="sr-only" role="status">
          Loading capacity…
        </span>
      </div>
    );
  }

  if (error && people.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState title="Couldn't load capacity" description={error} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Available" value={stats.free} icon={UserCheck} tone="success" />
        <StatCard
          title="Overloaded"
          value={stats.overloaded}
          icon={Gauge}
          tone={stats.overloaded > 0 ? "destructive" : "muted"}
        />
        <StatCard
          title="Overdue tasks"
          value={stats.overdue}
          icon={AlertTriangle}
          tone={stats.overdue > 0 ? "warning" : "muted"}
        />
        <StatCard title="Open tasks" value={stats.open} icon={FolderKanban} tone="primary" />
      </div>

      {/* One line that answers "is there room?" before anybody scans forty
          rows — which is the question that brought them to this screen. */}
      <LoadStrip levels={levelCounts} total={people.length} />

      {/* Said on screen, not only in the source. A label that looks like a
          measurement gets used as one. */}
      <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        Load is counted in open tasks, not hours — nothing here records how long
        a task takes. Treat “Heavy” and “Overloaded” as a place to look, and read
        the counts beside them before deciding anything.
      </p>

      <Toolbar
        search={{
          value: search,
          onChange: (value) => setSearch(value),
          placeholder: "Search name or email…",
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
                  {roleLabel(r)}
                </option>
              ))}
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className={selectClass}
              aria-label="Sort people"
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
          filtersActive ? (
            <Button variant="ghost" onClick={clearFilters}>
              <FilterX className="h-4 w-4" aria-hidden="true" />
              Clear filters
            </Button>
          ) : null
        }
      />

      <p className="-mt-3 text-sm text-muted-foreground" aria-live="polite">
        {visible.length === people.length
          ? `${people.length} ${people.length === 1 ? "person" : "people"}`
          : `${visible.length} of ${people.length} people`}
      </p>

      {visible.length === 0 ? (
        <EmptyState
          icon={Users}
          title={people.length === 0 ? "Nobody to show" : "No one matches your filters"}
          description={
            people.length === 0
              ? "Active members of this organization appear here with what they are carrying."
              : "Try a different search term, or widen the role filter."
          }
          action={
            people.length > 0 && filtersActive ? (
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
            <PersonCard
              key={p.userId}
              person={p}
              expanded={expanded.has(p.userId)}
              onToggle={() => toggle(p.userId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
