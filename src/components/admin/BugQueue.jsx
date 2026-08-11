"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Bug, Plus, ArrowRight, Monitor, ListOrdered } from "lucide-react";
import { supabase } from "@/utils/supabaseClient";
import { getOrgId, getOrgContext } from "@/utils/orgContext";
import { createTask, changeTaskStatus, allowedTransitions } from "@/utils/pmData";
import { BUG_STAGES, bugStage, SEVERITIES, severityMeta, sortBugs, bugCounts } from "@/utils/bugs";
import { showError, showSuccess } from "@/utils/alerts";
import { sectionTitle } from "@/components/shell/navConfig";
import {
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Badge,
  Button,
  Field,
  Input,
  EmptyState,
  ErrorState,
  SkeletonList,
} from "@/components/ui";

/**
 * The bug queue.
 *
 * Thin on purpose. A bug is a `developer_tasks` row with `task_type = 'bug'`,
 * and the lifecycle it walks is the ordinary status pipeline — so this screen
 * reuses createTask and changeTaskStatus rather than writing rows itself, and
 * inherits the transition rules, the activity log and the automations with
 * them.
 *
 * CLOSING IS NOT HERE. `completed` is reachable only through the review route,
 * which is what carries is_on_time, the productivity points, the admin_reviews
 * row and the developer's notification. A "Close" button here would produce a
 * closed bug with none of that, and the number in Reports would quietly stop
 * matching the number on this screen. The screen says so rather than leaving
 * somebody hunting for the button.
 */

const CONTROL =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

const TONE_VARIANT = {
  destructive: "destructive",
  warning: "warning",
  info: "info",
  success: "success",
  muted: "secondary",
};

// The next move, in the words of the lifecycle rather than the pipeline.
const NEXT_MOVE = {
  pending: { status: "in_progress", label: "Start fixing" },
  in_progress: { status: "awaiting_approval", label: "Mark fixed" },
  awaiting_approval: { status: "reviewed", label: "Start retest" },
  rejected: { status: "in_progress", label: "Back to fixing" },
};

const EMPTY = {
  projectId: "",
  title: "",
  description: "",
  severity: "major",
  steps: "",
  environment: "",
};

export default function BugQueue() {
  const [bugs, setBugs] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("open");
  const [reporting, setReporting] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const me = getOrgContext();
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const orgId = getOrgId();
      const [{ data: rows, error: bugErr }, { data: projectRows }] = await Promise.all([
        supabase
          .from("developer_tasks")
          .select(
            "id, task_title, task_description, status, severity, steps_to_reproduce, environment, project_id, developer_id, created_at"
          )
          .eq("organization_id", orgId)
          .eq("task_type", "bug")
          .limit(1000),
        supabase.from("projects").select("id, name").eq("organization_id", orgId).limit(500),
      ]);
      if (bugErr) throw bugErr;
      setBugs(rows || []);
      setProjects(projectRows || []);
    } catch (e) {
      setError(e?.message || "Could not load bugs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => bugCounts(bugs), [bugs]);

  const shown = useMemo(() => {
    // "Open" here means everything still in play, which includes Reopened —
    // a bug that failed its retest is emphatically not closed.
    const list =
      stage === "open"
        ? bugs.filter((b) => b.status !== "completed")
        : stage === "all"
          ? bugs
          : bugs.filter((b) => bugStage(b.status).id === stage);
    return sortBugs(list);
  }, [bugs, stage]);

  const projectName = (id) => projects.find((p) => p.id === id)?.name || "—";

  const report = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!form.projectId || !form.title.trim()) {
      showError("Almost there", "Pick a project and give the bug a title.");
      return;
    }
    setBusy(true);
    try {
      const { error: err } = await createTask(form.projectId, {
        task_title: form.title.trim(),
        task_description: form.description.trim() || null,
        task_type: "bug",
        // Severity carries the urgency; `priority` is left at its default so a
        // bug does not claim two different levels of importance in two
        // columns that can disagree.
        severity: form.severity,
        steps_to_reproduce: form.steps.trim() || null,
        environment: form.environment.trim() || null,
        reported_by: me?.userId || null,
      });
      if (err) throw err;
      setForm(EMPTY);
      setReporting(false);
      showSuccess("Bug reported", "It is in the queue, worst first.");
      await load();
    } catch (err) {
      showError("Not reported", err?.message || "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const move = async (bug) => {
    const next = NEXT_MOVE[bug.status];
    if (!next || busy) return;
    // Ask the shared rule rather than trusting the table above it: if the
    // pipeline ever changes, this refuses instead of writing something the
    // transition guard would reject anyway.
    if (!allowedTransitions(bug.status).includes(next.status)) {
      showError("Not allowed", `A bug cannot go from "${bug.status}" to "${next.status}".`);
      return;
    }
    setBusy(true);
    try {
      const { error: err } = await changeTaskStatus(bug.id, next.status);
      if (err) throw err;
      await load();
    } catch (e) {
      showError("Not moved", e?.message || "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={sectionTitle("bugs")}
        description="Reported defects, worst first. Closing happens in Task Reviews, where the retest is recorded."
        actions={
          <Button variant="outline" onClick={() => setReporting((v) => !v)}>
            {reporting ? "Cancel" : <><Plus aria-hidden="true" className="h-4 w-4" /><span className="ml-1.5">Report a bug</span></>}
          </Button>
        }
      />

      {reporting ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Report a bug</CardTitle>
            <CardDescription>
              Steps to reproduce are the part that saves a day later — write them even if they feel
              obvious now.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={report} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Project" htmlFor="bug-project" required>
                  <select
                    id="bug-project"
                    className={`${CONTROL} w-full`}
                    value={form.projectId}
                    onChange={(e) => setField("projectId", e.target.value)}
                    required
                  >
                    <option value="">Choose a project…</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Severity" htmlFor="bug-severity">
                  <select
                    id="bug-severity"
                    className={`${CONTROL} w-full`}
                    value={form.severity}
                    onChange={(e) => setField("severity", e.target.value)}
                  >
                    {SEVERITIES.map((s) => (
                      <option key={s.id} value={s.id}>{s.label} — {s.hint}</option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="What is wrong?" htmlFor="bug-title" required>
                <Input
                  id="bug-title"
                  value={form.title}
                  onChange={(e) => setField("title", e.target.value)}
                  maxLength={200}
                  placeholder="Saving a task clears the description"
                  required
                />
              </Field>

              <Field label="Steps to reproduce" htmlFor="bug-steps">
                <textarea
                  id="bug-steps"
                  rows={4}
                  className={`${CONTROL} w-full resize-y`}
                  value={form.steps}
                  onChange={(e) => setField("steps", e.target.value)}
                  placeholder={"1. Open a task\n2. Edit the title\n3. Save\n4. The description is empty"}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Where"
                  htmlFor="bug-env"
                  hint="Browser, device, build — bugs that only happen in one of those cost a day to find."
                >
                  <Input
                    id="bug-env"
                    value={form.environment}
                    onChange={(e) => setField("environment", e.target.value)}
                    placeholder="Chrome 141, Windows 11"
                  />
                </Field>
                <Field label="Anything else" htmlFor="bug-desc">
                  <Input
                    id="bug-desc"
                    value={form.description}
                    onChange={(e) => setField("description", e.target.value)}
                    maxLength={2000}
                  />
                </Field>
              </div>

              <Button type="submit" disabled={busy}>
                {busy ? "Reporting…" : "Report it"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {/* Counts keep every stage even at zero, so the row does not change
          shape as bugs move and become harder to read at a glance. */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setStage("open")}
          aria-pressed={stage === "open"}
          className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
            stage === "open"
              ? "border-primary bg-primary/10 text-foreground"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          Still open ({bugs.filter((b) => b.status !== "completed").length})
        </button>
        {BUG_STAGES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setStage(s.id)}
            aria-pressed={stage === s.id}
            className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
              stage === s.id
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {s.label} ({counts[s.id] ?? 0})
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonList rows={4} />
      ) : error ? (
        <ErrorState title="Couldn't load bugs" description={error} onRetry={load} />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={Bug}
          title={stage === "open" ? "No open bugs" : "Nothing at this stage"}
          description="Reported defects appear here, worst first, with the oldest breaking a tie."
        />
      ) : (
        <ul className="space-y-3">
          {shown.map((bug) => {
            const st = bugStage(bug.status);
            const sev = severityMeta(bug.severity);
            const next = NEXT_MOVE[bug.status];
            return (
              <li key={bug.id}>
                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <CardTitle className="text-base">{bug.task_title}</CardTitle>
                        <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span>{projectName(bug.project_id)}</span>
                          {bug.environment ? (
                            <span className="inline-flex items-center gap-1">
                              <Monitor aria-hidden="true" className="h-3.5 w-3.5" />
                              {bug.environment}
                            </span>
                          ) : null}
                        </CardDescription>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant={TONE_VARIANT[sev.tone] || "secondary"}>{sev.label}</Badge>
                        <Badge variant={TONE_VARIANT[st.tone] || "secondary"}>{st.label}</Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {bug.steps_to_reproduce ? (
                      <div>
                        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          <ListOrdered aria-hidden="true" className="h-3.5 w-3.5" />
                          Steps to reproduce
                        </p>
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
                          {bug.steps_to_reproduce}
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No steps to reproduce were given.
                      </p>
                    )}

                    {bug.task_description ? (
                      <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                        {bug.task_description}
                      </p>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {next ? (
                        <Button onClick={() => move(bug)} disabled={busy}>
                          <ArrowRight aria-hidden="true" className="h-4 w-4" />
                          <span className="ml-1.5">{next.label}</span>
                        </Button>
                      ) : null}
                      {bug.status === "reviewed" ? (
                        <p className="text-sm text-muted-foreground">
                          Retesting. Pass or fail it in <strong>Task Reviews</strong> — that is where
                          the result is recorded.
                        </p>
                      ) : null}
                      {bug.status === "completed" ? (
                        <p className="text-sm text-muted-foreground">Verified fixed and closed.</p>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
