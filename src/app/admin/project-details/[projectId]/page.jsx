"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/utils/supabaseClient";
import { showError, showWarning } from "@/utils/alerts";
import { isSessionExpired, clearAdminSession } from "@/utils/sessionPolicy";
import { authFetch } from "@/utils/authFetch";

const statusPill = (status) => {
  const s = String(status || "").toLowerCase();
  if (["completed", "done", "approved", "active", "reviewed"].includes(s)) return "bg-success/10 text-success";
  if (["in_progress", "in progress", "awaiting_approval", "pending_review"].includes(s)) return "bg-info/10 text-info";
  if (["pending", "assigned", "draft", "on_hold"].includes(s)) return "bg-warning/10 text-warning";
  if (["rejected", "cancelled", "overdue"].includes(s)) return "bg-destructive/10 text-destructive";
  return "bg-muted text-muted-foreground";
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

  const formatDate = (dateString) => {
    if (!dateString) return "Not set";
    return new Date(dateString).toLocaleDateString("en-US", {
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

  if (loading) {
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <div className="text-xl text-muted-foreground mt-4">Loading project details...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center">
        <div className="text-center bg-card p-8 rounded-xl border border-border shadow-card">
          <div className="text-destructive text-xl mb-4">Error Loading Project</div>
          <p className="text-muted-foreground mb-6">{error}</p>
          <button
            onClick={() => router.push("/admin/dashboard?section=all-projects")}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Back to Projects
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted py-8">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Project Details</h1>
            <p className="text-muted-foreground mt-1">{project?.name}</p>
          </div>
          <button
            onClick={() => router.push("/admin/dashboard?section=all-projects")}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
          >
            Back to Projects
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="bg-card rounded-xl border border-border shadow-card p-5">
              <h2 className="text-lg font-semibold text-foreground mb-3">Project Info</h2>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p><span className="font-medium text-foreground">Assigned to:</span> {project?.assigned_developer_name || "Not assigned"}</p>
                <p><span className="font-medium text-foreground">Email:</span> {project?.assigned_developer_email || "N/A"}</p>
                <p><span className="font-medium text-foreground">Deadline:</span> {formatDate(project?.deadline)}</p>
                <p><span className="font-medium text-foreground">Created:</span> {formatDate(project?.created_at)}</p>
                <p className="flex items-center gap-2"><span className="font-medium text-foreground">Plan status:</span> <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${statusPill(taskPlanStatus)}`}>{taskPlanStatus}</span></p>
                <p><span className="font-medium text-foreground">Submitted:</span> {taskPlanSubmitted ? "Yes" : "No"}</p>
                <p><span className="font-medium text-foreground">Submitted at:</span> {formatDate(project?.task_plan_submitted_at)}</p>
                <p><span className="font-medium text-foreground">Reviewed:</span> {formatDate(project?.task_plan_reviewed_at)}</p>
              </div>
              {project?.task_plan_rejection_reason && (
                <div className="mt-3 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
                  <span className="font-medium">Rejection reason:</span> {project.task_plan_rejection_reason}
                </div>
              )}
            </div>

            <div className="bg-card rounded-xl border border-border shadow-card p-5 mt-6">
              <h2 className="text-lg font-semibold text-foreground mb-3">Task Plan Review</h2>
              <div className="space-y-3">
                <button
                  onClick={handleApprovePlan}
                  disabled={processing || isPlanApproved || !canReviewPlan}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-success py-2 text-sm font-semibold text-success-foreground transition-colors hover:bg-success/90 disabled:opacity-50"
                >
                  {isPlanApproved ? "Task Plan Approved" : "Approve Task Plan"}
                </button>
                {!canReviewPlan && !isPlanApproved && (
                  <div className="text-xs text-muted-foreground bg-muted border border-border rounded-lg p-3">
                    Approve/Reject will be enabled after the developer clicks “Save Task Plan”.
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Rejection Reason</label>
                  <textarea
                    rows="3"
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    className="w-full border border-input bg-background rounded-lg px-3 py-2 focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none"
                    placeholder="Explain why the plan is rejected"
                    disabled={isPlanApproved || !canReviewPlan}
                  />
                </div>
                <button
                  onClick={handleRejectPlan}
                  disabled={processing || isPlanApproved || !canReviewPlan}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-destructive py-2 text-sm font-semibold text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
                >
                  Reject Task Plan
                </button>
              </div>
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="bg-card rounded-xl border border-border shadow-card p-5">
              <h2 className="text-lg font-semibold text-foreground mb-4">Tasks</h2>
              {tasks.length === 0 ? (
                <p className="text-muted-foreground">No tasks submitted for this project.</p>
              ) : (
                <div className="space-y-3">
                  {tasks.map((task, index) => (
                    <div key={task.id} className="border border-border rounded-lg p-4 bg-muted/50">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold text-foreground">{index + 1}. {formatTaskTitle(task.task_title)}</p>
                          <p className="text-sm text-muted-foreground mt-1">{task.task_description || "No description"}</p>
                          <p className="text-xs text-muted-foreground mt-2">
                            {formatDate(task.start_date)} - {formatDate(task.end_date)}
                          </p>
                        </div>
                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${statusPill(task.status || "pending")}`}>
                          {task.status || "pending"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
