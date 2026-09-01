"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  FileText,
  Package,
  Megaphone,
  ListTodo,
  Users,
  Download,
  Flag,
  Paperclip,
  CheckCircle2,
} from "lucide-react";
import { authFetch } from "@/utils/authFetch";
import { showError } from "@/utils/alerts";
import { Button, Tabs } from "@/components/ui";
import ProjectClosurePanel from "@/components/shared/ProjectClosurePanel";
import ClientTimeline from "./ClientTimeline";
import ClientProjectComments from "./ClientProjectComments";
import ClientTaskDetail from "./ClientTaskDetail";
import {
  ClientPage,
  Panel,
  EmptyState,
  ErrorState,
  StatusBadge,
  HealthBadge,
  ProgressBar,
  DetailSkeleton,
  surface,
  healthMeta,
  formatDate,
  formatDateTime,
  formatFileSize,
  humanize,
} from "./ClientShared";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "milestones", label: "Milestones" },
  { id: "tasks", label: "Tasks" },
  { id: "team", label: "Team" },
  { id: "timeline", label: "Timeline" },
  { id: "deliverables", label: "Deliverables" },
  { id: "updates", label: "Updates" },
  { id: "comments", label: "Conversation" },
];

// Priority arrives as a free-form string. Known words get a tone; anything else
// is shown verbatim in the neutral style rather than being guessed at.
const PRIORITY_TONES = {
  urgent: "bg-destructive/10 text-destructive",
  critical: "bg-destructive/10 text-destructive",
  highest: "bg-destructive/10 text-destructive",
  high: "bg-warning/10 text-warning-on-tint",
  medium: "bg-info/10 text-info-on-tint",
  normal: "bg-info/10 text-info-on-tint",
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
  // The open task lives here rather than inside the tab so closing it comes
  // back to the same project, on the same tab, without a re-fetch.
  const [openTaskId, setOpenTaskId] = useState(null);

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

  if (loading) return <DetailSkeleton />;

  if (error || !project) {
    return (
      <ClientPage width="wide">
        <BackButton onBack={onBack} />
        <ErrorState description={error || "This project could not be loaded."} onRetry={load} />
      </ClientPage>
    );
  }

  // A task takes over the whole panel: it carries its own back control, and
  // stacking a second header above it would leave two "back" buttons meaning
  // two different things.
  if (openTaskId) {
    return <ClientTaskDetail taskId={openTaskId} onBack={() => setOpenTaskId(null)} />;
  }

  const health = healthMeta(project.health);

  return (
    <ClientPage width="wide">
      <BackButton onBack={onBack} />

      <div className={`${surface} overflow-hidden`}>
        {/* A quiet header, not a saturated banner: the project name is the
            loudest thing on the screen because it is the most important. */}
        <div className="border-b border-border bg-muted/50 p-6 sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-2">
              <h2 className="text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-3xl">
                {project.name || "Untitled project"}
              </h2>
              {/* The deadline is one of the four dated facts in the Overview
                  tab; repeating it here made the header say the same thing
                  twice for projects that have one and go quiet for those that
                  do not. */}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <HealthBadge health={project.health} />
              <StatusBadge status={project.status} />
            </div>
          </div>
        </div>

        <Tabs
          tabs={TABS.map((t) => ({ ...t, panelId: `client-project-panel-${t.id}` }))}
          active={tab}
          onChange={(id) => setTab(id)}
          aria-label="Project sections"
          className="px-2 sm:px-4"
        />

        <div
          id={`client-project-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`tab-${tab}`}
          tabIndex={0}
          className="p-6 sm:p-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {tab === "overview" && (
            <OverviewTab project={project} health={health} projectId={projectId} onChanged={load} />
          )}
          {tab === "milestones" && <MilestonesTab milestones={milestones} />}
          {tab === "tasks" && <TasksTab tasks={tasks} onOpenTask={setOpenTaskId} />}
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
    </ClientPage>
  );
}

function BackButton({ onBack }) {
  return (
    <Button variant="outline" size="lg" onClick={onBack}>
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Back to Projects
    </Button>
  );
}

function OverviewTab({ project, health, projectId, onChanged }) {
  const pct = Math.max(0, Math.min(100, Number(project.progress) || 0));

  return (
    <div className="space-y-8">
      {/* One progress indicator. The health badge already sits in the header
          above, so it is not repeated here. */}
      <div className="rounded-xl border border-border bg-muted/50 p-6">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold tracking-tight text-foreground">Completion status</h3>
            <p className="text-[15px] text-muted-foreground">Progress across the work you can see</p>
          </div>
          <span className="text-4xl font-semibold tabular-nums text-foreground">{pct}%</span>
        </div>
        <ProgressBar value={project.progress} showLabel={false} tone={health?.barTone} />
      </div>

      {/* Directly under the progress, because "are we finished?" is the same
          question and this is where the client answers it. The panel decides
          for itself whether there is anything to show — before the team marks
          the work complete it is three gray steps and no form. */}
      <ProjectClosurePanel projectId={projectId} onChanged={onChanged} />

      {/* The three dates, always all three, so the row never goes ragged.
          Status is not repeated here — the header pill carries it. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <InfoTile label="Start" value={formatDate(project.start_date)} />
        <InfoTile label="End" value={formatDate(project.end_date)} />
        <InfoTile label="Deadline" value={formatDate(project.deadline)} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <InfoTile label="Open tasks" value={Number(project.open_tasks) || 0} />
        <InfoTile label="Awaiting your approval" value={Number(project.pending_approvals) || 0} />
      </div>

      <section className="space-y-4">
        <h3 className="text-lg font-semibold tracking-tight text-foreground">Description</h3>
        {project.description ? (
          <div className="space-y-4 rounded-xl border border-border bg-muted/50 p-6 text-[15px] text-foreground">
            {String(project.description)
              .split("\n")
              .map((paragraph, index) => (
                <p key={index} className="leading-relaxed">
                  {paragraph}
                </p>
              ))}
          </div>
        ) : (
          <p className="rounded-xl border border-border bg-muted/50 p-6 text-[15px] text-muted-foreground">
            No description provided for this project.
          </p>
        )}
      </section>
    </div>
  );
}

function InfoTile({ label, value }) {
  return (
    <div className={`${surface} p-5`}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 break-words text-lg font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function MilestonesTab({ milestones }) {
  if (milestones.length === 0) {
    return (
      <EmptyState
        icon={Flag}
        title="No milestones yet"
        description="Milestones for this project will show up here."
      />
    );
  }

  return (
    <ol className="relative space-y-5 border-l border-border pl-6 sm:pl-7">
      {milestones.map((milestone) => (
        <li key={milestone.id} className="relative">
          <span
            className={`absolute -left-[36px] top-5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-card sm:-left-[40px] ${
              milestone.completed_at ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
            }`}
          >
            {milestone.completed_at ? (
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Flag className="h-3 w-3" aria-hidden="true" />
            )}
          </span>
          <Panel className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <p className="min-w-0 text-lg font-semibold leading-snug text-foreground">
                {milestone.title || "Untitled milestone"}
              </p>
              <StatusBadge status={milestone.status} />
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
              <span>
                Due:{" "}
                <span className="font-medium tabular-nums text-foreground">
                  {formatDate(milestone.due_date)}
                </span>
              </span>
              {milestone.completed_at && (
                <span>
                  Completed:{" "}
                  <span className="font-medium tabular-nums text-success">
                    {formatDate(milestone.completed_at)}
                  </span>
                </span>
              )}
            </div>
          </Panel>
        </li>
      ))}
    </ol>
  );
}

function TasksTab({ tasks, onOpenTask }) {
  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={ListTodo}
        title="No tasks to show"
        description="Tasks shared with you will appear here as work progresses."
      />
    );
  }

  return (
    <ul className="space-y-4">
      {tasks.map((task) => {
        const priorityKey = String(task.priority || "").toLowerCase().trim();
        const labels = Array.isArray(task.labels) ? task.labels : [];
        const taskTitle = task.title || "Untitled task";
        const attachments = Number(task.attachment_count) || 0;
        return (
          <li key={task.id}>
            {/* The whole row is the control: a client reads the title to decide
                whether to open it, so the title is what they should be able to
                hit — on a phone as much as with a keyboard. */}
            <button
              type="button"
              onClick={() => onOpenTask(task.id)}
              aria-label={`Open task ${taskTitle}`}
              className={`${surface} w-full space-y-4 p-6 text-left transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <p className="min-w-0 text-lg font-semibold leading-snug text-foreground">{taskTitle}</p>
                <StatusBadge status={task.status} />
              </div>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
                {task.priority && (
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      PRIORITY_TONES[priorityKey] || "bg-muted text-muted-foreground"
                    }`}
                  >
                    {humanize(task.priority)}
                  </span>
                )}
                {task.due_date && (
                  <span>
                    Due:{" "}
                    <span className="font-medium tabular-nums text-foreground">
                      {formatDate(task.due_date)}
                    </span>
                  </span>
                )}
                {task.assignee_name && (
                  <span>
                    Assigned to <span className="font-medium text-foreground">{task.assignee_name}</span>
                  </span>
                )}
                {attachments > 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="tabular-nums">{attachments}</span>{" "}
                    {attachments === 1 ? "file" : "files"}
                  </span>
                )}
              </div>

              {labels.length > 0 && (
                <div className="flex flex-wrap gap-2">
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
            </button>
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
        description="The people assigned to your project will appear here."
      />
    );
  }

  // Name and role are the only two fields the contract sends, and the only two
  // rendered. Contact details for staff never belong on a client screen.
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {team.map((member) => (
        <li key={member.id} className={`${surface} flex items-center gap-4 p-5`}>
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">
            {String(member.name || "?").trim().charAt(0).toUpperCase() || "?"}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-foreground">
              {member.name || "Unnamed member"}
            </p>
            <p className="truncate text-sm text-muted-foreground">
              {humanize(member.role) || "Team member"}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function DeliverablesTab({ deliverables, onDownload, downloadingId }) {
  if (deliverables.length === 0) {
    return (
      <EmptyState icon={Package} title="No deliverables yet" description="Files shared with you will appear here." />
    );
  }

  return (
    <ul className="space-y-4">
      {deliverables.map((deliverable) => {
        const size = formatFileSize(deliverable.file_size);
        return (
          <li
            key={deliverable.id}
            className={`${surface} flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between`}
          >
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FileText className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold text-foreground">
                  {deliverable.file_name || "Untitled file"}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  {deliverable.file_type && <span>{deliverable.file_type}</span>}
                  {size && <span className="tabular-nums">{size}</span>}
                  {deliverable.submitted_at && (
                    <span className="tabular-nums">{formatDate(deliverable.submitted_at)}</span>
                  )}
                </div>
              </div>
            </div>
            <Button
              size="lg"
              onClick={() => onDownload(deliverable)}
              disabled={downloadingId === deliverable.id}
              className="shrink-0"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {downloadingId === deliverable.id ? "Preparing…" : "Download"}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

function UpdatesTab({ updates }) {
  if (updates.length === 0) {
    return (
      <EmptyState icon={Megaphone} title="No updates yet" description="Project updates from your team will appear here." />
    );
  }

  return (
    <ol className="relative space-y-5 border-l border-border pl-6 sm:pl-7">
      {updates.map((update) => (
        <li key={update.id} className="relative">
          <span className="absolute -left-[33px] top-6 h-3 w-3 rounded-full border-2 border-card bg-primary sm:-left-[37px]" />
          <Panel className="space-y-2">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
              <p className="min-w-0 text-lg font-semibold leading-snug text-foreground">
                {update.title || "Untitled update"}
              </p>
              <span className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
                {formatDateTime(update.created_at)}
              </span>
            </div>
            {update.body && (
              <p className="whitespace-pre-line break-words text-[15px] leading-relaxed text-muted-foreground">
                {update.body}
              </p>
            )}
            {update.author_name && <p className="pt-1 text-sm text-muted-foreground">{update.author_name}</p>}
          </Panel>
        </li>
      ))}
    </ol>
  );
}
