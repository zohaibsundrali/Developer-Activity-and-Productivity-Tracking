"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bug,
  CheckCircle2,
  ClipboardList,
  Lock,
  MinusCircle,
  Play,
  Plus,
  SkipForward,
  Unlock,
  XCircle,
} from "lucide-react";

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
  Tabs,
} from "@/components/ui";
import StatCard from "@/components/shell/StatCard";
import { authFetch } from "@/utils/authFetch";
import { showConfirm, showError, showSuccess } from "@/utils/alerts";

/**
 * Quality — test cases, test runs, and the defects that come out of them.
 *
 * WHY A TEST CASE IS NOT A TASK, which is the question this screen keeps
 * getting asked. A task is done once. A test case is a question you ask again
 * of every build, and its history is the answer changing over time. Modelling
 * it as a task gives you one row that is simultaneously passed and failed, or
 * a new task per run and no way to see a trend.
 *
 * A DEFECT IS STILL A BUG IN THE BUG QUEUE. Migration 061 refused a second bug
 * pipeline and this screen keeps that promise: "Raise defect" writes the same
 * `developer_tasks` row with `task_type: 'bug'` that the Bug Queue writes, and
 * the execution merely points at it. Nothing here is a parallel lifecycle, and
 * the bug appears on the board like any other.
 *
 * A CLOSED RUN IS READ-ONLY, and the controls are disabled rather than hidden —
 * the results are the point of the screen. The route refuses the write anyway,
 * and so does the trigger in 081.
 */

const CONTROL =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

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

export default function Quality({ projects = [] }) {
  const [tab, setTab] = useState("runs");
  const [cases, setCases] = useState([]);
  const [runs, setRuns] = useState([]);
  const [openRun, setOpenRun] = useState(null);
  const [executions, setExecutions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [caseForm, setCaseForm] = useState(null);
  const [runForm, setRunForm] = useState(null);

  const projectName = useCallback(
    (id) => projects.find((p) => String(p.id) === String(id))?.name || "Project",
    [projects]
  );

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
    setBusy(true);
    try {
      const res = await authFetch(`/api/quality?view=run&runId=${encodeURIComponent(runId)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "Could not open that run.");
      setOpenRun(json.run);
      setExecutions(json.executions || []);
    } catch (e) {
      showError(e?.message || "Could not open that run.");
    } finally {
      setBusy(false);
    }
  };

  const record = async (execution, result) => {
    setBusy(true);
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
      setBusy(false);
    }
  };

  const raiseDefect = async (execution) => {
    const ok = await showConfirm(
      "Raise a defect for this test?",
      "It is filed as an ordinary bug on the project board, with the test's steps as the reproduction steps.",
      { confirmButtonText: "Raise defect" }
    );
    if (!ok) return;
    setBusy(true);
    try {
      const res = await authFetch("/api/quality?action=bug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ executionId: execution.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "Could not raise it.");
      showSuccess("Defect raised — it is in the bug queue.");
      setExecutions((prev) =>
        prev.map((e) => (e.id === execution.id ? { ...e, bug_task_id: json.bug?.id } : e))
      );
    } catch (e) {
      showError(e?.message || "Could not raise it.");
    } finally {
      setBusy(false);
    }
  };

  const toggleRun = async (run) => {
    const closing = run.status === "open";
    const ok = await showConfirm(
      closing ? "Close this run?" : "Reopen this run?",
      closing
        ? "Results are frozen once it is closed. Reopening is possible and is recorded."
        : "Results become editable again.",
      { confirmButtonText: closing ? "Close run" : "Reopen" }
    );
    if (!ok) return;
    setBusy(true);
    try {
      const res = await authFetch("/api/quality", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: run.id, status: closing ? "closed" : "open" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "That did not go through.");
      setOpenRun((r) => (r ? { ...r, ...json.run } : r));
      showSuccess(closing ? "Run closed." : "Run reopened.");
    } catch (e) {
      showError(e?.message || "That did not go through.");
    } finally {
      setBusy(false);
    }
  };

  const submitCase = async () => {
    if (!caseForm?.projectId || !caseForm?.title?.trim()) {
      showError("Pick a project and give the case a title.");
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch("/api/quality?action=case", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(caseForm),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "Could not save it.");
      showSuccess("Test case saved.");
      setCaseForm(null);
      await load();
    } catch (e) {
      showError(e?.message || "Could not save it.");
    } finally {
      setBusy(false);
    }
  };

  const submitRun = async () => {
    if (!runForm?.projectId || !runForm?.name?.trim()) {
      showError("Pick a project and name the run.");
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch("/api/quality?action=run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(runForm),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "Could not start it.");
      showSuccess(`Run started with ${json.cases} case${json.cases === 1 ? "" : "s"}.`);
      setRunForm(null);
      await load();
    } catch (e) {
      showError(e?.message || "Could not start it.");
    } finally {
      setBusy(false);
    }
  };

  const runStats = useMemo(() => {
    let passed = 0;
    let failed = 0;
    let left = 0;
    for (const e of executions) {
      if (e.result === "passed") passed += 1;
      else if (e.result === "failed") failed += 1;
      else if (e.result === "untested") left += 1;
    }
    return { passed, failed, left };
  }, [executions]);

  // ── A single run, opened ────────────────────────────────────────────────
  if (openRun) {
    const closed = openRun.status === "closed";
    return (
      <div className="space-y-6">
        <PageHeader
          title={openRun.name}
          description={`${projectName(openRun.project_id)} · ${closed ? "closed" : "open"}`}
          actions={
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpenRun(null)}>
                Back
              </Button>
              <Button variant={closed ? "outline" : "default"} onClick={() => toggleRun(openRun)} disabled={busy}>
                {closed ? (
                  <>
                    <Unlock className="mr-2 h-4 w-4" aria-hidden="true" />
                    Reopen
                  </>
                ) : (
                  <>
                    <Lock className="mr-2 h-4 w-4" aria-hidden="true" />
                    Close run
                  </>
                )}
              </Button>
            </div>
          }
        />

        {closed && (
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
            This run is closed. Results are frozen — reopen it to change anything.
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard title="Passed" value={runStats.passed} icon={CheckCircle2} />
          <StatCard title="Failed" value={runStats.failed} icon={XCircle} />
          <StatCard title="Still to run" value={runStats.left} icon={ClipboardList} />
        </div>

        <Section title="Cases in this run">
          <ul className="divide-y divide-border">
            {executions.map((e) => {
              const meta = RESULT_META[e.result] || RESULT_META.untested;
              return (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {e.test_cases?.title || "Test case"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {e.test_cases?.expected_result || "No expected result recorded"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                    {["passed", "failed", "blocked", "skipped"].map((r) => (
                      <Button
                        key={r}
                        size="sm"
                        variant={e.result === r ? "default" : "outline"}
                        disabled={closed || busy}
                        onClick={() => record(e, r)}
                      >
                        {RESULT_META[r].label}
                      </Button>
                    ))}
                    {/* Only a failed or blocked test may cite a defect — the
                        CHECK in 081 refuses the rest, so the button follows. */}
                    {["failed", "blocked"].includes(e.result) &&
                      (e.bug_task_id ? (
                        <Badge variant="secondary">
                          <Bug className="mr-1 h-3 w-3" aria-hidden="true" />
                          Defect raised
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={closed || busy}
                          onClick={() => raiseDefect(e)}
                        >
                          <Bug className="mr-1 h-4 w-4" aria-hidden="true" />
                          Raise defect
                        </Button>
                      ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>
      </div>
    );
  }

  // ── The two lists ───────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        title="Quality"
        description="What gets checked, when it was last checked, and what came out of it."
        actions={
          tab === "cases" ? (
            <Button onClick={() => setCaseForm({ projectId: "", title: "", priority: "medium" })}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              New test case
            </Button>
          ) : (
            <Button onClick={() => setRunForm({ projectId: "", name: "" })}>
              <Play className="mr-2 h-4 w-4" aria-hidden="true" />
              Start a run
            </Button>
          )
        }
      />

      <Tabs tabs={TABS} active={tab} onChange={setTab} aria-label="Quality views" />

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : error ? (
        <ErrorState title="Could not load" description={error} onRetry={load} />
      ) : tab === "runs" ? (
        runs.length === 0 ? (
          <EmptyState
            icon={Play}
            title="No test runs yet"
            description="A run takes every active case on a project and asks them all at once."
          />
        ) : (
          <Section>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Run</th>
                    <th className="py-2 pr-4 font-medium">Project</th>
                    <th className="py-2 pr-4 font-medium">Passed</th>
                    <th className="py-2 pr-4 font-medium">Failed</th>
                    <th className="py-2 pr-4 font-medium">Left</th>
                    <th className="py-2 pr-4 font-medium">Defects</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.run_id} className="border-b border-border/60">
                      <td className="py-2 pr-4 text-foreground">
                        {r.name}
                        {r.status === "closed" && (
                          <Badge variant="secondary" className="ml-2">closed</Badge>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">{projectName(r.project_id)}</td>
                      <td className="py-2 pr-4 tabular-nums">{r.passed}</td>
                      <td className="py-2 pr-4 tabular-nums">{r.failed}</td>
                      <td className="py-2 pr-4 tabular-nums text-muted-foreground">{r.untested}</td>
                      <td className="py-2 pr-4 tabular-nums">{r.defects}</td>
                      <td className="py-2 text-right">
                        <Button size="sm" variant="outline" onClick={() => openRunDetail(r.run_id)} disabled={busy}>
                          Open
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )
      ) : cases.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No test cases yet"
          description="A test case is a question you ask of every build. Write one and it joins every future run."
        />
      ) : (
        <Section>
          <ul className="divide-y divide-border">
            {cases.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{c.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {projectName(c.project_id)}
                    {c.expected_result ? ` · expects: ${c.expected_result}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={c.priority === "high" ? "warning" : "outline"}>{c.priority}</Badge>
                  {c.status === "draft" && <Badge variant="secondary">draft</Badge>}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Modal open={Boolean(caseForm)} onClose={() => setCaseForm(null)} title="New test case">
        {caseForm && (
          <div className="space-y-4">
            <Field label="Project">
              <select
                className={CONTROL}
                value={caseForm.projectId}
                onChange={(e) => setCaseForm((f) => ({ ...f, projectId: e.target.value }))}
              >
                <option value="">Choose…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Title">
              <Input
                value={caseForm.title}
                onChange={(e) => setCaseForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Login rejects a wrong password"
              />
            </Field>
            <Field label="Steps">
              <textarea
                className={CONTROL}
                rows={4}
                value={caseForm.steps || ""}
                onChange={(e) => setCaseForm((f) => ({ ...f, steps: e.target.value }))}
              />
            </Field>
            <Field label="Expected result">
              <textarea
                className={CONTROL}
                rows={2}
                value={caseForm.expectedResult || ""}
                onChange={(e) => setCaseForm((f) => ({ ...f, expectedResult: e.target.value }))}
              />
            </Field>
            <Field label="Priority">
              <select
                className={CONTROL}
                value={caseForm.priority}
                onChange={(e) => setCaseForm((f) => ({ ...f, priority: e.target.value }))}
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCaseForm(null)} disabled={busy}>Cancel</Button>
              <Button onClick={submitCase} disabled={busy}>Save case</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(runForm)} onClose={() => setRunForm(null)} title="Start a test run">
        {runForm && (
          <div className="space-y-4">
            <Field label="Project">
              <select
                className={CONTROL}
                value={runForm.projectId}
                onChange={(e) => setRunForm((f) => ({ ...f, projectId: e.target.value }))}
              >
                <option value="">Choose…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Name" hint="Something you will recognise later — a build, a date, a release.">
              <Input
                value={runForm.name}
                onChange={(e) => setRunForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Regression — build 42"
              />
            </Field>
            <p className="text-sm text-muted-foreground">
              Every active case on the project joins the run. Draft and archived cases do not.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRunForm(null)} disabled={busy}>Cancel</Button>
              <Button onClick={submitRun} disabled={busy}>Start run</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
