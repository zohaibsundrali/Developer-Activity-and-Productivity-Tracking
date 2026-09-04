"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Lock,
  MinusCircle,
  SkipForward,
  XCircle,
} from "lucide-react";

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
import { authFetch } from "@/utils/authFetch";
import { showError } from "@/utils/alerts";

/**
 * Tests — the staff half of the Quality module.
 *
 * WHY THIS SCREEN EXISTS. 081 shipped test cases, runs and executions, and gave
 * all four quality keys to the same five roles. Its own migration said that was
 * not the design and why the widening had to wait: `developer`, `designer` and
 * `devops` cannot enter /admin, so `test_case.view` would have been a key with
 * no screen. This is the screen. 095 is the widening.
 *
 * NOT A SECOND Quality.jsx. The admin screen writes cases, opens runs, closes
 * them and files defects; this one READS what will be checked and RECORDS what
 * happened. Every control it does not offer corresponds to a key its audience
 * does not hold — `test_case.manage`, `test_run.manage`, `bug.raise` — so there
 * is nothing here that answers 403 when pressed. That is the whole difference,
 * and it is why this is a separate component rather than a prop on that one:
 * the two screens disagree about almost every control.
 *
 * A FAILED RESULT DOES NOT OFFER "raise defect", and the screen says so in a
 * sentence instead of showing a button that would fail. Filing a defect writes
 * a task row, and creating a task is a supervisor's act everywhere else in this
 * product; `bug.raise` keeps it that way. Telling somebody who to ask is more
 * use than a disabled control with no explanation.
 *
 * NO `role` PROP, deliberately, like the other shared screens. The route
 * decides against the verified token and RLS decides again underneath; a
 * component that branched on a role here would be a fourth opinion with no
 * authority.
 */

const TABS = [
  { id: "runs", label: "Test runs" },
  { id: "cases", label: "Test cases" },
];

const RESULT_META = {
  passed: { label: "Passed", icon: CheckCircle2, variant: "success" },
  failed: { label: "Failed", icon: XCircle, variant: "destructive" },
  blocked: { label: "Blocked", icon: MinusCircle, variant: "warning" },
  skipped: { label: "Skipped", icon: SkipForward, variant: "secondary" },
  untested: { label: "Untested", icon: ClipboardList, variant: "outline" },
};

/** The results a person running a test may record. */
const RECORDABLE = ["passed", "failed", "blocked", "skipped"];

const PRIORITY_VARIANT = {
  critical: "destructive",
  high: "warning",
  medium: "secondary",
  low: "outline",
};

function when(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function TestCases() {
  const [tab, setTab] = useState("runs");
  const [runs, setRuns] = useState([]);
  const [cases, setCases] = useState([]);
  const [openRun, setOpenRun] = useState(null);
  const [executions, setExecutions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch(`/api/quality?view=${tab}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "Could not load this.");
      if (tab === "runs") setRuns(json.runs || []);
      else setCases(json.cases || []);
    } catch (e) {
      setError(e?.message || "Could not load this.");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  const openRunDetail = async (runId) => {
    setBusyId(runId);
    try {
      const res = await authFetch(`/api/quality?view=run&runId=${encodeURIComponent(runId)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "Could not open that run.");
      setOpenRun(json.run);
      setExecutions(json.executions || []);
    } catch (e) {
      showError(e?.message || "Could not open that run.");
    } finally {
      setBusyId(null);
    }
  };

  const record = async (execution, result) => {
    setBusyId(execution.id);
    try {
      const res = await authFetch("/api/quality", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ executionId: execution.id, result }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "Could not record that.");
      setExecutions((prev) =>
        prev.map((e) => (e.id === execution.id ? { ...e, ...json.execution } : e))
      );
    } catch (e) {
      showError(e?.message || "Could not record that.");
    } finally {
      setBusyId(null);
    }
  };

  const runClosed = openRun?.status === "closed";

  const progress = useMemo(() => {
    const total = executions.length;
    const done = executions.filter((e) => e.result && e.result !== "untested").length;
    return { total, done, left: total - done };
  }, [executions]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return <ErrorState title="Tests unavailable" description={error} onRetry={load} />;
  }

  // ── One run, with its executions ──────────────────────────────────────
  if (openRun) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={openRun.name || "Test run"}
          description={
            runClosed
              ? "This run is closed. Results are frozen."
              : `${progress.done} of ${progress.total} recorded — ${progress.left} left.`
          }
          actions={
            <Button
              variant="outline"
              onClick={() => {
                setOpenRun(null);
                setExecutions([]);
              }}
            >
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
              All runs
            </Button>
          }
        />

        {runClosed && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            <Lock className="h-4 w-4" aria-hidden="true" />
            {/* Disabled rather than hidden: the results are the point of the
                screen, and a closed run is still worth reading. The route
                refuses the write anyway, and so does 081's trigger. */}
            Closed runs are read-only. Ask whoever owns the run to reopen it.
          </div>
        )}

        <Section>
          {executions.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="Nothing in this run"
              description="The run has no test cases in it."
            />
          ) : (
            <ul className="space-y-3">
              {executions.map((ex) => {
                const tc = ex.test_cases || {};
                const meta = RESULT_META[ex.result] || RESULT_META.untested;
                const Icon = meta.icon;
                const busy = busyId === ex.id;
                return (
                  <li
                    key={ex.id}
                    className="rounded-xl border border-border bg-card p-4 space-y-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{tc.title || "Test case"}</p>
                        {tc.expected_result && (
                          <p className="mt-1 text-sm text-muted-foreground">
                            Expected: {tc.expected_result}
                          </p>
                        )}
                      </div>
                      <Badge variant={meta.variant}>
                        <Icon className="h-3 w-3" aria-hidden="true" />
                        {meta.label}
                      </Badge>
                    </div>

                    {tc.steps && (
                      <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-sm text-foreground">
                        {tc.steps}
                      </pre>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {RECORDABLE.map((r) => (
                        <Button
                          key={r}
                          size="sm"
                          variant={ex.result === r ? "default" : "outline"}
                          disabled={busy || runClosed}
                          onClick={() => record(ex, r)}
                        >
                          {RESULT_META[r].label}
                        </Button>
                      ))}
                    </div>

                    {/* No "Raise defect" here, and a sentence rather than a
                        dead button: filing one writes a task row, which
                        `bug.raise` keeps with the reviewers. */}
                    {ex.result === "failed" && !ex.bug_task_id && (
                      <p className="text-sm text-muted-foreground">
                        Recorded as failed. A reviewer can raise the defect from the Quality
                        screen.
                      </p>
                    )}
                    {ex.bug_task_id && (
                      <p className="text-sm text-muted-foreground">
                        A defect is already filed for this test.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>
    );
  }

  // ── The two lists ─────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        title="Tests"
        description="What gets checked, and what the last run found."
      />

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === "runs" ? (
        <Section>
          {runs.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No test runs yet"
              description="A run is opened from the Quality screen. When one exists, it appears here."
            />
          ) : (
            <ul className="space-y-3">
              {runs.map((r) => (
                <li key={r.run_id}>
                  <button
                    type="button"
                    onClick={() => openRunDetail(r.run_id)}
                    disabled={busyId === r.run_id}
                    className="w-full rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted/40 disabled:opacity-60"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{r.name || "Test run"}</p>
                        <p className="text-sm text-muted-foreground">
                          {when(r.started_at) || "Not started"}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={r.status === "closed" ? "secondary" : "success"}>
                          {r.status === "closed" ? "Closed" : "Open"}
                        </Badge>
                        <span className="text-sm tabular-nums text-muted-foreground">
                          {Number(r.passed || 0)} passed · {Number(r.failed || 0)} failed ·{" "}
                          {Number(r.untested || 0)} left
                        </span>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : (
        <Section>
          {cases.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No test cases yet"
              description="Test cases are written on the Quality screen."
            />
          ) : (
            <ul className="space-y-3">
              {cases.map((c) => (
                <li key={c.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{c.title}</p>
                      {c.expected_result && (
                        <p className="mt-1 text-sm text-muted-foreground">
                          Expected: {c.expected_result}
                        </p>
                      )}
                    </div>
                    {c.priority && (
                      <Badge variant={PRIORITY_VARIANT[c.priority] || "outline"}>
                        {c.priority}
                      </Badge>
                    )}
                  </div>
                  {c.steps && (
                    <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-sm text-foreground">
                      {c.steps}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </div>
  );
}
