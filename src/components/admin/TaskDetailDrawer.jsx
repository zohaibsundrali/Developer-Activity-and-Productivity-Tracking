"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Check,
  Paperclip,
  MessageSquare,
  ListChecks,
  GitBranch,
  Eye,
  EyeOff,
  Plus,
  Save,
  Loader2,
  Download,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import {
  updateTask,
  createTask,
  changeTaskStatus,
  assignTask,
  allowedTransitions,
  loadTaskDetail,
  addComment,
  addChecklistItem,
  toggleChecklistItem,
  toggleWatcher,
  addDependency,
  uploadTaskAttachment,
  signTaskAttachment,
  deleteTaskAttachment,
  PRIORITIES,
} from "@/utils/pmData";
import { getOrgContext, isMembershipActive } from "@/utils/orgContext";
import { hasRole } from "@/utils/permissions";
import { showConfirm, showError, showSuccess } from "@/utils/alerts";

/**
 * "1.4 MB". Shown next to every attachment because the size is what decides
 * whether somebody opens it now or waits — and because a 0-byte file is a
 * failed upload that otherwise looks identical to a good one.
 */
function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const value = n / 1024 ** i;
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}
import TaskExtras from "@/components/admin/TaskExtras";
import TaskTimer from "@/components/admin/TaskTimer";
import {
  Badge,
  Button,
  Drawer,
  Field,
  Input,
  Skeleton,
  SkeletonList,
} from "@/components/ui";
import {
  Avatar,
  PriorityBadge,
  SELECT_CLASS,
  TaskStatusPill,
  taskRef,
} from "@/components/admin/views/viewKit";

// ---- constants & small helpers --------------------------------------
const DEPENDENCY_TYPES = ["blocks", "blocked_by", "relates_to"];

// "in_progress" -> "In Progress"
const pretty = (s) =>
  String(s || "")
    .split("_")
    .map((w) => (w && w[0] ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");

// What the client has said about this task, kept strictly apart from `status`:
// this is their verdict on the work, not a position in the team's pipeline, and
// nothing here ever writes to `status`.
const CLIENT_APPROVAL_META = {
  pending: {
    label: "Awaiting client",
    variant: "info",
    icon: Clock,
  },
  approved: {
    label: "Client approved",
    variant: "success",
    icon: CheckCircle2,
  },
  changes_requested: {
    label: "Client requested changes",
    variant: "warning",
    icon: AlertTriangle,
  },
  rejected: {
    label: "Client rejected",
    variant: "destructive",
    icon: XCircle,
  },
};

const TEXTAREA_CLASS =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground transition-colors duration-150 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

const fmtDate = (v) => {
  if (!v) return "";
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleString();
  } catch {
    return String(v);
  }
};

// A date input needs a plain YYYY-MM-DD value.
const toDateInput = (v) => {
  if (!v) return "";
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
    return d.toISOString().slice(0, 10);
  } catch {
    return String(v).slice(0, 10);
  }
};

/**
 * A block inside the drawer. Flat rules rather than nested cards: in a 512px
 * panel a stack of eleven bordered boxes reads as noise, while one heading
 * scale plus a hairline reads as an outline you can skim.
 */
function Block({ title, icon: Icon, count, children, className = "" }) {
  return (
    <section className={`border-t border-border pt-5 first:border-0 first:pt-0 ${className}`}>
      {title ? (
        <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
          {title}
          {count != null ? (
            <Badge variant="secondary" size="sm" className="tabular-nums">
              {count}
            </Badge>
          ) : null}
        </h3>
      ) : null}
      {children}
    </section>
  );
}

export default function TaskDetailDrawer({
  task,
  members = [],
  sprints = [],
  epics = [],
  allTasks = [],
  onClose,
  onChanged,
}) {
  // Local, editable copy of the task fields (kept in sync on every save).
  const [form, setForm] = useState(task || {});
  const [detail, setDetail] = useState({
    comments: [],
    checklist: [],
    watchers: [],
    attachments: [],
    dependencies: [],
  });
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [savingField, setSavingField] = useState(null);

  // section-local inputs
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [checklistText, setChecklistText] = useState("");
  const [depTaskId, setDepTaskId] = useState("");
  const [depType, setDepType] = useState("blocks");
  const [reviewerId, setReviewerId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busyAttachmentId, setBusyAttachmentId] = useState(null);

  // comment composer + @mentions
  const [commentBody, setCommentBody] = useState("");
  const [mentionIds, setMentionIds] = useState([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const commentRef = useRef(null);
  const [submittingComment, setSubmittingComment] = useState(false);

  const ctx = useMemo(() => getOrgContext() || {}, []);
  const taskId = task?.id;

  useEffect(() => {
    setForm(task || {});
  }, [task]);

  // ---- detail loading ------------------------------------------------
  const refresh = useCallback(async () => {
    if (!taskId) return;
    try {
      const d = await loadTaskDetail(taskId);
      setDetail({
        comments: d?.comments || [],
        checklist: d?.checklist || [],
        watchers: d?.watchers || [],
        attachments: d?.attachments || [],
        dependencies: d?.dependencies || [],
      });
    } catch (err) {
      console.error("loadTaskDetail failed", err);
    } finally {
      setLoadingDetail(false);
    }
    try {
      onChanged?.();
    } catch {
      /* noop */
    }
  }, [taskId, onChanged]);

  useEffect(() => {
    let active = true;
    setLoadingDetail(true);
    (async () => {
      if (!taskId) {
        setLoadingDetail(false);
        return;
      }
      try {
        const d = await loadTaskDetail(taskId);
        if (!active) return;
        setDetail({
          comments: d?.comments || [],
          checklist: d?.checklist || [],
          watchers: d?.watchers || [],
          attachments: d?.attachments || [],
          dependencies: d?.dependencies || [],
        });
      } catch (err) {
        console.error("loadTaskDetail failed", err);
      } finally {
        if (active) setLoadingDetail(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [taskId]);

  // ---- member lookups ------------------------------------------------
  const memberById = useMemo(() => {
    const m = new Map();
    (members || []).forEach((mem) => {
      if (mem && mem.userId != null) m.set(String(mem.userId), mem);
    });
    return m;
  }, [members]);

  const nameForUser = useCallback(
    (userId) => {
      if (userId == null) return "Unknown";
      const mem = memberById.get(String(userId));
      if (mem?.name) return mem.name;
      if (ctx?.userId != null && String(ctx.userId) === String(userId)) {
        return ctx.organizationName ? `You` : "You";
      }
      return "User";
    },
    [memberById, ctx]
  );

  // developer_tasks.developer_id is a foreign key onto developers(id), and a
  // membership's user_id is only a developers.id when its user_type is
  // "developer" - for an admin-typed membership it is an admin_users.id. Offering
  // anyone by ROLE therefore let a manager or team lead be picked whose id the
  // foreign key then rejected, so the assignment silently failed to save.
  //
  // Deactivated people are excluded for the same reason work should not be
  // routed to them at all: offboarding is meant to stop new work arriving.
  const assignableMembers = useMemo(
    () =>
      (members || []).filter((m) => {
        if (!m) return false;
        if (m.userType !== "developer") return false;
        return isMembershipActive(m.status);
      }),
    [members]
  );

  const reviewerMembers = useMemo(
    () =>
      (members || []).filter(
        (m) => m && String(m.role || "").toLowerCase() === "reviewer"
      ),
    [members]
  );

  const subtasks = useMemo(
    () => (allTasks || []).filter((t) => t && t.parent_task_id === taskId),
    [allTasks, taskId]
  );

  const dependencyCandidates = useMemo(
    () => (allTasks || []).filter((t) => t && t.id !== taskId),
    [allTasks, taskId]
  );

  const titleForTask = useCallback(
    (id) => {
      const found = (allTasks || []).find((t) => t && t.id === id);
      return found?.task_title || "Task";
    },
    [allTasks]
  );

  // ---- field saving --------------------------------------------------
  const saveField = useCallback(
    async (field, value) => {
      if (!taskId) return;
      setSavingField(field);
      try {
        const { error } = await updateTask(taskId, { [field]: value });
        if (error) {
          showError("Could not save", error.message || String(error));
          return;
        }
        setForm((prev) => ({ ...(prev || {}), [field]: value }));
        try {
          onChanged?.();
        } catch {
          /* noop */
        }
      } catch (err) {
        showError("Could not save", err?.message || String(err));
      } finally {
        setSavingField(null);
      }
    },
    [taskId, onChanged]
  );

  // Assignment is not a plain column write either: assignTask fires the
  // "assigned" automation trigger and notifies the new assignee. Routing it
  // through saveField is what left that trigger unreachable from the UI.
  const handleAssign = useCallback(
    async (developerId) => {
      if (!taskId) return;
      setSavingField("developer_id");
      try {
        const { error } = await assignTask(taskId, developerId || null);
        if (error) {
          showError("Could not assign", error.message || String(error));
          return;
        }
        setForm((prev) => ({ ...(prev || {}), developer_id: developerId || null }));
        try {
          onChanged?.();
        } catch {
          /* noop */
        }
      } catch (err) {
        showError("Could not assign", err?.message || String(err));
      } finally {
        setSavingField(null);
      }
    },
    [taskId, onChanged]
  );

  // Status is the one field that is never a plain column write: the legal moves
  // depend on where the task sits, and Done/Rejected belong to the review flow.
  const handleStatusChange = useCallback(
    async (next) => {
      if (!taskId || !next) return;
      setSavingField("status");
      try {
        const { error } = await changeTaskStatus(taskId, next);
        if (error) {
          showError("Status unchanged", error.message || String(error));
          return;
        }
        setForm((prev) => ({ ...(prev || {}), status: next }));
        try {
          onChanged?.();
        } catch {
          /* noop */
        }
      } catch (err) {
        showError("Status unchanged", err?.message || String(err));
      } finally {
        setSavingField(null);
      }
    },
    [taskId, onChanged]
  );

  const onLocalChange = (field, value) =>
    setForm((prev) => ({ ...(prev || {}), [field]: value }));

  // ---- subtasks ------------------------------------------------------
  const handleAddSubtask = async () => {
    const title = subtaskTitle.trim();
    if (!title || !task?.project_id) return;
    try {
      const { error } = await createTask(task.project_id, {
        task_title: title,
        parent_task_id: taskId,
      });
      if (error) {
        showError("Could not add subtask", error.message || String(error));
        return;
      }
      setSubtaskTitle("");
      await refresh();
    } catch (err) {
      showError("Could not add subtask", err?.message || String(err));
    }
  };

  // ---- checklist -----------------------------------------------------
  const handleAddChecklist = async () => {
    const text = checklistText.trim();
    if (!text || !taskId) return;
    try {
      const { error } = await addChecklistItem(taskId, text);
      if (error) {
        showError("Could not add item", error.message || String(error));
        return;
      }
      setChecklistText("");
      await refresh();
    } catch (err) {
      showError("Could not add item", err?.message || String(err));
    }
  };

  const handleToggleChecklist = async (item) => {
    if (!item?.id) return;
    try {
      const { error } = await toggleChecklistItem(item.id, !item.done);
      if (error) {
        showError("Could not update item", error.message || String(error));
        return;
      }
      await refresh();
    } catch (err) {
      showError("Could not update item", err?.message || String(err));
    }
  };

  const checklistItems = detail.checklist || [];
  const checklistDone = checklistItems.filter((i) => i && i.done).length;

  // ---- dependencies --------------------------------------------------
  const handleAddDependency = async () => {
    if (!depTaskId || !taskId) return;
    try {
      const { error } = await addDependency(taskId, depTaskId, depType);
      if (error) {
        showError("Could not add dependency", error.message || String(error));
        return;
      }
      setDepTaskId("");
      setDepType("blocks");
      await refresh();
    } catch (err) {
      showError("Could not add dependency", err?.message || String(err));
    }
  };

  // ---- watchers / reviewers -----------------------------------------
  const isWatching = useMemo(() => {
    if (ctx?.userId == null) return false;
    return (detail.watchers || []).some(
      (w) =>
        w &&
        String(w.user_id) === String(ctx.userId) &&
        (w.role || "watcher") === "watcher"
    );
  }, [detail.watchers, ctx]);

  const handleToggleWatch = async () => {
    if (ctx?.userId == null || !taskId) {
      showError("Cannot update watchers", "No current user in session.");
      return;
    }
    try {
      const { error } = await toggleWatcher(
        taskId,
        ctx.userId,
        ctx.userType,
        "watcher",
        !isWatching
      );
      if (error) {
        showError("Could not update watchers", error.message || String(error));
        return;
      }
      await refresh();
    } catch (err) {
      showError("Could not update watchers", err?.message || String(err));
    }
  };

  const handleAddReviewer = async () => {
    if (!reviewerId || !taskId) return;
    const mem = memberById.get(String(reviewerId));
    if (!mem) return;
    try {
      const { error } = await toggleWatcher(
        taskId,
        mem.userId,
        mem.userType,
        "reviewer",
        true
      );
      if (error) {
        showError("Could not add reviewer", error.message || String(error));
        return;
      }
      setReviewerId("");
      await refresh();
    } catch (err) {
      showError("Could not add reviewer", err?.message || String(err));
    }
  };

  // ---- attachments ---------------------------------------------------
  // Refused here rather than by the storage API, which answers a failed upload
  // with a 413 and no useful text. The number is the practical ceiling for a
  // browser upload over a slow connection, not a bucket limit.
  const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

  const handleUpload = async (e) => {
    const file = e?.target?.files?.[0];
    if (!file || !taskId) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      showError(
        "File too large",
        `${file.name} is ${formatBytes(file.size)}. The limit is ${formatBytes(
          MAX_ATTACHMENT_BYTES
        )}.`
      );
      if (e?.target) e.target.value = "";
      return;
    }
    setUploading(true);
    try {
      const { error } = await uploadTaskAttachment(taskId, file);
      if (error) {
        showError("Upload failed", error.message || String(error));
        return;
      }
      showSuccess("Uploaded", file.name);
      await refresh();
    } catch (err) {
      showError("Upload failed", err?.message || String(err));
    } finally {
      setUploading(false);
      if (e?.target) e.target.value = "";
    }
  };

  // The bucket is private, so "open" means "sign, then open". The window is
  // opened only after the URL comes back; opening it first and navigating it
  // later is what browsers block as a popup.
  const handleOpenAttachment = async (attachment) => {
    setBusyAttachmentId(attachment.id);
    try {
      const { url, error } = await signTaskAttachment(attachment);
      if (error || !url) {
        showError("Could not open", error?.message || "The file link could not be created.");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setBusyAttachmentId(null);
    }
  };

  const handleDeleteAttachment = async (attachment) => {
    const ok = await showConfirm(
      "Delete this file?",
      `${attachment.file_name || "This file"} will be removed from the task. This cannot be undone.`,
      { confirmButtonText: "Delete" }
    );
    if (!ok) return;
    setBusyAttachmentId(attachment.id);
    try {
      const { error } = await deleteTaskAttachment(attachment);
      if (error) {
        showError("Not deleted", error.message || String(error));
        return;
      }
      await refresh();
    } finally {
      setBusyAttachmentId(null);
    }
  };

  // ---- comments + @mentions -----------------------------------------
  const mentionMatches = useMemo(() => {
    const q = mentionQuery.trim().toLowerCase();
    return (members || [])
      .filter((m) => m && m.name && (!q || m.name.toLowerCase().includes(q)))
      .slice(0, 6);
  }, [members, mentionQuery]);

  const onCommentInput = (e) => {
    const value = e.target.value;
    setCommentBody(value);
    // Look at the token currently being typed (up to the caret).
    const caret = e.target.selectionStart ?? value.length;
    const upto = value.slice(0, caret);
    const match = /(^|\s)@([^\s@]*)$/.exec(upto);
    if (match) {
      setMentionOpen(true);
      setMentionQuery(match[2] || "");
    } else {
      setMentionOpen(false);
      setMentionQuery("");
    }
  };

  const insertMention = (mem) => {
    if (!mem) return;
    setCommentBody((prev) => {
      const value = prev || "";
      // Replace the trailing "@partial" with "@Name ".
      const replaced = value.replace(/(^|\s)@([^\s@]*)$/, (full, pre) => {
        return `${pre}@${mem.name} `;
      });
      return replaced === value ? `${value}@${mem.name} ` : replaced;
    });
    setMentionIds((prev) =>
      prev.includes(mem.userId) ? prev : [...prev, mem.userId]
    );
    setMentionOpen(false);
    setMentionQuery("");
    if (commentRef.current) commentRef.current.focus();
  };

  const handleSubmitComment = async () => {
    const body = commentBody.trim();
    if (!body || !taskId) return;
    setSubmittingComment(true);
    try {
      // Only keep mention ids whose names still appear in the body.
      const kept = (mentionIds || []).filter((id) => {
        const mem = memberById.get(String(id));
        return mem?.name && body.includes(`@${mem.name}`);
      });
      const { error } = await addComment(taskId, body, kept);
      if (error) {
        showError("Could not post comment", error.message || String(error));
        return;
      }
      setCommentBody("");
      setMentionIds([]);
      setMentionOpen(false);
      await refresh();
    } catch (err) {
      showError("Could not post comment", err?.message || String(err));
    } finally {
      setSubmittingComment(false);
    }
  };

  const commentAuthorName = (c) => {
    if (!c) return "User";
    if (c.author_name) return c.author_name;
    if (c.author_id != null) return nameForUser(c.author_id);
    if (ctx?.userId != null) return "You";
    return "User";
  };

  if (!task) return null;

  const currentStatus = form?.status || task?.status || "pending";
  const currentPriority = form?.priority || task?.priority || "medium";

  // Owner / Admin / Manager. Publishing a task to the client is a decision about
  // what the client is TOLD, not about running the board: can("manage_tasks")
  // would hand the same switch to a team lead, who can legitimately move any
  // card but is not the person who should decide that "chase the client about
  // the overdue invoice" is something the client gets to read. Naming the three
  // roles through hasRole keeps that set pinned here instead of borrowing a
  // capability whose membership is free to drift for unrelated reasons.
  const canSetClientVisibility = hasRole("owner", "admin", "manager");

  // Migration 032 adds the column NOT NULL, so a loaded task always carries a
  // real boolean once it has run. undefined/null therefore means "the column is
  // not there yet", which is a different thing from "private" and must not be
  // drawn as an unchecked box - that is precisely the reading ("it failed to
  // load") that would get someone to flip it without knowing what it did.
  const clientVisibilityKnown =
    form?.client_visible === true || form?.client_visible === false;
  const clientVisible = form?.client_visible === true;
  const savingClientVisible = savingField === "client_visible";

  // Null means the client has never been asked or has never answered, which is
  // not a decision and so gets no badge at all. An unrecognised value (a row
  // written before the 033 check constraint, say) is left alone rather than
  // drawn as one of the four known states.
  const clientApproval = CLIENT_APPROVAL_META[form?.client_approval_status] || null;
  const ClientApprovalIcon = clientApproval?.icon || null;
  const clientApprovalNote = String(form?.client_approval_note || "").trim();
  const clientWantsChanges = form?.client_approval_status === "changes_requested";

  const statusChoices = [
    currentStatus,
    ...allowedTransitions(currentStatus).filter((s) => s !== currentStatus),
  ];

  const ref = taskRef(task);
  const assigneeLabel = form?.developer_id
    ? memberById.get(String(form.developer_id))?.name || null
    : null;

  return (
    <Drawer
      open
      onClose={onClose}
      side="right"
      size="lg"
      title={form?.task_title || "Untitled task"}
      description={ref ? `Task ${ref}` : undefined}
    >
      <div className="space-y-5">
        {/* 1. Identity strip — what this task IS, at a glance ----------- */}
        <div className="flex flex-wrap items-center gap-2">
          <TaskStatusPill status={currentStatus} />
          <PriorityBadge priority={currentPriority} size="md" />
          {form?.task_type ? (
            <Badge variant="outline" className="capitalize">
              {String(form.task_type).replace(/_/g, " ")}
            </Badge>
          ) : null}
          <span className="ml-auto flex items-center gap-2">
            <Avatar name={assigneeLabel} />
            <span className="text-xs text-muted-foreground">
              {assigneeLabel || "Unassigned"}
            </span>
          </span>
        </div>

        {savingField ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Saving…
          </p>
        ) : null}

        {/* 1a. Client decision ----------------------------------------- */}
        {/* Sits directly under the header, above everything the team edits: the
            client's verdict is context for every decision taken below it, and
            the note behind "changes requested" is the one piece of this feature
            that has to be read before anyone moves the task on. It is shown, not
            editable - the client owns this answer, the team owns `status`. */}
        {clientApproval ? (
          <div
            className={`rounded-xl border p-4 ${
              clientWantsChanges ? "border-warning/40 bg-warning/5" : "border-border bg-muted/30"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Client decision
              </h3>
              <Badge variant={clientApproval.variant}>
                {ClientApprovalIcon ? (
                  <ClientApprovalIcon aria-hidden="true" />
                ) : null}
                {clientApproval.label}
              </Badge>
            </div>

            {clientWantsChanges && clientApprovalNote ? (
              <div className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-warning">
                  What the client asked for
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                  {clientApprovalNote}
                </p>
              </div>
            ) : clientApprovalNote ? (
              <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                {clientApprovalNote}
              </p>
            ) : null}

            {clientWantsChanges && !clientApprovalNote ? (
              <p className="mt-2 text-xs text-muted-foreground">
                The client asked for changes without leaving a note. Ask them
                what they need before this moves on.
              </p>
            ) : null}

            {form?.client_approval_at ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Decided {fmtDate(form.client_approval_at)}
              </p>
            ) : null}

            <p className="mt-2 text-xs text-muted-foreground">
              This is the client&apos;s answer on the work, not a stage of the
              team&apos;s workflow. The Status below is still yours to set.
            </p>
          </div>
        ) : null}

        {/* 2. Details — one scannable two-column grid ------------------- */}
        <Block title="Details">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div className="col-span-2">
              <Field label="Title" htmlFor={`task-title-${taskId}`}>
                <Input
                  id={`task-title-${taskId}`}
                  key={`title-${taskId}`}
                  className="font-medium"
                  defaultValue={form?.task_title || ""}
                  placeholder="Task title"
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== (form?.task_title || "")) {
                      saveField("task_title", v);
                    }
                  }}
                />
              </Field>
            </div>

            <Field
              label="Status"
              htmlFor={`task-status-${taskId}`}
              hint="Done and Rejected are decided in Task Reviews."
              className="col-span-2 sm:col-span-1"
            >
              <select
                id={`task-status-${taskId}`}
                className={`${SELECT_CLASS} w-full`}
                value={currentStatus}
                disabled={statusChoices.length < 2}
                onChange={(e) => handleStatusChange(e.target.value)}
              >
                {statusChoices.map((s) => (
                  <option key={s} value={s}>
                    {pretty(s)}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Priority"
              htmlFor={`task-priority-${taskId}`}
              className="col-span-2 sm:col-span-1"
            >
              <select
                id={`task-priority-${taskId}`}
                className={`${SELECT_CLASS} w-full`}
                value={currentPriority}
                onChange={(e) => saveField("priority", e.target.value)}
              >
                {(PRIORITIES || []).map((p) => (
                  <option key={p} value={p}>
                    {pretty(p)}
                  </option>
                ))}
              </select>
            </Field>

            <div className="col-span-2">
              <Field label="Assignee" htmlFor={`task-assignee-${taskId}`}>
                <select
                  id={`task-assignee-${taskId}`}
                  className={`${SELECT_CLASS} w-full`}
                  value={form?.developer_id ?? ""}
                  onChange={(e) => handleAssign(e.target.value || null)}
                >
                  <option value="">Unassigned</option>
                  {assignableMembers.map((m) => (
                    <option key={String(m.userId)} value={m.userId}>
                      {m.name}
                      {m.role ? ` (${pretty(m.role)})` : ""}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Story points" htmlFor={`task-points-${taskId}`}>
              <Input
                id={`task-points-${taskId}`}
                type="number"
                className="tabular-nums"
                value={form?.story_points ?? ""}
                onChange={(e) => onLocalChange("story_points", e.target.value)}
                onBlur={(e) =>
                  saveField(
                    "story_points",
                    e.target.value === "" ? null : Number(e.target.value)
                  )
                }
              />
            </Field>

            <Field label="Due date" htmlFor={`task-due-${taskId}`}>
              <Input
                id={`task-due-${taskId}`}
                type="date"
                value={toDateInput(form?.due_date)}
                onChange={(e) => saveField("due_date", e.target.value || null)}
              />
            </Field>

            <Field label="Estimated hours" htmlFor={`task-est-${taskId}`}>
              <Input
                id={`task-est-${taskId}`}
                type="number"
                className="tabular-nums"
                value={form?.estimated_hours ?? ""}
                onChange={(e) => onLocalChange("estimated_hours", e.target.value)}
                onBlur={(e) =>
                  saveField(
                    "estimated_hours",
                    e.target.value === "" ? null : Number(e.target.value)
                  )
                }
              />
            </Field>

            <Field label="Actual hours" htmlFor={`task-actual-${taskId}`}>
              <Input
                id={`task-actual-${taskId}`}
                type="number"
                className="tabular-nums"
                value={form?.actual_hours ?? ""}
                onChange={(e) => onLocalChange("actual_hours", e.target.value)}
                onBlur={(e) =>
                  saveField(
                    "actual_hours",
                    e.target.value === "" ? null : Number(e.target.value)
                  )
                }
              />
            </Field>

            <Field label="Sprint" htmlFor={`task-sprint-${taskId}`}>
              <select
                id={`task-sprint-${taskId}`}
                className={`${SELECT_CLASS} w-full`}
                value={form?.sprint_id ?? ""}
                onChange={(e) => saveField("sprint_id", e.target.value || null)}
              >
                <option value="">No sprint</option>
                {(sprints || []).map((s) => (
                  <option key={String(s.id)} value={s.id}>
                    {s.name || "Sprint"}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Epic" htmlFor={`task-epic-${taskId}`}>
              <select
                id={`task-epic-${taskId}`}
                className={`${SELECT_CLASS} w-full`}
                value={form?.epic_id ?? ""}
                onChange={(e) => saveField("epic_id", e.target.value || null)}
              >
                <option value="">No epic</option>
                {(epics || []).map((ep) => (
                  <option key={String(ep.id)} value={ep.id}>
                    {ep.name || "Epic"}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Block>

        {/* 2a. Client visibility --------------------------------------- */}
        {canSetClientVisibility ? (
          <Block title="Client visibility" icon={clientVisible ? Eye : EyeOff}>
            {clientVisibilityKnown ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      checked={clientVisible}
                      disabled={savingClientVisible}
                      onChange={(e) => saveField("client_visible", e.target.checked)}
                    />
                    Visible to client
                  </label>
                  {/* The state is spelled out next to the box as well, because a
                      lone unchecked box reads as "nothing here" rather than as a
                      deliberate "this one is ours". */}
                  <Badge variant={clientVisible ? "success" : "secondary"}>
                    {savingClientVisible ? (
                      <Loader2 className="animate-spin" aria-hidden="true" />
                    ) : null}
                    {clientVisible ? "In the client portal" : "Internal only"}
                  </Badge>
                </div>

                <p className="mt-2 text-xs text-muted-foreground">
                  {clientVisible
                    ? "The client sees this task in their portal: its title, status, priority, due date and the assignee's name. Comments, attachments, time logs and everything else stay internal."
                    : "Only your team sees this task. It is not listed in the client's portal at all."}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  New tasks start internal, so a title written for the team is
                  never shown to the client until someone turns this on.
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                This task carries no visibility setting, which means the client
                portal columns have not been added to the database yet — not that
                the client can read it. Run migration 032 and reopen this task.
              </p>
            )}
          </Block>
        ) : null}

        {/* 3. Description --------------------------------------------- */}
        <Block title="Description">
          <textarea
            className={`${TEXTAREA_CLASS} min-h-[120px] resize-y`}
            value={form?.task_description ?? ""}
            aria-label="Task description"
            placeholder="Add a description…"
            onChange={(e) => onLocalChange("task_description", e.target.value)}
          />
          <div className="mt-2 flex justify-end">
            <Button
              size="lg"
              disabled={savingField === "task_description"}
              onClick={() => saveField("task_description", form?.task_description ?? "")}
            >
              {savingField === "task_description" ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Save aria-hidden="true" />
              )}
              Save
            </Button>
          </div>
        </Block>

        {/* 3a. Time tracking ------------------------------------------ */}
        <Block>
          <TaskTimer
            task={task}
            projectId={task?.project_id}
            members={members}
            onChanged={onChanged}
          />
        </Block>

        {/* 3b. Advanced fields (type, labels, recurring, custom fields, history) */}
        <Block>
          <TaskExtras
            task={task}
            projectId={task?.project_id}
            members={members}
            onChanged={onChanged}
          />
        </Block>

        {/* 4. Subtasks ------------------------------------------------ */}
        <Block title="Subtasks" icon={ListChecks} count={subtasks.length}>
          <ul className="space-y-1.5">
            {subtasks.map((st) => (
              <li
                key={String(st.id)}
                className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <span className="truncate text-foreground">
                  {st.task_title || "Untitled"}
                </span>
                <TaskStatusPill status={st.status} />
              </li>
            ))}
            {subtasks.length === 0 ? (
              <li className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                No subtasks yet.
              </li>
            ) : null}
          </ul>
          <div className="mt-3 flex items-center gap-2">
            <Input
              placeholder="Add subtask…"
              aria-label="New subtask title"
              value={subtaskTitle}
              onChange={(e) => setSubtaskTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddSubtask();
                }
              }}
            />
            <Button size="default" onClick={handleAddSubtask} disabled={!subtaskTitle.trim()}>
              <Plus aria-hidden="true" /> Add
            </Button>
          </div>
        </Block>

        {/* 5. Checklist ----------------------------------------------- */}
        <Block
          title="Checklist"
          icon={Check}
          count={`${checklistDone}/${checklistItems.length}`}
        >
          {checklistItems.length > 0 ? (
            <div
              className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={checklistDone}
              aria-valuemin={0}
              aria-valuemax={checklistItems.length}
              aria-label="Checklist progress"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-150"
                style={{
                  width: `${Math.round((checklistDone / checklistItems.length) * 100)}%`,
                }}
              />
            </div>
          ) : null}

          {loadingDetail && checklistItems.length === 0 ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : (
            <ul className="space-y-2">
              {checklistItems.map((item) => (
                <li key={String(item.id)} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    checked={!!item.done}
                    onChange={() => handleToggleChecklist(item)}
                  />
                  <span
                    className={
                      item.done
                        ? "text-muted-foreground line-through"
                        : "text-foreground"
                    }
                  >
                    {item.text || ""}
                  </span>
                </li>
              ))}
              {checklistItems.length === 0 ? (
                <li className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                  No items yet.
                </li>
              ) : null}
            </ul>
          )}

          <div className="mt-3 flex items-center gap-2">
            <Input
              placeholder="Add checklist item…"
              aria-label="New checklist item"
              value={checklistText}
              onChange={(e) => setChecklistText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddChecklist();
                }
              }}
            />
            <Button size="default" onClick={handleAddChecklist} disabled={!checklistText.trim()}>
              <Plus aria-hidden="true" /> Add
            </Button>
          </div>
        </Block>

        {/* 6. Dependencies -------------------------------------------- */}
        <Block
          title="Dependencies"
          icon={GitBranch}
          count={(detail.dependencies || []).length}
        >
          {loadingDetail && (detail.dependencies || []).length === 0 ? (
            <Skeleton className="h-10 w-full rounded-lg" />
          ) : (
            <ul className="space-y-1.5">
              {(detail.dependencies || []).map((dep) => (
                <li
                  key={String(dep.id ?? dep.depends_on_task_id)}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <span className="truncate text-foreground">
                    {titleForTask(dep.depends_on_task_id)}
                  </span>
                  <Badge variant="default" size="sm">
                    {pretty(dep.type)}
                  </Badge>
                </li>
              ))}
              {(detail.dependencies || []).length === 0 ? (
                <li className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                  No dependencies.
                </li>
              ) : null}
            </ul>
          )}

          <div className="mt-3 grid grid-cols-2 gap-2">
            <select
              className={`${SELECT_CLASS} w-full`}
              aria-label="Dependency task"
              value={depTaskId}
              onChange={(e) => setDepTaskId(e.target.value)}
            >
              <option value="">Select task…</option>
              {dependencyCandidates.map((t) => (
                <option key={String(t.id)} value={t.id}>
                  {t.task_title || "Untitled"}
                </option>
              ))}
            </select>
            <select
              className={`${SELECT_CLASS} w-full`}
              aria-label="Dependency type"
              value={depType}
              onChange={(e) => setDepType(e.target.value)}
            >
              {DEPENDENCY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {pretty(t)}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-2 flex justify-end">
            <Button size="lg" onClick={handleAddDependency} disabled={!depTaskId}>
              <Plus aria-hidden="true" /> Add dependency
            </Button>
          </div>
        </Block>

        {/* 7. Watchers / Reviewers ------------------------------------ */}
        <Block title="Watchers & reviewers" icon={Eye}>
          <div className="flex flex-wrap gap-1.5">
            {(detail.watchers || []).map((w) => (
              <Badge key={`${w.user_id}-${w.role || "watcher"}`} variant="default">
                {nameForUser(w.user_id)}
                <span className="text-primary/70">· {pretty(w.role || "watcher")}</span>
              </Badge>
            ))}
            {(detail.watchers || []).length === 0 ? (
              <span className="text-xs text-muted-foreground">No watchers yet.</span>
            ) : null}
          </div>

          <div className="mt-3">
            <Button
              variant={isWatching ? "outline" : "default"}
              size="lg"
              onClick={handleToggleWatch}
            >
              <Eye aria-hidden="true" />
              {isWatching ? "Unwatch" : "Watch"}
            </Button>
          </div>

          {reviewerMembers.length > 0 ? (
            <div className="mt-3 flex items-center gap-2">
              <select
                className={`${SELECT_CLASS} w-full`}
                aria-label="Add reviewer"
                value={reviewerId}
                onChange={(e) => setReviewerId(e.target.value)}
              >
                <option value="">Add reviewer…</option>
                {reviewerMembers.map((m) => (
                  <option key={String(m.userId)} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </select>
              <Button size="default" onClick={handleAddReviewer} disabled={!reviewerId}>
                <Plus aria-hidden="true" /> Add
              </Button>
            </div>
          ) : null}
        </Block>

        {/* 8. Attachments --------------------------------------------- */}
        <Block
          title="Attachments"
          icon={Paperclip}
          count={(detail.attachments || []).length}
        >
          {loadingDetail && (detail.attachments || []).length === 0 ? (
            <Skeleton className="h-10 w-full rounded-lg" />
          ) : (
            <ul className="space-y-1.5">
              {(detail.attachments || []).map((a) => {
                const size = formatBytes(a.file_size);
                const busy = busyAttachmentId === a.id;
                const name = a.file_name || "File";
                return (
                  <li
                    key={String(a.id ?? a.file_path)}
                    className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <Paperclip
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-foreground">{name}</span>
                      {size && (
                        <span className="block text-xs text-muted-foreground tabular-nums">
                          {size}
                        </span>
                      )}
                    </span>
                    {/* Until these two existed, an upload went into a private
                        bucket and the drawer showed a name nobody could open
                        or remove. */}
                    <button
                      type="button"
                      onClick={() => handleOpenAttachment(a)}
                      disabled={busy}
                      title="Open"
                      aria-label={`Open ${name}`}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      {busy ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Download className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteAttachment(a)}
                      disabled={busy}
                      title="Delete"
                      aria-label={`Delete ${name}`}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
              {(detail.attachments || []).length === 0 ? (
                <li className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                  No attachments.
                </li>
              ) : null}
            </ul>
          )}
          <div className="mt-3">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Paperclip className="h-4 w-4" aria-hidden="true" />
              )}
              {uploading ? "Uploading…" : "Upload file"}
              <input
                type="file"
                className="sr-only"
                onChange={handleUpload}
                disabled={uploading}
              />
            </label>
          </div>
        </Block>

        {/* 9. Comments ------------------------------------------------ */}
        <Block
          title="Comments"
          icon={MessageSquare}
          count={(detail.comments || []).length}
        >
          {loadingDetail ? (
            <SkeletonList rows={2} />
          ) : (
            <ul className="space-y-4">
              {(detail.comments || []).map((c) => (
                <li key={String(c.id ?? `${c.author_id}-${c.created_at}`)} className="flex gap-3">
                  <Avatar name={commentAuthorName(c)} size="md" className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-medium text-foreground">
                        {commentAuthorName(c)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {fmtDate(c.created_at)}
                      </span>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                      {c.body || ""}
                    </p>
                  </div>
                </li>
              ))}
              {(detail.comments || []).length === 0 ? (
                <li className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                  No comments yet. Use @ to pull someone in.
                </li>
              ) : null}
            </ul>
          )}

          {/* composer with @mention dropdown */}
          <div className="relative mt-4">
            <textarea
              ref={commentRef}
              className={`${TEXTAREA_CLASS} min-h-[80px] resize-y`}
              aria-label="Write a comment"
              placeholder="Write a comment… use @ to mention"
              value={commentBody}
              onChange={onCommentInput}
              onKeyDown={(e) => {
                if (e.key === "Escape") setMentionOpen(false);
              }}
            />
            {mentionOpen && mentionMatches.length > 0 ? (
              <div className="absolute left-0 right-0 z-10 mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-popover shadow-popover">
                {mentionMatches.map((m) => (
                  <button
                    key={String(m.userId)}
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-popover-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    onClick={() => insertMention(m)}
                  >
                    <Avatar name={m.name} />
                    <span className="font-medium">{m.name}</span>
                    {m.email ? (
                      <span className="truncate text-xs text-muted-foreground">{m.email}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="mt-2 flex justify-end">
            <Button
              size="lg"
              onClick={handleSubmitComment}
              disabled={submittingComment || !commentBody.trim()}
            >
              {submittingComment ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <MessageSquare aria-hidden="true" />
              )}
              Comment
            </Button>
          </div>
        </Block>
      </div>
    </Drawer>
  );
}
