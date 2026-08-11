"use client";

import { useState, useEffect, useCallback } from "react";
import { GitPullRequestArrow, Check, X, Wallet, CalendarClock, Clock } from "lucide-react";
import { authFetch } from "@/utils/authFetch";
import { showError, showSuccess } from "@/utils/alerts";
import { ClientPage, Panel, formatDate } from "@/components/client/ClientShared";
import { Button, Field, Input, Badge, EmptyState, ErrorState, SkeletonList } from "@/components/ui";

/**
 * Change requests — the client's side.
 *
 * The screen exists to make one moment unmissable: the point where the client
 * is being asked to agree to a cost. Everything else on it is context for that
 * decision. A change request they approve here moves the project's budget, so
 * the figure is shown as plainly as it can be and the buttons say what they
 * mean rather than "Confirm".
 */

const CONTROL =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

const STATUS_META = {
  submitted: { label: "With the team", variant: "info" },
  estimating: { label: "Being costed", variant: "info" },
  awaiting_admin: { label: "Being costed", variant: "info" },
  awaiting_client: { label: "Needs your approval", variant: "warning" },
  approved: { label: "Approved", variant: "success" },
  implemented: { label: "Done", variant: "success" },
  rejected: { label: "Declined", variant: "destructive" },
  withdrawn: { label: "Withdrawn", variant: "secondary" },
};

function money(amount, currency) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${currency || ""} ${n.toLocaleString("en-US")}`.trim();
  }
}

export default function ClientChangeRequests() {
  const [rows, setRows] = useState([]);
  // Fetched here rather than passed in: the client shell holds no project
  // list of its own, and every other client screen fetches what it needs.
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [openId, setOpenId] = useState(null);
  const [draft, setDraft] = useState({ projectId: "", title: "", description: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [crRes, projRes] = await Promise.all([
        authFetch("/api/change-requests"),
        authFetch("/api/client/projects"),
      ]);
      const json = await crRes.json().catch(() => ({}));
      if (!crRes.ok) throw new Error(json?.error || "Could not load these.");
      setRows(json.changeRequests || []);

      // A failed project list costs a name in a dropdown, not the screen.
      const projJson = await projRes.json().catch(() => ({}));
      setProjects(projJson?.projects || []);
    } catch (e) {
      setError(e?.message || "Could not load these.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const raise = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!draft.projectId || !draft.title.trim() || !draft.description.trim()) {
      showError("Almost there", "Pick a project and describe what you would like changed.");
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch("/api/change-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: draft.projectId,
          title: draft.title.trim(),
          description: draft.description.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not send it.");
      setDraft({ projectId: "", title: "", description: "" });
      showSuccess("Sent", "The team will come back to you with a cost and a timeline.");
      await load();
    } catch (err) {
      showError("Not sent", err?.message || "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const decide = async (cr, action) => {
    if (busy) return;
    if (action === "reject" && !reason.trim()) {
      showError("A reason helps", "Tell the team why, so they can suggest something else.");
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch(`/api/change-requests/${cr.id}/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: reason.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not record that.");
      setOpenId(null);
      setReason("");
      showSuccess(
        action === "client_approve" ? "Approved" : "Declined",
        action === "client_approve"
          ? "The project budget and timeline have been updated."
          : "The team has been told."
      );
      await load();
    } catch (e) {
      showError("Not recorded", e?.message || "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const projectName = (id) => projects.find((p) => p.id === id)?.name || "your project";
  const waiting = rows.filter((r) => r.status === "awaiting_client");

  return (
    <ClientPage
      title="Change requests"
      description="Ask for something new, and approve the cost before work starts."
    >
      <div className="space-y-6">
        {waiting.length ? (
          <p className="rounded-lg border border-warning/30 bg-warning/[0.08] p-3 text-sm text-foreground">
            {waiting.length === 1
              ? "One change request is waiting for your approval."
              : `${waiting.length} change requests are waiting for your approval.`}{" "}
            Work does not start until you agree.
          </p>
        ) : null}

        <Panel className="p-4 sm:p-5">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Ask for a change
          </h2>
          <p className="mt-1 text-[15px] text-muted-foreground">
            The team will come back with a cost and how much time it adds, and nothing is charged or
            built until you approve it.
          </p>
          <form onSubmit={raise} className="mt-4 space-y-4">
            <Field label="Project" htmlFor="ccr-project" required>
              <select
                id="ccr-project"
                className={CONTROL}
                value={draft.projectId}
                onChange={(e) => setDraft((d) => ({ ...d, projectId: e.target.value }))}
                required
              >
                <option value="">Choose a project…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="What would you like changed?" htmlFor="ccr-title" required>
              <Input
                id="ccr-title"
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                maxLength={200}
                required
              />
            </Field>
            <Field label="Describe it" htmlFor="ccr-desc" required>
              <textarea
                id="ccr-desc"
                rows={5}
                className={`${CONTROL} resize-y`}
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                maxLength={10000}
                required
              />
            </Field>
            <Button type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send request"}
            </Button>
          </form>
        </Panel>

        <div>
          <h2 className="mb-3 text-lg font-semibold tracking-tight text-foreground">
            Your change requests
          </h2>
          {loading ? (
            <SkeletonList rows={3} />
          ) : error ? (
            <ErrorState title="Couldn't load these" description={error} onRetry={load} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={GitPullRequestArrow}
              title="Nothing yet"
              description="Anything you ask for will appear here with its cost once the team has looked."
            />
          ) : (
            <ul className="space-y-3">
              {rows.map((cr) => {
                const meta = STATUS_META[cr.status] || { label: cr.status, variant: "secondary" };
                const cost = money(cr.estimated_cost, cr.currency);
                const mine = cr.status === "awaiting_client";
                const isOpen = openId === cr.id;
                return (
                  <li key={cr.id}>
                    <Panel className={`p-4 ${mine ? "border-warning/40" : ""}`}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">{cr.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {projectName(cr.project_id)} · {formatDate(cr.created_at)}
                          </p>
                        </div>
                        <Badge variant={meta.variant} className="shrink-0">
                          {meta.label}
                        </Badge>
                      </div>

                      {/* The figures, once there are any. This is the decision. */}
                      {cost || cr.estimated_hours || cr.timeline_impact_days ? (
                        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 rounded-lg border border-border bg-muted/40 p-3 text-sm">
                          {cost ? (
                            <span className="inline-flex items-center gap-1.5 font-medium text-foreground tabular-nums">
                              <Wallet aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                              {cost}
                            </span>
                          ) : null}
                          {cr.estimated_hours ? (
                            <span className="inline-flex items-center gap-1.5 text-muted-foreground tabular-nums">
                              <Clock aria-hidden="true" className="h-4 w-4" />
                              {cr.estimated_hours} hours
                            </span>
                          ) : null}
                          {cr.timeline_impact_days ? (
                            <span className="inline-flex items-center gap-1.5 text-muted-foreground tabular-nums">
                              <CalendarClock aria-hidden="true" className="h-4 w-4" />
                              adds {cr.timeline_impact_days} days
                            </span>
                          ) : null}
                        </div>
                      ) : null}

                      {cr.decision_reason ? (
                        <p className="mt-3 rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">
                          {cr.decision_reason}
                        </p>
                      ) : null}

                      {mine ? (
                        <div className="mt-3 space-y-3">
                          {isOpen ? (
                            <Field
                              label="Anything to add?"
                              htmlFor={`ccr-reason-${cr.id}`}
                              hint="Needed if you decline, so the team can suggest an alternative."
                            >
                              <textarea
                                id={`ccr-reason-${cr.id}`}
                                rows={2}
                                className={`${CONTROL} resize-y`}
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                maxLength={2000}
                              />
                            </Field>
                          ) : null}
                          <div className="flex flex-wrap gap-2">
                            <Button
                              onClick={() => decide(cr, "client_approve")}
                              disabled={busy}
                            >
                              <Check aria-hidden="true" className="h-4 w-4" />
                              <span className="ml-1.5">Approve this cost</span>
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => {
                                if (!isOpen) {
                                  setOpenId(cr.id);
                                  setReason("");
                                  return;
                                }
                                decide(cr, "reject");
                              }}
                              disabled={busy}
                            >
                              <X aria-hidden="true" className="h-4 w-4" />
                              <span className="ml-1.5">
                                {isOpen ? "Confirm decline" : "Decline"}
                              </span>
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </Panel>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </ClientPage>
  );
}
