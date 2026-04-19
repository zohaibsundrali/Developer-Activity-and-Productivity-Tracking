"use client";
import { useState, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import { showPre } from "@/utils/alerts";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

/**
 * TaskCompletionModal Component
 * 
 * Handles the task completion workflow:
 * 1. Developer clicks "Mark as Completed"
 * 2. Developer uploads proof of work (PDF, Word, or any document)
 * 3. Task status changes to "awaiting_approval" (Pending)
 * 4. Admin reviews and approves/rejects
 */
export default function TaskCompletionModal({
  isOpen,
  onClose,
  task,
  project,
  developer,
  onTaskUpdated,
}) {
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [submissionNotes, setSubmissionNotes] = useState("");
  const [error, setError] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef(null);

  // Allowed file types
  const allowedTypes = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "image/png",
    "image/jpeg",
    "image/gif",
    "text/plain",
    "application/zip",
    "application/x-rar-compressed",
  ];

  const allowedExtensions = [
    ".pdf", ".doc", ".docx", ".xls", ".xlsx",
    ".png", ".jpg", ".jpeg", ".gif",
    ".txt", ".zip", ".rar"
  ];

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const extension = "." + file.name.split(".").pop().toLowerCase();
    if (!allowedExtensions.includes(extension)) {
      setError(`Invalid file type. Allowed: ${allowedExtensions.join(", ")}`);
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setError("File size must be less than 10MB");
      return;
    }

    setSelectedFile(file);
    setError("");
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      const extension = "." + file.name.split(".").pop().toLowerCase();
      if (!allowedExtensions.includes(extension)) {
        setError(`Invalid file type. Allowed: ${allowedExtensions.join(", ")}`);
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setError("File size must be less than 10MB");
        return;
      }
      setSelectedFile(file);
      setError("");
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const uploadFile = async () => {
    if (!selectedFile) return null;

    try {
      setUploading(true);
      setUploadProgress(10);

      // Create unique file name and storage path
      const timestamp = Date.now();
      const sanitizedName = selectedFile.name.replace(/[^a-zA-Z0-9.-]/g, "_");
      const fileName = `${timestamp}_${sanitizedName}`;
      const storagePath = `submissions/${developer.id}/${project.id}/${task.id}/${fileName}`;

      setUploadProgress(40);

      // Upload ONLY to the task-submissions bucket
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("task-submissions")
        .upload(storagePath, selectedFile, {
          cacheControl: "3600",
          upsert: true,
        });

      if (uploadError) {
        console.error("File upload error:", uploadError);
        setError(`File upload failed: ${uploadError.message}`);
        return null;
      }

      setUploadProgress(80);

      // Get public URL from the same bucket
      const { data: urlData } = supabase.storage
        .from("task-submissions")
        .getPublicUrl(storagePath);

      setUploadProgress(100);

      return {
        url: urlData?.publicUrl || "",
        path: storagePath,
        name: selectedFile.name,
        type: selectedFile.type,
        size: selectedFile.size,
      };
    } catch (err) {
      console.error("File upload error:", err);
      setError("An error occurred while uploading the file. Please try again.");
      return null;
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedFile) {
      setError("Please upload proof of work before submitting");
      return;
    }

    try {
      setSubmitting(true);
      setError("");

      // Upload file first
      const fileData = await uploadFile();
      if (!fileData) {
        return;
      }

      // Submit task via API
      const response = await fetch("/api/task-submission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          projectId: project.id,
          developerId: developer.id,
          fileUrl: fileData.url,
          fileName: fileData.name,
          fileType: fileData.type,
          fileSize: fileData.size,
          storagePath: fileData.path,
          submissionNotes: submissionNotes,
        }),
      });

      const result = await response.json();

      if (result.success) {
        // Notify parent component
        if (onTaskUpdated) {
          onTaskUpdated({
            ...task,
            status: "awaiting_approval",
            submitted_at: new Date().toISOString(),
          });
        }

        // Show success message
        showPre(
          "Task submitted",
          `Task submitted successfully!\n\n${
            result.isOnTime
              ? "Submitted on time"
              : "Submitted after deadline"
          }\n\nYour task is now pending admin review.`,
          result.isOnTime ? "success" : "warning"
        );

        onClose();
      } else {
        setError(result.error || "Failed to submit task");
      }
    } catch (err) {
      console.error("Submit error:", err);
      setError("An error occurred while submitting. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const isDeadlinePassed = () => {
    if (!task.end_date && !task.endDate) return false;
    const deadline = new Date(task.end_date || task.endDate);
    deadline.setHours(23, 59, 59, 999);
    return new Date() > deadline;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#009578] to-[#00b894] p-6 rounded-t-xl">
          <h2 className="text-xl font-bold text-white">Submit Task for Review</h2>
          <p className="text-white/80 text-sm mt-1">{task.title || task.task_title}</p>
        </div>

        <div className="p-6">
          {/* Deadline Warning */}
          {isDeadlinePassed() && (
            <div className="mb-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
              <div className="flex items-center text-orange-700">
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span className="font-medium">Deadline has passed!</span>
              </div>
              <p className="text-sm text-orange-600 mt-1">
                Submitting after the deadline will result in -1 productivity point.
              </p>
            </div>
          )}

          {/* Task Details */}
          <div className="mb-4 p-3 bg-gray-50 rounded-lg">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-gray-500">Start Date:</span>
                <p className="font-medium">
                  {new Date(task.start_date || task.startDate).toLocaleDateString()}
                </p>
              </div>
              <div>
                <span className="text-gray-500">End Date:</span>
                <p className="font-medium">
                  {new Date(task.end_date || task.endDate).toLocaleDateString()}
                </p>
              </div>
            </div>
          </div>

          {/* File Upload Area */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Proof of Work <span className="text-red-500">*</span>
            </label>
            <div
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                selectedFile
                  ? "border-green-300 bg-green-50"
                  : "border-gray-300 hover:border-[#009578] hover:bg-gray-50"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileSelect}
                accept={allowedExtensions.join(",")}
                className="hidden"
              />

              {selectedFile ? (
                <div className="flex items-center justify-center">
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mr-3">
                    <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <p className="font-medium text-gray-800">{selectedFile.name}</p>
                    <p className="text-sm text-gray-500">{formatFileSize(selectedFile.size)}</p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedFile(null);
                    }}
                    className="ml-4 text-red-500 hover:text-red-700"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : (
                <>
                  <svg className="w-12 h-12 mx-auto text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="text-gray-600 mb-1">
                    Drag & drop your file here, or{" "}
                    <span className="text-[#009578] font-medium">browse</span>
                  </p>
                  <p className="text-xs text-gray-500">
                    Supported: PDF, DOC, DOCX, XLS, XLSX, Images (Max 10MB)
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Upload Progress */}
          {uploading && (
            <div className="mb-4">
              <div className="flex justify-between text-sm text-gray-600 mb-1">
                <span>Uploading...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-[#009578] h-2 rounded-full transition-all"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Submission Notes */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Notes (Optional)
            </label>
            <textarea
              value={submissionNotes}
              onChange={(e) => setSubmissionNotes(e.target.value)}
              placeholder="Add any notes about your work..."
              className="w-full border rounded-lg p-3 focus:ring-2 focus:ring-[#009578] focus:border-[#009578]"
              rows={3}
            />
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* Info Box */}
          <div className="mb-6 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <h4 className="font-medium text-blue-800 mb-1">What happens next?</h4>
            <ul className="text-sm text-blue-700 list-disc list-inside space-y-1">
              <li>Your task will be marked as "Pending Review"</li>
              <li>Admin will review your submission</li>
              <li>You'll be notified when approved or rejected</li>
              <li>
                {isDeadlinePassed()
                  ? "Late submission: -1 productivity point"
                  : "On-time submission: +1 productivity point"}
              </li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="flex space-x-3 p-4 bg-gray-50 rounded-b-xl">
          <button
            onClick={onClose}
            disabled={submitting || uploading}
            className="flex-1 px-4 py-2 border rounded-lg text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!selectedFile || submitting || uploading}
            className="flex-1 px-4 py-2 bg-[#009578] text-white rounded-lg hover:bg-[#007d63] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Submitting...
              </span>
            ) : (
              "Submit for Review"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
