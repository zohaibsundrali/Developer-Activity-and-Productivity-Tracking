"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckSquare,
  Check,
  X,
  RotateCcw,
  MessageSquare,
  RefreshCw,
  CheckCircle2,
  XCircle,
  History,
} from "lucide-react";
import { authFetch } from "@/utils/authFetch";
import { showSuccess } from "@/utils/alerts";
import {
  Spinner,
  EmptyState,
  ErrorState,
  StatusBadge,
  SectionHeader,
  formatDateTime,
  formatRelativeTime,
  humanize,
} from "./ClientShared";

// The three decisions a client can make. `request_changes` and `reject` carry a
// mandatory note: the route answers 400 without one, and more to the point a
// decision the team cannot act on is not a decision.
const DECISIONS = [
  {
    action: "approve",
    label: "Approve",
    icon: Check,
    requiresNote: false,
    className: "bg-success text-success-foreground hover:bg-success/90",
    successTitle: "Approved",
  },
  {
    action: "request_changes",
    label: "Request changes",
    icon: RotateCcw,
    requiresNote: true,
    className: "bg-warning/10 text-warning hover:bg-warning/20",
    successTitle: "Changes requested",
  },
  {
    action: "reject",
    label: "Reject",
    icon: X,
    requiresNote: true,
    className: "bg-destructive/10 text-destructive hover:bg-destructive/20",
    successTitle: "Rejected",
  },
];

// Matches the actions the audit trail records (migration 032).
const HISTORY_META = {
  approved: { icon: CheckCircle2, tone: "bg-success/10 text-success" },
  rejected: { icon: XCircle, tone: "bg-destructive/10 text-destructive" },
  changes_requested: { icon: RotateCcw, tone: "bg-warning/10 text-warning" },
  commented: { icon: MessageSquare, tone: "bg-muted text-muted-foreground" },
  reopened: { icon: RefreshCw, tone: "bg-info/10 text-info" },
};

const HISTORY_FALLBACK = { icon: History, tone: "bg-muted text-muted-foreground" };

const timeOf = (value) => {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

export default function ClientApprovals({ onViewProject }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState({});
  const [noteErrors, setNoteErrors] = useState({});
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const res = await authFetch("/api/client/approvals");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Failed to load approvals.");
        return;
      }
      setItems(Array.isArray(data.approvals) ? data.approvals : []);
    } catch {
      setError("Something went wrong while loading approvals.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Pending first — the whole point of the screen is the decisions still owed.
  const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      const aPending = a.status === "pending" ? 0 : 1;
      const bPending = b.status === "pending" ? 0 : 1;
      if (aPending !== bPending) return aPending - bPending;
      return timeOf(b.created_at) - timeOf(a.created_at);
    });
  }, [items]);

  const pendingCount = useMemo(
    () => items.filter((item) => item.status === "pending").length,
    [items]
  );

  const handleDecision = async (approval, decision) => {
    const note = (notes[approval.id] || "").trim();

    // Blocked here as well as in the disabled button, because a keyboard submit
    // must not be able to slip past the visual guard.
    if (decision.requiresNote && !note) {
      setNoteErrors((prev) => ({
        ...prev,
        [approval.id]: `Please explain what needs to change before you ${decision.label.toLowerCase()}.`,
      }));
      return;
    }

    setBusyId(approval.id);
    setNoteErrors((prev) => ({ ...prev, [approval.id]: "" }));

    try {
      const res = await authFetch(`/api/client/approvals/${approval.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(note ? { action: decision.action, note } : { action: decision.action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNoteErrors((prev) => ({
          ...prev,
          [approval.id]: data?.error || "Could not submit your decision. Please try again.",
        }));
        return;
      }

      // The response carries the new status and the appended audit row, so the
      // server's version replaces the local one rather than being guessed at.
      if (data.approval) {
        setItems((prev) => prev.map((item) => (item.id === approval.id ? data.approval : item)));
      } else {
        load();
      }
      setNotes((prev) => ({ ...prev, [approval.id]: "" }));
      showSuccess(decision.successTitle, "Your decision has been recorded.");
    } catch {
      setNoteErrors((prev) => ({
        ...prev,
        [approval.id]: "Something went wrong. Please try again.",
      }));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <Spinner label="Loading approvals…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Approvals"
        subtitle="Review and respond to items awaiting your sign-off"
        right={
          <div className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{pendingCount}</span> pending
          </div>
        }
      />

      {sorted.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title="Nothing to approve"
          message="When your agency requests approval on something, it'll show up here."
        />
      ) : (
        <div className="space-y-4">
          {sorted.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              note={notes[approval.id] || ""}
              noteError={noteErrors[approval.id] || ""}
              busy={busyId === approval.id}
              onNoteChange={(value) => {
                setNotes((prev) => ({ ...prev, [approval.id]: value }));
                setNoteErrors((prev) => ({ ...prev, [approval.id]: "" }));
              }}
              onDecision={(decision) => handleDecision(approval, decision)}
              onViewProject={onViewProject}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ApprovalCard({ approval, note, noteError, busy, onNoteChange, onDecision, onViewProject }) {
  const [showHistory, setShowHistory] = useState(false);
  const pending = approval.status === "pending";
  const history = Array.isArray(approval.history) ? approval.history : [];
  const hasNote = note.trim().length > 0;

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-foreground">{approval.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {approval.project_name &&
              (onViewProject ? (
                <button
                  onClick={() => onViewProject(approval.project_id)}
                  className="font-medium text-primary hover:underline"
                >
                  {approval.project_name}
                </button>
              ) : (
                <span className="font-medium text-primary">{approval.project_name}</span>
              ))}
            {approval.item_type && (
              <span className="rounded-full bg-muted px-2.5 py-1 font-medium text-muted-foreground">
                {humanize(approval.item_type)}
              </span>
            )}
            <span className="text-muted-foreground">Requested {formatRelativeTime(approval.created_at)}</span>
          </div>
          {approval.description && (
            <p className="mt-2 whitespace-pre-line break-words text-sm text-muted-foreground">
              {approval.description}
            </p>
          )}
        </div>
        <StatusBadge status={approval.status} />
      </div>

      {pending && (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          <div>
            <label
              htmlFor={`approval-note-${approval.id}`}
              className="mb-1 block text-sm font-medium text-foreground"
            >
              Note{" "}
              <span className="font-normal text-muted-foreground">
                — required to request changes or reject
              </span>
            </label>
            <textarea
              id={`approval-note-${approval.id}`}
              value={note}
              onChange={(e) => onNoteChange(e.target.value)}
              placeholder="Tell the team what you'd like changed…"
              rows={3}
              className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {noteError && <p className="text-sm text-destructive">{noteError}</p>}

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {DECISIONS.map((decision) => {
              const Icon = decision.icon;
              const blocked = decision.requiresNote && !hasNote;
              return (
                <button
                  key={decision.action}
                  onClick={() => onDecision(decision)}
                  disabled={busy || blocked}
                  title={blocked ? "Add a note first" : undefined}
                  className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${decision.className}`}
                >
                  <Icon className="mr-1.5 h-4 w-4" />
                  {decision.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-4 border-t border-border pt-4">
          <button
            onClick={() => setShowHistory((open) => !open)}
            aria-expanded={showHistory}
            className="inline-flex items-center text-sm font-medium text-primary hover:underline"
          >
            <History className="mr-1.5 h-4 w-4" />
            {showHistory ? "Hide history" : `View history (${history.length})`}
          </button>

          {showHistory && (
            <ol className="relative mt-4 space-y-3 border-l border-border pl-5">
              {history.map((event) => {
                const meta = HISTORY_META[event.action] || HISTORY_FALLBACK;
                const Icon = meta.icon;
                return (
                  <li key={event.id} className="relative">
                    <span
                      className={`absolute -left-[29px] top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-card ${meta.tone}`}
                    >
                      <Icon className="h-2.5 w-2.5" />
                    </span>
                    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                      <p className="min-w-0 text-sm font-medium text-foreground">
                        {humanize(event.action)}
                        {event.actor_name && (
                          <span className="font-normal text-muted-foreground"> by {event.actor_name}</span>
                        )}
                      </p>
                      <span className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDateTime(event.created_at)}
                      </span>
                    </div>
                    {event.note && (
                      <p className="mt-1 whitespace-pre-line break-words text-sm text-muted-foreground">
                        {event.note}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
