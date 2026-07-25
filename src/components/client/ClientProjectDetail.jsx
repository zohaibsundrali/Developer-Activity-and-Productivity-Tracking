"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ArrowLeft,
  FileText,
  CalendarDays,
  Package,
  Megaphone,
  CheckSquare,
  Download,
  Milestone as MilestoneIcon,
  Check,
  X,
} from "lucide-react";
import { authFetch } from "@/utils/authFetch";
import { showSuccess, showError } from "@/utils/alerts";
import {
  Spinner,
  EmptyState,
  ErrorState,
  StatusBadge,
  ProgressBar,
  formatDate,
  formatDateTime,
  humanize,
} from "./ClientShared";

const TABS = [
  { id: "overview", label: "Overview", icon: FileText },
  { id: "milestones", label: "Milestones", icon: MilestoneIcon },
  { id: "timeline", label: "Timeline", icon: CalendarDays },
  { id: "deliverables", label: "Deliverables", icon: Package },
  { id: "updates", label: "Updates", icon: Megaphone },
  { id: "approvals", label: "Approvals", icon: CheckSquare },
];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export default function ClientProjectDetail({ projectId, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("overview");
  const [downloadingId, setDownloadingId] = useState(null);
  const [decidingId, setDecidingId] = useState(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setLoading(true);
      setError("");
      const res = await authFetch(`/api/client/projects/${projectId}`);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload?.error || "Failed to load project details.");
        return;
      }
      setData(payload);
    } catch {
      setError("Something went wrong while loading this project.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

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

  const handleDecision = async (approval, decision) => {
    try {
      setDecidingId(approval.id);
      const res = await authFetch(`/api/client/approvals/${approval.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError("Action failed", payload?.error || "Could not submit your decision.");
        return;
      }
      // Optimistic local update
      setData((prev) => {
        if (!prev) return prev;
        const approvals = asArray(prev.approvals).map((a) =>
          a.id === approval.id ? { ...a, status: decision === "approve" ? "approved" : "rejected" } : a
        );
        return { ...prev, approvals };
      });
      showSuccess(decision === "approve" ? "Approved" : "Rejected", "Your decision has been recorded.");
    } catch {
      showError("Action failed", "Something went wrong. Please try again.");
    } finally {
      setDecidingId(null);
    }
  };

  if (loading) return <Spinner label="Loading project details…" />;
  if (error) {
    return (
      <div className="space-y-4">
        <BackButton onBack={onBack} />
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }

  const project = data?.project || data || {};
  const milestones = asArray(data?.milestones);
  const tasks = asArray(data?.tasks);
  const deliverables = asArray(data?.deliverables);
  const updates = asArray(data?.updates || data?.project_updates);
  const approvals = asArray(data?.approvals);

  return (
    <div className="space-y-6">
      <BackButton onBack={onBack} />

      {/* Header */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <div className="bg-primary p-6 text-primary-foreground sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold sm:text-3xl">{project.name || "Untitled Project"}</h1>
              {project.deadline && (
                <p className="mt-2 text-sm text-primary-foreground/80">
                  Deadline: {formatDate(project.deadline)}
                </p>
              )}
            </div>
            <StatusBadge status={project.status} className="bg-white/20 text-white" />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto border-b border-border px-2 sm:px-4">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
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

        <div className="p-5 sm:p-6">
          {tab === "overview" && <OverviewTab project={project} />}
          {tab === "milestones" && <MilestonesTab milestones={milestones} />}
          {tab === "timeline" && <TimelineTab tasks={tasks} />}
          {tab === "deliverables" && (
            <DeliverablesTab
              deliverables={deliverables}
              onDownload={handleDownload}
              downloadingId={downloadingId}
            />
          )}
          {tab === "updates" && <UpdatesTab updates={updates} />}
          {tab === "approvals" && (
            <ApprovalsTab approvals={approvals} onDecision={handleDecision} decidingId={decidingId} />
          )}
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

function OverviewTab({ project }) {
  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-border bg-muted/50 p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <span className="text-base font-semibold text-foreground">Completion Status</span>
            <p className="text-sm text-muted-foreground">Progress toward completion</p>
          </div>
          <span className="text-3xl font-bold text-primary">{Math.max(0, Math.min(100, Number(project.progress) || 0))}%</span>
        </div>
        <ProgressBar value={project.progress} showLabel={false} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <InfoTile label="Status" value={humanize(project.status) || "—"} />
        <InfoTile label="Deadline" value={project.deadline ? formatDate(project.deadline) : "Not set"} />
        <InfoTile label="Created" value={project.created_at ? formatDate(project.created_at) : "—"} />
      </div>

      <div>
        <h3 className="mb-3 text-base font-bold text-foreground">Description</h3>
        {project.description ? (
          <div className="space-y-3 rounded-2xl border border-border bg-muted/50 p-6 text-foreground">
            {String(project.description)
              .split("\n")
              .map((p, i) => (
                <p key={i} className="leading-relaxed">
                  {p}
                </p>
              ))}
          </div>
        ) : (
          <p className="rounded-2xl border border-border bg-muted/50 p-6 text-muted-foreground">
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
      <p className="mt-1 text-sm font-semibold text-foreground break-words">{value}</p>
    </div>
  );
}

function MilestonesTab({ milestones }) {
  if (milestones.length === 0) {
    return <EmptyState icon={MilestoneIcon} title="No milestones yet" message="Milestones for this project will show up here." />;
  }
  return (
    <ul className="space-y-3">
      {milestones.map((m) => (
        <li
          key={m.id}
          className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card p-4 shadow-card"
        >
          <div className="min-w-0">
            <p className="font-semibold text-foreground">{m.title || m.name || "Milestone"}</p>
            {m.description && <p className="mt-1 text-sm text-muted-foreground">{m.description}</p>}
            <p className="mt-2 text-xs text-muted-foreground">
              Due: <span className="font-medium text-foreground">{formatDate(m.due_date || m.deadline)}</span>
            </p>
          </div>
          <StatusBadge status={m.status} />
        </li>
      ))}
    </ul>
  );
}

function TimelineTab({ tasks }) {
  if (tasks.length === 0) {
    return <EmptyState icon={CalendarDays} title="No tasks to show" message="The project timeline will appear here as work progresses." />;
  }
  return (
    <ul className="space-y-3">
      {tasks.map((t) => (
        <li
          key={t.id}
          className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card p-4 shadow-card"
        >
          <div className="min-w-0">
            <p className="font-semibold text-foreground">{t.title || t.name || "Task"}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {(t.start_date || t.created_at) && (
                <span>Start: <span className="font-medium text-foreground">{formatDate(t.start_date || t.created_at)}</span></span>
              )}
              {(t.due_date || t.end_date || t.deadline) && (
                <span>Due: <span className="font-medium text-foreground">{formatDate(t.due_date || t.end_date || t.deadline)}</span></span>
              )}
            </div>
          </div>
          <StatusBadge status={t.status} />
        </li>
      ))}
    </ul>
  );
}

function DeliverablesTab({ deliverables, onDownload, downloadingId }) {
  if (deliverables.length === 0) {
    return <EmptyState icon={Package} title="No deliverables yet" message="Files shared with you will appear here." />;
  }
  return (
    <ul className="space-y-3">
      {deliverables.map((d) => (
        <li
          key={d.id}
          className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-card sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileText className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate font-semibold text-foreground">{d.name || d.file_name || "Deliverable"}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {(d.type || d.file_type) && <span>{humanize(d.type || d.file_type)}</span>}
                {(d.created_at || d.date) && <span>{formatDate(d.created_at || d.date)}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 sm:justify-end">
            {(d.review_status || d.status) && <StatusBadge status={d.review_status || d.status} />}
            <button
              onClick={() => onDownload(d)}
              disabled={downloadingId === d.id}
              className="inline-flex items-center rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              <Download className="mr-1.5 h-4 w-4" />
              {downloadingId === d.id ? "Preparing…" : "Download"}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function UpdatesTab({ updates }) {
  if (updates.length === 0) {
    return <EmptyState icon={Megaphone} title="No updates yet" message="Project updates from your team will appear here." />;
  }
  return (
    <ol className="relative space-y-6 border-l border-border pl-6">
      {updates.map((u) => (
        <li key={u.id} className="relative">
          <span className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 border-card bg-primary" />
          <div className="rounded-xl border border-border bg-card p-4 shadow-card">
            <div className="mb-1 flex items-center justify-between gap-3">
              <p className="font-semibold text-foreground">{u.title || "Update"}</p>
              <span className="text-xs text-muted-foreground">
                {formatDateTime(u.created_at || u.published_at || u.date)}
              </span>
            </div>
            {u.body && <p className="text-sm text-muted-foreground whitespace-pre-line">{u.body}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function ApprovalsTab({ approvals, onDecision, decidingId }) {
  if (approvals.length === 0) {
    return <EmptyState icon={CheckSquare} title="No approvals" message="Items awaiting your approval will appear here." />;
  }
  return (
    <ul className="space-y-3">
      {approvals.map((a) => {
        const status = String(a.status || "").toLowerCase();
        const isPending = status === "pending" || status === "awaiting" || status === "open" || !status;
        return (
          <li key={a.id} className="rounded-xl border border-border bg-card p-4 shadow-card">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-semibold text-foreground">{a.title || a.subject || "Approval request"}</p>
                {a.description && <p className="mt-1 text-sm text-muted-foreground">{a.description}</p>}
                {(a.created_at || a.requested_at) && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Requested {formatDate(a.created_at || a.requested_at)}
                  </p>
                )}
              </div>
              <StatusBadge status={a.status || "pending"} />
            </div>
            {isPending && (
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => onDecision(a, "approve")}
                  disabled={decidingId === a.id}
                  className="inline-flex items-center rounded-lg bg-success px-4 py-2 text-sm font-medium text-success-foreground transition-colors hover:bg-success/90 disabled:opacity-60"
                >
                  <Check className="mr-1.5 h-4 w-4" />
                  Approve
                </button>
                <button
                  onClick={() => onDecision(a, "reject")}
                  disabled={decidingId === a.id}
                  className="inline-flex items-center rounded-lg bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-60"
                >
                  <X className="mr-1.5 h-4 w-4" />
                  Reject
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
