"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  startTaskTimer,
  stopTaskTimer,
  getActiveTimer,
  loadTimeLogs,
  addManualTimeLog,
  sumSeconds,
  formatDuration,
} from "@/utils/pmData";
import { showError } from "@/utils/alerts";
import { Badge, Button, Skeleton } from "@/components/ui";
import { Play, Square, Timer, Plus, Loader2 } from "lucide-react";

// ---- shared tokens (match TaskDetailDrawer / TaskExtras, compact drawer) ---
const FIELD_CLASS =
  "rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm text-foreground transition-colors duration-150 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
const SECTION_HEADING_CLASS =
  "text-xs font-semibold uppercase tracking-wide text-muted-foreground";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Native-Date-only day label: "today" / "yesterday" / "Mar 4".
// Defined as a function (no new Date() at module scope).
function relativeDay(iso) {
  if (!iso) return "";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((dayStart(new Date()) - dayStart(then)) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${MONTHS[then.getMonth()]} ${then.getDate()}`;
}

// Whole seconds between a log's start and now.
function secondsSince(startedAt) {
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return 0;
  return Math.max(0, Math.round((Date.now() - started) / 1000));
}

export default function TaskTimer({ task, projectId, members = [], onChanged }) {
  const taskId = task?.id;
  const effectiveProjectId = projectId || task?.project_id || null;

  const [logs, setLogs] = useState([]);
  // Purely presentational: without it the recent-entries list shows its empty
  // state ("No time logged yet") for the whole of the first fetch, which reads
  // as an answer rather than as "still loading".
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [active, setActive] = useState(null); // this user's running log, any task
  const [busy, setBusy] = useState(false); // a mutation is in flight
  const [elapsed, setElapsed] = useState(0); // live seconds, this task only
  const [showAdd, setShowAdd] = useState(false);
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");

  const intervalRef = useRef(null);

  const isRunningThisTask = !!active && taskId != null && String(active.task_id) === String(taskId);
  const isRunningOtherTask = !!active && !isRunningThisTask;

  // Every failure surfaces the same way; nothing here ever throws.
  const fail = useCallback((error) => {
    showError("Timer error", error?.message || String(error));
  }, []);

  const refetchLogs = useCallback(async () => {
    if (!taskId) return;
    const rows = await loadTimeLogs({ taskId });
    setLogs(rows || []);
  }, [taskId]);

  // ---- initial load, and whenever a different task is shown ---------------
  useEffect(() => {
    let alive = true;
    setLogs([]);
    setActive(null);
    setElapsed(0);
    setShowAdd(false);
    setMinutes("");
    setNote("");
    setLoadingLogs(true);
    if (!taskId) {
      setLoadingLogs(false);
      return undefined;
    }
    (async () => {
      try {
        const [rows, running] = await Promise.all([loadTimeLogs({ taskId }), getActiveTimer()]);
        if (!alive) return;
        setLogs(rows || []);
        setActive(running || null);
      } catch (error) {
        if (alive) fail(error);
      } finally {
        if (alive) setLoadingLogs(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [taskId, fail]);

  // ---- live elapsed ticker (only while running THIS task) ----------------
  // Cleared on unmount, on task change, and as soon as the timer stops.
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    // Not running: leave `elapsed` as-is — the pill is unmounted, and both the
    // task-change reset and the next start re-seed it before it is shown again.
    if (!isRunningThisTask || !active?.started_at) return undefined;
    const startedAt = active.started_at;
    setElapsed(secondsSince(startedAt));
    intervalRef.current = setInterval(() => setElapsed(secondsSince(startedAt)), 1000);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isRunningThisTask, active?.started_at]);

  // ---- mutations ---------------------------------------------------------
  const handleStart = useCallback(async () => {
    if (!taskId || busy) return;
    setBusy(true);
    try {
      const { log, error } = await startTaskTimer(taskId, effectiveProjectId);
      if (error) {
        fail(error);
        return;
      }
      setElapsed(0); // a freshly started timer is 0 — avoids a stale first frame
      setActive(log || null);
      await refetchLogs();
      await onChanged?.();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }, [taskId, effectiveProjectId, busy, refetchLogs, onChanged, fail]);

  const handleStop = useCallback(async () => {
    if (!active || busy) return;
    setBusy(true);
    try {
      const { error } = await stopTaskTimer(active);
      if (error) {
        fail(error);
        return;
      }
      setActive(null); // also tears the ticker down
      await refetchLogs();
      await onChanged?.();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }, [active, busy, refetchLogs, onChanged, fail]);

  const handleAddManual = useCallback(async () => {
    if (busy) return;
    const mins = Number(minutes);
    // Nothing usable typed — just collapse the row.
    if (!Number.isFinite(mins) || mins <= 0) {
      setShowAdd(false);
      setMinutes("");
      setNote("");
      return;
    }
    setBusy(true);
    try {
      const { error } = await addManualTimeLog({
        taskId,
        projectId: effectiveProjectId,
        seconds: Math.round(mins * 60),
        note: note.trim() || null,
      });
      if (error) {
        fail(error);
        return;
      }
      setShowAdd(false);
      setMinutes("");
      setNote("");
      await refetchLogs();
      await onChanged?.();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }, [busy, minutes, note, taskId, effectiveProjectId, refetchLogs, onChanged, fail]);

  // ---- derived -----------------------------------------------------------
  const loggedSeconds = sumSeconds(logs);
  const estimatedHours = Number(task?.estimated_hours);
  const hasEstimate = Number.isFinite(estimatedHours) && estimatedHours > 0;
  const pct = hasEstimate ? (loggedSeconds / (estimatedHours * 3600)) * 100 : 0;
  const overBudget = hasEstimate && pct > 100;

  const recent = logs.filter((l) => l.ended_at).slice(0, 5);

  const nameFor = (developerId) => {
    if (developerId == null) return "Someone";
    const mem = (members || []).find((m) => m && String(m.userId) === String(developerId));
    return mem?.name || "Someone";
  };

  return (
    <div className="text-sm">
      <h4 className={`${SECTION_HEADING_CLASS} mb-2 flex items-center gap-1.5`}>
        <Timer className="h-3.5 w-3.5" /> Time tracking
      </h4>

      {/* 1. PRIMARY CONTROL ---------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        {isRunningThisTask ? (
          <>
            <Badge size="md" className="tabular-nums" aria-live="polite">
              {formatDuration(elapsed)}
            </Badge>
            <Button variant="destructive" size="sm" onClick={handleStop} disabled={busy}>
              {busy ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Square aria-hidden="true" />
              )}
              Stop
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={handleStart} disabled={busy || !taskId}>
            {busy ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Play aria-hidden="true" />
            )}
            Start timer
          </Button>
        )}

        {!showAdd ? (
          <Button variant="outline" size="sm" onClick={() => setShowAdd(true)} disabled={busy}>
            <Plus aria-hidden="true" /> Add time
          </Button>
        ) : null}
      </div>

      {isRunningOtherTask ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          A timer is running on another task — starting here will stop it.
        </p>
      ) : null}

      {/* 2. TOTALS -------------------------------------------------------- */}
      <div className="mt-3">
        <p className="text-xs text-muted-foreground">
          Total logged:{" "}
          <span className="font-semibold tabular-nums text-foreground">
            {formatDuration(loggedSeconds)}
          </span>
          {hasEstimate ? (
            <>
              {" "}
              of <span className="tabular-nums">{estimatedHours}h</span> estimated
              {overBudget ? (
                <span className="ml-1 font-semibold tabular-nums text-warning">
                  ({Math.round(pct)}%)
                </span>
              ) : null}
            </>
          ) : null}
        </p>
        {hasEstimate ? (
          <div className="mt-1.5 h-1.5 w-full rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${overBudget ? "bg-warning" : "bg-primary"}`}
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            />
          </div>
        ) : null}
      </div>

      {/* 3. MANUAL ENTRY -------------------------------------------------- */}
      {showAdd ? (
        <div className="mt-2 flex items-center gap-1.5">
          <input
            type="number"
            min="1"
            step="1"
            className={`${FIELD_CLASS} w-20 shrink-0 tabular-nums`}
            placeholder="Mins"
            aria-label="Minutes to log"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddManual();
              }
            }}
          />
          <input
            type="text"
            className={`${FIELD_CLASS} min-w-0 flex-1`}
            placeholder="Note (optional)"
            aria-label="Note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddManual();
              }
            }}
          />
          <Button size="sm" onClick={handleAddManual} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Add
          </Button>
        </div>
      ) : null}

      {/* 4. RECENT ENTRIES ------------------------------------------------ */}
      <div className="mt-3">
        {loadingLogs ? (
          <div className="space-y-2" role="status" aria-label="Loading time entries">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ) : recent.length === 0 ? (
          <p className="text-xs text-muted-foreground">No time logged yet.</p>
        ) : (
          <ul className="space-y-1">
            {recent.map((log) => (
              <li
                key={String(log.id)}
                className="flex items-center justify-between gap-2 text-xs"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-foreground">{nameFor(log.developer_id)}</span>
                  {log.source === "manual" ? (
                    <Badge variant="secondary" size="sm">
                      manual
                    </Badge>
                  ) : null}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-semibold tabular-nums text-foreground">
                    {formatDuration(log.seconds)}
                  </span>
                  <span className="text-muted-foreground">{relativeDay(log.ended_at)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
