"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  X,
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
  PRIORITIES,
} from "@/utils/pmData";
import { getOrgContext, isMembershipActive } from "@/utils/orgContext";
import { hasRole } from "@/utils/permissions";
import { showError, showSuccess } from "@/utils/alerts";
import TaskExtras from "@/components/admin/TaskExtras";
import TaskTimer from "@/components/admin/TaskTimer";

// ---- constants & small helpers --------------------------------------
const DEPENDENCY_TYPES = ["blocks", "blocked_by", "relates_to"];

// "in_progress" -> "In Progress"
const pretty = (s) =>
  String(s || "")
    .split("_")
    .map((w) => (w && w[0] ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");

const priorityChipClass = (p) => {
  switch (String(p || "").toLowerCase()) {
    case "urgent":
      return "bg-destructive/10 text-destructive";
    case "high":
      return "bg-warning/10 text-warning";
    case "medium":
      return "bg-info/10 text-info";
    case "low":
    default:
      return "bg-muted text-muted-foreground";
  }
};

// What the client has said about this task, kept strictly apart from `status`:
// this is their verdict on the work, not a position in the team's pipeline, and
// nothing here ever writes to `status`.
const CLIENT_APPROVAL_META = {
  pending: {
    label: "Awaiting client",
    chip: "bg-info/10 text-info",
    icon: Clock,
  },
  approved: {
    label: "Client approved",
    chip: "bg-success/10 text-success",
    icon: CheckCircle2,
  },
  changes_requested: {
    label: "Client requested changes",
    chip: "bg-warning/10 text-warning",
    icon: AlertTriangle,
  },
  rejected: {
    label: "Client rejected",
    chip: "bg-destructive/10 text-destructive",
    icon: XCircle,
  },
};

const INPUT_CLASS =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30";
const LABEL_CLASS = "mb-1 block text-xs font-medium text-foreground";
const HEADING_CLASS = "text-sm font-semibold text-foreground";
const CARD_CLASS = "rounded-xl border border-border bg-card p-4";
const PRIMARY_BTN_CLASS =
  "inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60";

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
  const handleUpload = async (e) => {
    const file = e?.target?.files?.[0];
    if (!file || !taskId) return;
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

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="fixed inset-y-0 right-0 z-50 w-full max-w-xl overflow-y-auto border-l border-border bg-background p-5 shadow-elevated"
        role="dialog"
        aria-modal="true"
        aria-label="Task detail"
      >
        {/* 1. Header --------------------------------------------------- */}
        <div className={`${CARD_CLASS} mb-4`}>
          <div className="flex items-start gap-3">
            <input
              className={`${INPUT_CLASS} text-base font-semibold`}
              defaultValue={form?.task_title || ""}
              key={`title-${taskId}`}
              placeholder="Task title"
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== (form?.task_title || "")) {
                  saveField("task_title", v);
                }
              }}
            />
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg border border-border p-2 text-muted-foreground hover:bg-muted"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLASS}>Status</label>
              <select
                className={INPUT_CLASS}
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
              <p className="mt-1 text-[11px] text-muted-foreground">
                Completed and Rejected are decided in Task Reviews.
              </p>
            </div>
            <div>
              <label className={LABEL_CLASS}>Priority</label>
              <div className="flex items-center gap-2">
                <select
                  className={INPUT_CLASS}
                  value={currentPriority}
                  onChange={(e) => saveField("priority", e.target.value)}
                >
                  {(PRIORITIES || []).map((p) => (
                    <option key={p} value={p}>
                      {pretty(p)}
                    </option>
                  ))}
                </select>
                <span
                  className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${priorityChipClass(
                    currentPriority
                  )}`}
                >
                  {pretty(currentPriority)}
                </span>
              </div>
            </div>
          </div>
          {savingField ? (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Saving…
            </div>
          ) : null}
        </div>

        {/* 1a. Client decision ----------------------------------------- */}
        {/* Sits directly under the header, above everything the team edits: the
            client's verdict is context for every decision taken below it, and
            the note behind "changes requested" is the one piece of this feature
            that has to be read before anyone moves the task on. It is shown, not
            editable - the client owns this answer, the team owns `status`. */}
        {clientApproval ? (
          <div
            className={`${CARD_CLASS} mb-4 ${
              clientWantsChanges ? "border-warning/40" : ""
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className={`${HEADING_CLASS} flex items-center gap-2`}>
                Client decision
              </h3>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ${clientApproval.chip}`}
              >
                {ClientApprovalIcon ? (
                  <ClientApprovalIcon className="h-3.5 w-3.5" aria-hidden="true" />
                ) : null}
                {clientApproval.label}
              </span>
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
              team&apos;s workflow. The Status above is still yours to set.
            </p>
          </div>
        ) : null}

        {/* 2. Meta grid ----------------------------------------------- */}
        <div className={`${CARD_CLASS} mb-4`}>
          <h3 className={`${HEADING_CLASS} mb-3`}>Details</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={LABEL_CLASS}>Assignee</label>
              <select
                className={INPUT_CLASS}
                value={form?.developer_id ?? ""}
                onChange={(e) =>
                  handleAssign(e.target.value || null)
                }
              >
                <option value="">Unassigned</option>
                {assignableMembers.map((m) => (
                  <option key={String(m.userId)} value={m.userId}>
                    {m.name}
                    {m.role ? ` (${pretty(m.role)})` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={LABEL_CLASS}>Story points</label>
              <input
                type="number"
                className={INPUT_CLASS}
                value={form?.story_points ?? ""}
                onChange={(e) => onLocalChange("story_points", e.target.value)}
                onBlur={(e) =>
                  saveField(
                    "story_points",
                    e.target.value === "" ? null : Number(e.target.value)
                  )
                }
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>Estimated hours</label>
              <input
                type="number"
                className={INPUT_CLASS}
                value={form?.estimated_hours ?? ""}
                onChange={(e) =>
                  onLocalChange("estimated_hours", e.target.value)
                }
                onBlur={(e) =>
                  saveField(
                    "estimated_hours",
                    e.target.value === "" ? null : Number(e.target.value)
                  )
                }
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>Actual hours</label>
              <input
                type="number"
                className={INPUT_CLASS}
                value={form?.actual_hours ?? ""}
                onChange={(e) => onLocalChange("actual_hours", e.target.value)}
                onBlur={(e) =>
                  saveField(
                    "actual_hours",
                    e.target.value === "" ? null : Number(e.target.value)
                  )
                }
              />
            </div>
            <div>
              <label className={LABEL_CLASS}>Due date</label>
              <input
                type="date"
                className={INPUT_CLASS}
                value={toDateInput(form?.due_date)}
                onChange={(e) =>
                  saveField("due_date", e.target.value || null)
                }
              />
            </div>

            <div>
              <label className={LABEL_CLASS}>Sprint</label>
              <select
                className={INPUT_CLASS}
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
            </div>
            <div>
              <label className={LABEL_CLASS}>Epic</label>
              <select
                className={INPUT_CLASS}
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
            </div>
          </div>
        </div>

        {/* 2a. Client visibility --------------------------------------- */}
        {canSetClientVisibility ? (
          <div className={`${CARD_CLASS} mb-4`}>
            <h3 className={`${HEADING_CLASS} mb-3 flex items-center gap-2`}>
              {clientVisible ? (
                <Eye className="h-4 w-4 text-primary" />
              ) : (
                <EyeOff className="h-4 w-4 text-primary" />
              )}
              Client visibility
            </h3>

            {clientVisibilityKnown ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-input accent-primary"
                      checked={clientVisible}
                      disabled={savingClientVisible}
                      onChange={(e) =>
                        saveField("client_visible", e.target.checked)
                      }
                    />
                    Visible to client
                  </label>
                  {/* The state is spelled out next to the box as well, because a
                      lone unchecked box reads as "nothing here" rather than as a
                      deliberate "this one is ours". */}
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium ${
                      clientVisible
                        ? "bg-success/10 text-success"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {savingClientVisible ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : null}
                    {clientVisible ? "In the client portal" : "Internal only"}
                  </span>
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
          </div>
        ) : null}

        {/* 3. Description --------------------------------------------- */}
        <div className={`${CARD_CLASS} mb-4`}>
          <h3 className={`${HEADING_CLASS} mb-3`}>Description</h3>
          <textarea
            className={`${INPUT_CLASS} min-h-[120px] resize-y`}
            value={form?.task_description ?? ""}
            placeholder="Add a description…"
            onChange={(e) => onLocalChange("task_description", e.target.value)}
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              className={PRIMARY_BTN_CLASS}
              disabled={savingField === "task_description"}
              onClick={() =>
                saveField("task_description", form?.task_description ?? "")
              }
            >
              {savingField === "task_description" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save
            </button>
          </div>
        </div>

        {/* 3a. Time tracking ------------------------------------------ */}
        <div className={`${CARD_CLASS} mb-4`}>
          <TaskTimer
            task={task}
            projectId={task?.project_id}
            members={members}
            onChanged={onChanged}
          />
        </div>

        {/* 3b. Advanced fields (type, labels, recurring, custom fields, history) */}
        <div className={`${CARD_CLASS} mb-4`}>
          <TaskExtras
            task={task}
            projectId={task?.project_id}
            members={members}
            onChanged={onChanged}
          />
        </div>

        {/* 4. Subtasks ------------------------------------------------ */}
        <div className={`${CARD_CLASS} mb-4`}>
          <h3 className={`${HEADING_CLASS} mb-3 flex items-center gap-2`}>
            <ListChecks className="h-4 w-4 text-primary" /> Subtasks
            <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {subtasks.length}
            </span>
          </h3>
          <ul className="space-y-2">
            {subtasks.map((st) => (
              <li
                key={String(st.id)}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
              >
                <span className="truncate text-foreground">
                  {st.task_title || "Untitled"}
                </span>
                <span className="ml-2 shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {pretty(st.status)}
                </span>
              </li>
            ))}
            {subtasks.length === 0 ? (
              <li className="text-xs text-muted-foreground">No subtasks yet.</li>
            ) : null}
          </ul>
          <div className="mt-3 flex items-center gap-2">
            <input
              className={INPUT_CLASS}
              placeholder="Add subtask…"
              value={subtaskTitle}
              onChange={(e) => setSubtaskTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddSubtask();
                }
              }}
            />
            <button
              type="button"
              className={PRIMARY_BTN_CLASS}
              onClick={handleAddSubtask}
              disabled={!subtaskTitle.trim()}
            >
              <Plus className="h-4 w-4" /> Add
            </button>
          </div>
        </div>

        {/* 5. Checklist ----------------------------------------------- */}
        <div className={`${CARD_CLASS} mb-4`}>
          <h3 className={`${HEADING_CLASS} mb-3 flex items-center gap-2`}>
            <Check className="h-4 w-4 text-primary" /> Checklist
            <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {checklistDone}/{checklistItems.length}
            </span>
          </h3>
          <ul className="space-y-2">
            {checklistItems.map((item) => (
              <li key={String(item.id)} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input accent-primary"
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
              <li className="text-xs text-muted-foreground">No items yet.</li>
            ) : null}
          </ul>
          <div className="mt-3 flex items-center gap-2">
            <input
              className={INPUT_CLASS}
              placeholder="Add checklist item…"
              value={checklistText}
              onChange={(e) => setChecklistText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddChecklist();
                }
              }}
            />
            <button
              type="button"
              className={PRIMARY_BTN_CLASS}
              onClick={handleAddChecklist}
              disabled={!checklistText.trim()}
            >
              <Plus className="h-4 w-4" /> Add
            </button>
          </div>
        </div>

        {/* 6. Dependencies -------------------------------------------- */}
        <div className={`${CARD_CLASS} mb-4`}>
          <h3 className={`${HEADING_CLASS} mb-3 flex items-center gap-2`}>
            <GitBranch className="h-4 w-4 text-primary" /> Dependencies
          </h3>
          <ul className="space-y-2">
            {(detail.dependencies || []).map((dep) => (
              <li
                key={String(dep.id ?? dep.depends_on_task_id)}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
              >
                <span className="truncate text-foreground">
                  {titleForTask(dep.depends_on_task_id)}
                </span>
                <span className="ml-2 shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  {pretty(dep.type)}
                </span>
              </li>
            ))}
            {(detail.dependencies || []).length === 0 ? (
              <li className="text-xs text-muted-foreground">
                No dependencies.
              </li>
            ) : null}
          </ul>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <select
              className={INPUT_CLASS}
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
              className={INPUT_CLASS}
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
            <button
              type="button"
              className={PRIMARY_BTN_CLASS}
              onClick={handleAddDependency}
              disabled={!depTaskId}
            >
              <Plus className="h-4 w-4" /> Add dependency
            </button>
          </div>
        </div>

        {/* 7. Watchers / Reviewers ------------------------------------ */}
        <div className={`${CARD_CLASS} mb-4`}>
          <h3 className={`${HEADING_CLASS} mb-3 flex items-center gap-2`}>
            <Eye className="h-4 w-4 text-primary" /> Watchers &amp; Reviewers
          </h3>
          <div className="flex flex-wrap gap-2">
            {(detail.watchers || []).map((w) => (
              <span
                key={`${w.user_id}-${w.role || "watcher"}`}
                className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary"
              >
                {nameForUser(w.user_id)}
                <span className="text-primary/70">· {pretty(w.role || "watcher")}</span>
              </span>
            ))}
            {(detail.watchers || []).length === 0 ? (
              <span className="text-xs text-muted-foreground">
                No watchers yet.
              </span>
            ) : null}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              className={
                isWatching
                  ? "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                  : PRIMARY_BTN_CLASS
              }
              onClick={handleToggleWatch}
            >
              <Eye className="h-4 w-4" />
              {isWatching ? "Unwatch" : "Watch"}
            </button>
          </div>

          {reviewerMembers.length > 0 ? (
            <div className="mt-3 flex items-center gap-2">
              <select
                className={INPUT_CLASS}
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
              <button
                type="button"
                className={PRIMARY_BTN_CLASS}
                onClick={handleAddReviewer}
                disabled={!reviewerId}
              >
                <Plus className="h-4 w-4" /> Add
              </button>
            </div>
          ) : null}
        </div>

        {/* 8. Attachments --------------------------------------------- */}
        <div className={`${CARD_CLASS} mb-4`}>
          <h3 className={`${HEADING_CLASS} mb-3 flex items-center gap-2`}>
            <Paperclip className="h-4 w-4 text-primary" /> Attachments
          </h3>
          <ul className="space-y-2">
            {(detail.attachments || []).map((a) => (
              <li
                key={String(a.id ?? a.file_path)}
                className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-foreground">
                  {a.file_name || "File"}
                </span>
              </li>
            ))}
            {(detail.attachments || []).length === 0 ? (
              <li className="text-xs text-muted-foreground">
                No attachments.
              </li>
            ) : null}
          </ul>
          <div className="mt-3">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted">
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Paperclip className="h-4 w-4" />
              )}
              {uploading ? "Uploading…" : "Upload file"}
              <input
                type="file"
                className="hidden"
                onChange={handleUpload}
                disabled={uploading}
              />
            </label>
          </div>
        </div>

        {/* 9. Comments ------------------------------------------------ */}
        <div className={CARD_CLASS}>
          <h3 className={`${HEADING_CLASS} mb-3 flex items-center gap-2`}>
            <MessageSquare className="h-4 w-4 text-primary" /> Comments
            <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {(detail.comments || []).length}
            </span>
          </h3>

          <ul className="space-y-3">
            {loadingDetail ? (
              <li className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading…
              </li>
            ) : null}
            {(detail.comments || []).map((c) => (
              <li
                key={String(c.id ?? `${c.author_id}-${c.created_at}`)}
                className="rounded-lg border border-border px-3 py-2"
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">
                    {commentAuthorName(c)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {fmtDate(c.created_at)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-foreground">
                  {c.body || ""}
                </p>
              </li>
            ))}
            {!loadingDetail && (detail.comments || []).length === 0 ? (
              <li className="text-xs text-muted-foreground">
                No comments yet.
              </li>
            ) : null}
          </ul>

          {/* composer with @mention dropdown */}
          <div className="relative mt-3">
            <textarea
              ref={commentRef}
              className={`${INPUT_CLASS} min-h-[80px] resize-y`}
              placeholder="Write a comment… use @ to mention"
              value={commentBody}
              onChange={onCommentInput}
              onKeyDown={(e) => {
                if (e.key === "Escape") setMentionOpen(false);
              }}
            />
            {mentionOpen && mentionMatches.length > 0 ? (
              <div className="absolute left-0 right-0 z-10 mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-card shadow-elevated">
                {mentionMatches.map((m) => (
                  <button
                    key={String(m.userId)}
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
                    onClick={() => insertMention(m)}
                  >
                    <span className="font-medium">{m.name}</span>
                    {m.email ? (
                      <span className="text-xs text-muted-foreground">
                        {m.email}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              className={PRIMARY_BTN_CLASS}
              onClick={handleSubmitComment}
              disabled={submittingComment || !commentBody.trim()}
            >
              {submittingComment ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MessageSquare className="h-4 w-4" />
              )}
              Comment
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
