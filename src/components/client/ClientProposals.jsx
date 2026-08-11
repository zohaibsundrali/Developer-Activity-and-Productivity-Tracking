"use client";

import { useState, useEffect, useCallback } from "react";
import { Send, Lightbulb, Clock, CheckCircle2, XCircle, HelpCircle } from "lucide-react";
import { authFetch } from "@/utils/authFetch";
import { showError, showSuccess } from "@/utils/alerts";
import { ClientPage, Panel, formatDate } from "@/components/client/ClientShared";
import { Button, Field, Input, Badge, EmptyState, ErrorState, SkeletonList } from "@/components/ui";

/**
 * The client's side of the proposal flow: file a request for new work, and
 * watch what happened to the ones already filed.
 *
 * A submitted proposal cannot be edited — see the note in database/059. So the
 * form is deliberately a little more insistent than a normal one about getting
 * the detail in up front, and the "waiting" state says plainly that the ball is
 * with us. Somebody who cannot edit and cannot tell whether anyone has looked
 * will email to ask, which is the outcome this screen exists to avoid.
 */

const CONTROL =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

const STATUS_META = {
  submitted: { label: "Waiting for review", variant: "info", icon: Clock },
  in_review: { label: "Being reviewed", variant: "info", icon: Clock },
  needs_info: { label: "We need more detail", variant: "warning", icon: HelpCircle },
  accepted: { label: "Accepted", variant: "success", icon: CheckCircle2 },
  rejected: { label: "Not taken forward", variant: "destructive", icon: XCircle },
};

const OPEN = ["submitted", "in_review"];

export default function ClientProposals() {
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    budget: "",
    desiredDeadline: "",
  });

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch("/api/proposals");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not load your proposals.");
      setProposals(json.proposals || []);
    } catch (e) {
      setError(e?.message || "Could not load your proposals.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // One open proposal at a time — the server enforces this, and saying so here
  // means the person finds out before they write three paragraphs.
  const hasOpen = proposals.some((p) => OPEN.includes(p.status));

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!form.title.trim() || !form.description.trim()) {
      showError("Almost there", "A title and a description are both needed.");
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim(),
          budget: form.budget === "" ? null : form.budget,
          desiredDeadline: form.desiredDeadline || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not send your proposal.");

      showSuccess("Sent", "We have it. You will hear back here and by notification.");
      setForm({ title: "", description: "", budget: "", desiredDeadline: "" });
      await load();
    } catch (err) {
      showError("Not sent", err?.message || "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ClientPage
      title="New project"
      description="Tell us what you would like built, and follow what happens to it."
    >
      <div className="space-y-6">
        <Panel className="p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
            <Lightbulb aria-hidden="true" className="h-5 w-5 text-primary" />
            Propose a project
          </h2>

          {hasOpen ? (
            <p className="mt-3 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
              You already have a proposal waiting for a decision. We will come back to you on that
              one first — it is listed below.
            </p>
          ) : (
            <form onSubmit={submit} className="mt-4 space-y-4">
              <Field label="What is it?" htmlFor="proposal-title">
                <Input
                  id="proposal-title"
                  value={form.title}
                  onChange={(e) => setField("title", e.target.value)}
                  maxLength={200}
                  placeholder="A short name — “Customer portal redesign”"
                />
              </Field>

              <Field
                label="Describe it"
                htmlFor="proposal-description"
                hint="The more you put here, the fewer questions come back. What it should do, who it is for, anything that must not change."
              >
                <textarea
                  id="proposal-description"
                  rows={7}
                  className={`${CONTROL} resize-y`}
                  value={form.description}
                  onChange={(e) => setField("description", e.target.value)}
                  maxLength={10000}
                  placeholder="What are you trying to achieve?"
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Budget (optional)"
                  htmlFor="proposal-budget"
                  hint="A number, if you have one in mind. Leave it blank if not."
                >
                  <Input
                    id="proposal-budget"
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    value={form.budget}
                    onChange={(e) => setField("budget", e.target.value)}
                    placeholder="50000"
                  />
                </Field>
                <Field label="Needed by (optional)" htmlFor="proposal-deadline">
                  <Input
                    id="proposal-deadline"
                    type="date"
                    value={form.desiredDeadline}
                    onChange={(e) => setField("desiredDeadline", e.target.value)}
                  />
                </Field>
              </div>

              <p className="text-xs text-muted-foreground">
                Once sent, a proposal cannot be edited — so it is always the version we replied to.
                If we need more, we will ask and you can send an updated one.
              </p>

              <Button type="submit" disabled={busy}>
                <Send aria-hidden="true" className="h-4 w-4" />
                <span className="ml-1.5">{busy ? "Sending…" : "Send proposal"}</span>
              </Button>
            </form>
          )}
        </Panel>

        <div>
          <h2 className="mb-3 text-lg font-semibold tracking-tight text-foreground">
            Your proposals
          </h2>
          {loading ? (
            <SkeletonList rows={3} />
          ) : error ? (
            <ErrorState title="Couldn't load these" description={error} onRetry={load} />
          ) : proposals.length === 0 ? (
            <EmptyState
              icon={Lightbulb}
              title="Nothing yet"
              description="Anything you propose will appear here with its progress."
            />
          ) : (
            <ul className="space-y-3">
              {proposals.map((p) => {
                const meta = STATUS_META[p.status] || {
                  label: p.status,
                  variant: "secondary",
                  icon: Clock,
                };
                const Icon = meta.icon;
                return (
                  <li key={p.id}>
                    <Panel className="p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">{p.title}</p>
                          <p className="text-xs text-muted-foreground">
                            Sent {formatDate(p.created_at)}
                          </p>
                        </div>
                        <Badge variant={meta.variant} className="shrink-0">
                          <Icon aria-hidden="true" className="mr-1 h-3 w-3" />
                          {meta.label}
                        </Badge>
                      </div>

                      {/* The reply, when there is one. This is the whole point
                          of the status: a decision without its reason just
                          makes someone pick up the phone. */}
                      {p.decision_reason ? (
                        <p className="mt-3 rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">
                          {p.decision_reason}
                        </p>
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
