"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/utils/supabaseClient";
import { showError, showWarning } from "@/utils/alerts";
import { isSessionExpired, clearAdminSession } from "@/utils/sessionPolicy";
import { authFetch } from "@/utils/authFetch";
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  Section,
  Skeleton,
  SkeletonCard,
  StatusPill,
} from "@/components/ui";
import { ArrowLeft, Check, ClipboardList, X } from "lucide-react";
import ProjectTeam from "@/components/admin/ProjectTeam";

// The plan/task status vocabulary here is wider than the board's. It maps onto
// the seven StatusPill shapes, so the state carries a glyph as well as a colour
// and survives greyscale — a plain Badge was colour-only.
const statusPillKey = (status) => {
  const s = String(status || "").toLowerCase();
  if (["completed", "done", "approved", "reviewed"].includes(s)) return "success";
  if (["active", "in_progress", "in progress"].includes(s)) return "active";
  if (["awaiting_approval", "pending_review", "pending", "assigned", "on_hold"].includes(s)) return "pending";
  if (["draft"].includes(s)) return "inactive";
  if (["rejected", "cancelled", "overdue"].includes(s)) return "error";
  return "unknown";
};

// "In Progress", never "in_progress".
const statusLabel = (status) =>
  String(status || "unknown")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

// `progress` is a nullable integer column; folded to a real 0–100 number before
// it reaches a bar width or a label.
const clampPercent = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
};

const checkAdminAuth = () => {
  if (typeof window === "undefined") return false;

  const adminUser = sessionStorage.getItem("adminUser");
  if (!adminUser) return false;

  try {
    const userData = JSON.parse(adminUser);

    if (userData.role !== "admin") {
      clearAdminSession();
      return false;
    }

    if (isSessionExpired(userData)) {
      clearAdminSession();
      return false;
    }

    return userData;
  } catch {
    return false;
  }
};

export default function AdminProjectDetailsPage() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.projectId;

  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState(null);
  const [currentAdmin, setCurrentAdmin] = useState(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const fetchProjectDetails = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      setError(null);

      const { data: projectData, error: projectError } = await supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .single();

      if (projectError) throw projectError;

      const { data: tasksData, error: tasksError } = await supabase
        .from("developer_tasks")
        .select("*")
        .eq("project_id", projectId)
        .order("task_order", { ascending: true });

      if (tasksError) throw tasksError;

      setProject(projectData);
      setTasks(tasksData || []);
    } catch (err) {
      setError(err.message || "Failed to load project details.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const adminData = checkAdminAuth();
    if (!adminData) {
      router.push("/login?redirect=/admin/project-details/" + projectId);
      return;
    }

    setCurrentAdmin(adminData);
    fetchProjectDetails();

    // Realtime: auto-refresh when developer submits task plan (projects row updates)
    const channel = supabase
      .channel(`admin-project-details-${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "projects",
          filter: `id=eq.${projectId}`,
        },
        () => {
          // Fetch latest project + tasks so button states update immediately
          fetchProjectDetails({ silent: true });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, router, fetchProjectDetails]);

  const handleApprovePlan = async () => {
    if (!currentAdmin) return;

    const currentStatus = project?.task_plan_status || "draft";
    const isSubmitted = Boolean(project?.task_plan_submitted ?? project?.task_plan_submitted_at);

    if (!isSubmitted || currentStatus !== "pending") {
      showWarning(
        "Task plan not submitted",
        "Approve/Reject is disabled until the developer saves the task plan."
      );
      return;
    }

    try {
      setProcessing(true);

      const res = await authFetch("/api/task-plan/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          adminId: currentAdmin.id,
          adminEmail: currentAdmin.email,
          action: "approve",
        }),
      });

      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result.success) {
        throw new Error(result.error || "Failed to approve task plan");
      }
      await fetchProjectDetails();
    } catch (err) {
      showError("Approval failed", `Failed to approve task plan: ${err.message}`);
    } finally {
      setProcessing(false);
    }
  };

  const handleRejectPlan = async () => {
    if (!currentAdmin) return;

    const currentStatus = project?.task_plan_status || "draft";
    const isSubmitted = Boolean(project?.task_plan_submitted ?? project?.task_plan_submitted_at);

    if (!isSubmitted || currentStatus !== "pending") {
      showWarning(
        "Task plan not submitted",
        "Approve/Reject is disabled until the developer saves the task plan."
      );
      return;
    }
    if (!rejectionReason.trim()) {
      showWarning("Missing reason", "Please provide a rejection reason.");
      return;
    }

    try {
      setProcessing(true);

      const res = await authFetch("/api/task-plan/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          adminId: currentAdmin.id,
          adminEmail: currentAdmin.email,
          action: "reject",
          rejectionReason: rejectionReason.trim(),
        }),
      });

      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result.success) {
        throw new Error(result.error || "Failed to reject task plan");
      }
      await fetchProjectDetails();
    } catch (err) {
      showError("Rejection failed", `Failed to reject task plan: ${err.message}`);
    } finally {
      setProcessing(false);
    }
  };

  // Guarded: an unparseable timestamp used to render as "Invalid Date".
  const formatDate = (dateString) => {
    if (!dateString) return "Not set";
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return "Not set";
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  };

  const formatTaskTitle = (title) => {
    if (!title) return "";
    return title
      .replace(/_/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim();
  };

  const taskPlanStatus = project?.task_plan_status || "draft";
  const taskPlanSubmitted = Boolean(project?.task_plan_submitted ?? project?.task_plan_submitted_at);
  const canReviewPlan = taskPlanSubmitted && taskPlanStatus === "pending";
  const isPlanApproved = taskPlanStatus === "approved";

  const backToProjects = () => router.push("/admin/dashboard?section=all-projects");

  const pageFrame = (children) => (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">{children}</div>
    </div>
  );

  if (loading) {
    return pageFrame(
      <>
        <PageHeader
          title="Project details"
          breadcrumbs={[
            { label: "Projects", href: "/admin/dashboard?section=all-projects" },
            { label: "Details" },
          ]}
        />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-1">
            <SkeletonCard lines={7} />
            <SkeletonCard lines={4} />
          </div>
          <div className="lg:col-span-2">
            <div className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-card">
              <Skeleton className="h-4 w-24" />
              {[0, 1, 2].map((i) => (
                <div key={i} className="space-y-2 rounded-lg border border-border p-4">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </>
    );
  }

  if (error) {
    return pageFrame(
      <>
        <PageHeader
          title="Project details"
          breadcrumbs={[
            { label: "Projects", href: "/admin/dashboard?section=all-projects" },
            { label: "Details" },
          ]}
        />
        <ErrorState
          title="Couldn't load this project"
          description={error}
          onRetry={() => fetchProjectDetails()}
        />
        <div className="mt-4 flex justify-center">
          <Button variant="outline" size="lg" onClick={backToProjects}>
            <ArrowLeft aria-hidden="true" />
            Back to projects
          </Button>
        </div>
      </>
    );
  }

  return pageFrame(
    <>
      <PageHeader
        // The project name is the subject of this page, so it is the heading —
        // it used to be demoted to the description under a generic title.
        title={project?.name || "Untitled project"}
        description="Task plan, progress and review for this project."
        breadcrumbs={[
          { label: "Projects", href: "/admin/dashboard?section=all-projects" },
          { label: project?.name || "Details" },
        ]}
        actions={
          <Button variant="outline" size="lg" onClick={backToProjects}>
            <ArrowLeft aria-hidden="true" />
            Back to projects
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-1">
          <Section title="Project info" className="rounded-xl border border-border bg-card p-5 shadow-card">
            {/* The plan's state, said once, at the top — not spread across a
                badge, a Yes/No and two timestamps of equal weight. */}
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <StatusPill
                status={statusPillKey(taskPlanStatus)}
                label={statusLabel(taskPlanStatus)}
              />
              <span className="text-sm text-muted-foreground">
                {taskPlanSubmitted ? "Submitted by the developer" : "Not submitted yet"}
              </span>
            </div>

            {/* One progress indicator — a labelled bar. */}
            <div className="mb-5">
              <div className="mb-1.5 flex items-baseline justify-between text-sm">
                <span className="text-muted-foreground">Progress</span>
                <span className="font-semibold tabular-nums text-foreground">
                  {clampPercent(project?.progress)}%
                </span>
              </div>
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={clampPercent(project?.progress)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Project progress"
              >
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${clampPercent(project?.progress)}%` }}
                />
              </div>
            </div>

            <dl className="grid grid-cols-1 gap-x-4 gap-y-3 border-t border-border pt-4 text-sm sm:grid-cols-2 lg:grid-cols-1">
              <div className="min-w-0">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Assigned to
                </dt>
                <dd className="mt-0.5 truncate text-foreground">
                  {project?.assigned_developer_name || "Not assigned"}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Email
                </dt>
                <dd className="mt-0.5 truncate text-foreground">
                  {project?.assigned_developer_email || "Not set"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Deadline
                </dt>
                <dd className="mt-0.5 tabular-nums text-foreground">{formatDate(project?.deadline)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Created
                </dt>
                <dd className="mt-0.5 tabular-nums text-foreground">{formatDate(project?.created_at)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Plan submitted
                </dt>
                <dd className="mt-0.5 tabular-nums text-foreground">
                  {formatDate(project?.task_plan_submitted_at)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Plan reviewed
                </dt>
                <dd className="mt-0.5 tabular-nums text-foreground">
                  {formatDate(project?.task_plan_reviewed_at)}
                </dd>
              </div>
            </dl>

            {project?.task_plan_rejection_reason && (
              <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <p className="font-medium">Rejection reason</p>
                <p className="mt-1 whitespace-pre-wrap">{project.task_plan_rejection_reason}</p>
              </div>
            )}
          </Section>

          {/* Who is on this project, as opposed to who is in the organization.
              Until migration 071 the database could not tell them apart:
              assigned_to holds one developer and manager_id one manager. */}
          <ProjectTeam projectId={projectId} />

          <Section
            title="Task plan review"
            className="rounded-xl border border-border bg-card p-5 shadow-card"
          >
            <div className="space-y-3">
              <Button
                size="lg"
                className="w-full"
                onClick={handleApprovePlan}
                disabled={processing || isPlanApproved || !canReviewPlan}
              >
                <Check aria-hidden="true" />
                {isPlanApproved ? "Task plan approved" : "Approve task plan"}
              </Button>

              {!canReviewPlan && !isPlanApproved && (
                <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                  Approve/Reject will be enabled after the developer clicks “Save Task Plan”.
                </p>
              )}

              <Field label="Rejection reason" htmlFor="plan-rejection-reason">
                <textarea
                  id="plan-rejection-reason"
                  rows={3}
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground transition-colors duration-150 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
                  placeholder="Explain why the plan is rejected"
                  disabled={isPlanApproved || !canReviewPlan}
                />
              </Field>

              <Button
                variant="destructive"
                size="lg"
                className="w-full"
                onClick={handleRejectPlan}
                disabled={processing || isPlanApproved || !canReviewPlan}
              >
                <X aria-hidden="true" />
                Reject task plan
              </Button>
            </div>
          </Section>
        </div>

        <div className="lg:col-span-2">
          <Section
            title="Tasks"
            description={`${tasks.length} task${tasks.length === 1 ? "" : "s"} in this plan`}
            className="rounded-xl border border-border bg-card p-5 shadow-card"
          >
            {tasks.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title="No tasks submitted"
                description="The developer has not added any tasks to this project's plan yet."
              />
            ) : (
              <ol className="space-y-3">
                {tasks.map((task, index) => {
                  const status = task.status || "pending";
                  const hasDates = Boolean(task.start_date || task.end_date);
                  return (
                    <li
                      key={task.id}
                      className="rounded-lg border border-border bg-muted/30 p-4"
                    >
                      {/* Same three lines, in the same order, on every task. */}
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            <span className="tabular-nums text-muted-foreground">{index + 1}.</span>{" "}
                            {formatTaskTitle(task.task_title) || "Untitled task"}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {task.task_description || "No description"}
                          </p>
                          <p className="mt-2 text-sm tabular-nums text-muted-foreground">
                            {hasDates
                              ? `${formatDate(task.start_date)} – ${formatDate(task.end_date)}`
                              : "No dates set"}
                          </p>
                        </div>
                        <StatusPill
                          status={statusPillKey(status)}
                          label={statusLabel(status)}
                          size="sm"
                          className="shrink-0 self-start"
                        />
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}
