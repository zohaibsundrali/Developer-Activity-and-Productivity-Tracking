"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  FileText,
  CalendarDays,
  Package,
  Megaphone,
  ListTodo,
  Users,
  MessagesSquare,
  Download,
  Flag,
  Paperclip,
  CheckCircle2,
} from "lucide-react";
import { authFetch } from "@/utils/authFetch";
import { showError } from "@/utils/alerts";
import ClientTimeline from "./ClientTimeline";
import ClientProjectComments from "./ClientProjectComments";
import {
  Spinner,
  EmptyState,
  ErrorState,
  StatusBadge,
  HealthBadge,
  ProgressBar,
  healthMeta,
  formatDate,
  formatDateTime,
  formatFileSize,
  humanize,
} from "./ClientShared";

const TABS = [
  { id: "overview", label: "Overview", icon: FileText },
  { id: "milestones", label: "Milestones", icon: Flag },
  { id: "tasks", label: "Tasks", icon: ListTodo },
  { id: "team", label: "Team", icon: Users },
  { id: "timeline", label: "Timeline", icon: CalendarDays },
  { id: "deliverables", label: "Deliverables", icon: Package },
  { id: "updates", label: "Updates", icon: Megaphone },
  { id: "comments", label: "Conversation", icon: MessagesSquare },
];

// Priority arrives as a free-form string. Known words get a tone; anything else
// is shown verbatim in the neutral style rather than being guessed at.
const PRIORITY_TONES = {
  urgent: "bg-destructive/10 text-destructive",
  critical: "bg-destructive/10 text-destructive",
  highest: "bg-destructive/10 text-destructive",
  high: "bg-warning/10 text-warning",
  medium: "bg-info/10 text-info",
  normal: "bg-info/10 text-info",
  low: "bg-muted text-muted-foreground",
  lowest: "bg-muted text-muted-foreground",
};

const asArray = (value) => (Array.isArray(value) ? value : []);

const timeOf = (value) => {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
};

// Undated rows sink to the bottom instead of pretending to be due at epoch.
const byDateAsc = (a, b) => {
  const at = timeOf(a);
  const bt = timeOf(b);
  if (at === bt) return 0;
  if (at === null) return 1;
  if (bt === null) return -1;
  return at - bt;
};

export default function ClientProjectDetail({ projectId, onBack }) {
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("overview");
  const [downloadingId, setDownloadingId] = useState(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setLoading(true);
      setError("");
      const res = await authFetch(`/api/client/projects/${projectId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Failed to load project details.");
        return;
      }
      setProject(data.project || null);
    } catch {
      setError("Something went wrong while loading this project.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const milestones = useMemo(
    () => [...asArray(project?.milestones)].sort((a, b) => byDateAsc(a.due_date, b.due_date)),
    [project]
  );

  const tasks = useMemo(
    () => [...asArray(project?.tasks)].sort((a, b) => byDateAsc(a.due_date, b.due_date)),
    [project]
  );

  const team = useMemo(() => asArray(project?.team), [project]);

  const deliverables = useMemo(
    () =>
      [...asArray(project?.deliverables)].sort(
        (a, b) => (timeOf(b.submitted_at) ?? 0) - (timeOf(a.submitted_at) ?? 0)
      ),
    [project]
  );

  const updates = useMemo(
    () =>
      [...asArray(project?.updates)].sort(
        (a, b) => (timeOf(b.created_at) ?? 0) - (timeOf(a.created_at) ?? 0)
      ),
    [project]
  );

  const handleDownload = async (deliverable) => {
    try {
      setDownloadingId(deliverable.id);
      const res = await authFetch(`/api/client/deliverables/${deliverable.id}/url`);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload?.url) {
        showError("Download failed", payload?.error || "Could not get a download link.");
        return;
      }
      window.open(payload.url, "_blank", "noopener,noreferrer");
    } catch {
      showError("Download failed", "Something went wrong. Please try again.");
    } finally {
      setDownloadingId(null);
    }
  };

  if (loading) return <Spinner label="Loading project details…" />;

  if (error || !project) {
    return (
      <div className="space-y-4">
        <BackButton onBack={onBack} />
        <ErrorState message={error || "This project could not be loaded."} onRetry={load} />
      </div>
    );
  }

  const health = healthMeta(project.health);

  return (
    <div className="space-y-6">
      <BackButton onBack={onBack} />

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <div className="bg-primary p-5 text-primary-foreground sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-xl font-bold sm:text-3xl">{project.name}</h1>
              {project.deadline && (
                <p className="mt-2 text-sm text-primary-foreground/80">
                  Deadline: {formatDate(project.deadline)}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <HealthBadge health={project.health} className="bg-white/20 text-white" />
              <StatusBadge status={project.status} className="bg-white/20 text-white" />
            </div>
          </div>
        </div>

        <div className="flex gap-1 overflow-x-auto border-b border-border px-2 sm:px-4">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors sm:px-4 ${
                  active
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="p-4 sm:p-6">
          {tab === "overview" && <OverviewTab project={project} health={health} />}
          {tab === "milestones" && <MilestonesTab milestones={milestones} />}
          {tab === "tasks" && <TasksTab tasks={tasks} />}
          {tab === "team" && <TeamTab team={team} />}
          {tab === "timeline" && <ClientTimeline projectId={projectId} />}
          {tab === "deliverables" && (
            <DeliverablesTab
              deliverables={deliverables}
              onDownload={handleDownload}
              downloadingId={downloadingId}
            />
          )}
          {tab === "updates" && <UpdatesTab updates={updates} />}
          {tab === "comments" && <ClientProjectComments projectId={projectId} />}
        </div>
      </div>
    </div>
  );
}

function BackButton({ onBack }) {
  return (
    <button
      onClick={onBack}
      className="inline-flex items-center rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-card transition-all hover:bg-muted"
    >
      <ArrowLeft className="mr-2 h-4 w-4" />
      Back to Projects
    </button>
  );
}

function OverviewTab({ project, health }) {
  const pct = Math.max(0, Math.min(100, Number(project.progress) || 0));

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-muted/50 p-5 sm:p-6">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="text-base font-semibold text-foreground">Completion Status</span>
            <p className="text-sm text-muted-foreground">Progress across the work you can see</p>
          </div>
          <div className="flex items-center gap-3">
            <HealthBadge health={project.health} />
            <span className="text-3xl font-bold text-primary tabular-nums">{pct}%</span>
          </div>
        </div>
        <ProgressBar value={project.progress} showLabel={false} tone={health?.barTone} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <InfoTile label="Status" value={humanize(project.status) || "—"} />
        <InfoTile label="Start" value={project.start_date ? formatDate(project.start_date) : "Not set"} />
        <InfoTile label="End" value={project.end_date ? formatDate(project.end_date) : "Not set"} />
        <InfoTile label="Deadline" value={project.deadline ? formatDate(project.deadline) : "Not set"} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <InfoTile label="Open tasks" value={Number(project.open_tasks) || 0} />
        <InfoTile label="Awaiting your approval" value={Number(project.pending_approvals) || 0} />
      </div>

      <div>
        <h3 className="mb-3 text-base font-bold text-foreground">Description</h3>
        {project.description ? (
          <div className="space-y-3 rounded-xl border border-border bg-muted/50 p-5 text-foreground sm:p-6">
            {String(project.description)
              .split("\n")
              .map((paragraph, index) => (
                <p key={index} className="leading-relaxed">
                  {paragraph}
                </p>
              ))}
          </div>
        ) : (
          <p className="rounded-xl border border-border bg-muted/50 p-5 text-muted-foreground sm:p-6">
            No description provided for this project.
          </p>
        )}
      </div>
    </div>
  );
}

function InfoTile({ label, value }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-card">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function MilestonesTab({ milestones }) {
  if (milestones.length === 0) {
    return (
      <EmptyState
        icon={Flag}
        title="No milestones yet"
        message="Milestones for this project will show up here."
      />
    );
  }

  return (
    <ol className="relative space-y-4 border-l border-border pl-5 sm:pl-6">
      {milestones.map((milestone) => (
        <li key={milestone.id} className="relative">
          <span
            className={`absolute -left-[30px] top-3 flex h-6 w-6 items-center justify-center rounded-full border-2 border-card sm:-left-[34px] ${
              milestone.completed_at ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
            }`}
          >
            {milestone.completed_at ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Flag className="h-3 w-3" />}
          </span>
          <div className="rounded-xl border border-border bg-card p-4 shadow-card">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <p className="min-w-0 font-semibold text-foreground">{milestone.title}</p>
              <StatusBadge status={milestone.status} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                Due: <span className="font-medium text-foreground">{formatDate(milestone.due_date)}</span>
              </span>
              {milestone.completed_at && (
                <span>
                  Completed:{" "}
                  <span className="font-medium text-success">{formatDate(milestone.completed_at)}</span>
                </span>
              )}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function TasksTab({ tasks }) {
  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={ListTodo}
        title="No tasks to show"
        message="Tasks shared with you will appear here as work progresses."
      />
    );
  }

  return (
    <ul className="space-y-3">
      {tasks.map((task) => {
        const priorityKey = String(task.priority || "").toLowerCase().trim();
        const labels = Array.isArray(task.labels) ? task.labels : [];
        return (
          <li key={task.id} className="rounded-xl border border-border bg-card p-4 shadow-card">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <p className="min-w-0 font-semibold text-foreground">{task.title}</p>
              <StatusBadge status={task.status} />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
              {task.priority && (
                <span
                  className={`rounded-full px-2.5 py-1 font-semibold ${
                    PRIORITY_TONES[priorityKey] || "bg-muted text-muted-foreground"
                  }`}
                >
                  {humanize(task.priority)}
                </span>
              )}
              {task.due_date && (
                <span>
                  Due: <span className="font-medium text-foreground">{formatDate(task.due_date)}</span>
                </span>
              )}
              {task.assignee_name && (
                <span>
                  Assigned to <span className="font-medium text-foreground">{task.assignee_name}</span>
                </span>
              )}
              {Number(task.attachment_count) > 0 && (
                <span className="inline-flex items-center">
                  <Paperclip className="mr-1 h-3.5 w-3.5" />
                  {Number(task.attachment_count)}
                </span>
              )}
            </div>

            {labels.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {labels.map((label) => (
                  <span
                    key={label}
                    className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
                  >
                    {label}
                  </span>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function TeamTab({ team }) {
  if (team.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No team members listed"
        message="The people assigned to your project will appear here."
      />
    );
  }

  // Name and role are the only two fields the contract sends, and the only two
  // rendered. Contact details for staff never belong on a client screen.
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {team.map((member) => (
        <li
          key={member.id}
          className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-card"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-bold text-primary">
            {String(member.name || "?").trim().charAt(0).toUpperCase() || "?"}
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold text-foreground">{member.name}</p>
            <p className="truncate text-sm text-muted-foreground">{humanize(member.role)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function DeliverablesTab({ deliverables, onDownload, downloadingId }) {
  if (deliverables.length === 0) {
    return (
      <EmptyState icon={Package} title="No deliverables yet" message="Files shared with you will appear here." />
    );
  }

  return (
    <ul className="space-y-3">
      {deliverables.map((deliverable) => {
        const size = formatFileSize(deliverable.file_size);
        return (
          <li
            key={deliverable.id}
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-card sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FileText className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground">{deliverable.file_name}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {deliverable.file_type && <span>{deliverable.file_type}</span>}
                  {size && <span>{size}</span>}
                  {deliverable.submitted_at && <span>{formatDate(deliverable.submitted_at)}</span>}
                </div>
              </div>
            </div>
            <button
              onClick={() => onDownload(deliverable)}
              disabled={downloadingId === deliverable.id}
              className="inline-flex shrink-0 items-center justify-center rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              <Download className="mr-1.5 h-4 w-4" />
              {downloadingId === deliverable.id ? "Preparing…" : "Download"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function UpdatesTab({ updates }) {
  if (updates.length === 0) {
    return (
      <EmptyState icon={Megaphone} title="No updates yet" message="Project updates from your team will appear here." />
    );
  }

  return (
    <ol className="relative space-y-4 border-l border-border pl-5 sm:pl-6">
      {updates.map((update) => (
        <li key={update.id} className="relative">
          <span className="absolute -left-[27px] top-3 h-3 w-3 rounded-full border-2 border-card bg-primary sm:-left-[31px]" />
          <div className="rounded-xl border border-border bg-card p-4 shadow-card">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
              <p className="min-w-0 font-semibold text-foreground">{update.title}</p>
              <span className="whitespace-nowrap text-xs text-muted-foreground">
                {formatDateTime(update.created_at)}
              </span>
            </div>
            {update.body && (
              <p className="mt-1.5 whitespace-pre-line break-words text-sm text-muted-foreground">{update.body}</p>
            )}
            {update.author_name && (
              <p className="mt-2 text-xs text-muted-foreground">{update.author_name}</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
