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
import { Button, Modal, Field } from "@/components/ui";
import {
  ClientPage,
  Panel,
  EmptyState,
  ErrorState,
  StatusBadge,
  RowsSkeleton,
  formatDateTime,
  formatRelativeTime,
  humanize,
} from "./ClientShared";

// The three decisions a client can make. `request_changes` and `reject` carry a
// mandatory note: the route answers 400 without one, and more to the point a
// decision the team cannot act on is not a decision.
//
// All three are offered as equally real, equally reachable controls. Approve is
// the affirmative one and reads as such, but it is never the only button that
// looks pressable — a client who wants to say no must not have to hunt for it.
const DECISIONS = [
  {
    action: "approve",
    label: "Approve",
    icon: Check,
    requiresNote: false,
    className: "bg-success text-success-foreground hover:bg-success/90",
    successTitle: "Approved",
    // Copy for the confirmation step.
    question: "Approve this item?",
    consequence: "Your team will treat this as signed off and carry on with the work.",
    noteHint: "Add a note if there is anything the team should know (optional).",
  },
  {
    action: "request_changes",
    label: "Request changes",
    icon: RotateCcw,
    requiresNote: true,
    className: "bg-warning text-warning-foreground hover:bg-warning/90",
    successTitle: "Changes requested",
    question: "Request changes to this item?",
    consequence: "This goes back to your team with your note, and they will revise it.",
    noteHint: "Tell the team what needs to change. This is required.",
  },
  {
    action: "reject",
    label: "Reject",
    icon: X,
    requiresNote: true,
    className: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
    successTitle: "Rejected",
    question: "Reject this item?",
    consequence: "This is recorded as declined. Your team will need to propose something else.",
    noteHint: "Explain why you are rejecting this. This is required.",
  },
];

// Outline styling for the card-level triggers, so all three decisions carry the
// same weight before one is chosen and the colour still says which is which.
const TRIGGER_STYLES = {
  approve: "border-success/50 text-success hover:bg-success/10 hover:text-success",
  request_changes: "border-warning/50 text-warning hover:bg-warning/10 hover:text-warning",
  reject: "border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive",
};

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

  if (loading) {
    return (
      <ClientPage title="Approvals" description="Review and respond to items awaiting your sign-off">
        <RowsSkeleton count={3} />
      </ClientPage>
    );
  }

  if (error) {
    return (
      <ClientPage title="Approvals" description="Review and respond to items awaiting your sign-off">
        <ErrorState message={error} onRetry={load} />
      </ClientPage>
    );
  }

  return (
    <ClientPage
      title="Approvals"
      description="Review and respond to items awaiting your sign-off"
      actions={
        <span className="text-base text-muted-foreground">
          <span className="font-semibold text-foreground">{pendingCount}</span> awaiting you
        </span>
      }
    >
      {sorted.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title="Nothing to approve"
          message="When your agency requests approval on something, it'll show up here."
        />
      ) : (
        <div className="space-y-6">
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
    </ClientPage>
  );
}

function ApprovalCard({ approval, note, noteError, busy, onNoteChange, onDecision, onViewProject }) {
  const pending = approval.status === "pending";

  const [confirming, setConfirming] = useState(null);
  const [showHistory, setShowHistory] = useState(!pending);

  // The server's reply replaces this row, so the moment it stops being pending
  // the decision succeeded: close the dialog and open the record. A failure
  // leaves the row pending, which keeps the dialog up with the error on it.
  useEffect(() => {
    if (!pending) {
      setConfirming(null);
      setShowHistory(true);
    }
  }, [pending]);

  const history = Array.isArray(approval.history) ? approval.history : [];
  const hasNote = note.trim().length > 0;

  return (
    <Panel className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <h3 className="text-lg font-semibold leading-snug text-foreground">{approval.title}</h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
            {approval.project_name &&
              (onViewProject ? (
                <button
                  onClick={() => onViewProject(approval.project_id)}
                  className="rounded-sm font-medium text-primary transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {approval.project_name}
                </button>
              ) : (
                <span className="font-medium text-primary">{approval.project_name}</span>
              ))}
            {approval.item_type && (
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                {humanize(approval.item_type)}
              </span>
            )}
            <span>Requested {formatRelativeTime(approval.created_at)}</span>
          </div>
          {approval.description && (
            <p className="whitespace-pre-line break-words pt-1 text-[15px] leading-relaxed text-muted-foreground">
              {approval.description}
            </p>
          )}
        </div>
        <StatusBadge status={approval.status} />
      </div>

      {pending && (
        <div className="space-y-4 border-t border-border pt-6">
          <p className="text-sm font-medium text-foreground">What would you like to do?</p>

          {/* Three real choices, same size and same weight. Each opens a
              confirmation that restates what is being decided before anything
              is sent — nothing here submits on a single click. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {DECISIONS.map((decision) => {
              const Icon = decision.icon;
              return (
                <Button
                  key={decision.action}
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={() => setConfirming(decision)}
                  disabled={busy}
                  className={`h-11 w-full ${TRIGGER_STYLES[decision.action]}`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {decision.label}
                </Button>
              );
            })}
          </div>

          {noteError && !confirming && (
            <p className="text-sm text-destructive" role="alert">
              {noteError}
            </p>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div className="space-y-4 border-t border-border pt-6">
          <button
            onClick={() => setShowHistory((open) => !open)}
            aria-expanded={showHistory}
            className="inline-flex items-center gap-2 rounded-sm text-sm font-medium text-primary transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <History className="h-4 w-4" aria-hidden="true" />
            {showHistory
              ? pending
                ? "Hide history"
                : "Hide decision record"
              : pending
              ? `View history (${history.length})`
              : `View decision record (${history.length})`}
          </button>

          {showHistory && (
            <ol className="relative space-y-5 border-l border-border pl-6">
              {history.map((event) => {
                const meta = HISTORY_META[event.action] || HISTORY_FALLBACK;
                const Icon = meta.icon;
                return (
                  <li key={event.id} className="relative">
                    <span
                      className={`absolute -left-[30px] top-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-card ${meta.tone}`}
                    >
                      <Icon className="h-3 w-3" aria-hidden="true" />
                    </span>
                    <div className="space-y-1.5">
                      <p className="text-[15px] font-medium text-foreground">
                        {humanize(event.action)}
                        {event.actor_name && (
                          <span className="font-normal text-muted-foreground"> by {event.actor_name}</span>
                        )}
                      </p>
                      <p className="text-sm text-muted-foreground">{formatDateTime(event.created_at)}</p>
                      {event.note && (
                        <p className="whitespace-pre-line break-words pt-1 text-[15px] leading-relaxed text-foreground">
                          {event.note}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}

      <DecisionDialog
        approval={approval}
        decision={confirming}
        note={note}
        noteError={noteError}
        busy={busy}
        hasNote={hasNote}
        onNoteChange={onNoteChange}
        onCancel={() => setConfirming(null)}
        onConfirm={onDecision}
      />
    </Panel>
  );
}

// The confirmation step. It restates the thing being decided in full — title,
// project, type, when it was requested — so nobody agrees to "Item #4".
function DecisionDialog({
  approval,
  decision,
  note,
  noteError,
  busy,
  hasNote,
  onNoteChange,
  onCancel,
  onConfirm,
}) {
  if (!decision) return null;

  const Icon = decision.icon;
  const blocked = decision.requiresNote && !hasNote;
  const noteId = `approval-note-${approval.id}`;

  return (
    <Modal
      open
      onClose={onCancel}
      title={decision.question}
      description={decision.consequence}
      size="md"
      footer={
        <>
          <Button type="button" variant="outline" size="lg" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            size="lg"
            onClick={() => onConfirm(decision)}
            disabled={busy || blocked}
            className={decision.className}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {busy ? "Recording…" : `Yes, ${decision.label.toLowerCase()}`}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <dl className="space-y-3 rounded-xl border border-border bg-muted/50 p-5 text-[15px]">
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">You are deciding on</dt>
            <dd className="font-semibold leading-snug text-foreground">{approval.title}</dd>
          </div>
          {approval.project_name && (
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Project</dt>
              <dd className="text-foreground">{approval.project_name}</dd>
            </div>
          )}
          {approval.item_type && (
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Type</dt>
              <dd className="text-foreground">{humanize(approval.item_type)}</dd>
            </div>
          )}
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Requested</dt>
            <dd className="text-foreground">{formatDateTime(approval.created_at)}</dd>
          </div>
        </dl>

        <Field
          label="Note"
          htmlFor={noteId}
          hint={decision.noteHint}
          error={noteError || undefined}
          required={decision.requiresNote}
        >
          <textarea
            id={noteId}
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder="Tell the team what you'd like changed…"
            rows={4}
            className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-[15px] leading-relaxed text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </Field>
      </div>
    </Modal>
  );
}
