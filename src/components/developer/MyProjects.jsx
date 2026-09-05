"use client";
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { showInfo, showWarning } from "@/utils/alerts";
import { authFetch } from "@/utils/authFetch";
import { projectStatusMeta } from "@/utils/projectStatus";
import {
  BarChart3,
  CalendarClock,
  CalendarCheck2,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileText,
  FolderKanban,
  GanttChartSquare,
  Zap,
} from "lucide-react";
import StatCard from "@/components/shell/StatCard";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  PageHeader,
  Skeleton,
  StatusPill,
  Toolbar,
} from "@/components/ui";

// Native control the kit has no primitive for (select).
const CONTROL_CLASS =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

// Project status → StatusPill state (colour + glyph + text, never colour alone).
// The map that used to live here knew six spellings; the one on the developer
// dashboard knew eight, and the two disagreed. Both now read the single
// vocabulary in utils/projectStatus.js, which migration 065 also enforces in
// the database.
function projectStatus(status) {
  const meta = projectStatusMeta(status);
  // StatusPill takes the tone under the name `status`.
  return { status: meta.tone, label: meta.label };
}

// A card fact: same label/value slot on every card, so a grid of them reads as
// columns. Matches EmployeeDirectory's CardFact.
function Fact({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      {children}
    </div>
  );
}

export default function MyProjects({
  assignedProjects,
  onViewProjectDetails, // ✅ Added prop for navigation
  user
}) {
  const router = useRouter();
  const [sortBy, setSortBy] = useState('recent');
  const [filterStatus, setFilterStatus] = useState('all');

  const [showMetricsModal, setShowMetricsModal] = useState(false);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState("");
  const [metricsData, setMetricsData] = useState(null);
  // Remembered so the error state's Retry has something to retry — metricsData
  // is null on failure, so it could not carry the project.
  const [metricsProject, setMetricsProject] = useState(null);

  // Guarded: an unparseable timestamp used to reach the card as the literal
  // string "Invalid Date".
  const formatDate = (dateString) => {
    if (!dateString) return 'Not set';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return 'Not set';
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Get time ago for assigned date. Returns "" rather than a placeholder so the
  // caller can simply omit the line instead of printing "N/A" at a person.
  const getTimeAgo = (dateString) => {
    if (!dateString) return '';
    const now = new Date();
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return '';
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return formatDate(dateString);
  };

  const handleDownloadFile = (project) => {
    if (project.file_url) {
      window.open(project.file_url, '_blank', 'noopener,noreferrer');
    } else {
      showInfo("No file", "No file available for this project.");
    }
  };

  // ✅ FIXED: Use the navigation function from parent
  const handleViewProject = (project) => {
    if (onViewProjectDetails) {
      onViewProjectDetails(project);
    } else {
      // Fallback if prop not provided
      showInfo("Project", `Viewing project: ${project.name}.`);
    }
  };

  const handleSubmitWork = (project) => {
    showInfo("Submit work", `Submit work for project: ${project.name}.`);
    // You can implement actual submission logic here
  };

  const handleViewTimeline = (project) => {
    if (!project?.id) return;
    router.push(`/developer/gantt-chart/${project.id}`);
  };

  const handleViewMetrics = async (project) => {
    if (!project?.id) return;

    if (!user?.id) {
      showWarning("Not logged in", "Please login again to view metrics.");
      return;
    }

    try {
      setMetricsLoading(true);
      setMetricsError("");
      setMetricsData(null);
      setMetricsProject(project);
      setShowMetricsModal(true);

      // Developer-side metrics must be scoped to the logged-in developer.
      const url = `/api/productivity?type=project&projectId=${project.id}&developerId=${encodeURIComponent(String(user.id))}`;
      const res = await authFetch(url);
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        setMetricsError(data.error || "Failed to load productivity metrics.");
        return;
      }

      setMetricsData({
        ...data,
        project,
      });
    } catch (err) {
      setMetricsError("Error loading productivity metrics. Please try again.");
    } finally {
      setMetricsLoading(false);
    }
  };

  // Filter projects based on status
  const filteredProjects = assignedProjects.filter(project => {
    if (filterStatus === 'all') return true;
    if (filterStatus === 'active') return project.status === 'active' || project.status === 'in_progress';
    if (filterStatus === 'completed') return project.status === 'completed' || project.status === 'done';
    if (filterStatus === 'pending') return project.status === 'pending' || project.status === 'assigned';
    return true;
  });

  // Sort projects
  const sortedProjects = [...filteredProjects].sort((a, b) => {
    if (sortBy === 'recent') {
      return new Date(b.created_at || b.assigned_at) - new Date(a.created_at || a.assigned_at);
    }
    if (sortBy === 'deadline') {
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return new Date(a.deadline) - new Date(b.deadline);
    }
    if (sortBy === 'progress') {
      return (b.progress || 0) - (a.progress || 0);
    }
    return 0;
  });

  // Calculate statistics
  const activeProjectsCount = assignedProjects.filter(p =>
    p.status === 'active' || p.status === 'in_progress'
  ).length;

  const completedProjectsCount = assignedProjects.filter(p =>
    p.status === 'completed' || p.status === 'done'
  ).length;

  const pendingProjectsCount = assignedProjects.filter(p =>
    p.status === 'pending' || p.status === 'assigned'
  ).length;

  return (
    <div>
      <PageHeader
        title="My Projects"
        description="Everything assigned to you, with progress, deadlines and requirements."
      />

      <div className="space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <StatCard title="Active Projects" value={activeProjectsCount} icon={Zap} tone="primary" />
          <StatCard title="Completed" value={completedProjectsCount} icon={CheckCircle2} tone="success" />
          <StatCard title="Pending" value={pendingProjectsCount} icon={Clock} tone="warning" />
        </div>

        {/* Filters */}
        <div className="rounded-xl border border-border bg-card p-4 shadow-card">
          <Toolbar
            filters={
              <div className="flex flex-wrap items-end gap-4">
                <Field label="Sort by" htmlFor="projects-sort">
                  <select
                    id="projects-sort"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className={CONTROL_CLASS}
                  >
                    <option value="recent">Most recent</option>
                    <option value="deadline">Deadline</option>
                    <option value="progress">Progress</option>
                  </select>
                </Field>

                <Field label="Status" htmlFor="projects-status">
                  <select
                    id="projects-status"
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className={CONTROL_CLASS}
                  >
                    <option value="all">All projects</option>
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                    <option value="pending">Pending</option>
                  </select>
                </Field>
              </div>
            }
          />
        </div>

        {/* The quiet line that tells you the filters did something. */}
        <p className="-mt-3 text-sm text-muted-foreground" aria-live="polite">
          {sortedProjects.length === assignedProjects.length
            ? `${assignedProjects.length} ${assignedProjects.length === 1 ? "project" : "projects"}`
            : `${sortedProjects.length} of ${assignedProjects.length} ${
                assignedProjects.length === 1 ? "project" : "projects"
              }`}
        </p>

        {/* Projects grid */}
        <div>
        {/* Metrics / Productivity Modal (Developer view) */}
        <Modal
          open={showMetricsModal}
          onClose={() => {
            setShowMetricsModal(false);
            setMetricsData(null);
            setMetricsError("");
            setMetricsProject(null);
          }}
          title="Your productivity on this project"
          description={metricsData?.project?.name || metricsProject?.name || undefined}
          size="lg"
        >
          {metricsLoading ? (
            // Same four tiles as the loaded state, so the dialog does not resize.
            <div className="space-y-4" aria-busy="true">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-24 w-full rounded-xl" />
                ))}
              </div>
              <Skeleton className="h-12 w-full rounded-lg" />
            </div>
          ) : metricsError ? (
            <ErrorState
              title="Couldn't load your metrics"
              description={metricsError}
              onRetry={() => handleViewMetrics(metricsProject)}
            />
          ) : metricsData ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="rounded-xl border border-border bg-card p-4 text-center">
                  <div className="text-2xl font-semibold tabular-nums text-foreground">
                    {metricsData.totalTasks}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">Total tasks</div>
                </div>
                <div className="rounded-xl border border-border bg-card p-4 text-center">
                  <div className="text-2xl font-semibold tabular-nums text-success">
                    {metricsData.summary?.onTime || 0}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">On time</div>
                  <div className="text-xs tabular-nums text-muted-foreground">
                    +{metricsData.summary?.onTime || 0} pts
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-card p-4 text-center">
                  <div className="text-2xl font-semibold tabular-nums text-destructive">
                    {metricsData.summary?.late || 0}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">Late</div>
                  <div className="text-xs tabular-nums text-muted-foreground">
                    −{metricsData.summary?.late || 0} pts
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-card p-4 text-center">
                  <div
                    className={`text-2xl font-semibold tabular-nums ${
                      parseFloat(metricsData.productivityPercentage || 0) >= 80
                        ? "text-success"
                        : parseFloat(metricsData.productivityPercentage || 0) >= 50
                        ? "text-warning"
                        : "text-destructive"
                    }`}
                  >
                    {metricsData.productivityPercentage || 0}%
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">Productivity</div>
                  <div className="text-xs tabular-nums text-muted-foreground">
                    Points:{" "}
                    {metricsData.productivityPoints >= 0
                      ? `+${metricsData.productivityPoints}`
                      : metricsData.productivityPoints}
                  </div>
                </div>
              </div>

              <dl className="flex flex-wrap gap-x-5 gap-y-2 rounded-lg border border-border bg-muted/40 p-3 text-xs">
                {[
                  { label: "Completed", value: metricsData.summary?.completed || 0 },
                  { label: "On time", value: metricsData.summary?.onTime || 0 },
                  { label: "Late", value: metricsData.summary?.late || 0 },
                  {
                    label: "Pending",
                    value:
                      (metricsData.summary?.pending || 0) +
                      (metricsData.summary?.inProgress || 0) +
                      (metricsData.summary?.awaiting || 0),
                  },
                  { label: "Rejected", value: metricsData.summary?.rejected || 0 },
                ].map((row) => (
                  <div key={row.label} className="flex items-baseline gap-1.5">
                    <dt className="text-muted-foreground">{row.label}</dt>
                    <dd className="font-semibold tabular-nums text-foreground">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : (
            <EmptyState
              icon={BarChart3}
              title="No metrics yet"
              description="Complete a task on this project and your score shows up here."
            />
          )}
        </Modal>

        {sortedProjects.length > 0 ? (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {sortedProjects.map(project => {
              const assignedDate = project.assigned_at || project.created_at;
              const daysAgo = getTimeAgo(assignedDate);
              const status = projectStatus(project.status);
              const progress = Math.min(100, Math.max(0, Number(project.progress) || 0));

              const projectName = project.name || "Untitled project";

              // Returns null only when there is genuinely no deadline; an
              // unparseable one no longer falls through to "NaN days left".
              const deadlineInfo = (() => {
                if (!project.deadline) return null;
                try {
                  const deadline = new Date(project.deadline);
                  const diffDays = Math.ceil((deadline - new Date()) / (1000 * 60 * 60 * 24));
                  if (!Number.isFinite(diffDays)) return null;
                  if (diffDays < 0) return { label: "Overdue", variant: "destructive" };
                  if (diffDays === 0) return { label: "Due today", variant: "warning" };
                  if (diffDays === 1) return { label: "1 day left", variant: "warning" };
                  if (diffDays <= 3) return { label: `${diffDays} days left`, variant: "warning" };
                  return { label: `${diffDays} days left`, variant: "secondary" };
                } catch {
                  return null;
                }
              })();

              return (
                <article
                  key={project.id}
                  className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card transition-shadow duration-150 motion-reduce:transition-none hover:shadow-elevated"
                >
                  {/* Project header — the name is the only large text here. */}
                  <div className="border-b border-border p-4 sm:p-5">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <h3 className="line-clamp-2 min-h-[2.75rem] text-base font-semibold leading-snug text-foreground" title={projectName}>
                        {projectName}
                      </h3>
                      <StatusPill status={status.status} label={status.label} size="sm" className="shrink-0" />
                    </div>

                    {/* Reserved, so a card with a blurb is not taller than one without. */}
                    <p className="mb-4 line-clamp-2 min-h-[2.5rem] text-sm text-muted-foreground">
                      {project.description || "No description provided."}
                    </p>

                    {/* One progress indicator — a labelled bar, nothing else. */}
                    <div className="mb-1.5 flex items-baseline justify-between text-sm">
                      <span className="text-muted-foreground">Progress</span>
                      <span className="font-semibold tabular-nums text-foreground">{progress}%</span>
                    </div>
                    <div
                      className="h-2 w-full overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      aria-valuenow={progress}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${projectName} progress`}
                    >
                      <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
                    </div>
                  </div>

                  {/* Project details — the same two facts, in the same slots,
                      on every card, whether or not the data is there. */}
                  <div className="flex flex-1 flex-col gap-4 p-4 sm:p-5">
                    <dl className="grid grid-cols-2 gap-4">
                      <Fact label="Assigned">
                        <dd className="mt-0.5 flex items-center gap-1.5 text-sm tabular-nums text-foreground">
                          <CalendarCheck2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="truncate">{formatDate(assignedDate)}</span>
                        </dd>
                        <dd className="mt-1 flex min-h-[1.5rem] items-center text-sm tabular-nums text-muted-foreground">
                          {daysAgo}
                        </dd>
                      </Fact>

                      <Fact label="Deadline">
                        <dd className="mt-0.5 flex items-center gap-1.5 text-sm tabular-nums text-foreground">
                          <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="truncate">{formatDate(project.deadline)}</span>
                        </dd>
                        <dd className="mt-1 flex min-h-[1.5rem] items-center">
                          {deadlineInfo && (
                            <Badge variant={deadlineInfo.variant} size="sm">{deadlineInfo.label}</Badge>
                          )}
                        </dd>
                      </Fact>
                    </dl>

                    {/* Attachment slot — always present, always the same height,
                        so the action rows line up across the grid. */}
                    {project.file_url ? (
                      <div className="flex h-14 items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <FileText className="h-4 w-4" aria-hidden="true" />
                          </span>
                          <p
                            className="truncate text-sm font-medium text-foreground"
                            title={project.file_name || "Requirements file"}
                          >
                            {project.file_name || "Requirements file"}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDownloadFile(project)}
                          aria-label={`Download requirements for ${projectName}`}
                        >
                          <Download className="h-4 w-4" aria-hidden="true" />
                          Download
                        </Button>
                      </div>
                    ) : (
                      <div className="flex h-14 items-center gap-3 rounded-lg border border-dashed border-border px-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <FileText className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <p className="text-sm text-muted-foreground">No requirements file</p>
                      </div>
                    )}

                    {/* Actions — one primary per card, the rest outline. */}
                    <div className="mt-auto space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewMetrics(project)}
                          aria-label={`View your metrics for ${projectName}`}
                        >
                          <BarChart3 className="h-4 w-4" aria-hidden="true" />
                          Metrics
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewTimeline(project)}
                          aria-label={`View timeline for ${projectName}`}
                        >
                          <GanttChartSquare className="h-4 w-4" aria-hidden="true" />
                          Timeline
                        </Button>
                      </div>
                      <Button
                        className="w-full"
                        size="sm"
                        onClick={() => handleViewProject(project)}
                        aria-label={`View details for ${projectName}`}
                      >
                        <Eye className="h-4 w-4" aria-hidden="true" />
                        View details
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={FolderKanban}
            title={filterStatus === "all" ? "No projects yet" : `No ${filterStatus} projects`}
            description={
              filterStatus === "all"
                ? "You haven't been assigned any projects yet. Anything assigned to you shows up here."
                : "Nothing matches this filter — try another status."
            }
            action={
              filterStatus !== "all" ? (
                <Button onClick={() => setFilterStatus("all")}>Show all projects</Button>
              ) : undefined
            }
          />
        )}
        </div>
      </div>
    </div>
  );
}