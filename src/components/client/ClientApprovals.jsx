"use client";

import { useEffect, useState, useCallback } from "react";
import { CheckSquare, Check, X } from "lucide-react";
import { authFetch } from "@/utils/authFetch";
import { showSuccess, showError } from "@/utils/alerts";
import {
  Spinner,
  EmptyState,
  ErrorState,
  StatusBadge,
  SectionHeader,
  formatDate,
} from "./ClientShared";

const isPendingStatus = (s) => {
  const v = String(s || "").toLowerCase();
  return v === "pending" || v === "awaiting" || v === "open" || v === "";
};

export default function ClientApprovals() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState({});
  const [decidingId, setDecidingId] = useState(null);

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
      setItems(Array.isArray(data.approvals) ? data.approvals : Array.isArray(data) ? data : []);
    } catch {
      setError("Something went wrong while loading approvals.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDecision = async (approval, decision) => {
    const note = notes[approval.id] || "";
    const prev = items;
    // Optimistic update
    setDecidingId(approval.id);
    setItems((list) =>
      list.map((a) =>
        a.id === approval.id ? { ...a, status: decision === "approve" ? "approved" : "rejected" } : a
      )
    );
    try {
      const res = await authFetch(`/api/client/approvals/${approval.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setItems(prev); // revert
        showError("Action failed", payload?.error || "Could not submit your decision.");
        return;
      }
      showSuccess(
        decision === "approve" ? "Approved" : "Rejected",
        "Your decision has been recorded."
      );
    } catch {
      setItems(prev); // revert
      showError("Action failed", "Something went wrong. Please try again.");
    } finally {
      setDecidingId(null);
    }
  };

  if (loading) return <Spinner label="Loading approvals…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  // Pending first, then the rest.
  const sorted = [...items].sort((a, b) => {
    const ap = isPendingStatus(a.status) ? 0 : 1;
    const bp = isPendingStatus(b.status) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return new Date(b.created_at || b.requested_at || 0) - new Date(a.created_at || a.requested_at || 0);
  });

  const pendingCount = items.filter((a) => isPendingStatus(a.status)).length;

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
          {sorted.map((a) => {
            const pending = isPendingStatus(a.status);
            return (
              <div key={a.id} className="rounded-xl border border-border bg-card p-5 shadow-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-foreground">
                      {a.title || a.subject || "Approval request"}
                    </h3>
                    {a.project_name && (
                      <p className="mt-0.5 text-xs font-medium text-primary">{a.project_name}</p>
                    )}
                    {a.description && (
                      <p className="mt-2 text-sm text-muted-foreground whitespace-pre-line">{a.description}</p>
                    )}
                    {(a.created_at || a.requested_at) && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Requested {formatDate(a.created_at || a.requested_at)}
                      </p>
                    )}
                  </div>
                  <StatusBadge status={a.status || "pending"} />
                </div>

                {pending && (
                  <div className="mt-4 space-y-3">
                    <textarea
                      value={notes[a.id] || ""}
                      onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))}
                      placeholder="Add an optional note…"
                      rows={2}
                      className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => handleDecision(a, "approve")}
                        disabled={decidingId === a.id}
                        className="inline-flex items-center rounded-lg bg-success px-4 py-2 text-sm font-medium text-success-foreground transition-colors hover:bg-success/90 disabled:opacity-60"
                      >
                        <Check className="mr-1.5 h-4 w-4" />
                        Approve
                      </button>
                      <button
                        onClick={() => handleDecision(a, "reject")}
                        disabled={decidingId === a.id}
                        className="inline-flex items-center rounded-lg bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-60"
                      >
                        <X className="mr-1.5 h-4 w-4" />
                        Reject
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
