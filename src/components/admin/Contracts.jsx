"use client";

import { useCallback, useEffect, useState } from "react";
import { FileSignature, History, Plus, TriangleAlert } from "lucide-react";

import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  Section,
  Skeleton,
} from "@/components/ui";
import { authFetch } from "@/utils/authFetch";
import { supabase } from "@/utils/supabaseClient";
import { getOrgId } from "@/utils/orgContext";
import { showConfirm, showError, showSuccess } from "@/utils/alerts";

/**
 * Contracts — what was agreed, and what has changed since.
 *
 * THE COMMERCIAL CHAIN WAS COMPLETE AT BOTH ENDS AND EMPTY IN THE MIDDLE. A
 * client could raise a proposal, the work could be planned, tracked, approved
 * and invoiced — and nothing recorded what had actually been agreed. The
 * invoice was the first written commitment in the whole system, which is the
 * wrong way round.
 *
 * A SIGNED CONTRACT IS AMENDED, NOT EDITED. Once it is past 'sent', the value,
 * the type and the dates are what both sides agreed; changing them in place
 * would make the record say what somebody last typed rather than what was
 * agreed. The Amend dialog writes down what it was, and the trigger in 092
 * refuses the change without that row. The history is on the screen, not
 * buried.
 *
 * THE MILESTONE GAP IS SHOWN, NOT ENFORCED. A contract worth 50,000 with 30,000
 * of milestones is usually one somebody has not finished breaking down —
 * occasionally it is a retainer where the milestones are only the variable
 * part. Refusing it would teach people to leave the value blank.
 */

const CONTROL =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

const STATUS_TONE = {
  draft: "secondary",
  sent: "warning",
  signed: "success",
  active: "success",
  completed: "outline",
  terminated: "destructive",
};

const MILESTONE_TONE = {
  pending: "outline",
  delivered: "warning",
  approved: "success",
  invoiced: "info",
};

const TYPES = [
  ["fixed_price", "Fixed price"],
  ["time_and_materials", "Time and materials"],
  ["retainer", "Retainer"],
];

const money = (v, currency = "USD") =>
  v === null || v === undefined
    ? "—"
    : new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(v));

export default function Contracts({ projects = [] }) {
  const [contracts, setContracts] = useState([]);
  const [active, setActive] = useState(null);
  const [milestones, setMilestones] = useState([]);
  const [amendments, setAmendments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null);
  const [milestoneForm, setMilestoneForm] = useState(null);
  const [amendForm, setAmendForm] = useState(null);
  const [invoicing, setInvoicing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch("/api/contracts");
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "Could not load contracts.");
      setContracts(json.contracts || []);
    } catch (e) {
      setError(e?.message || "Could not load contracts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const open = async (row) => {
    setBusy(true);
    try {
      const res = await authFetch(
        `/api/contracts?view=contract&contractId=${encodeURIComponent(row.contract_id)}`
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "Could not open that.");
      setActive({ ...row, ...json.contract });
      setMilestones(json.milestones || []);
      setAmendments(json.amendments || []);
    } catch (e) {
      showError(e?.message || "Could not open that.");
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status) => {
    const signing = !["draft", "sent"].includes(status) && !active.signed_at;
    if (signing) {
      const ok = await showConfirm(
        "Sign this contract?",
        "After this the value, the type and the dates can only be changed by an amendment, which records what they were.",
        { confirmButtonText: "Sign" }
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      const res = await authFetch("/api/contracts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractId: active.contract_id, status }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "That did not go through.");
      setActive((a) => ({ ...a, ...json.contract }));
      showSuccess("Contract updated.");
      await load();
    } catch (e) {
      showError(e?.message || "That did not go through.");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Marking a milestone invoiced needs the invoice it went on — the CHECK in
   * 092 refuses the row without one. So it is PICKED, not typed: a dialog
   * asking somebody to paste a uuid is not a picker, and this screen already
   * knows how to open a modal.
   */
  const askForInvoice = async (m) => {
    setBusy(true);
    try {
      const { data } = await supabase
        .from("invoices")
        .select("id, number, amount, currency, status")
        .eq("organization_id", getOrgId())
        .neq("status", "void")
        .order("created_at", { ascending: false })
        .limit(200);
      setInvoicing({ milestone: m, invoices: data || [], invoiceId: "" });
    } catch (e) {
      showError(e?.message || "Could not load the invoices.");
    } finally {
      setBusy(false);
    }
  };

  const moveMilestone = async (m, status, invoiceId) => {
    setBusy(true);
    try {
      const res = await authFetch("/api/contracts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ milestoneId: m.id, status, invoiceId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "That did not go through.");
      setMilestones((prev) => prev.map((x) => (x.id === m.id ? json.milestone : x)));
      setInvoicing(null);
    } catch (e) {
      showError(e?.message || "That did not go through.");
    } finally {
      setBusy(false);
    }
  };

  const submitContract = async () => {
    if (!form?.reference?.trim() || !form?.title?.trim()) {
      showError("A contract needs a reference and a title.");
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch("/api/contracts?action=contract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "Could not create it.");
      showSuccess("Contract created as a draft.");
      setForm(null);
      await load();
    } catch (e) {
      showError(e?.message || "Could not create it.");
    } finally {
      setBusy(false);
    }
  };

  const submitMilestone = async () => {
    if (!milestoneForm?.title?.trim()) {
      showError("Give the milestone a title.");
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch("/api/contracts?action=milestone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...milestoneForm, contractId: active.contract_id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "Could not add it.");
      setMilestones((prev) => [...prev, json.milestone]);
      setMilestoneForm(null);
    } catch (e) {
      showError(e?.message || "Could not add it.");
    } finally {
      setBusy(false);
    }
  };

  const submitAmend = async () => {
    if (!amendForm?.field) return;
    setBusy(true);
    try {
      const res = await authFetch("/api/contracts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractId: active.contract_id,
          amend: { field: amendForm.field, value: amendForm.value || null },
          reason: amendForm.reason,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "Could not amend it.");
      showSuccess("Amendment recorded.");
      setAmendForm(null);
      await open({ contract_id: active.contract_id });
      await load();
    } catch (e) {
      showError(e?.message || "Could not amend it.");
    } finally {
      setBusy(false);
    }
  };

  // ── One contract ────────────────────────────────────────────────────────
  if (active) {
    const signed = !["draft", "sent"].includes(active.status);
    return (
      <div className="space-y-6">
        <PageHeader
          title={`${active.reference} · ${active.title}`}
          description={`${active.contract_type?.replace(/_/g, " ")} · ${money(active.value, active.currency)}`}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setActive(null)}>Back</Button>
              {active.status === "draft" && (
                <Button variant="outline" onClick={() => setStatus("sent")} disabled={busy}>Mark sent</Button>
              )}
              {["draft", "sent"].includes(active.status) && (
                <Button onClick={() => setStatus("signed")} disabled={busy}>
                  <FileSignature className="mr-2 h-4 w-4" aria-hidden="true" />
                  Sign
                </Button>
              )}
              {signed && !["completed", "terminated"].includes(active.status) && (
                <>
                  <Button variant="outline" onClick={() => setAmendForm({ field: "value", value: "" })} disabled={busy}>
                    Amend
                  </Button>
                  <Button variant="outline" onClick={() => setStatus("completed")} disabled={busy}>
                    Complete
                  </Button>
                </>
              )}
              {!["completed", "terminated"].includes(active.status) && (
                <Button onClick={() => setMilestoneForm({ title: "" })} disabled={busy}>
                  <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                  Milestone
                </Button>
              )}
            </div>
          }
        />

        {signed && (
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
            Signed{active.signed_by_name ? ` by ${active.signed_by_name}` : ""}. The value, the type
            and the dates can now only change by amendment — the previous figure is kept.
          </div>
        )}

        <Section title="Milestones">
          {milestones.length === 0 ? (
            <EmptyState
              icon={FileSignature}
              title="No milestones"
              description="Break the contract into what gets delivered and when it is billable."
            />
          ) : (
            <ul className="divide-y divide-border">
              {milestones.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{m.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {m.due_date ? `due ${m.due_date}` : "no due date"} ·{" "}
                      {money(m.amount, active.currency)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={MILESTONE_TONE[m.status] || "outline"}>{m.status}</Badge>
                    {m.status === "pending" && (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => moveMilestone(m, "delivered")}>
                        Delivered
                      </Button>
                    )}
                    {m.status === "delivered" && (
                      <Button size="sm" disabled={busy} onClick={() => moveMilestone(m, "approved")}>
                        Approve
                      </Button>
                    )}
                    {m.status === "approved" && (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => askForInvoice(m)}>
                        Mark invoiced
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {amendments.length > 0 && (
          <Section title="Amendments" description="Every change to a signed term, and what it was.">
            <ul className="divide-y divide-border">
              {amendments.map((a) => (
                <li key={a.id} className="flex items-start gap-3 py-3">
                  <History className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0 text-sm">
                    <p className="text-foreground">
                      <span className="font-medium">{a.field.replace(/_/g, " ")}</span>{" "}
                      changed from <span className="tabular-nums">{a.previous_value ?? "—"}</span> to{" "}
                      <span className="tabular-nums">{a.new_value ?? "—"}</span>
                    </p>
                    {a.reason && <p className="text-xs text-muted-foreground">{a.reason}</p>}
                    <p className="text-xs text-muted-foreground">
                      {new Date(a.created_at).toLocaleString()}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Modal open={Boolean(invoicing)} onClose={() => setInvoicing(null)} title="Which invoice?">
          {invoicing && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {invoicing.milestone.title} — marking it invoiced records which invoice it went on,
                so the milestone and the bill stay joined up.
              </p>
              {invoicing.invoices.length === 0 ? (
                <EmptyState
                  icon={FileSignature}
                  title="No invoices to point at"
                  description="Raise the invoice first, on the Invoicing screen, then come back."
                />
              ) : (
                <Field label="Invoice">
                  <select
                    className={CONTROL}
                    value={invoicing.invoiceId}
                    onChange={(e) => setInvoicing((x) => ({ ...x, invoiceId: e.target.value }))}
                  >
                    <option value="">Choose…</option>
                    {invoicing.invoices.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.number} · {money(inv.amount, inv.currency)} · {inv.status}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setInvoicing(null)} disabled={busy}>Cancel</Button>
                <Button
                  onClick={() => moveMilestone(invoicing.milestone, "invoiced", invoicing.invoiceId)}
                  disabled={busy || !invoicing.invoiceId}
                >
                  Mark invoiced
                </Button>
              </div>
            </div>
          )}
        </Modal>

        <Modal open={Boolean(milestoneForm)} onClose={() => setMilestoneForm(null)} title="Add a milestone">
          {milestoneForm && (
            <div className="space-y-4">
              <Field label="Title">
                <Input
                  value={milestoneForm.title}
                  onChange={(e) => setMilestoneForm((f) => ({ ...f, title: e.target.value }))}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Due date">
                  <input
                    type="date"
                    className={CONTROL}
                    value={milestoneForm.dueDate || ""}
                    onChange={(e) => setMilestoneForm((f) => ({ ...f, dueDate: e.target.value }))}
                  />
                </Field>
                <Field label="Amount" hint="Leave blank if it is not separately billable.">
                  <Input
                    type="number"
                    min={0}
                    value={milestoneForm.amount || ""}
                    onChange={(e) => setMilestoneForm((f) => ({ ...f, amount: e.target.value }))}
                  />
                </Field>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setMilestoneForm(null)} disabled={busy}>Cancel</Button>
                <Button onClick={submitMilestone} disabled={busy}>Add</Button>
              </div>
            </div>
          )}
        </Modal>

        <Modal open={Boolean(amendForm)} onClose={() => setAmendForm(null)} title="Amend the contract">
          {amendForm && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                The previous figure is recorded and stays visible. This is how a signed term is
                changed — it cannot be edited in place.
              </p>
              <Field label="What is changing">
                <select
                  className={CONTROL}
                  value={amendForm.field}
                  onChange={(e) => setAmendForm((f) => ({ ...f, field: e.target.value, value: "" }))}
                >
                  <option value="value">Value</option>
                  <option value="contract_type">Contract type</option>
                  <option value="start_date">Start date</option>
                  <option value="end_date">End date</option>
                </select>
              </Field>
              <Field label="New value">
                {amendForm.field === "contract_type" ? (
                  <select
                    className={CONTROL}
                    value={amendForm.value}
                    onChange={(e) => setAmendForm((f) => ({ ...f, value: e.target.value }))}
                  >
                    <option value="">Choose…</option>
                    {TYPES.map(([v, label]) => (
                      <option key={v} value={v}>{label}</option>
                    ))}
                  </select>
                ) : amendForm.field === "value" ? (
                  <Input
                    type="number"
                    min={0}
                    value={amendForm.value}
                    onChange={(e) => setAmendForm((f) => ({ ...f, value: e.target.value }))}
                  />
                ) : (
                  <input
                    type="date"
                    className={CONTROL}
                    value={amendForm.value}
                    onChange={(e) => setAmendForm((f) => ({ ...f, value: e.target.value }))}
                  />
                )}
              </Field>
              <Field label="Why" hint="What the change is for. This is the part a dispute reads.">
                <textarea
                  className={CONTROL}
                  rows={3}
                  value={amendForm.reason || ""}
                  onChange={(e) => setAmendForm((f) => ({ ...f, reason: e.target.value }))}
                />
              </Field>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setAmendForm(null)} disabled={busy}>Cancel</Button>
                <Button onClick={submitAmend} disabled={busy}>Record amendment</Button>
              </div>
            </div>
          )}
        </Modal>
      </div>
    );
  }

  // ── The list ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        title="Contracts"
        description="What was agreed with each client, and what has been delivered against it."
        actions={
          <Button onClick={() => setForm({ reference: "", title: "", contractType: "fixed_price" })}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            New contract
          </Button>
        }
      />

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : error ? (
        <ErrorState title="Could not load" description={error} onRetry={load} />
      ) : contracts.length === 0 ? (
        <EmptyState
          icon={FileSignature}
          title="No contracts yet"
          description="Record what was agreed, and the invoices that follow have something to follow from."
        />
      ) : (
        <Section>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Reference</th>
                  <th className="py-2 pr-4 font-medium">Title</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Value</th>
                  <th className="py-2 pr-4 font-medium">Milestones</th>
                  <th className="py-2 pr-4 font-medium">Not broken out</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {contracts.map((c) => {
                  const gap = c.milestone_gap;
                  return (
                    <tr key={c.contract_id} className="border-b border-border/60">
                      <td className="py-2 pr-4 tabular-nums text-foreground">{c.reference}</td>
                      <td className="py-2 pr-4">{c.title}</td>
                      <td className="py-2 pr-4">
                        <Badge variant={STATUS_TONE[c.status] || "outline"}>{c.status}</Badge>
                      </td>
                      <td className="py-2 pr-4 tabular-nums">{money(c.value, c.currency)}</td>
                      <td className="py-2 pr-4 tabular-nums text-muted-foreground">
                        {c.milestones_invoiced}/{c.milestones} invoiced
                      </td>
                      {/* The gap is a prompt, not an error — see the note at the
                          top. NULL where the value is unknown, because a gap
                          from an unknown total is not zero. */}
                      <td className="py-2 pr-4 tabular-nums">
                        {gap === null || gap === undefined ? (
                          <span className="text-muted-foreground">—</span>
                        ) : Number(gap) === 0 ? (
                          <span className="text-muted-foreground">all of it</span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <TriangleAlert className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                            {money(gap, c.currency)}
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        <Button size="sm" variant="outline" onClick={() => open(c)} disabled={busy}>
                          Open
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Modal open={Boolean(form)} onClose={() => setForm(null)} title="New contract">
        {form && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Reference">
                <Input
                  value={form.reference}
                  onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                  placeholder="SOW-2026-004"
                />
              </Field>
              <Field label="Type">
                <select
                  className={CONTROL}
                  value={form.contractType}
                  onChange={(e) => setForm((f) => ({ ...f, contractType: e.target.value }))}
                >
                  {TYPES.map(([v, label]) => (
                    <option key={v} value={v}>{label}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Title">
              <Input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </Field>
            <Field label="Project" hint="Optional — a contract is often signed before the project exists.">
              <select
                className={CONTROL}
                value={form.projectId || ""}
                onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))}
              >
                <option value="">Not linked</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Value" hint="Blank if not agreed yet.">
                <Input
                  type="number"
                  min={0}
                  value={form.value || ""}
                  onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                />
              </Field>
              <Field label="Start">
                <input
                  type="date"
                  className={CONTROL}
                  value={form.startDate || ""}
                  onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                />
              </Field>
              <Field label="End">
                <input
                  type="date"
                  className={CONTROL}
                  min={form.startDate}
                  value={form.endDate || ""}
                  onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                />
              </Field>
            </div>
            <p className="text-sm text-muted-foreground">
              It starts as a draft. Signing it freezes the value, the type and the dates — after
              that they change only by amendment.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setForm(null)} disabled={busy}>Cancel</Button>
              <Button onClick={submitContract} disabled={busy}>Create draft</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
