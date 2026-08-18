"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Play, RefreshCw, Square } from "lucide-react";

import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
} from "@/components/ui";
import { getOrgContext, getOrgId } from "@/utils/orgContext";
import { getActiveTimer, startTaskTimer, stopTaskTimer } from "@/utils/pmData";
import { showError, showSuccess } from "@/utils/alerts";
import { WORK_BUCKETS, bucketMyWork, daysUntil, deadlineOf, loadMyWork } from "@/utils/myWork";

/**
 * My Work — everything assigned to the signed-in person, across every project.
 *
 * THE SCREEN THAT WAS MISSING. A developer could see how many tasks they had
 * and which projects they were on, and nowhere at all what those tasks WERE.
 * Finding out meant opening each project in turn.
 *
 * ORDER IS THE INFORMATION, and it is not sorted by date. "Sent back to you"
 * comes first even when nothing in it is late, because a rejected task is the
 * one most easily missed: it carries no deadline pressure, it looks ordinary in
 * a list, and it is entirely blocked on the person reading this. Overdue comes
 * next. "With a reviewer" comes last, and is deliberately outside the headline
 * count — it is finished work waiting on somebody else, and counting it as
 * outstanding would make the number say the opposite of what it means.
 *
 * NO EMPTY BUCKETS. A section reading "Overdue — 0" trains people to skim past
 * headings. Buckets appear only when they have something in them, and when all
 * of them are empty the screen says so in one line.
 */

function toneClasses(tone) {
  switch (tone) {
    case "destructive":
      return { dot: "bg-destructive", text: "text-destructive", ring: "ring-destructive/30" };
    case "warning":
      return { dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400", ring: "ring-amber-500/30" };
    case "info":
      return { dot: "bg-sky-500", text: "text-sky-600 dark:text-sky-400", ring: "ring-sky-500/30" };
    default:
      return { dot: "bg-muted-foreground/40", text: "text-muted-foreground", ring: "ring-border" };
  }
}

/** "3 days late", "due today", "in 4 days", or nothing when there is no date. */
function Deadline({ task }) {
  const left = daysUntil(task);
  if (left == null) {
    return <span className="text-xs text-muted-foreground">No date set</span>;
  }
  if (left < 0) {
    return (
      <span className="text-xs font-medium text-destructive">
        {Math.abs(left)}d late
      </span>
    );
  }
  if (left === 0) return <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Due today</span>;
  return <span className="text-xs text-muted-foreground">in {left}d</span>;
}

const PRIORITY_TONE = {
  urgent: "destructive",
  high: "destructive",
  medium: "secondary",
  low: "outline",
};

function TaskRow({ task, onOpen, activeTimer, onStart, onStop, busy }) {
  const project = task.project?.name || "No project";
  const isRunning = String(activeTimer?.task_id || "") === String(task.id);

  // A DIV, NOT A BUTTON, and the title is the button instead. The row used to
  // be one big <button> — which is fine until it has to contain the timer
  // control, because a button inside a button is invalid HTML and browsers
  // resolve it by dropping one of them. Which one they drop is not something
  // to find out in production.
  return (
    <li className="flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:bg-muted/50">
      <button
        type="button"
        onClick={() => onOpen?.(task)}
        className="min-w-0 flex-1 text-left"
      >
        <span className="block truncate text-sm font-medium text-foreground">
          {task.task_title || "Untitled task"}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="truncate">{project}</span>
          {task.task_type === "bug" && (
            <Badge variant="destructive" className="h-4 px-1 text-[10px]">
              Bug
            </Badge>
          )}
          {task.priority && task.priority !== "medium" && (
            <Badge variant={PRIORITY_TONE[task.priority] || "secondary"} className="h-4 px-1 text-[10px] capitalize">
              {task.priority}
            </Badge>
          )}
        </span>
        {/* The reviewer's words, on the row, not one click away. A rejection
            with the reason hidden is a task somebody has to go hunting to
            understand — which is how sent-back work sits untouched. */}
        {task.status === "rejected" && (task.rejection_reason || task.admin_comments) && (
          <span className="mt-1 block rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">
            {task.rejection_reason || task.admin_comments}
          </span>
        )}
      </button>

      <span className="flex shrink-0 items-center gap-2 pt-0.5">
        <Deadline task={task} />
        {/* Logging time belongs where the tasks are. Everything behind this
            button already existed — task_time_logs, start/stop, a database
            guard against two running timers — and its only UI was inside an
            ADMIN drawer, so the people doing the work could not reach it. */}
        <Button
          size="sm"
          variant={isRunning ? "destructive" : "outline"}
          disabled={busy}
          onClick={() => (isRunning ? onStop?.() : onStart?.(task))}
          title={isRunning ? "Stop the timer" : "Start timing this task"}
          aria-label={isRunning ? `Stop timing ${task.task_title}` : `Start timing ${task.task_title}`}
        >
          {isRunning ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
        </Button>
      </span>
    </li>
  );
}

function Bucket({ bucket, tasks, onOpen, timer }) {
  const tone = toneClasses(bucket.tone);
  return (
    <section aria-labelledby={`bucket-${bucket.id}`} className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h3
          id={`bucket-${bucket.id}`}
          className="flex items-center gap-2 text-sm font-semibold text-foreground"
        >
          <span className={`inline-block h-2 w-2 rounded-full ${tone.dot}`} aria-hidden="true" />
          {bucket.label}
          <span className={`text-xs font-normal ${tone.text}`}>{tasks.length}</span>
        </h3>
        <p className="text-xs text-muted-foreground">{bucket.blurb}</p>
      </div>
      <ul className="space-y-1.5">
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} onOpen={onOpen} {...timer} />
        ))}
      </ul>
    </section>
  );
}

function WorkSkeleton() {
  return (
    <div className="space-y-6">
      {[0, 1].map((i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ))}
    </div>
  );
}

export default function MyWork({ onViewProjectDetails }) {
  const [tasks, setTasks] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTimer, setActiveTimer] = useState(null);
  const [timerBusy, setTimerBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const ctx = getOrgContext();
      const rows = await loadMyWork(getOrgId(), ctx?.userId || ctx?.appUserId);
      setTasks(rows);
    } catch (e) {
      setError(e?.message || "Could not load your work.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const view = useMemo(() => (tasks ? bucketMyWork(tasks) : null), [tasks]);

  const open = useCallback(
    (task) => {
      if (task?.project_id) onViewProjectDetails?.(task.project_id);
    },
    [onViewProjectDetails]
  );

  // ── The timer ────────────────────────────────────────────────────────────
  // startTaskTimer stops any other running timer first, and a partial unique
  // index (migration 024) refuses a second one if two tabs race past that
  // read. So the worst case here is a stale button, not a double count —
  // which is why this reloads the active timer after every action rather than
  // trusting local state.
  const refreshTimer = useCallback(async () => {
    try {
      setActiveTimer(await getActiveTimer());
    } catch {
      setActiveTimer(null);
    }
  }, []);

  useEffect(() => {
    refreshTimer();
  }, [refreshTimer]);

  const start = useCallback(
    async (task) => {
      setTimerBusy(true);
      try {
        await startTaskTimer(task.id, task.project_id || null);
        await refreshTimer();
        showSuccess(`Timing "${task.task_title}"`);
      } catch (e) {
        showError(e?.message || "Could not start the timer.");
      } finally {
        setTimerBusy(false);
      }
    },
    [refreshTimer]
  );

  const stop = useCallback(async () => {
    if (!activeTimer) return;
    setTimerBusy(true);
    try {
      await stopTaskTimer(activeTimer);
      await refreshTimer();
      showSuccess("Timer stopped");
    } catch (e) {
      showError(e?.message || "Could not stop the timer.");
    } finally {
      setTimerBusy(false);
    }
  }, [activeTimer, refreshTimer]);

  const timer = { activeTimer, onStart: start, onStop: stop, busy: timerBusy };

  if (loading && !tasks) {
    return (
      <div className="space-y-6">
        <PageHeader title="My Work" />
        <WorkSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="My Work" />
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }

  const filled = WORK_BUCKETS.filter((b) => view.buckets[b.id].length > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Work"
        description={
          view.total === 0
            ? "Nothing outstanding."
            : `${view.total} thing${view.total === 1 ? "" : "s"} on your plate, across every project.`
        }
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        }
      />

      {filled.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Nothing assigned to you"
          description="When somebody assigns you a task it will appear here, grouped by what needs doing first."
        />
      ) : (
        <div className="space-y-7">
          {filled.map((b) => (
            <Bucket key={b.id} bucket={b} tasks={view.buckets[b.id]} onOpen={open} timer={timer} />
          ))}
        </div>
      )}
    </div>
  );
}
