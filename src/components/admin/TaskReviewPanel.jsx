"use client";
import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import { showError, showSuccess, showWarning } from "@/utils/alerts";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function TaskReviewPanel({ currentAdmin }) {
  const [loading, setLoading] = useState(true);
  const [submissions, setSubmissions] = useState([]);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [reviewStatus, setReviewStatus] = useState("pending"); // pending, reviewed
  const [reviewComments, setReviewComments] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [processing, setProcessing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [modalAction, setModalAction] = useState(null); // 'approve' or 'reject'

  // Fetch submissions on mount and when status filter changes
  useEffect(() => {
    if (currentAdmin?.id) {
      fetchSubmissions();
    }
  }, [currentAdmin, reviewStatus]);

  const fetchSubmissions = async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `/api/admin-review?adminId=${currentAdmin.id}&status=${reviewStatus}`
      );
      const data = await response.json();

      if (data.success) {
        setSubmissions(data.reviews || []);
      } else {
        console.error("Failed to fetch submissions:", data.error);
      }
    } catch (error) {
      console.error("Fetch error:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleReview = async (action) => {
    if (!selectedSubmission) return;

    if (action === "reject" && !rejectionReason.trim()) {
      showWarning("Missing reason", "Please provide a reason for rejection.");
      return;
    }

    try {
      setProcessing(true);

      const response = await fetch("/api/admin-review", {
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
      pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
      approved: "bg-green-100 text-green-800 border-green-200",
      rejected: "bg-red-100 text-red-800 border-red-200",
    };
    return badges[status] || badges.pending;
  };

  const handleDownloadFile = async (fileUrl, fileName, storagePath) => {
    let downloadUrl = null;

    try {
      // 1) Prefer generating a fresh URL from Supabase Storage using storagePath
      if (storagePath) {
        const { data, error } = await supabase.storage
          .from("task-submissions")
          .createSignedUrl(storagePath, 60); // 60 seconds expiry

        if (error) {
          console.error("Failed to create signed URL from storage:", error);
        } else if (data?.signedUrl) {
          downloadUrl = data.signedUrl;
        }
      }

      // 2) Fallback to a valid HTTP(S) URL from the database if needed
      if (
        !downloadUrl &&
        fileUrl &&
        fileUrl.startsWith("http") &&
        !fileUrl.startsWith("data:") &&
        !fileUrl.startsWith("base64:")
      ) {
        downloadUrl = fileUrl;
      }

      if (!downloadUrl) {
        console.error("No valid download URL available for this file");
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
      <div className="p-6 text-center text-gray-500">
        Please log in to view task reviews
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-lg overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#009578] to-[#00b894] p-6">
        <h2 className="text-2xl font-bold text-white mb-2">
          Task Review Panel
        </h2>
        <p className="text-white/80">
          Review and approve developer task submissions
        </p>
      </div>

      {/* Filter Tabs */}
      <div className="border-b px-6 py-3 bg-gray-50 flex space-x-4">
        <button
          onClick={() => setReviewStatus("pending")}
          className={`px-4 py-2 rounded-lg font-medium transition-all ${
            reviewStatus === "pending"
              ? "bg-[#009578] text-white shadow"
              : "bg-white text-gray-600 hover:bg-gray-100 border"
          }`}
        >
          Pending Reviews
          {reviewStatus === "pending" && submissions.length > 0 && (
            <span className="ml-2 bg-white/20 px-2 py-0.5 rounded-full text-sm">
              {submissions.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setReviewStatus("reviewed")}
          className={`px-4 py-2 rounded-lg font-medium transition-all ${
            reviewStatus === "reviewed"
              ? "bg-[#009578] text-white shadow"
              : "bg-white text-gray-600 hover:bg-gray-100 border"
          }`}
        >
          Review History
        </button>
        <button
          onClick={fetchSubmissions}
          className="ml-auto px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-all"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="p-6">
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#009578] mx-auto"></div>
            <p className="mt-4 text-gray-500">Loading submissions...</p>
          </div>
        ) : submissions.length === 0 ? (
          <div className="text-center py-12">
            <svg
              className="w-16 h-16 mx-auto text-gray-300"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
              />
            </svg>
            <p className="mt-4 text-gray-500">
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
                className="border rounded-xl p-5 hover:shadow-lg transition-all bg-white"
              >
                {/* Submission Header */}
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="font-bold text-lg text-gray-800">
                      {submission.developer_tasks?.task_title || "Unnamed Task"}
                    </h3>
                    <p className="text-sm text-gray-500">
                      Project: {submission.projects?.name || "Unknown Project"}
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    {isLateSubmission(submission) && (
                      <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded-full text-xs font-medium">
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

                {/* Developer Info */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 bg-gray-50 rounded-lg p-4">
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Developer</p>
                    <p className="font-medium text-gray-800">
                      {submission.developers?.name || "Unknown"}
                    </p>
                    <p className="text-xs text-gray-500">
                      {submission.developers?.email}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Deadline</p>
                    <p className="font-medium text-gray-800">
                      {formatDate(submission.developer_tasks?.end_date)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Submitted</p>
                    <p className="font-medium text-gray-800">
                      {formatDate(submission.submitted_at)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase">
                      Time Status
                    </p>
                    <p
                      className={`font-medium ${
                        isLateSubmission(submission)
                          ? "text-red-600"
                          : "text-green-600"
                      }`}
                    >
                      {isLateSubmission(submission) ? "Late (-1)" : "On Time (+1)"}
                    </p>
                  </div>
                </div>

                {/* File Info */}
                <div className="flex items-center justify-between bg-blue-50 rounded-lg p-3 mb-4">
                  <div className="flex items-center">
                    <svg
                      className="w-8 h-8 text-blue-500 mr-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    <div>
                      <p className="font-medium text-gray-800">
                        {submission.file_name || "Uploaded File"}
                      </p>
                      <p className="text-xs text-gray-500">
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
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center"
                  >
                    <svg
                      className="w-4 h-4 mr-2"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M16 12l-4 4m0 0l-4-4m4 4V4"
                      />
                    </svg>
                    Download File
                  </button>
                </div>

                {/* Submission Notes */}
                {submission.submission_notes && (
                  <div className="mb-4 bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 uppercase mb-1">
                      Developer Notes
                    </p>
                    <p className="text-gray-700">{submission.submission_notes}</p>
                  </div>
                )}

                

                {/* Action Buttons */}
                {submission.review_status === "pending" && (
                  <div className="flex space-x-3 pt-4 border-t">
                    <button
                      onClick={() => openReviewModal(submission, "approve")}
                      className="flex-1 px-4 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors font-medium flex items-center justify-center"
                    >
                      <svg
                        className="w-5 h-5 mr-2"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      Approve Task
                    </button>
                    <button
                      onClick={() => openReviewModal(submission, "reject")}
                      className="flex-1 px-4 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors font-medium flex items-center justify-center"
                    >
                      <svg
                        className="w-5 h-5 mr-2"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                      Reject Task
                    </button>
                  </div>
                )}

                {/* Review Result (for history) */}
                {submission.review_status !== "pending" && (
                  <div
                    className={`mt-4 p-3 rounded-lg ${
                      submission.review_status === "approved"
                        ? "bg-green-50"
                        : "bg-red-50"
                    }`}
                  >
                    <p className="font-medium text-gray-800">
                      {submission.review_status === "approved"
                        ? "✓ Approved"
                        : "✗ Rejected"}
                    </p>
                    {submission.review_comments && (
                      <p className="text-sm text-gray-600 mt-1">
                        {submission.review_comments}
                      </p>
                    )}
                    <p className="text-xs text-gray-500 mt-1">
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
            <div
              className={`p-4 rounded-t-xl ${
                modalAction === "approve" ? "bg-green-500" : "bg-red-500"
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
                  <p className="text-gray-600 mb-4">
                    You are about to approve this task. The developer will
                    receive{" "}
                    <span
                      className={`font-bold ${
                        isLateSubmission(selectedSubmission)
                          ? "text-red-600"
                          : "text-green-600"
                      }`}
                    >
                      {isLateSubmission(selectedSubmission)
                        ? "-1 productivity point (late)"
                        : "+1 productivity point (on time)"}
                    </span>
                    .
                  </p>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Comments (Optional)
                  </label>
                  <textarea
                    value={reviewComments}
                    onChange={(e) => setReviewComments(e.target.value)}
                    className="w-full border rounded-lg p-3 focus:ring-2 focus:ring-green-500 focus:border-green-500"
                    rows={3}
                    placeholder="Add any feedback for the developer..."
                  />
                </div>
              ) : (
                <div>
                  <p className="text-gray-600 mb-4">
                    Please provide a reason for rejection. The developer will be
                    notified and can resubmit their work.
                  </p>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Rejection Reason <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    className="w-full border rounded-lg p-3 focus:ring-2 focus:ring-red-500 focus:border-red-500"
                    rows={3}
                    placeholder="Explain why this submission is being rejected..."
                    required
                  />
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-3 p-4 bg-gray-50 rounded-b-xl">
              <button
                onClick={() => {
                  setShowModal(false);
                  setReviewComments("");
                  setRejectionReason("");
                }}
                className="flex-1 px-4 py-2 border rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
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
                className={`flex-1 px-4 py-2 rounded-lg text-white transition-colors ${
                  modalAction === "approve"
                    ? "bg-green-500 hover:bg-green-600"
                    : "bg-red-500 hover:bg-red-600"
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
