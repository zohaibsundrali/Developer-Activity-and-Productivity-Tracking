"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarPlus, Plane } from "lucide-react";

import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  Modal,
  PageHeader,
  Section,
  Skeleton,
  StatusPill,
} from "@/components/ui";
import { authFetch } from "@/utils/authFetch";
import { showConfirm, showError, showSuccess } from "@/utils/alerts";

/**
 * My Leave — raising a request and watching what happened to it.
 *
 * ONE COMPONENT for both shells, for the reason MyAttendance gives: an HR lead
 * takes holidays too, and there is only one shape to "when am I off".
 *
 * WHAT THIS SCREEN DOES NOT DO is decide anything. It cannot approve, it cannot
 * request on somebody else's behalf, and it never sends a `status` — the route
 * writes 'pending' and reads no status from the body at all, because a create
 * endpoint that takes a status from the caller is an approval endpoint wearing
 * a disguise.
 *
 * QUOTAS MAY BE UNSET AND THAT IS SHOWN HONESTLY. `annual_quota_days` is NULL
 * until the organization chooses one (see migration 075), so the balance line
 * reads "not set" rather than 0 — which would tell somebody they have no leave
 * left when in fact nobody has said how much they get.
 */

const CONTROL =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

const STATUS_PILL = {
  pending: "pending",
  approved: "success",
  rejected: "error",
  cancelled: "inactive",
};

function localDay(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Inclusive of both ends — a one-day leave is 1 day, not 0. */
function spanDays(start, end) {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / 86400000) + 1;
}

export default function MyLeave() {
  const [requests, setRequests] = useState([]);
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const today = localDay();
  const [form, setForm] = useState({
    leaveTypeId: "",
    startDate: today,
    endDate: today,
    halfDay: false,
    reason: "",
  });

  const load = useCallback(async () => {
    setError("");
    try {
      const [reqRes, typeRes] = await Promise.all([
        authFetch("/api/leave?scope=me"),
        authFetch("/api/leave?types=1"),
      ]);
      const reqJson = await reqRes.json().catch(() => ({}));
      const typeJson = await typeRes.json().catch(() => ({}));
      if (!reqRes.ok || !reqJson?.success) {
        throw new Error(reqJson?.error || "Could not load your leave.");
      }
      setRequests(reqJson.requests || []);
      setTypes(typeRes.ok && typeJson?.success ? typeJson.types || [] : []);
    } catch (e) {
      setError(e?.message || "Could not load your leave.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const span = spanDays(form.startDate, form.endDate);
  // A half day only makes sense on a single-day request. Offering the checkbox
  // on a five-day span would let somebody book "0.5 days" of a working week.
  const canHalf = span === 1;
  const days = span === null ? null : canHalf && form.halfDay ? 0.5 : span;

  const pendingCount = useMemo(
    () => requests.filter((r) => r.status === "pending").length,
    [requests]
  );

  const submit = async () => {
    if (!form.leaveTypeId) {
      showError("Choose a leave type.");
      return;
    }
    if (days === null) {
      showError("The end date cannot be before the start date.");
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch("/api/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leaveTypeId: form.leaveTypeId,
          startDate: form.startDate,
          endDate: form.endDate,
          days,
          reason: form.reason,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Could not raise the request.");
      }
      showSuccess("Leave requested.");
      setOpen(false);
      setForm((f) => ({ ...f, reason: "", halfDay: false }));
      await load();
    } catch (e) {
      showError(e?.message || "Could not raise the request.");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (row) => {
    // showConfirm is positional (title, text, options) — an object argument
    // renders "[object Object]" as the title and still resolves, so this is a
    // mistake that looks like it worked.
    const ok = await showConfirm(
      "Withdraw this request?",
      `${row.start_date} to ${row.end_date}. This cannot be undone.`,
      { confirmButtonText: "Withdraw" }
    );
    if (!ok) return;
    try {
      const res = await authFetch("/api/leave", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: row.id, decision: "cancelled" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "Could not withdraw it.");
      }
      showSuccess("Request withdrawn.");
      await load();
    } catch (e) {
      showError(e?.message || "Could not withdraw it.");
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (error) {
    return <ErrorState title="Leave unavailable" description={error} onRetry={load} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Leave"
        description={
          pendingCount
            ? `${pendingCount} request${pendingCount === 1 ? "" : "s"} waiting for a decision.`
            : "Your leave requests and their outcomes."
        }
        actions={
          <Button onClick={() => setOpen(true)} disabled={types.length === 0}>
            <CalendarPlus className="mr-2 h-4 w-4" aria-hidden="true" />
            Request leave
          </Button>
        }
      />

      {/* An organization whose HR has not configured any leave type yet. Said
          plainly, because a disabled button with no explanation is the thing
          that gets reported as a bug about the button. */}
      {types.length === 0 && (
        <Section>
          <EmptyState
            icon={Plane}
            title="No leave types configured"
            description="Someone with HR access needs to set up leave types before requests can be raised."
          />
        </Section>
      )}

      <Section title="Your requests">
        {requests.length === 0 ? (
          <EmptyState
            icon={Plane}
            title="No leave requested"
            description="Requests you raise appear here with their status."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Type</th>
                  <th className="py-2 pr-4 font-medium">From</th>
                  <th className="py-2 pr-4 font-medium">To</th>
                  <th className="py-2 pr-4 font-medium">Days</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Note</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} className="border-b border-border/60">
                    <td className="py-2 pr-4 text-foreground">
                      {r.leave_types?.name || "Leave"}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">{r.start_date}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{r.end_date}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{r.days}</td>
                    <td className="py-2 pr-4">
                      <StatusPill status={STATUS_PILL[r.status] || "unknown"} label={r.status} />
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {r.decision_note || "—"}
                    </td>
                    <td className="py-2 text-right">
                      {/* Only a pending request can be withdrawn. An approved
                          one is a plan other people have made around. */}
                      {r.status === "pending" && (
                        <Button variant="ghost" size="sm" onClick={() => cancel(r)}>
                          Withdraw
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Modal open={open} onClose={() => setOpen(false)} title="Request leave">
        <div className="space-y-4">
          <Field label="Leave type">
            <select
              className={CONTROL}
              value={form.leaveTypeId}
              onChange={(e) => setForm((f) => ({ ...f, leaveTypeId: e.target.value }))}
            >
              <option value="">Choose…</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.annual_quota_days == null ? " (quota not set)" : ` (${t.annual_quota_days} days/yr)`}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From">
              <input
                type="date"
                className={CONTROL}
                value={form.startDate}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    startDate: e.target.value,
                    // Keep the range valid as it is typed rather than rejecting
                    // it afterwards.
                    endDate: f.endDate < e.target.value ? e.target.value : f.endDate,
                  }))
                }
              />
            </Field>
            <Field label="To">
              <input
                type="date"
                className={CONTROL}
                min={form.startDate}
                value={form.endDate}
                onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
              />
            </Field>
          </div>

          {canHalf && (
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={form.halfDay}
                onChange={(e) => setForm((f) => ({ ...f, halfDay: e.target.checked }))}
              />
              Half day
            </label>
          )}

          <Field label="Reason (optional)">
            <textarea
              className={CONTROL}
              rows={3}
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            />
          </Field>

          <p className="text-sm text-muted-foreground">
            {days === null
              ? "The end date cannot be before the start date."
              : `This request is ${days} day${days === 1 ? "" : "s"}.`}
          </p>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy || days === null}>
              {busy ? "Sending…" : "Request leave"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
