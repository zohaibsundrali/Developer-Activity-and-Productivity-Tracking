"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { allowed } from "@/utils/permissions";
import {
  GitPullRequestArrow,
  Calculator,
  Check,
  X,
  Hammer,
  Wallet,
  CalendarClock,
  Clock,
} from "lucide-react";
import { authFetch } from "@/utils/authFetch";
import { supabase } from "@/utils/supabaseClient";
import { getOrgId } from "@/utils/orgContext";
import { showError, showSuccess } from "@/utils/alerts";
import { sectionTitle } from "@/components/shell/navConfig";
import {
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Badge,
  Button,
  Field,
  Input,
  EmptyState,
  ErrorState,
  SkeletonList,
} from "@/components/ui";

/**
 * Change requests — the staff side.
 *
 * The screen is organised around WHO IS BEING WAITED ON, not around a list of
 * everything. A change request sitting at `awaiting_client` is not the
 * company's problem and putting it in the same pile as one that needs pricing
 * is how the pile stops being read.
 */

const CONTROL =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

const STATUS_META = {
  submitted: { label: "Needs pricing", variant: "info" },
  estimating: { label: "Being priced", variant: "info" },
  awaiting_admin: { label: "Needs your approval", variant: "warning" },
  awaiting_client: { label: "With the client", variant: "secondary" },
  approved: { label: "Approved", variant: "success" },
  implemented: { label: "Implemented", variant: "success" },
  rejected: { label: "Declined", variant: "destructive" },
  withdrawn: { label: "Withdrawn", variant: "secondary" },
};

// What the company still has to do something about.
const OURS = ["submitted", "estimating", "awaiting_admin", "approved"];

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

const when = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

export default function ChangeRequests() {
  const [rows, setRows] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("ours");
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState(false);

  // Per-request inputs.
  const [est, setEst] = useState({ cost: "", hours: "", days: "", notes: "" });
  const [reason, setReason] = useState("");

  // Raising one as staff.
  const [raising, setRaising] = useState(false);
  const [draft, setDraft] = useState({ projectId: "", title: "", description: "" });

  // The two-person rule, asked of the catalogue rather than restated here.
  // Pricing is owner/admin/manager; approving the price for sale is owner/admin
  // only, so whoever set the number is not also the one who agrees to sell at
  // it. That distinction was written out twice — here and in
  // /api/change-requests/[id]/advance — and two copies is how it quietly stops
  // being true on one side.
  const canPrice = allowed("change_request.decide");
  const canApprove = allowed("change_request.approve");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch("/api/change-requests");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not load change requests.");
      setRows(json.changeRequests || []);

      const { data } = await supabase
        .from("projects")
        .select("id, name")
        .eq("organization_id", getOrgId())
        .order("created_at", { ascending: false })
        .limit(500);
      setProjects(data || []);
    } catch (e) {
      setError(e?.message || "Could not load change requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const projectName = (id) => projects.find((p) => p.id === id)?.name || "a project";

  const shown = useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "ours") return rows.filter((r) => OURS.includes(r.status));
    if (filter === "client") return rows.filter((r) => r.status === "awaiting_client");
    return rows.filter((r) => ["implemented", "rejected", "withdrawn"].includes(r.status));
  }, [rows, filter]);

  const oursCount = rows.filter((r) => OURS.includes(r.status)).length;

  const act = async (cr, action, extra = {}) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await authFetch(`/api/change-requests/${cr.id}/advance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: reason.trim(), ...extra }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not update that.");
      showSuccess("Done", messageFor(action));
      setOpenId(null);
      setReason("");
      setEst({ cost: "", hours: "", days: "", notes: "" });
      await load();
    } catch (e) {
      showError("Not updated", e?.message || "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const raise = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!draft.projectId || !draft.title.trim() || !draft.description.trim()) {
      showError("Almost there", "Pick a project and describe the change.");
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
      if (!res.ok) throw new Error(json?.error || "Could not raise it.");
      setDraft({ projectId: "", title: "", description: "" });
      setRaising(false);
      showSuccess("Raised", "Price it, then send it for approval.");
      await load();
    } catch (err) {
      showError("Not raised", err?.message || "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={sectionTitle("change-requests")}
        description="Scope changes, with a price on them, agreed before anyone builds."
        actions={
          canPrice ? (
            <Button variant="outline" onClick={() => setRaising((v) => !v)}>
              {raising ? "Cancel" : "Raise one"}
            </Button>
          ) : null
        }
      />

      {raising ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Raise a change request</CardTitle>
            <CardDescription>
              For scope that has grown without anyone asking — so it gets priced and agreed rather
              than absorbed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={raise} className="space-y-4">
              <Field label="Project" htmlFor="cr-project" required>
                <select
                  id="cr-project"
                  className={`${CONTROL} w-full`}
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
              <Field label="What changed?" htmlFor="cr-title" required>
                <Input
                  id="cr-title"
                  value={draft.title}
                  onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                  maxLength={200}
                  required
                />
              </Field>
              <Field label="Describe it" htmlFor="cr-desc" required>
                <textarea
                  id="cr-desc"
                  rows={4}
                  className={`${CONTROL} w-full resize-y`}
                  value={draft.description}
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                  maxLength={10000}
                  required
                />
              </Field>
              <Button type="submit" disabled={busy}>
                Raise it
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {[
          { id: "ours", label: `On us (${oursCount})` },
          { id: "client", label: "With the client" },
          { id: "closed", label: "Closed" },
          { id: "all", label: "All" },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setFilter(t.id)}
            aria-pressed={filter === t.id}
            className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
              filter === t.id
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonList rows={4} />
      ) : error ? (
        <ErrorState title="Couldn't load these" description={error} onRetry={load} />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={GitPullRequestArrow}
          title="Nothing here"
          description="Scope changes appear here once a client asks for one, or someone raises it."
        />
      ) : (
        <ul className="space-y-3">
          {shown.map((cr) => {
            const meta = STATUS_META[cr.status] || { label: cr.status, variant: "secondary" };
            const cost = money(cr.estimated_cost, cr.currency);
            const isOpen = openId === cr.id;
            return (
              <li key={cr.id}>
                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <CardTitle className="text-base">{cr.title}</CardTitle>
                        <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span>{projectName(cr.project_id)}</span>
                          <span>{when(cr.created_at)}</span>
                          <span className="capitalize">by {cr.requester_type}</span>
                          {cost ? (
                            <span className="inline-flex items-center gap-1 tabular-nums">
                              <Wallet aria-hidden="true" className="h-3.5 w-3.5" />
                              {cost}
                            </span>
                          ) : null}
                          {cr.estimated_hours ? (
                            <span className="inline-flex items-center gap-1 tabular-nums">
                              <Clock aria-hidden="true" className="h-3.5 w-3.5" />
                              {cr.estimated_hours}h
                            </span>
                          ) : null}
                          {cr.timeline_impact_days ? (
                            <span className="inline-flex items-center gap-1 tabular-nums">
                              <CalendarClock aria-hidden="true" className="h-3.5 w-3.5" />+
                              {cr.timeline_impact_days}d
                            </span>
                          ) : null}
                        </CardDescription>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setOpenId(isOpen ? null : cr.id);
                            setReason("");
                            setEst({
                              cost: cr.estimated_cost ?? "",
                              hours: cr.estimated_hours ?? "",
                              days: cr.timeline_impact_days ?? "",
                              notes: cr.pm_notes ?? "",
                            });
                          }}
                        >
                          {isOpen ? "Close" : "Open"}
                        </Button>
                      </div>
                    </div>
                  </CardHeader>

                  {isOpen ? (
                    <CardContent className="space-y-4 border-t border-border pt-4">
                      <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                        {cr.description}
                      </p>

                      {cr.decision_reason ? (
                        <div className="rounded-lg border border-border bg-muted/40 p-3">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Reason given
                          </p>
                          <p className="mt-1 text-sm text-foreground">{cr.decision_reason}</p>
                        </div>
                      ) : null}

                      {cr.applied_at ? (
                        <p className="text-sm text-muted-foreground">
                          Applied {when(cr.applied_at)} — budget was{" "}
                          {money(cr.previous_budget, cr.currency) ?? "unset"}
                          {cr.previous_deadline ? `, deadline was ${when(cr.previous_deadline)}` : ""}.
                        </p>
                      ) : null}

                      {/* PRICING — the step that makes this table worth having */}
                      {canPrice && ["submitted", "estimating"].includes(cr.status) ? (
                        <div className="space-y-3 rounded-lg border border-border p-3">
                          <p className="text-sm font-medium text-foreground">Put a price on it</p>
                          <div className="grid gap-3 sm:grid-cols-3">
                            <Field label="Cost" htmlFor={`cost-${cr.id}`}>
                              <Input
                                id={`cost-${cr.id}`}
                                type="number"
                                min="0"
                                step="any"
                                value={est.cost}
                                onChange={(e) => setEst((s) => ({ ...s, cost: e.target.value }))}
                              />
                            </Field>
                            <Field label="Hours" htmlFor={`hours-${cr.id}`}>
                              <Input
                                id={`hours-${cr.id}`}
                                type="number"
                                min="0"
                                step="any"
                                value={est.hours}
                                onChange={(e) => setEst((s) => ({ ...s, hours: e.target.value }))}
                              />
                            </Field>
                            <Field label="Extra days" htmlFor={`days-${cr.id}`}>
                              <Input
                                id={`days-${cr.id}`}
                                type="number"
                                min="0"
                                step="1"
                                value={est.days}
                                onChange={(e) => setEst((s) => ({ ...s, days: e.target.value }))}
                              />
                            </Field>
                          </div>
                          <Field
                            label="Internal notes"
                            htmlFor={`notes-${cr.id}`}
                            hint="Never shown to the client."
                          >
                            <textarea
                              id={`notes-${cr.id}`}
                              rows={2}
                              className={`${CONTROL} w-full resize-y`}
                              value={est.notes}
                              onChange={(e) => setEst((s) => ({ ...s, notes: e.target.value }))}
                              maxLength={5000}
                            />
                          </Field>
                          <Button
                            onClick={() =>
                              act(cr, "estimate", {
                                estimatedCost: est.cost,
                                estimatedHours: est.hours,
                                timelineImpactDays: est.days,
                                pmNotes: est.notes,
                              })
                            }
                            disabled={busy}
                          >
                            <Calculator aria-hidden="true" className="h-4 w-4" />
                            <span className="ml-1.5">Send for approval</span>
                          </Button>
                        </div>
                      ) : null}

                      {/* Reason, for whichever action needs one */}
                      {canPrice && !["implemented", "rejected", "withdrawn"].includes(cr.status) ? (
                        <Field
                          label="Note"
                          htmlFor={`reason-${cr.id}`}
                          hint="Required to decline. The other side reads it."
                        >
                          <textarea
                            id={`reason-${cr.id}`}
                            rows={2}
                            className={`${CONTROL} w-full resize-y`}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            maxLength={2000}
                          />
                        </Field>
                      ) : null}

                      <div className="flex flex-wrap gap-2">
                        {cr.status === "awaiting_admin" ? (
                          canApprove ? (
                            <Button onClick={() => act(cr, "admin_approve")} disabled={busy}>
                              <Check aria-hidden="true" className="h-4 w-4" />
                              <span className="ml-1.5">Approve &amp; send to client</span>
                            </Button>
                          ) : (
                            // A manager priced it; agreeing to sell at that price
                            // is somebody else's call, and saying so beats a
                            // button that fails.
                            <p className="text-sm text-muted-foreground">
                              Priced and waiting on an owner or admin to approve it.
                            </p>
                          )
                        ) : null}

                        {cr.status === "approved" && canPrice ? (
                          <Button onClick={() => act(cr, "implement")} disabled={busy}>
                            <Hammer aria-hidden="true" className="h-4 w-4" />
                            <span className="ml-1.5">Mark implemented</span>
                          </Button>
                        ) : null}

                        {canPrice &&
                        !["implemented", "rejected", "withdrawn", "approved"].includes(cr.status) ? (
                          <Button
                            variant="destructive"
                            onClick={() => act(cr, "reject")}
                            disabled={busy}
                          >
                            <X aria-hidden="true" className="h-4 w-4" />
                            <span className="ml-1.5">Decline</span>
                          </Button>
                        ) : null}
                      </div>

                      {cr.status === "awaiting_client" ? (
                        <p className="text-sm text-muted-foreground">
                          Waiting on the client to accept the cost. Nothing to do here until they do.
                        </p>
                      ) : null}
                    </CardContent>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function messageFor(action) {
  switch (action) {
    case "estimate":
      return "Priced, and sent for approval.";
    case "admin_approve":
      return "Approved. The client has been asked to accept the cost.";
    case "implement":
      return "Marked as implemented.";
    case "reject":
      return "Declined, and the reason has been recorded.";
    default:
      return "Updated.";
  }
}
