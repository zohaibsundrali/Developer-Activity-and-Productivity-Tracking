"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { AlertTriangle, FileText, Receipt, TrendingUp } from "lucide-react";

import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Section,
  Skeleton,
  Tabs,
} from "@/components/ui";
import StatCard from "@/components/shell/StatCard";
import { getOrgContext } from "@/utils/orgContext";
import { invoiceSelectionKey, isInvoiceProfileType, invoicePnlTotals, invoiceCurrencyBreakdown } from "@/utils/invoicingSelections";
import { authFetch } from "@/utils/authFetch";
import { showConfirm, showError, showSuccess } from "@/utils/alerts";

/**
 * Invoicing — approved hours becoming a bill, and what a project actually made.
 *
 * TWO TABS BECAUSE THEY ARE TWO QUESTIONS ASKED BY THE SAME PERSON in the same
 * sitting: what can I bill, and did the last one leave us anything. Splitting
 * them into two sidebar entries would put a nav click in the middle of one
 * thought.
 *
 * THIS SCREEN NEVER PRICES ANYTHING. It sends which weeks to bill — a project,
 * a person, a week — and the route reads the hours and the rate back from the
 * database. A screen that posted its own totals would let whoever opened it
 * invoice a client for any number, and the invoice would look correct.
 *
 * A ROW WITH NO RATE IS SHOWN, NOT HIDDEN. Somebody worked those hours. Hiding
 * them because nobody set a price is how work goes unbilled quietly; showing
 * them un-selectable, with the reason, is how it gets priced.
 */

const money = (v, currency = "USD") =>
  v == null
    ? "—"
    : new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(v));

const TABS = [
  { id: "billable", label: "Ready to bill" },
  { id: "pnl", label: "Project P&L" },
];

export default function Invoicing() {
  const [tab, setTab] = useState("billable");
  const [rows, setRows] = useState([]);
  const [pnl, setPnl] = useState([]);
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [project, setProject] = useState("");
  const [busy, setBusy] = useState(false);
  const context = getOrgContext();
  const scope = `${context?.organizationId}:${context?.userType}:${context?.userId}:${tab}`;
  const liveScope = useRef(scope); liveScope.current = scope;
  const loadGeneration = useRef(0);
  const currentScope = useCallback(() => {
    const current = getOrgContext();
    return liveScope.current === scope && `${current?.organizationId}:${current?.userType}:${current?.userId}:${tab}` === scope;
  }, [scope, tab]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setRows([]); setPnl([]); setClients([]); setClientId(""); setSelected(new Set()); setProject("");
    const ticket = ++loadGeneration.current;
    const active = () => ticket === loadGeneration.current && currentScope();
    try {
      const res = await authFetch(`/api/invoicing?view=${tab}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Could not load this.");
      }
      if (!active()) return;
      if (tab === "pnl") setPnl(json.projects || []);
      else {
        setRows(json.rows || []);
        setClients(json.clients || []);
        setSelected(new Set());
      }
    } catch (e) {
      if (active()) setError(e?.message || "Could not load this.");
    } finally {
      if (active()) setLoading(false);
    }
  }, [tab, currentScope]);

  useEffect(() => {
    load();
  }, [load]);

  /** Weeks group by project: one invoice bills one project. */
  const byProject = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.project_id)) map.set(r.project_id, []);
      map.get(r.project_id).push(r);
    }
    return map;
  }, [rows]);

  const keyOf = invoiceSelectionKey;

  const toggle = (r) => {
    if (r.rate == null || !isInvoiceProfileType(r.user_type) || busy) return;
    if (!selected.has(keyOf(r)) && selected.size >= 200 && project === r.project_id) {
      showError("Choose at most 200 weeks per invoice.");
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      const k = keyOf(r);
      if (next.has(k)) next.delete(k);
      else {
        // One invoice, one project. Switching project clears the rest rather
        // than silently building a selection that cannot be billed together.
        if (project && project !== r.project_id) next.clear();
        next.add(k);
      }
      return next;
    });
    if (project !== r.project_id) setClientId("");
    setProject(r.project_id);
  };

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(keyOf(r))),
    [rows, selected]
  );
  const selectedTotal = selectedRows.reduce(
    (s, r) => s + Number(r.hours) * Number(r.rate || 0),
    0
  );

  const unpricedCount = rows.filter((r) => r.rate == null).length;

  const raise = async () => {
    if (busy || selectedRows.length === 0 || !currentScope()) return;
    const ok = await showConfirm(
      `Raise a draft invoice for ${money(selectedTotal)}?`,
      `${selectedRows.length} week${selectedRows.length === 1 ? "" : "s"} of approved hours. It is created as a draft — nothing is sent to the client.`,
      { confirmButtonText: "Create draft" }
    );
    if (!ok || !currentScope()) return;

    setBusy(true);
    try {
      const res = await authFetch("/api/invoicing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project,
          clientId: clientId || null,
          // Deliberately NOT sending hours or rates. See the note at the top.
          selections: selectedRows.map((r) => ({
            userId: r.user_id,
            userType: r.user_type,
            weekStart: r.week_start,
          })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!currentScope()) return;
      if (!res.ok || !json?.success) throw new Error(json?.error || "Could not raise it.");
      showSuccess(`Draft ${json.invoice?.number || "invoice"} created.`);
      await load();
    } catch (e) {
      if (currentScope()) showError(e?.message || "Could not raise it.");
    } finally {
      setBusy(false);
    }
  };

  const totals = useMemo(() => invoicePnlTotals(pnl), [pnl]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoicing"
        description="Approved, billable hours — and what each project has actually made."
      />

      <Tabs tabs={TABS} active={tab} onChange={setTab} aria-label="Invoicing views" />

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : error ? (
        <ErrorState title="Could not load" description={error} onRetry={load} />
      ) : tab === "pnl" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard title="Invoiced" value={money(totals.invoiced)} icon={Receipt}
              hint={totals.invoiced == null ? "Separate currencies — see project amounts" : undefined} />
            <StatCard
              title="Cost"
              value={money(totals.cost)}
              icon={TrendingUp}
              hint={totals.cost == null ? "No cost rates set" : !totals.costComplete ? "Partial cost — some hours have no cost rate" : "Approved hours × cost rate"}
            />
            <StatCard
              title="Margin"
              value={money(totals.margin)}
              icon={TrendingUp}
              hint={totals.invoiced == null ? "Currencies cannot be combined without conversion" : totals.margin == null ? "Needs complete cost rates" : undefined}
            />
          </div>

          <Section title="By project">
            {pnl.length === 0 ? (
              <EmptyState
                icon={TrendingUp}
                title="Nothing to report yet"
                description="A project appears here once it has approved hours or an invoice."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">Project</th>
                      <th className="py-2 pr-4 font-medium">Invoiced</th>
                      <th className="py-2 pr-4 font-medium">Hours</th>
                      <th className="py-2 pr-4 font-medium">Cost</th>
                      <th className="py-2 pr-4 font-medium">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pnl.map((p) => {
                      const partial =
                        Number(p.total_hours) > 0 &&
                        Number(p.costed_hours) < Number(p.total_hours);
                      return (
                        <tr key={p.project_id} className="border-b border-border/60">
                          <td className="py-2 pr-4 text-foreground">{p.project_name}</td>
                          <td className="py-2 pr-4 tabular-nums">
                            {money(p.invoiced)}
                            {p.invoiced == null && (
                              <p className="text-xs text-muted-foreground">
                                {invoiceCurrencyBreakdown(p.invoice_currency_totals) || "Currency totals unavailable"}
                              </p>
                            )}
                          </td>
                          <td className="py-2 pr-4 tabular-nums text-muted-foreground">
                            {p.total_hours}
                          </td>
                          <td className="py-2 pr-4 tabular-nums">
                            {money(p.cost)}
                            {/* The gap named rather than absorbed: a margin that
                                treats unpriced people as free is the most
                                misleading number this screen could show. */}
                            {partial && (
                              <span
                                className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground"
                                title={`${p.costed_hours} of ${p.total_hours} hours have a cost rate`}
                              >
                                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                                partial
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-4 tabular-nums">
                            {p.margin == null || partial ? (
                              <span className="text-muted-foreground">{p.invoiced == null ? "— separate currencies" : "— needs complete cost rates"}</span>
                            ) : (
                              <span className={Number(p.margin) < 0 ? "text-destructive" : ""}>
                                {money(p.margin)}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </>
      ) : (
        <>
          {unpricedCount > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span>
                {unpricedCount} week{unpricedCount === 1 ? "" : "s"} of approved work cannot be
                billed because no rate is set. Set one on the project, or on the person for that
                project.
              </span>
            </div>
          )}

          {rows.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="Nothing ready to bill"
              description="Hours appear here once a timesheet week is approved and the work is marked billable."
            />
          ) : (
            <>
              {[...byProject.entries()].map(([projectId, group]) => (
                <Section key={projectId} title={group[0]?.project_name || "Project"}>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[680px] text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                          <th className="py-2 pr-4 font-medium" />
                          <th className="py-2 pr-4 font-medium">Week</th>
                          <th className="py-2 pr-4 font-medium">Hours</th>
                          <th className="py-2 pr-4 font-medium">Rate</th>
                          <th className="py-2 pr-4 font-medium">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.map((r) => {
                          const priced = r.rate != null;
                          return (
                            <tr key={keyOf(r)} className="border-b border-border/60">
                              <td className="py-2 pr-4">
                                <input
                                  type="checkbox"
                                  checked={selected.has(keyOf(r))}
                                  disabled={!priced || !isInvoiceProfileType(r.user_type) || busy}
                                  onChange={() => toggle(r)}
                                  aria-label={`Bill ${r.user_type || "unresolved"} week of ${r.week_start}`}
                                />
                              </td>
                              <td className="py-2 pr-4 tabular-nums">{r.week_start}</td>
                              <td className="py-2 pr-4 tabular-nums">{r.hours}</td>
                              <td className="py-2 pr-4 tabular-nums">
                                {priced ? money(r.rate) : <Badge variant="warning">rate not set</Badge>}
                              </td>
                              <td className="py-2 pr-4 tabular-nums">
                                {priced ? money(Number(r.hours) * Number(r.rate)) : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Section>
              ))}

              <div className="space-y-2 rounded-lg border border-border bg-card px-3 py-3">
                <label htmlFor="invoice-recipient" className="block text-sm font-medium">Invoice client</label>
                <select id="invoice-recipient" value={clientId} onChange={event => setClientId(event.target.value)}
                  disabled={busy || selectedRows.length === 0}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                  <option value="">Unassigned draft</option>
                  {clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}
                </select>
                <p className="text-xs text-muted-foreground">
                  {clientId
                    ? "The selected client can access this invoice after it leaves draft."
                    : "Unassigned drafts are not visible to clients. Choose a client here if this invoice will be shared."}
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
                <span className="text-sm">
                  {selectedRows.length === 0
                    ? "Select the weeks to bill."
                    : `${selectedRows.length} week${selectedRows.length === 1 ? "" : "s"} selected · ${money(selectedTotal)}`}
                </span>
                <Button onClick={raise} disabled={busy || selectedRows.length === 0}>
                  <Receipt className="mr-2 h-4 w-4" aria-hidden="true" />
                  Create draft invoice
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
