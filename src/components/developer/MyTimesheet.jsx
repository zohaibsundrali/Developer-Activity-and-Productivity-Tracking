"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, Clock, Lock, Plus, Send, Square } from "lucide-react";

import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Skeleton,
} from "@/components/ui";
import { authFetch } from "@/utils/authFetch";
import { supabase } from "@/utils/supabaseClient";
import { getOrgContext } from "@/utils/orgContext";
import { showError, showSuccess } from "@/utils/alerts";
import {
  addManualTimeLog,
  formatDuration,
  loadTimeLogs,
  stopTaskTimer,
} from "@/utils/pmData";
import { buildWeek, logSeconds, parseDuration, weekStart, ymd } from "@/utils/timesheet";
import { loadMyWork } from "@/utils/myWork";

/**
 * My Timesheet — a week of your own logged time.
 *
 * WHY THIS DID NOT EXIST. Everything underneath it already did: the
 * `task_time_logs` table (migration 017), start/stop/manual helpers in
 * pmData.js, and a partial unique index in the database that refuses a second
 * running timer for one person. The only UI for any of it is `TaskTimer`,
 * rendered inside `TaskDetailDrawer` — an ADMIN component. Developers have no
 * task drawer, so the people doing the work could not log time against it. The
 * table has no rows because nobody could put one there.
 *
 * A WEEK, NOT A MONTH AND NOT A DAY. A day gives no sense of whether the week
 * is on track; a month is too long to correct anything by the time you notice.
 * A week is also the unit people are asked to account for.
 *
 * THE RUNNING TIMER TICKS. `seconds` is only written when a timer stops, so a
 * running row has to be measured against now — and against a `now` that
 * advances, or today's total would freeze at whatever it was when the screen
 * loaded, which is precisely the number somebody watching a timer is watching.
 */

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function shiftWeek(start, weeks) {
  const d = new Date(start);
  d.setDate(d.getDate() + weeks * 7);
  return ymd(d);
}

function prettyDay(date) {
  const d = new Date(date);
  return `${DAY_NAMES[(d.getDay() + 6) % 7]} ${d.getDate()}`;
}

export default function MyTimesheet() {
  const [start, setStart] = useState(() => weekStart(new Date()));
  const [logs, setLogs] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const [entryTask, setEntryTask] = useState("");
  const [entryAmount, setEntryAmount] = useState("");
  const [entryNote, setEntryNote] = useState("");
  // The submission record for the week on screen, or null while it is still a
  // draft nobody has sent. A week with no row IS a draft — see migration 077,
  // which is why nothing was backfilled.
  const [sheet, setSheet] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const ctx = getOrgContext();
      const developerId = ctx?.userId || ctx?.appUserId;
      const from = `${start}T00:00:00.000Z`;
      const to = `${shiftWeek(start, 1)}T00:00:00.000Z`;

      const [rows, myTasks] = await Promise.all([
        loadTimeLogs({ developerId, from, to }),
        // For the manual-entry picker and to put a title on each row.
        // `task_time_logs` stores the id, not the name.
        loadMyWork(ctx?.organizationId || ctx?.orgId, developerId).catch(() => []),
      ]);

      const byId = new Map((myTasks || []).map((t) => [String(t.id), t]));
      setLogs(
        (rows || []).map((l) => ({
          ...l,
          task: byId.get(String(l.task_id)) || null,
          project: byId.get(String(l.task_id))?.project || null,
        }))
      );
      setTasks(myTasks || []);

      // The week's submission state. Failing to read it must not take the
      // timesheet down with it: the hours are the screen's real content and a
      // missing banner is a smaller loss than a blank page.
      try {
        const res = await authFetch(`/api/timesheets?scope=me`);
        const json = await res.json().catch(() => ({}));
        const rows = res.ok && json?.success ? json.timesheets || [] : [];
        setSheet(rows.find((t) => t.week_start === start) || null);
      } catch {
        setSheet(null);
      }
    } catch (e) {
      setError(e?.message || "Could not load your timesheet.");
    } finally {
      setLoading(false);
    }
  }, [start]);

  useEffect(() => {
    load();
  }, [load]);

  // Only while something is actually running. A ticking interval on a screen
  // with no live timer is a re-render a second for no reason.
  const week = useMemo(() => (logs ? buildWeek(logs, start, now) : null), [logs, start, now]);
  const running = week?.running || null;

  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [running]);

  const stop = useCallback(async () => {
    if (!running) return;
    setBusy(true);
    try {
      await stopTaskTimer(running);
      await load();
      showSuccess("Timer stopped");
    } catch (e) {
      showError(e?.message || "Could not stop the timer.");
    } finally {
      setBusy(false);
    }
  }, [running, load]);

  const addEntry = useCallback(
    async (e) => {
      e.preventDefault();
      const seconds = parseDuration(entryAmount);
      if (!entryTask) return showError("Pick a task first.");
      if (!seconds) {
        return showError('Enter a length like "1h 30m", "90m", or "45".');
      }
      setBusy(true);
      try {
        const task = tasks.find((t) => String(t.id) === String(entryTask));
        await addManualTimeLog({
          taskId: entryTask,
          projectId: task?.project_id || null,
          seconds,
          note: entryNote.trim() || null,
        });
        setEntryAmount("");
        setEntryNote("");
        await load();
        showSuccess(`Logged ${formatDuration(seconds)}`);
      } catch (err) {
        showError(err?.message || "Could not add that entry.");
      } finally {
        setBusy(false);
      }
    },
    [entryTask, entryAmount, entryNote, tasks, load]
  );

  if (loading && !logs) {
    return (
      <div className="space-y-6">
        <PageHeader title="My Timesheet" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="My Timesheet" />
        <ErrorState description={error} onRetry={load} />
      </div>
    );
  }

  const locked = sheet?.status === "submitted" || sheet?.status === "approved";

  const submitWeek = async () => {
    setSubmitting(true);
    try {
      const res = await authFetch("/api/timesheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStart: start }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "Could not submit the week.");
      setSheet(json.timesheet);
      showSuccess("Week submitted for approval.");
    } catch (e) {
      showError(e?.message || "Could not submit the week.");
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Flip a row between billable and not.
   *
   * A ROW IS SEVERAL LOGS — one task on one day may be three sittings — so this
   * writes every id the row carries. Done through PostgREST rather than a route
   * because that is how every other write on this screen already works; the
   * lock that matters lives in the database (migration 077), so a submitted or
   * approved week refuses this from the trigger and the error below is the
   * trigger's own words.
   */
  const setBillable = async (row, value) => {
    if (!row.logIds?.length) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("task_time_logs")
        .update({ is_billable: value })
        .in("id", row.logIds);
      if (error) throw new Error(error.message);
      await load();
    } catch (e) {
      showError(e?.message || "Could not change that.");
    } finally {
      setBusy(false);
    }
  };

  const thisWeek = weekStart(new Date());

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Timesheet"
        description={
          week.total === 0
            ? "Nothing logged this week."
            : `${formatDuration(week.total)} logged · ${formatDuration(week.billable)} billable.`
        }
      />

      {/* The week's submission state. Shown for every week, including one that
          has never been sent, because "you have not submitted this" is the
          thing a person most needs to know and an absent banner says nothing. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
        <div className="flex items-center gap-2 text-sm">
          {sheet?.status === "approved" ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
              <span>Approved{sheet.decision_note ? ` — ${sheet.decision_note}` : ""}</span>
            </>
          ) : sheet?.status === "submitted" ? (
            <>
              <Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span>Submitted — waiting for approval. The hours are locked until it is decided.</span>
            </>
          ) : sheet?.status === "rejected" ? (
            <>
              <Badge variant="destructive">Rejected</Badge>
              <span>{sheet.decision_note || "Correct the week and submit it again."}</span>
            </>
          ) : (
            <span className="text-muted-foreground">Not submitted.</span>
          )}
        </div>
        {!locked && week.total > 0 && (
          <Button size="sm" onClick={submitWeek} disabled={submitting}>
            <Send className="mr-2 h-4 w-4" aria-hidden="true" />
            {sheet?.status === "rejected" ? "Submit again" : "Submit week"}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => setStart(shiftWeek(start, -1))}>
            <ChevronLeft className="h-4 w-4" />
            <span className="sr-only">Previous week</span>
          </Button>
          <span className="px-2 text-sm font-medium tabular-nums">
            {start} — {shiftWeek(start, 1)}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setStart(shiftWeek(start, 1))}
            disabled={start >= thisWeek}
            title={start >= thisWeek ? "That week has not happened yet" : "Next week"}
          >
            <ChevronRight className="h-4 w-4" />
            <span className="sr-only">Next week</span>
          </Button>
          {start !== thisWeek && (
            <Button variant="ghost" size="sm" onClick={() => setStart(thisWeek)}>
              This week
            </Button>
          )}
        </div>

        {running && (
          <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-1.5">
            <Clock className="h-4 w-4 animate-pulse text-primary" />
            <span className="text-sm">
              Running:{" "}
              <span className="font-medium tabular-nums">{formatDuration(logSeconds(running, now))}</span>
            </span>
            <Button size="sm" variant="destructive" onClick={stop} disabled={busy}>
              <Square className="mr-1 h-3 w-3" />
              Stop
            </Button>
          </div>
        )}
      </div>

      {week.total === 0 ? (
        <EmptyState
          icon={Clock}
          title="No time logged this week"
          description="Start a timer from My Work, or add an entry below for work you have already done."
        />
      ) : (
        <div className="space-y-3">
          {week.days
            .filter((d) => d.rows.length > 0)
            .map((day) => (
              <section key={day.date} className="rounded-lg border border-border">
                <div className="flex items-baseline justify-between border-b border-border bg-muted/40 px-3 py-2">
                  <h3 className="text-sm font-semibold">{prettyDay(day.date)}</h3>
                  <span className="text-sm font-medium tabular-nums">
                    {formatDuration(day.seconds)}
                  </span>
                </div>
                <ul className="divide-y divide-border/60">
                  {day.rows.map((row) => (
                    <li
                      key={`${day.date}-${row.taskId}`}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{row.title}</span>
                        <span className="block text-xs text-muted-foreground">
                          {row.project || "No project"}
                          {row.entries > 1 && ` · ${row.entries} entries`}
                          {row.isRunning && " · running"}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-3">
                        {/* Disabled rather than hidden once the week is locked:
                            the state is worth seeing even when it cannot be
                            changed, and a control that vanishes reads as a bug. */}
                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={row.billableSeconds > 0}
                            disabled={locked || busy || !row.logIds?.length}
                            onChange={(e) => setBillable(row, e.target.checked)}
                            aria-label={`Mark ${row.title} as billable`}
                          />
                          Billable
                        </label>
                        <span className="text-sm tabular-nums">
                          {formatDuration(row.seconds)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}

      <form onSubmit={addEntry} className="rounded-lg border border-border p-3 space-y-3">
        <h3 className="text-sm font-semibold">Add time you have already spent</h3>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-end">
          <Field label="Task" htmlFor="ts-task">
            <select
              id="ts-task"
              value={entryTask}
              onChange={(e) => setEntryTask(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Pick a task…</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.task_title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="How long" htmlFor="ts-amount">
            <Input
              id="ts-amount"
              value={entryAmount}
              onChange={(e) => setEntryAmount(e.target.value)}
              placeholder="1h 30m"
            />
          </Field>
          <Field label="Note" htmlFor="ts-note">
            <Input
              id="ts-note"
              value={entryNote}
              onChange={(e) => setEntryNote(e.target.value)}
              placeholder="Optional"
            />
          </Field>
          <Button type="submit" disabled={busy}>
            <Plus className="mr-1 h-4 w-4" />
            Add
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {/* Stated rather than left to be discovered: a bare number is the most
              likely thing somebody types, and reading it as seconds would
              silently record almost nothing. */}
          &ldquo;1h 30m&rdquo;, &ldquo;90m&rdquo;, or a plain number, which is read as minutes.
        </p>
      </form>
    </div>
  );
}
