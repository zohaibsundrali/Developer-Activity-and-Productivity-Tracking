"use client";
import { useState, useEffect, useCallback } from "react";
import { showError, showSuccess, showWarning } from "@/utils/alerts";
import { getSignedSubmissionUrl } from "@/utils/submissionFiles";
import { authFetch } from "@/utils/authFetch";
import { supabase } from "@/utils/supabaseClient";
import { getOrgId } from "@/utils/orgContext";
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

// Shown above the developer's own details, because the client's objection is
// the thing that decides whether this submission can be approved at all.
function ClientPushbackNotice({ pushback, compact = false }) {
  if (!pushback) return null;
  const Icon = pushback.icon;
  const note = String(pushback.note || "").trim();
  return (
    <div className={`rounded-lg border p-3 ${pushback.box} ${compact ? "" : "mb-4"}`}>
      <div className={`flex items-start gap-2 font-semibold ${pushback.text}`}>
        <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
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

  const getStatusBadge = (status) => {
    const badges = {
      pending: "bg-warning/10 text-warning border-warning/20",
      approved: "bg-success/10 text-success border-success/20",
      rejected: "bg-destructive/10 text-destructive border-destructive/20",
    };
    return badges[status] || badges.pending;
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
      <div className="p-6 text-center text-muted-foreground">
        Please log in to view task reviews
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
      {/* Header */}
      <div className="bg-primary p-6">
        <h2 className="text-2xl font-bold text-primary-foreground mb-2">
          Task Review Panel
        </h2>
        <p className="text-primary-foreground/80">
          Review and approve developer task submissions
        </p>
      </div>

      {/* Filter Tabs */}
      <div className="border-b border-border px-6 py-3 bg-muted/50 flex space-x-4">
        <button
          onClick={() => setReviewStatus("pending")}
          className={`px-4 py-2 rounded-lg font-semibold transition-all ${
            reviewStatus === "pending"
              ? "bg-primary text-primary-foreground shadow-card"
              : "bg-card text-muted-foreground hover:bg-muted border border-border"
          }`}
        >
          Pending Reviews
          {reviewStatus === "pending" && submissionsCount > 0 && (
            <span className="ml-2 bg-white/20 px-2 py-0.5 rounded-full text-sm">
              {submissionsCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setReviewStatus("reviewed")}
          className={`px-4 py-2 rounded-lg font-semibold transition-all ${
            reviewStatus === "reviewed"
              ? "bg-primary text-primary-foreground shadow-card"
              : "bg-card text-muted-foreground hover:bg-muted border border-border"
          }`}
        >
          Review History
          {reviewStatus === "reviewed" && submissionsCount > 0 && (
            <span className="ml-2 bg-white/20 px-2 py-0.5 rounded-full text-sm">
              {submissionsCount}
            </span>
          )}
        </button>
        <button
          onClick={fetchSubmissions}
          className="ml-auto inline-flex items-center justify-center px-4 py-2 bg-card text-muted-foreground rounded-lg border border-border hover:bg-muted transition-all"
        >
          <RefreshCw className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      {/* Content */}
      <div className="p-6">
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
            <p className="mt-4 text-muted-foreground">Loading submissions...</p>
          </div>
        ) : submissions.length === 0 ? (
          <div className="text-center py-12">
            <ClipboardList
              className="w-16 h-16 mx-auto text-muted-foreground/40"
              aria-hidden="true"
            />
            <p className="mt-4 text-muted-foreground">
              {reviewStatus === "pending"
                ? "No pending reviews"
                : "No review history found"}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {submissions.map((submission) => (
              <div
                key={submission.id}
                className="border border-border rounded-xl p-5 hover:shadow-card transition-all bg-card"
              >
                {/* Submission Header */}
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-bold text-lg text-foreground">
                      {submission.developer_tasks?.task_title || "Unnamed Task"}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Project: {submission.projects?.name || "Unknown Project"}
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    {isLateSubmission(submission) && (
                      <span className="px-2.5 py-1 bg-warning/10 text-warning rounded-full text-xs font-semibold">
                        Late Submission
                      </span>
                    )}
                    <span
                      className={`px-3 py-1 rounded-full text-sm font-medium border ${getStatusBadge(
                        submission.review_status
                      )}`}
                    >
                      {submission.review_status?.charAt(0).toUpperCase() +
                        submission.review_status?.slice(1)}
                    </span>
                  </div>
                </div>

                {/* Client decision on the underlying task, if there is one.
                    It is never merged into review_status above: that badge is
                    the team's own pipeline and the client does not move it. */}
                <ClientPushbackNotice pushback={clientPushbackFor(submission)} />

                {/* Developer Info */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 bg-muted/50 rounded-lg p-4">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">Developer</p>
                    <p className="font-medium text-foreground">
                      {submission.developers?.name || "Unknown"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {submission.developers?.email}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">Deadline</p>
                    <p className="font-medium text-foreground">
                      {formatDate(submission.developer_tasks?.end_date)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">Submitted</p>
                    <p className="font-medium text-foreground">
                      {formatDate(submission.submitted_at)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">
                      Time Status
                    </p>
                    <p
                      className={`font-medium ${
                        isLateSubmission(submission)
                          ? "text-destructive"
                          : "text-success"
                      }`}
                    >
                      {isLateSubmission(submission) ? "Late (-1)" : "On Time (+1)"}
                    </p>
                  </div>
                </div>

                {/* File Info */}
                <div className="flex items-center justify-between bg-info/10 rounded-lg p-3 mb-4">
                  <div className="flex items-center">
                    <FileText className="w-8 h-8 text-info mr-3" aria-hidden="true" />
                    <div>
                      <p className="font-medium text-foreground">
                        {submission.file_name || "Uploaded File"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {submission.file_type?.toUpperCase()} •{" "}
                        {submission.file_size
                          ? `${(submission.file_size / 1024).toFixed(1)} KB`
                          : "Size unknown"}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      handleDownloadFile(
                        submission.file_url,
                        submission.file_name,
                        submission.storage_path
                      )
                    }
                    className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-semibold text-sm"
                  >
                    <Download className="w-4 h-4" aria-hidden="true" />
                    Download File
                  </button>
                </div>

                {/* Submission Notes */}
                {submission.submission_notes && (
                  <div className="mb-4 bg-muted/50 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground uppercase mb-1">
                      Developer Notes
                    </p>
                    <p className="text-foreground">{submission.submission_notes}</p>
                  </div>
                )}

                

                {/* Action Buttons */}
                {submission.review_status === "pending" && (
                  <div className="flex space-x-3 pt-4 border-t border-border">
                    <button
                      onClick={() => openReviewModal(submission, "approve")}
                      className="flex-1 px-4 py-3 bg-success text-success-foreground rounded-lg hover:bg-success/90 transition-colors font-semibold flex items-center justify-center gap-2"
                    >
                      <Check className="w-5 h-5" aria-hidden="true" />
                      Approve Task
                    </button>
                    <button
                      onClick={() => openReviewModal(submission, "reject")}
                      className="flex-1 px-4 py-3 bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 transition-colors font-semibold flex items-center justify-center gap-2"
                    >
                      <X className="w-5 h-5" aria-hidden="true" />
                      Reject Task
                    </button>
                  </div>
                )}

                {/* Review Result (for history) */}
                {submission.review_status !== "pending" && (
                  <div
                    className={`mt-4 p-3 rounded-lg ${
                      submission.review_status === "approved"
                        ? "bg-success/10"
                        : "bg-destructive/10"
                    }`}
                  >
                    <p className="font-medium text-foreground">
                      {submission.review_status === "approved"
                        ? "✓ Approved"
                        : "✗ Rejected"}
                    </p>
                    {submission.review_comments && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {submission.review_comments}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      Reviewed: {formatDate(submission.reviewed_at)}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Review Modal */}
      {showModal && selectedSubmission && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-card border border-border shadow-popover rounded-xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
            <div
              className={`p-4 rounded-t-xl ${
                modalAction === "approve" ? "bg-success" : "bg-destructive"
              }`}
            >
              <h3 className="text-xl font-bold text-white">
                {modalAction === "approve" ? "Approve Task" : "Reject Task"}
              </h3>
              <p className="text-white/80 text-sm">
                {selectedSubmission.developer_tasks?.task_title}
              </p>
            </div>

            <div className="p-6 overflow-y-auto">
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
                  <p className="text-muted-foreground mb-4">
                    You are about to approve this task. The developer will
                    receive{" "}
                    <span
                      className={`font-bold ${
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
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Comments (Optional)
                  </label>
                  <textarea
                    value={reviewComments}
                    onChange={(e) => setReviewComments(e.target.value)}
                    className="w-full border border-input bg-background rounded-lg p-3 focus:border-primary focus:ring-2 focus:ring-primary/30"
                    rows={3}
                    placeholder="Add any feedback for the developer..."
                  />
                </div>
              ) : (
                <div>
                  <p className="text-muted-foreground mb-4">
                    Please provide a reason for rejection. The developer will be
                    notified and can resubmit their work.
                  </p>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Rejection Reason <span className="text-destructive">*</span>
                  </label>
                  <textarea
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    className="w-full border border-input bg-background rounded-lg p-3 focus:border-destructive focus:ring-2 focus:ring-destructive/30"
                    rows={3}
                    placeholder="Explain why this submission is being rejected..."
                    required
                  />
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-3 p-4 bg-muted/50 rounded-b-xl">
              <button
                onClick={() => {
                  setShowModal(false);
                  setReviewComments("");
                  setRejectionReason("");
                }}
                className="flex-1 px-4 py-2 border border-border rounded-lg text-foreground hover:bg-muted transition-colors"
                disabled={processing}
              >
                Cancel
              </button>
              <button
                onClick={() => handleReview(modalAction)}
                disabled={
                  processing ||
                  (modalAction === "reject" && !rejectionReason.trim())
                }
                className={`flex-1 px-4 py-2 rounded-lg text-white font-semibold transition-colors ${
                  modalAction === "approve"
                    ? "bg-success hover:bg-success/90"
                    : "bg-destructive hover:bg-destructive/90"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {processing
                  ? "Processing..."
                  : modalAction === "approve"
                  ? "Confirm Approval"
                  : "Confirm Rejection"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
