"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, RotateCcw, XCircle } from "lucide-react";

import {
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Section,
  Skeleton,
  StatusPill,
  Tabs,
} from "@/components/ui";
import { createTimesheetPager } from "@/utils/timesheetPagination";
import { supabase } from "@/utils/supabaseClient";
import { deviceSessionFingerprint, deviceIdentityChanged } from "@/utils/devicePagination";
import { authFetch } from "@/utils/authFetch";
import { getOrgContext } from "@/utils/orgContext";
import { formatDuration } from "@/utils/pmData";
import { showConfirm, showError, showSuccess } from "@/utils/alerts";

/**
 * Timesheet Approvals — the weeks waiting to be agreed.
 *
 * WHAT APPROVING ACTUALLY DOES, and why it is not just a label. A submitted or
 * approved week is LOCKED: the trigger in migration 077 refuses any insert,
 * update or delete of a time log inside it. That matters because time logs are
 * written straight from the browser through PostgREST, so a lock that lived in
 * application code would be advisory — the same browser that renders this
 * screen could patch the hours behind it.
 *
 * REOPEN IS THEREFORE A REAL ACTION, not an undo button. It is the only way
 * corrected hours can be entered for a decided week, and it is recorded.
 *
 * YOUR OWN WEEK IS SHOWN AND NOT ACTIONABLE. A manager and a team lead book
 * hours like everybody else. Hiding their own row would look like it had been
 * lost; the route refuses it independently.
 */

const STATUS_PILL = {
  draft: "inactive",
  submitted: "pending",
  approved: "success",
  rejected: "error",
};

const TABS = [
  { id: "submitted", label: "Awaiting decision" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
];

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

export default function TimesheetApprovals() {
  const [tab, setTab] = useState("submitted");
  const [page, setPage] = useState({ timesheets: [], loading: true, error: "", nextCursor: null });
  const { timesheets: rows, loading, error, nextCursor } = page;
  const pager = useRef(null);
  const actionGeneration = useRef(0);
  const actionPending = useRef(false);
  const [busyId, setBusyId] = useState(null);

  const identity = getOrgContext();
  const me = identity?.userId || null;

  const load = useCallback(() => pager.current?.load(), []);

  useEffect(() => {
    const controller = createTimesheetPager(async (cursor, signal) => {
      const params = new URLSearchParams({ status: tab, limit: "50" });
      if (cursor) params.set("cursor", cursor);
      const res = await authFetch(`/api/timesheets?${params}`, { signal });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "Could not load timesheets.");
      return json;
    }, setPage);
    pager.current = controller;
    controller.clear();
    let previousIdentity;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (deviceIdentityChanged(event, previousIdentity, session)) {
        previousIdentity = deviceSessionFingerprint(session);
        ++actionGeneration.current;
        actionPending.current = false;
        setBusyId(null);
        controller.clear();
        // Broadcast payloads may come from another tab; authFetch resolves
        // this tab's current session and the server rechecks its authority.
        void controller.load();
      }
    });
    void controller.load();
    return () => { ++actionGeneration.current; actionPending.current = false; controller.dispose(); data?.subscription?.unsubscribe(); };
  }, [tab]);

  const decide = async (row, decision) => {
    if (actionPending.current || loading) return;
    actionPending.current = true;
    const own = actionGeneration.current;
    try {
      const label =
        decision === "approved" ? "Approve" : decision === "rejected" ? "Reject" : "Reopen";
      const ok = await showConfirm(
        `${label} the week of ${row.week_start}?`,
        decision === "approved"
          ? `${formatDuration(row.total_seconds)} logged, ${formatDuration(row.billable_seconds)} billable. Approving locks the hours — reopening is the only way to change them afterwards.`
          : decision === "rejected"
            ? "The week goes back to its author, who can correct it and submit again."
            : "The hours become editable again and the week returns to draft.",
        { confirmButtonText: label }
      );
      if (!ok || own !== actionGeneration.current) return;

      setBusyId(row.id);
      const res = await authFetch("/api/timesheets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timesheetId: row.id, decision }),
      });
      const json = await res.json().catch(() => ({}));
      if (own !== actionGeneration.current) return;
      if (!res.ok || !json?.success) throw new Error(json?.error || "That did not go through.");
      showSuccess(
        decision === "approved"
          ? "Week approved."
          : decision === "rejected"
            ? "Week sent back."
            : "Week reopened."
      );
      await load();
    } catch (e) {
      if (own === actionGeneration.current) showError(e?.message || "Could not confirm the action.");
    } finally {
      if (own === actionGeneration.current) { actionPending.current = false; setBusyId(null); }
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Timesheet Approvals"
        description={
          tab === "submitted" && rows.length
            ? `${rows.length}${nextCursor ? "+" : ""} week${rows.length === 1 && !nextCursor ? "" : "s"} waiting on you.`
            : "Weeks submitted across the organization."
        }
      />

      <Tabs tabs={TABS} active={tab} onChange={setTab} aria-label="Timesheet status" />

      <Section>
        {loading && !rows.length ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : error && !rows.length ? (
          <ErrorState title="Could not load" description={error} onRetry={load} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Clock}
            title={tab === "submitted" ? "Nothing waiting" : `No ${tab} weeks`}
            description={
              tab === "submitted"
                ? "Weeks appear here as soon as somebody submits one."
                : "Nothing has been filed under this status yet."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Week</th>
                  <th className="py-2 pr-4 font-medium">Logged</th>
                  <th className="py-2 pr-4 font-medium">Billable</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const mine = me && String(r.user_id) === String(me) && r.user_type === identity?.userType;
                  return (
                    <tr key={r.id} className="border-b border-border/60">
                      <td className="py-2 pr-4 tabular-nums text-foreground">{r.week_start}</td>
                      <td className="py-2 pr-4 tabular-nums text-muted-foreground">
                        {formatDuration(r.total_seconds)}
                      </td>
                      <td className="py-2 pr-4 tabular-nums text-muted-foreground">
                        {formatDuration(r.billable_seconds)}
                        <span className="ml-1 text-xs">
                          ({pct(r.billable_seconds, r.total_seconds)}%)
                        </span>
                      </td>
                      <td className="py-2 pr-4">
                        <StatusPill status={STATUS_PILL[r.status] || "unknown"} label={r.status} />
                      </td>
                      <td className="py-2 text-right">
                        {mine ? (
                          <span className="text-xs text-muted-foreground">
                            Your own — someone else decides
                          </span>
                        ) : r.status === "submitted" ? (
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              disabled={busyId !== null || loading}
                              onClick={() => decide(r, "approved")}
                            >
                              <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden="true" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyId !== null || loading}
                              onClick={() => decide(r, "rejected")}
                            >
                              <XCircle className="mr-1 h-4 w-4" aria-hidden="true" />
                              Reject
                            </Button>
                          </div>
                        ) : r.status === "approved" || r.status === "rejected" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busyId !== null || loading}
                            onClick={() => decide(r, "reopen")}
                          >
                            <RotateCcw className="mr-1 h-4 w-4" aria-hidden="true" />
                            Reopen
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 && error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
        {nextCursor && <Button className="mt-4" variant="outline" disabled={loading || busyId !== null} onClick={() => pager.current?.load(error ? page.retryMore : true)}>{loading ? "Loading…" : error ? "Retry loading weeks" : "Load more weeks"}</Button>}
        {rows.length > 0 && error && !nextCursor && <Button variant="outline" onClick={load}>Refresh weeks</Button>}
      </Section>
    </div>
  );
}
