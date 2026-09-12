"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { CalendarDays, Clock, LogIn, LogOut, MapPin } from "lucide-react";

import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Section,
  Skeleton,
  StatusPill,
} from "@/components/ui";
import StatCard from "@/components/shell/StatCard";
import { attendanceActionRequest, priorAttendanceCheckout } from "@/utils/attendanceActions";
import { useAuth } from "@/contexts/AuthContext";
import { getOrgContext } from "@/utils/orgContext";
import { attendanceIdentity, loadAttendanceRange, validateAttendanceReceipt } from "@/utils/attendanceRequests";
import { authFetch } from "@/utils/authFetch";
import { showError, showSuccess } from "@/utils/alerts";

/**
 * My Attendance — the same screen in the staff shell and the admin shell.
 *
 * ONE COMPONENT, NOT TWO. An HR lead has a working day exactly as a developer
 * does, and the question "was I in on Tuesday" has one answer and one shape.
 * Nothing here takes a `role` prop, because nothing here needs to know who is
 * looking: the route decides that against the verified token, and RLS decides
 * it again underneath.
 *
 * THE DATE COMES FROM THIS BROWSER, DELIBERATELY. The server runs in UTC, so an
 * organization may start its local calendar day before UTC does. Sending `YYYY-MM-DD` as the user's own calendar reads it
 * is what stops a morning check-in landing on yesterday. The route validates it
 * hard rather than trusting it.
 */

/** The user's own calendar day, not the server's. */
function localDay(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function hoursBetween(a, b) {
  if (!a || !b) return null;
  const ms = Date.parse(b) - Date.parse(a);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms / 3600000;
}

const timeOf = (iso) =>
  iso
    ? new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : "—";

/**
 * Attendance status -> the StatusPill vocabulary.
 *
 * StatusPill has its own seven-word map (active/success/inactive/pending/
 * warning/error/unknown) and falls back silently for anything else, so passing
 * our words straight in would render every row as "unknown" and nothing would
 * look broken enough to notice.
 */
const STATUS_PILL = {
  present: "success",
  remote: "active",
  on_leave: "warning",
  holiday: "inactive",
  absent: "error",
};

const STATUS_LABEL = {
  present: "Present",
  remote: "Remote",
  on_leave: "On leave",
  holiday: "Holiday",
  absent: "Absent",
};

export default function MyAttendance() {
  useAuth(); // Subscribe to account changes; storage supplies the typed display context.
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [today, setToday] = useState(localDay);
  const liveDay = useRef(today);
  liveDay.current = today;
  const context = getOrgContext();
  const identity = attendanceIdentity(context);
  const liveIdentity = useRef(identity);
  liveIdentity.current = identity;
  const mounted = useRef(true);
  const generation = useRef(0);
  const actionLock = useRef(null);
  const [loadedIdentity, setLoadedIdentity] = useState(null);
  const currentIdentity = useCallback(() => mounted.current && identity !== null
    && liveIdentity.current === identity && attendanceIdentity(getOrgContext()) === identity, [identity]);

  useEffect(() => {
    mounted.current = true;
    const clock = setInterval(() => setToday(localDay()), 30000);
    return () => { mounted.current = false; ++generation.current; clearInterval(clock); };
  }, []);

  const load = useCallback(async () => {
    const ticket = ++generation.current;
    const current = () => ticket === generation.current && currentIdentity();
    setLoading(true);
    setError("");
    setRecords([]);
    setLoadedIdentity(null);
    try {
      if (!identity) throw new Error("Your identity could not be confirmed. Sign in again.");
      const start = new Date(`${today}T12:00:00`);
      start.setDate(start.getDate() - 29);
      const rows = await loadAttendanceRange(authFetch, { from: localDay(start), to: today, context: getOrgContext(), current });
      if (!current()) return;
      setRecords(rows);
      setLoadedIdentity(identity);
    } catch (e) {
      if (ticket === generation.current && mounted.current && (!identity || currentIdentity())) setError(e?.message || "Could not load your attendance.");
    } finally {
      if (ticket === generation.current && mounted.current && (!identity || currentIdentity())) setLoading(false);
    }
  }, [today, identity, currentIdentity]);

  useEffect(() => {
    actionLock.current = null;
    setBusy(false);
    load();
  }, [load]);

  const todayRecord = useMemo(
    () => records.find((r) => r.work_date === today) || null,
    [records, today]
  );

  const monthStats = useMemo(() => {
    let present = 0;
    let onLeave = 0;
    let hours = 0;
    for (const r of records) {
      if (r.status === "present" || r.status === "remote") present += 1;
      if (r.status === "on_leave") onLeave += 1;
      const h = hoursBetween(r.check_in_at, r.check_out_at);
      if (h !== null) hours += h;
    }
    return { present, onLeave, hours };
  }, [records]);

  const act = async (action, record = null) => {
    if (actionLock.current || loading || error || loadedIdentity !== identity || !currentIdentity()) return;
    const actualToday = localDay();
    const request = attendanceActionRequest(action, today, actualToday, record);
    if (!request) {
      if (today !== actualToday) setToday(actualToday);
      return;
    }
    if (record && !records.some((row) => row === record)) return;
    const ticket = {};
    actionLock.current = ticket;
    setBusy(true);
    const captured = getOrgContext();
    try {
      const res = await authFetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const json = await res.json().catch(() => ({}));
      if (!currentIdentity() || liveDay.current !== today || actionLock.current !== ticket) return;
      if (!res.ok || !json?.success) throw new Error(json?.error || "That did not go through.");
      const confirmed = validateAttendanceReceipt(json, captured, request.workDate, action);
      if (json.unchanged && !confirmed.check_in_at) {
        showSuccess(`Attendance unchanged: ${STATUS_LABEL[confirmed.status] || confirmed.status}.`);
        await load();
        return;
      }
      showSuccess(json.unchanged
        ? (action === "check_out" ? "Already checked out." : "Already checked in.")
        : (action === "check_out" ? "Checked out." : "Checked in."));
      await load();
    } catch (e) {
      if (currentIdentity() && liveDay.current === today && actionLock.current === ticket) {
        showError(e?.message || "That did not go through.");
        // A network failure may follow a committed write: confirm state again.
        await load();
      }
    } finally {
      if (actionLock.current === ticket) {
        actionLock.current = null;
        if (currentIdentity()) setBusy(false);
      }
    }
  };

  if (loading || (!error && loadedIdentity !== identity)) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return <ErrorState title="Attendance unavailable" description={error} onRetry={load} />;
  }

  const onLeaveToday = todayRecord?.status === "on_leave";
  const nonWorkingDay = ["on_leave", "holiday", "absent"].includes(todayRecord?.status);
  const checkedIn = Boolean(todayRecord?.check_in_at);
  const checkedOut = Boolean(todayRecord?.check_out_at);

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Attendance"
        description="Your check-ins for the last 30 days."
      />

      <Section>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <CalendarDays className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-foreground">Today</p>
              <p className="text-sm text-muted-foreground">
                {checkedIn ? `In at ${timeOf(todayRecord.check_in_at)}` : "Not checked in yet"}
                {checkedOut ? ` · Out at ${timeOf(todayRecord.check_out_at)}` : ""}
              </p>
            </div>
          </div>

          {/* An approved leave day is not a day to check in on. The button is
              hidden rather than disabled: there is nothing the person could do
              to make it work, so offering it would only raise a question. */}
          {nonWorkingDay ? (
            <Badge variant="warning">{onLeaveToday ? "On approved leave today" : STATUS_LABEL[todayRecord.status]}</Badge>
          ) : (
            <div className="flex gap-2">
              <Button
                onClick={() => act("check_in")}
                disabled={busy || checkedIn}
                aria-label="Check in for today"
              >
                <LogIn className="mr-2 h-4 w-4" aria-hidden="true" />
                {checkedIn ? "Checked in" : "Check in"}
              </Button>
              <Button
                variant="outline"
                onClick={() => act("check_out")}
                disabled={busy || !checkedIn || checkedOut}
                aria-label="Check out for today"
              >
                <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
                {checkedOut ? "Checked out" : "Check out"}
              </Button>
            </div>
          )}
        </div>
      </Section>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="Days present"
          value={monthStats.present}
          icon={MapPin}
          hint="Last 30 days"
        />
        <StatCard
          title="Days on leave"
          value={monthStats.onLeave}
          icon={CalendarDays}
          hint="Last 30 days"
        />
        <StatCard
          title="Hours recorded"
          value={monthStats.hours ? monthStats.hours.toFixed(1) : "0.0"}
          icon={Clock}
          hint="Only days with a check-out"
        />
      </div>

      <Section title="Recent days">
        {records.length === 0 ? (
          <EmptyState
            title="No attendance yet"
            description="Your days appear here once you check in."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Date</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">In</th>
                  <th className="py-2 pr-4 font-medium">Out</th>
                  <th className="py-2 pr-4 font-medium">Hours</th>
                  <th className="py-2 pr-4 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => {
                  const h = hoursBetween(r.check_in_at, r.check_out_at);
                  return (
                    <tr key={r.id} className="border-b border-border/60">
                      <td className="py-2 pr-4 text-foreground">{r.work_date}</td>
                      <td className="py-2 pr-4">
                        <StatusPill
                          status={STATUS_PILL[r.status] || "unknown"}
                          label={STATUS_LABEL[r.status] || r.status}
                        />
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">{timeOf(r.check_in_at)}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{timeOf(r.check_out_at)}</td>
                      {/* An open day shows a dash, not 0.0 — it is unknown, not zero. */}
                      <td className="py-2 pr-4 text-muted-foreground">
                        {h === null ? "—" : h.toFixed(1)}
                      </td>
                      <td className="py-2 pr-4">
                        {priorAttendanceCheckout(r, today) ? (
                          <Button variant="outline" disabled={busy}
                            aria-label={`Check out shift from ${r.work_date}`}
                            onClick={() => act("check_out", r)}>
                            Check out shift
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
      </Section>
    </div>
  );
}
