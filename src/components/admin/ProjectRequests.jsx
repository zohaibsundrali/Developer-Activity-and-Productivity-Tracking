"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Inbox,
  Check,
  X,
  HelpCircle,
  Eye,
  Calendar,
  Wallet,
  Building2,
} from "lucide-react";
import { authFetch } from "@/utils/authFetch";
import { supabase } from "@/utils/supabaseClient";
import { getOrgId, getOrgContext } from "@/utils/orgContext";
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
  EmptyState,
  ErrorState,
  SkeletonList,
} from "@/components/ui";

/**
 * Requests — client project proposals waiting on a decision.
 *
 * Every decision goes through /api/proposals/[id]/decide rather than writing
 * the row from here. Accepting is six writes across three tables; doing them
 * from a browser is how you end up with a project the client cannot see.
 */

const CONTROL =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

const STATUS_META = {
  submitted: { label: "New", variant: "info" },
  in_review: { label: "In review", variant: "secondary" },
  needs_info: { label: "Waiting on client", variant: "warning" },
  accepted: { label: "Accepted", variant: "success" },
  rejected: { label: "Declined", variant: "destructive" },
};

// The queue defaults to what still needs a human. Accepted and declined ones
// are still reachable — they are the record of what was agreed — but they are
// not what the screen is for.
const OPEN_STATUSES = ["submitted", "in_review", "needs_info"];

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

function when(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export default function ProjectRequests() {
  const [proposals, setProposals] = useState([]);
  const [clients, setClients] = useState({});
  const [managers, setManagers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("open");
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState(false);

  // Per-proposal decision inputs.
  const [reason, setReason] = useState("");
  const [managerId, setManagerId] = useState("");

  const me = getOrgContext();
  const canDecide = ["owner", "admin", "manager"].includes(me?.role);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch("/api/proposals");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not load requests.");
      setProposals(json.proposals || []);

      const orgId = getOrgId();
      // Names for the cards. Read separately rather than embedded so a failure
      // here costs a name, not the whole queue.
      const [{ data: clientRows }, { data: memberRows }] = await Promise.all([
        supabase.from("clients").select("id, name, company, email").eq("organization_id", orgId),
        supabase
          .from("memberships")
          .select("user_id, email, role, status")
          .eq("organization_id", orgId)
          .eq("status", "active")
          .in("role", ["owner", "admin", "manager", "team_lead"]),
      ]);
      const byId = {};
      for (const c of clientRows || []) byId[c.id] = c;
      setClients(byId);
      setManagers(memberRows || []);
    } catch (e) {
      setError(e?.message || "Could not load requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    if (filter === "all") return proposals;
    if (filter === "open") return proposals.filter((p) => OPEN_STATUSES.includes(p.status));
    return proposals.filter((p) => p.status === filter);
  }, [proposals, filter]);

  const openCount = proposals.filter((p) => OPEN_STATUSES.includes(p.status)).length;
  const open = proposals.find((p) => p.id === openId) || null;

  const decide = async (decision) => {
    if (!open || busy) return;
    if ((decision === "rejected" || decision === "needs_info") && !reason.trim()) {
      showError("A reason is required", "The client will read this — say what is missing or why.");
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch(`/api/proposals/${open.id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          reason: reason.trim(),
          managerId: decision === "accepted" ? managerId || null : null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || json?.detail || "Could not record that.");

      showSuccess(
        decision === "accepted" ? "Accepted" : decision === "rejected" ? "Declined" : "Sent back",
        decision === "accepted"
          ? "The project has been created and the client can see it."
          : "The client has been told."
      );
      setOpenId(null);
      setReason("");
      setManagerId("");
      await load();
    } catch (e) {
      showError("Not recorded", e?.message || "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const clientLabel = (p) => {
    const c = clients[p.client_id];
    if (!c) return "A client";
    return c.company || c.name || c.email || "A client";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={sectionTitle("requests")}
        description="Project proposals from your clients, waiting on a decision."
      />

      <div className="flex flex-wrap items-center gap-2">
        {[
          { id: "open", label: `Needs a decision (${openCount})` },
          { id: "accepted", label: "Accepted" },
          { id: "rejected", label: "Declined" },
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
        <ErrorState title="Couldn't load requests" description={error} onRetry={load} />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={filter === "open" ? "Nothing waiting" : "Nothing here"}
          description="When a client sends a project proposal it appears here for a decision."
        />
      ) : (
        <ul className="space-y-3">
          {shown.map((p) => {
            const meta = STATUS_META[p.status] || { label: p.status, variant: "secondary" };
            const amount = money(p.budget, p.currency);
            return (
              <li key={p.id}>
                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <CardTitle className="text-base">{p.title}</CardTitle>
                        <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="inline-flex items-center gap-1">
                            <Building2 aria-hidden="true" className="h-3.5 w-3.5" />
                            {clientLabel(p)}
                          </span>
                          <span>{when(p.created_at)}</span>
                          {amount ? (
                            <span className="inline-flex items-center gap-1 tabular-nums">
                              <Wallet aria-hidden="true" className="h-3.5 w-3.5" />
                              {amount}
                            </span>
                          ) : null}
                          {p.desired_deadline ? (
                            <span className="inline-flex items-center gap-1 tabular-nums">
                              <Calendar aria-hidden="true" className="h-3.5 w-3.5" />
                              by {when(p.desired_deadline)}
                            </span>
                          ) : null}
                        </CardDescription>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setOpenId(openId === p.id ? null : p.id);
                            setReason("");
                            setManagerId("");
                          }}
                        >
                          <Eye aria-hidden="true" className="h-4 w-4" />
                          <span className="ml-1.5">{openId === p.id ? "Close" : "Review"}</span>
                        </Button>
                      </div>
                    </div>
                  </CardHeader>

                  {openId === p.id ? (
                    <CardContent className="space-y-4 border-t border-border pt-4">
                      <div>
                        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          What they asked for
                        </h3>
                        <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-foreground">
                          {p.description}
                        </p>
                      </div>

                      {p.decision_reason ? (
                        <div className="rounded-lg border border-border bg-muted/40 p-3">
                          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Last decision
                          </h3>
                          <p className="mt-1 text-sm text-foreground">{p.decision_reason}</p>
                        </div>
                      ) : null}

                      {p.status === "accepted" ? (
                        <p className="text-sm text-muted-foreground">
                          Accepted{p.decided_at ? ` on ${when(p.decided_at)}` : ""}. The project has
                          been created.
                        </p>
                      ) : !canDecide ? (
                        <p className="text-sm text-muted-foreground">
                          You can read this request. Deciding it is for an owner, admin or project
                          manager.
                        </p>
                      ) : (
                        <div className="space-y-4">
                          <Field
                            label="Assign a project manager"
                            htmlFor={`mgr-${p.id}`}
                            hint="Only used when you accept. They will be told the project is theirs."
                          >
                            <select
                              id={`mgr-${p.id}`}
                              className={CONTROL}
                              value={managerId}
                              onChange={(e) => setManagerId(e.target.value)}
                            >
                              <option value="">Decide later</option>
                              {managers.map((m) => (
                                <option key={m.user_id} value={m.user_id}>
                                  {m.email} — {m.role}
                                </option>
                              ))}
                            </select>
                          </Field>

                          <Field
                            label="Note to the client"
                            htmlFor={`reason-${p.id}`}
                            hint="Required when you decline or ask for more. They will read it."
                          >
                            <textarea
                              id={`reason-${p.id}`}
                              rows={3}
                              className={`${CONTROL} w-full resize-y`}
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                              maxLength={2000}
                              placeholder="What is missing, or why this is not one for us…"
                            />
                          </Field>

                          <div className="flex flex-wrap gap-2">
                            <Button onClick={() => decide("accepted")} disabled={busy}>
                              <Check aria-hidden="true" className="h-4 w-4" />
                              <span className="ml-1.5">Accept &amp; create project</span>
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => decide("needs_info")}
                              disabled={busy}
                            >
                              <HelpCircle aria-hidden="true" className="h-4 w-4" />
                              <span className="ml-1.5">Ask for more</span>
                            </Button>
                            <Button
                              variant="destructive"
                              onClick={() => decide("rejected")}
                              disabled={busy}
                            >
                              <X aria-hidden="true" className="h-4 w-4" />
                              <span className="ml-1.5">Decline</span>
                            </Button>
                          </div>
                        </div>
                      )}
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
