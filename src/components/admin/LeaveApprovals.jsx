"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Plane, XCircle } from "lucide-react";

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
import { authFetch } from "@/utils/authFetch";
import { getOrgContext } from "@/utils/orgContext";
import { showConfirm, showError, showSuccess } from "@/utils/alerts";

/**
 * Leave Approvals — the queue an HR lead or a manager works through.
 *
 * WHY YOUR OWN REQUEST IS VISIBLE HERE BUT NOT ACTIONABLE. An HR lead holds
 * `leave.approve` and also takes holidays, so their own request lands in this
 * list like anybody else's. Hiding it would be worse than showing it — they
 * would think it had vanished — so it is shown with the buttons replaced by a
 * note. The route refuses the same thing independently (see SELF_APPROVAL in
 * /api/leave); this is the explanation, not the enforcement.
 *
 * The decision itself is a PATCH with a `decision`, never a status written
 * straight onto the row: the route re-checks the permission, re-checks that the
 * request is still pending, and stamps who decided it.
 */

const STATUS_PILL = {
  pending: "pending",
  approved: "success",
  rejected: "error",
  cancelled: "inactive",
};

const TABS = [
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
];

export default function LeaveApprovals() {
  const [tab, setTab] = useState("pending");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  // Who I am, so my own request can be marked rather than silently dropped.
  const me = getOrgContext()?.userId || null;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch(`/api/leave?status=${encodeURIComponent(tab)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Could not load leave requests.");
      }
      setRows(json.requests || []);
    } catch (e) {
      setError(e?.message || "Could not load leave requests.");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (row, decision) => {
    const ok = await showConfirm(
      decision === "approved" ? "Approve this leave?" : "Reject this leave?",
      `${row.start_date} to ${row.end_date} · ${row.days} day${row.days === 1 ? "" : "s"}.` +
        (decision === "approved"
          ? " Approving marks those days as leave on the attendance record."
          : ""),
      { confirmButtonText: decision === "approved" ? "Approve" : "Reject" }
    );
    if (!ok) return;

    setBusyId(row.id);
    try {
      const res = await authFetch("/api/leave", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: row.id, decision }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "That did not go through.");
      }
      showSuccess(decision === "approved" ? "Leave approved." : "Leave rejected.");
      await load();
    } catch (e) {
      showError(e?.message || "That did not go through.");
    } finally {
      setBusyId(null);
    }
  };

  const pendingCount = useMemo(
    () => (tab === "pending" ? rows.length : null),
    [tab, rows]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave Approvals"
        description={
          pendingCount
            ? `${pendingCount} request${pendingCount === 1 ? "" : "s"} waiting on you.`
            : "Leave requests across the organization."
        }
      />

      <Tabs tabs={TABS} active={tab} onChange={setTab} aria-label="Leave request status" />

      <Section>
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : error ? (
          <ErrorState title="Could not load" description={error} onRetry={load} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Plane}
            title={tab === "pending" ? "Nothing waiting" : `No ${tab} requests`}
            description={
              tab === "pending"
                ? "Requests appear here as soon as somebody raises one."
                : "Nothing has been filed under this status yet."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Type</th>
                  <th className="py-2 pr-4 font-medium">From</th>
                  <th className="py-2 pr-4 font-medium">To</th>
                  <th className="py-2 pr-4 font-medium">Days</th>
                  <th className="py-2 pr-4 font-medium">Reason</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const mine = me && String(r.user_id) === String(me);
                  return (
                    <tr key={r.id} className="border-b border-border/60">
                      <td className="py-2 pr-4 text-foreground">
                        {r.leave_types?.name || "Leave"}
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">{r.start_date}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{r.end_date}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{r.days}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{r.reason || "—"}</td>
                      <td className="py-2 pr-4">
                        <StatusPill
                          status={STATUS_PILL[r.status] || "unknown"}
                          label={r.status}
                        />
                      </td>
                      <td className="py-2 text-right">
                        {r.status !== "pending" ? null : mine ? (
                          // Shown, not hidden. See the note at the top.
                          <span className="text-xs text-muted-foreground">
                            Your own — someone else decides
                          </span>
                        ) : (
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              disabled={busyId === r.id}
                              onClick={() => decide(r, "approved")}
                            >
                              <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden="true" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyId === r.id}
                              onClick={() => decide(r, "rejected")}
                            >
                              <XCircle className="mr-1 h-4 w-4" aria-hidden="true" />
                              Reject
                            </Button>
                          </div>
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
    </div>
  );
}
