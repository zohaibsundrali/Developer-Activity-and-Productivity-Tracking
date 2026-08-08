"use client";
import { useState, useRef } from "react";
import {
  CircleCheck,
  Loader2,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import { supabase } from "@/utils/supabaseClient";
import { showPre } from "@/utils/alerts";
import { Button, Field, Modal } from "@/components/ui";

/**
 * The drop target for the proof-of-work file.
 *
 * `Field` clones its single child to inject `id` / `aria-describedby` /
 * `aria-invalid`. If that child were the styled wrapper div, the label's
 * `htmlFor` would point at a div and the association would be silently broken.
 * So this component takes the injected props and forwards them to the real
 * `<input type="file">`, keeping the wrapper purely decorative.
 */
function FileDropzone({
  inputRef,
  onChange,
  accept,
  onDrop,
  onDragOver,
  selected,
  children,
  // Injected by Field:
  id,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
}) {
  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDrop={onDrop}
      onDragOver={onDragOver}
      className={`cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors duration-150 ${
        selected
          ? "border-success/40 bg-success/10"
          : "border-border hover:border-primary hover:bg-muted/50"
      }`}
    >
      <input
        id={id}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        ref={inputRef}
        type="file"
        onChange={onChange}
        accept={accept}
        className="sr-only"
      />
      {children}
    </div>
  );
}

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
      const { error: uploadError } = await supabase.storage
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

  const deadlinePassed = isDeadlinePassed();
  const busy = submitting || uploading;

  return (
    // Modal owns the focus trap, Escape, focus restoration and aria-modal.
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Submit task for review"
      description={task.title || task.task_title}
      size="lg"
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!selectedFile || busy}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                Submitting…
              </>
            ) : (
              "Submit for review"
            )}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Deadline warning */}
        {deadlinePassed && (
          <div className="rounded-lg border border-warning/20 bg-warning/10 p-3">
            <p className="flex items-center gap-2 text-sm font-medium text-warning">
              <TriangleAlert className="h-4 w-4" aria-hidden="true" />
              The deadline has passed
            </p>
            <p className="mt-1 text-sm text-warning">
              Submitting late costs one productivity point.
            </p>
          </div>
        )}

        {/* Task dates */}
        <dl className="grid grid-cols-1 gap-3 rounded-lg bg-muted/50 p-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Start date</dt>
            <dd className="font-medium tabular-nums text-foreground">
              {new Date(task.start_date || task.startDate).toLocaleDateString()}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">End date</dt>
            <dd className="font-medium tabular-nums text-foreground">
              {new Date(task.end_date || task.endDate).toLocaleDateString()}
            </dd>
          </div>
        </dl>

        {/* File upload */}
        <Field
          label="Proof of work"
          htmlFor="task-proof-file"
          required
          hint="PDF, DOC, DOCX, XLS, XLSX, images, TXT, ZIP or RAR · up to 10 MB"
        >
          <FileDropzone
            inputRef={fileInputRef}
            onChange={handleFileSelect}
            accept={allowedExtensions.join(",")}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            selected={Boolean(selectedFile)}
          >
            {selectedFile ? (
              <div className="flex min-w-0 items-center justify-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success">
                  <CircleCheck className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 text-left">
                  <p
                    className="truncate font-medium text-foreground"
                    title={selectedFile.name}
                  >
                    {selectedFile.name}
                  </p>
                  <p className="text-sm tabular-nums text-muted-foreground">
                    {formatFileSize(selectedFile.size)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove selected file"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedFile(null);
                  }}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            ) : (
              <div className="space-y-1">
                <Upload className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">
                  Drag &amp; drop your file here, or{" "}
                  <span className="font-medium text-primary">browse</span>
                </p>
              </div>
            )}
          </FileDropzone>
        </Field>

        {/* Upload progress */}
        {uploading && (
          <div>
            <div className="mb-1 flex justify-between text-sm text-muted-foreground">
              <span>Uploading…</span>
              <span className="tabular-nums">{uploadProgress}%</span>
            </div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={uploadProgress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Upload progress"
            >
              <div
                className="h-full rounded-full bg-primary transition-all duration-150"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Notes */}
        <Field label="Notes" htmlFor="submission-notes" hint="Optional — anything the reviewer should know.">
          <textarea
            id="submission-notes"
            value={submissionNotes}
            onChange={(e) => setSubmissionNotes(e.target.value)}
            placeholder="Add any notes about your work…"
            className="w-full rounded-lg border border-input bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            rows={3}
          />
        </Field>

        {/* Submission / upload error */}
        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}

        {/* What happens next */}
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <h3 className="text-sm font-medium text-foreground">What happens next</h3>
          <ul className="mt-1.5 list-inside list-disc space-y-1 text-sm text-muted-foreground">
            <li>Your task moves to “Awaiting review”.</li>
            <li>An admin reviews the submission.</li>
            <li>You are notified when it is approved or rejected.</li>
            <li>
              {deadlinePassed
                ? "Late submission: −1 productivity point."
                : "On-time submission: +1 productivity point."}
            </li>
          </ul>
        </div>
      </div>
    </Modal>
  );
}
