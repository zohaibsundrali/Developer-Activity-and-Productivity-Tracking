"use client";
import { useState, useEffect, useCallback } from "react";
import { showError, showSuccess, showWarning } from "@/utils/alerts";
import { getSignedSubmissionUrl } from "@/utils/submissionFiles";
import { authFetch } from "@/utils/authFetch";
import { supabase } from "@/utils/supabaseClient";
import { getOrgId } from "@/utils/orgContext";
import { Badge, Button, EmptyState, Modal, Section, SkeletonCard, Tabs } from "@/components/ui";
import {
  RefreshCw,
  ClipboardList,
  FileText,
  Download,
  Check,
  X,
  AlertTriangle,
  XCircle,
} from "lucide-react";

// The two client verdicts that mean the work is disputed. Approved and pending
// are deliberately absent: a reviewer does not need to be interrupted because a
// client agreed, and an unanswered request says nothing about the submission.
const CLIENT_PUSHBACK = {
  changes_requested: {
    label: "Client requested changes",
    box: "border-warning/40 bg-warning/10",
    text: "text-warning",
    icon: AlertTriangle,
  },
  rejected: {
    label: "Client rejected this work",
    box: "border-destructive/40 bg-destructive/10",
    text: "text-destructive",
    icon: XCircle,
  },
};

const REVIEW_STATUS_VARIANT = {
  pending: "warning",
  approved: "success",
  rejected: "destructive",
};

// Shown above the developer's own details, because the client's objection is
// the thing that decides whether this submission can be approved at all.
function ClientPushbackNotice({ pushback, compact = false }) {
  if (!pushback) return null;
  const Icon = pushback.icon;
  const note = String(pushback.note || "").trim();
  return (
    <div className={`rounded-lg border p-3 ${pushback.box} ${compact ? "" : "mb-4"}`}>
      <div className={`flex items-start gap-2 text-sm font-semibold ${pushback.text}`}>
        <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span>{pushback.label}</span>
      </div>
      {note ? (
        <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{note}</p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          No note was left with the decision. Check with the client before
          approving this work.
        </p>
      )}
    </div>
  );
}

export default function TaskReviewPanel({ currentAdmin }) {
  const [loading, setLoading] = useState(true);
  const [submissions, setSubmissions] = useState([]);
  const [submissionsCount, setSubmissionsCount] = useState(0);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [reviewStatus, setReviewStatus] = useState("pending"); // pending, reviewed
  const [reviewComments, setReviewComments] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [processing, setProcessing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [modalAction, setModalAction] = useState(null); // 'approve' or 'reject'
  // task id -> the client's decision on that task, keyed separately from the
  // submission because the review queue is fetched by an endpoint that knows
  // nothing about the client portal.
  const [clientDecisions, setClientDecisions] = useState({});

  const fetchSubmissions = useCallback(async () => {
    try {
      setLoading(true);
      const response = await authFetch(
        `/api/admin-review?adminId=${currentAdmin.id}&status=${reviewStatus}`
      );
      const data = await response.json();

      if (data.success) {
        setSubmissions(data.reviews || []);
        setSubmissionsCount(
          typeof data.count === "number" ? data.count : (data.reviews || []).length
        );
      } else {
        console.error("Failed to fetch submissions:", data.error);
        setSubmissions([]);
        setSubmissionsCount(0);
      }
    } catch (error) {
      console.error("Fetch error:", error);
      setSubmissions([]);
      setSubmissionsCount(0);
    } finally {
      setLoading(false);
    }
  }, [currentAdmin?.id, reviewStatus]);

  // Fetch submissions on mount and when status filter changes
  useEffect(() => {
    if (currentAdmin?.id) {
      fetchSubmissions();
    }
  }, [currentAdmin?.id, reviewStatus, fetchSubmissions]);

  // The client's decision lives on the task, and the queue above lists
  // submissions, so it is read here against the task ids actually on screen.
  // A reviewer who cannot see that the client has already rejected this work is
  // one click away from approving it, which is the failure this whole phase
  // exists to prevent - so it is fetched even though it costs a second round
  // trip.
  useEffect(() => {
    const taskIds = [
      ...new Set((submissions || []).map((s) => s.task_id).filter(Boolean)),
    ];
    if (taskIds.length === 0) {
      setClientDecisions({});
      return undefined;
    }

    let cancelled = false;
    (async () => {
      let query = supabase
        .from("developer_tasks")
        .select("id, client_approval_status, client_approval_note, client_approval_at")
        .in("id", taskIds);
      const orgId = getOrgId();
      if (orgId) query = query.eq("organization_id", orgId);

      const { data, error } = await query;
      if (cancelled) return;
      if (error) {
        // Before migration 033 these columns do not exist. The review queue is
        // still usable without them, so this stays quiet rather than blocking
        // the panel behind a schema the box may not have yet.
        console.error("Client decision fetch error:", error);
        return;
      }
      const byTask = {};
      for (const row of data || []) byTask[row.id] = row;
      setClientDecisions(byTask);
    })();

    return () => {
      cancelled = true;
    };
  }, [submissions]);

  const clientPushbackFor = (submission) => {
    const decision = clientDecisions[submission?.task_id];
    const meta = CLIENT_PUSHBACK[decision?.client_approval_status];
    return meta ? { ...meta, note: decision.client_approval_note } : null;
  };

  const handleReview = async (action) => {
    if (!selectedSubmission) return;

    if (action === "reject" && !rejectionReason.trim()) {
      showWarning("Missing reason", "Please provide a reason for rejection.");
      return;
    }

    try {
      setProcessing(true);

      const response = await authFetch("/api/admin-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId: selectedSubmission.id,
          taskId: selectedSubmission.task_id,
          adminId: currentAdmin.id,
          adminEmail: currentAdmin.email,
          adminName: currentAdmin.name,
          action: action,
          comments: reviewComments,
          rejectionReason: action === "reject" ? rejectionReason : null,
        }),
      });

      const result = await response.json();

      if (result.success) {
        showSuccess(
          "Review saved",
          `Task ${action === "approve" ? "approved" : "rejected"} successfully.`
        );
        setShowModal(false);
        setSelectedSubmission(null);
        setReviewComments("");
        setRejectionReason("");
        fetchSubmissions(); // Refresh the list
      } else {
        showError("Review failed", `Error: ${result.error}`);
      }
    } catch (error) {
      console.error("Review error:", error);
      showError("Review failed", "Failed to process review.");
    } finally {
      setProcessing(false);
    }
  };

  const openReviewModal = (submission, action) => {
    setSelectedSubmission(submission);
    setModalAction(action);
    setShowModal(true);
  };

  const closeReviewModal = () => {
    setShowModal(false);
    setReviewComments("");
    setRejectionReason("");
  };

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const isLateSubmission = (submission) => {
    if (!submission.developer_tasks?.end_date || !submission.submitted_at)
      return false;
    const deadline = new Date(submission.developer_tasks.end_date);
    deadline.setHours(23, 59, 59, 999);
    const submitted = new Date(submission.submitted_at);
    return submitted > deadline;
  };

  const handleDownloadFile = async (fileUrl, fileName, storagePath) => {
    try {
      // The task-submissions bucket is PRIVATE, so we always mint a fresh
      // short-lived signed URL (derived from storage_path, or parsed from the
      // stored file_url for older rows). The stored public URL is never used
      // directly because it does not resolve for a private bucket.
      const downloadUrl = await getSignedSubmissionUrl({ storagePath, fileUrl });

      if (!downloadUrl) {
        showError?.(
          "Download unavailable",
          "Could not generate a secure link for this file. Please try again."
        );
        return;
      }
      // Fetch the file as a blob, then trigger a forced download
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        console.error("Download request failed with status", response.status);
        return;
      }

      const blob = await response.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName || "download";
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(objectUrl);
    } catch (error) {
      console.error("File download failed:", error);
    }
  };

  if (!currentAdmin) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="Not signed in"
        description="Please log in to view task reviews."
      />
    );
  }

  return (
    <Section
      title="Task reviews"
      description="Approve or reject the work developers have submitted."
      actions={
        <Button variant="outline" size="lg" onClick={fetchSubmissions} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin" : undefined} aria-hidden="true" />
          Refresh
        </Button>
      }
    >
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <Tabs
          className="px-4 pt-1"
          aria-label="Review queue"
          active={reviewStatus}
          onChange={(id) => setReviewStatus(id)}
          tabs={[
            {
              id: "pending",
              label: "Pending reviews",
              count: reviewStatus === "pending" ? submissionsCount : undefined,
            },
            {
              id: "reviewed",
              label: "Review history",
              count: reviewStatus === "reviewed" ? submissionsCount : undefined,
            },
          ]}
        />

        <div className="p-4 sm:p-6">
          {loading ? (
            <div className="space-y-4">
              <SkeletonCard lines={4} />
              <SkeletonCard lines={4} />
            </div>
          ) : submissions.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title={
                reviewStatus === "pending" ? "Nothing waiting on you" : "No review history yet"
              }
              description={
                reviewStatus === "pending"
                  ? "Every submitted task has been reviewed. New submissions land here."
                  : "Approved and rejected submissions will be listed here once you have reviewed some."
              }
            />
          ) : (
            <div className="space-y-4">
              {submissions.map((submission) => (
                <article
                  key={submission.id}
                  className="rounded-xl border border-border bg-card p-4 shadow-card transition-shadow duration-150 hover:shadow-elevated sm:p-5"
                >
                  {/* Submission header */}
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-foreground">
                        {submission.developer_tasks?.task_title || "Unnamed task"}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {submission.projects?.name || "Unknown project"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {isLateSubmission(submission) && (
                        <Badge variant="warning">Late submission</Badge>
                      )}
                      <Badge
                        variant={
                          REVIEW_STATUS_VARIANT[submission.review_status] || "secondary"
                        }
                      >
                        {submission.review_status?.charAt(0).toUpperCase() +
                          submission.review_status?.slice(1)}
                      </Badge>
                    </div>
                  </div>

                  {/* Client decision on the underlying task, if there is one.
                      It is never merged into review_status above: that badge is
                      the team's own pipeline and the client does not move it. */}
                  <ClientPushbackNotice pushback={clientPushbackFor(submission)} />

                  {/* Developer info — a scannable grid, not a wall of rows */}
                  <dl className="mb-4 grid grid-cols-2 gap-4 rounded-lg bg-muted/40 p-4 md:grid-cols-4">
                    <div className="min-w-0">
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Developer
                      </dt>
                      <dd className="truncate text-sm font-medium text-foreground">
                        {submission.developers?.name || "Unknown"}
                      </dd>
                      <dd className="truncate text-xs text-muted-foreground">
                        {submission.developers?.email}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Deadline
                      </dt>
                      <dd className="text-sm font-medium text-foreground">
                        {formatDate(submission.developer_tasks?.end_date)}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Submitted
                      </dt>
                      <dd className="text-sm font-medium text-foreground">
                        {formatDate(submission.submitted_at)}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Time status
                      </dt>
                      <dd>
                        <Badge variant={isLateSubmission(submission) ? "destructive" : "success"}>
                          {isLateSubmission(submission) ? "Late (-1)" : "On time (+1)"}
                        </Badge>
                      </dd>
                    </div>
                  </dl>

                  {/* File info */}
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-info/10 text-info">
                        <FileText className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {submission.file_name || "Uploaded file"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {submission.file_type?.toUpperCase()} •{" "}
                          {submission.file_size
                            ? `${(submission.file_size / 1024).toFixed(1)} KB`
                            : "Size unknown"}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={() =>
                        handleDownloadFile(
                          submission.file_url,
                          submission.file_name,
                          submission.storage_path
                        )
                      }
                    >
                      <Download aria-hidden="true" />
                      Download
                    </Button>
                  </div>

                  {/* Submission notes */}
                  {submission.submission_notes && (
                    <div className="mb-4 rounded-lg bg-muted/40 p-3">
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Developer notes
                      </p>
                      <p className="whitespace-pre-wrap text-sm text-foreground">
                        {submission.submission_notes}
                      </p>
                    </div>
                  )}

                  {/* Action buttons */}
                  {submission.review_status === "pending" && (
                    <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row">
                      <Button
                        size="lg"
                        className="flex-1"
                        onClick={() => openReviewModal(submission, "approve")}
                      >
                        <Check aria-hidden="true" />
                        Approve task
                      </Button>
                      <Button
                        variant="destructive"
                        size="lg"
                        className="flex-1"
                        onClick={() => openReviewModal(submission, "reject")}
                      >
                        <X aria-hidden="true" />
                        Reject task
                      </Button>
                    </div>
                  )}

                  {/* Review result (for history) */}
                  {submission.review_status !== "pending" && (
                    <div
                      className={`mt-4 rounded-lg border p-3 ${
                        submission.review_status === "approved"
                          ? "border-success/30 bg-success/10"
                          : "border-destructive/30 bg-destructive/10"
                      }`}
                    >
                      <Badge
                        variant={
                          submission.review_status === "approved" ? "success" : "destructive"
                        }
                      >
                        {submission.review_status === "approved" ? "Approved" : "Rejected"}
                      </Badge>
                      {submission.review_comments && (
                        <p className="mt-2 text-sm text-foreground">
                          {submission.review_comments}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        Reviewed {formatDate(submission.reviewed_at)}
                      </p>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Review modal */}
      {showModal && selectedSubmission && (
        <Modal
          open
          onClose={closeReviewModal}
          size="md"
          title={modalAction === "approve" ? "Approve task" : "Reject task"}
          description={selectedSubmission.developer_tasks?.task_title}
          footer={
            <>
              <Button variant="outline" size="lg" onClick={closeReviewModal} disabled={processing}>
                Cancel
              </Button>
              <Button
                variant={modalAction === "approve" ? "default" : "destructive"}
                size="lg"
                onClick={() => handleReview(modalAction)}
                disabled={
                  processing ||
                  (modalAction === "reject" && !rejectionReason.trim())
                }
              >
                {processing
                  ? "Processing…"
                  : modalAction === "approve"
                  ? "Confirm approval"
                  : "Confirm rejection"}
              </Button>
            </>
          }
        >
          {modalAction === "approve" ? (
            <div>
              {/* Last point at which this is still stoppable: signing off
                  work the client has just pushed back on is the mistake
                  worth interrupting someone for. */}
              {clientPushbackFor(selectedSubmission) ? (
                <div className="mb-4">
                  <ClientPushbackNotice
                    pushback={clientPushbackFor(selectedSubmission)}
                    compact
                  />
                </div>
              ) : null}
              <p className="mb-4 text-sm text-muted-foreground">
                You are about to approve this task. The developer will receive{" "}
                <span
                  className={`font-semibold ${
                    isLateSubmission(selectedSubmission)
                      ? "text-destructive"
                      : "text-success"
                  }`}
                >
                  {isLateSubmission(selectedSubmission)
                    ? "-1 productivity point (late)"
                    : "+1 productivity point (on time)"}
                </span>
                .
              </p>
              <label
                htmlFor="review-comments"
                className="mb-2 block text-sm font-medium text-foreground"
              >
                Comments (optional)
              </label>
              <textarea
                id="review-comments"
                value={reviewComments}
                onChange={(e) => setReviewComments(e.target.value)}
                className="w-full rounded-lg border border-input bg-background p-3 text-sm text-foreground transition-colors duration-150 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                rows={3}
                placeholder="Add any feedback for the developer…"
              />
            </div>
          ) : (
            <div>
              <p className="mb-4 text-sm text-muted-foreground">
                Please provide a reason for rejection. The developer will be
                notified and can resubmit their work.
              </p>
              <label
                htmlFor="rejection-reason"
                className="mb-2 block text-sm font-medium text-foreground"
              >
                Rejection reason <span className="text-destructive">*</span>
              </label>
              <textarea
                id="rejection-reason"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                className="w-full rounded-lg border border-input bg-background p-3 text-sm text-foreground transition-colors duration-150 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                rows={3}
                placeholder="Explain why this submission is being rejected…"
                required
              />
            </div>
          )}
        </Modal>
      )}
    </Section>
  );
}
