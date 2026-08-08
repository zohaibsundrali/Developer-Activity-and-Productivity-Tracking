"use client";

// One task, opened from the project's task list.
//
// The list answers "what is being worked on"; this screen answers "what is the
// state of this specific piece of work, and can we talk about it here". The
// thread below is the task's own conversation, not the project's: a question
// about one deliverable stays attached to the deliverable rather than being
// filed into a single project-wide stream nobody can search afterwards.
//
// Staff may post internally on this same thread (migration 033). Those rows
// never reach this component — RLS refuses them and the route filters them —
// which is why nothing here looks at an `internal` flag.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Paperclip,
  Download,
  MessagesSquare,
  CalendarDays,
  Send,
  Loader2,
  FileText,
} from "lucide-react";
import { authFetch } from "@/utils/authFetch";
import { showError } from "@/utils/alerts";
import { Button } from "@/components/ui";
import {
  ClientPage,
  Panel,
  EmptyState,
  ErrorState,
  StatusBadge,
  LoadMoreButton,
  ConversationSkeleton,
  DetailSkeleton,
  surface,
  kindMeta,
  formatDate,
  formatDateTime,
  formatRelativeTime,
  formatFileSize,
  humanize,
} from "./ClientShared";

const PAGE_SIZE = 20;

// Same tone table the project task list uses. Known words get a tone; anything
// else is shown verbatim in the neutral style rather than being guessed at.
const PRIORITY_TONES = {
  urgent: "bg-destructive/10 text-destructive",
  critical: "bg-destructive/10 text-destructive",
  highest: "bg-destructive/10 text-destructive",
  high: "bg-warning/10 text-warning",
  medium: "bg-info/10 text-info",
  normal: "bg-info/10 text-info",
  low: "bg-muted text-muted-foreground",
  lowest: "bg-muted text-muted-foreground",
};

const asArray = (value) => (Array.isArray(value) ? value : []);

const timeOf = (value) => {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
};

export default function ClientTaskDetail({ taskId, onBack }) {
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!taskId) return;
    try {
      setLoading(true);
      setError("");
      const res = await authFetch(`/api/client/tasks/${taskId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        // The route answers 404 both for a task that does not exist and for one
        // this client may not see, so the message must not imply either.
        setError(data?.error || "This task could not be loaded.");
        return;
      }
      setTask(data.task || null);
    } catch {
      setError("Something went wrong while loading this task.");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    load();
  }, [load]);

  const labels = useMemo(() => asArray(task?.labels), [task]);
  const attachments = useMemo(() => asArray(task?.attachments), [task]);

  // The route already merges and sorts the history newest-first; re-sorting
  // here keeps the screen right even if a future source arrives out of order.
  const activity = useMemo(
    () => [...asArray(task?.activity)].sort((a, b) => (timeOf(b.created_at) ?? 0) - (timeOf(a.created_at) ?? 0)),
    [task]
  );

  if (loading) return <DetailSkeleton />;

  if (error || !task) {
    return (
      <ClientPage width="wide">
        <BackButton onBack={onBack} />
        <ErrorState message={error || "This task could not be loaded."} onRetry={load} />
      </ClientPage>
    );
  }

  const priorityKey = String(task.priority || "").toLowerCase().trim();
  const approvalStatus = String(task.client_approval_status || "").toLowerCase().trim();

  return (
    <ClientPage width="wide">
      <BackButton onBack={onBack} />

      <div className={`${surface} overflow-hidden`}>
        <div className="border-b border-border bg-muted/50 p-6 sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <h2 className="min-w-0 break-words text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-3xl">
              {task.title}
            </h2>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <StatusBadge status={task.status} />
            </div>
          </div>
        </div>

        <div className="space-y-8 p-6 sm:p-8">
          {approvalStatus && (
            <ApprovalPanel status={task.client_approval_status} note={task.client_approval_note} />
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <InfoTile label="Due" value={task.due_date ? formatDate(task.due_date) : "Not set"} />
            <InfoTile label="Assigned to" value={task.assignee_name || "Unassigned"} />
            <InfoTile
              label="Priority"
              value={
                task.priority ? (
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-sm font-semibold ${
                      PRIORITY_TONES[priorityKey] || "bg-muted text-muted-foreground"
                    }`}
                  >
                    {humanize(task.priority)}
                  </span>
                ) : (
                  "Not set"
                )
              }
            />
          </div>

          {labels.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {labels.map((label) => (
                <span
                  key={label}
                  className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
                >
                  {label}
                </span>
              ))}
            </div>
          )}

          <section className="space-y-4">
            <h3 className="text-lg font-semibold tracking-tight text-foreground">Description</h3>
            {task.description ? (
              <div className="space-y-4 rounded-xl border border-border bg-muted/50 p-6 text-[15px] text-foreground">
                {String(task.description)
                  .split("\n")
                  .map((paragraph, index) => (
                    <p key={index} className="break-words leading-relaxed">
                      {paragraph}
                    </p>
                  ))}
              </div>
            ) : (
              <p className="rounded-xl border border-border bg-muted/50 p-6 text-[15px] text-muted-foreground">
                No description provided for this task.
              </p>
            )}
          </section>

          <section className="space-y-4">
            <h3 className="text-lg font-semibold tracking-tight text-foreground">Files</h3>
            <Attachments attachments={attachments} />
          </section>

          <section className="space-y-4">
            <h3 className="text-lg font-semibold tracking-tight text-foreground">History</h3>
            <Activity activity={activity} />
          </section>

          <section className="space-y-4">
            <h3 className="text-lg font-semibold tracking-tight text-foreground">Conversation</h3>
            <TaskComments taskId={taskId} />
          </section>
        </div>
      </div>
    </ClientPage>
  );
}

function BackButton({ onBack }) {
  return (
    <Button variant="outline" size="lg" onClick={onBack}>
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Back to Tasks
    </Button>
  );
}

function InfoTile({ label, value }) {
  return (
    <div className={`${surface} p-5`}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-2 break-words text-lg font-semibold text-foreground">{value}</div>
    </div>
  );
}

// The client's own decision on this task, echoed back. The note is shown only
// for changes_requested: that is the one outcome where the reason IS the
// decision, and the team's next move depends on reading it.
function ApprovalPanel({ status, note }) {
  const changesRequested = String(status || "").toLowerCase().trim() === "changes_requested";
  return (
    <div
      className={`rounded-xl border p-5 sm:p-6 ${
        changesRequested ? "border-warning/30 bg-warning/10" : "border-border bg-muted/50"
      }`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[15px] font-semibold text-foreground">Your decision</span>
        <StatusBadge status={status} />
      </div>
      {changesRequested && note && (
        <p className="mt-3 whitespace-pre-line break-words text-[15px] leading-relaxed text-foreground">{note}</p>
      )}
    </div>
  );
}

function Attachments({ attachments }) {
  if (attachments.length === 0) {
    return (
      <EmptyState
        icon={Paperclip}
        title="No files on this task"
        message="Files your team attaches to this task will appear here."
      />
    );
  }

  return (
    <ul className="space-y-4">
      {attachments.map((file) => {
        const size = formatFileSize(file.file_size);
        return (
          <li
            key={file.id}
            className={`${surface} flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between`}
          >
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FileText className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold text-foreground">{file.file_name}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  {file.file_type && <span>{file.file_type}</span>}
                  {size && <span>{size}</span>}
                </div>
              </div>
            </div>

            {file.url ? (
              <Button asChild size="lg" className="shrink-0">
                <a href={file.url} target="_blank" rel="noopener noreferrer">
                  <Download className="h-4 w-4" aria-hidden="true" />
                  Download
                </a>
              </Button>
            ) : (
              // The link is signed per response and expires; a file left on
              // screen long enough can legitimately have a name and no link.
              <span className="inline-flex shrink-0 items-center rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
                Link expired — reload
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Activity({ activity }) {
  if (activity.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="No history yet"
        message="Status changes and approvals on this task will appear here."
      />
    );
  }

  return (
    <ol className="relative space-y-5 border-l border-border pl-6 sm:pl-7">
      {activity.map((event) => {
        const meta = kindMeta(event.kind);
        const Icon = meta.icon;
        return (
          <li key={event.id} className="relative">
            <span
              className={`absolute -left-[36px] top-5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-card sm:-left-[40px] ${meta.tone}`}
            >
              <Icon className="h-3 w-3" aria-hidden="true" />
            </span>
            <Panel className="space-y-2">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <p className="min-w-0 break-words text-lg font-semibold leading-snug text-foreground">
                  {event.title}
                </p>
                <span
                  className="whitespace-nowrap text-sm text-muted-foreground"
                  title={formatDateTime(event.created_at)}
                >
                  {formatRelativeTime(event.created_at)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1 text-sm text-muted-foreground">
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${meta.tone}`}>{meta.label}</span>
                {event.actor_name && <span>{event.actor_name}</span>}
              </div>
            </Panel>
          </li>
        );
      })}
    </ol>
  );
}

// The task thread. Same contract shape and same keyset paging as the project
// conversation; no attachment control, because a task comment has nowhere to
// store one (task_comments carries no attachment columns) and offering a
// control that silently drops the file would be worse than not offering it.
function TaskComments({ taskId }) {
  const [comments, setComments] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState("");

  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [composeError, setComposeError] = useState("");

  const fetchPage = useCallback(
    async (before) => {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      if (before) params.set("before", before);

      const res = await authFetch(`/api/client/tasks/${taskId}/comments?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to load the conversation.");
      return {
        comments: Array.isArray(data.comments) ? data.comments : [],
        hasMore: Boolean(data.hasMore),
      };
    },
    [taskId]
  );

  const load = useCallback(async () => {
    if (!taskId) return;
    try {
      setLoading(true);
      setError("");
      setPageError("");
      const page = await fetchPage(null);
      setComments(page.comments);
      setHasMore(page.hasMore);
    } catch (err) {
      setError(err?.message || "Something went wrong while loading the conversation.");
    } finally {
      setLoading(false);
    }
  }, [taskId, fetchPage]);

  useEffect(() => {
    load();
  }, [load]);

  // Page on the oldest row on screen, never on an offset that shifts every time
  // someone posts.
  const cursor = useMemo(() => {
    if (comments.length === 0) return null;
    return comments[comments.length - 1]?.created_at || null;
  }, [comments]);

  const loadMore = useCallback(async () => {
    if (!cursor || pageLoading) return;
    try {
      setPageLoading(true);
      setPageError("");
      const page = await fetchPage(cursor);
      setComments((prev) => [...prev, ...page.comments]);
      setHasMore(page.hasMore);
    } catch (err) {
      setPageError(err?.message || "Could not load older messages.");
    } finally {
      setPageLoading(false);
    }
  }, [cursor, pageLoading, fetchPage]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (sending) return;

    const text = body.trim();
    if (!text) {
      setComposeError("Please write a message before sending.");
      return;
    }

    setSending(true);
    setComposeError("");
    try {
      const res = await authFetch(`/api/client/tasks/${taskId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setComposeError(data?.error || "Your message could not be posted. Please try again.");
        return;
      }

      if (data.comment) {
        setComments((prev) => [data.comment, ...prev]);
      } else {
        load();
      }
      setBody("");
    } catch (err) {
      showError("Message not sent", err?.message || "Something went wrong. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <Panel as="form" onSubmit={handleSubmit} className="space-y-4">
        <label htmlFor={`client-task-comment-${taskId}`} className="sr-only">
          Ask a question about this task
        </label>
        <textarea
          id={`client-task-comment-${taskId}`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Ask a question about this task…"
          rows={3}
          className="w-full resize-y rounded-lg border border-input bg-background px-3.5 py-3 text-[15px] leading-relaxed text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />

        {composeError && (
          <p className="text-sm text-destructive" role="alert">
            {composeError}
          </p>
        )}

        <div className="flex justify-end">
          <Button type="submit" size="lg" disabled={sending || !body.trim()}>
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            {sending ? "Sending…" : "Send"}
          </Button>
        </div>
      </Panel>

      {loading ? (
        <ConversationSkeleton count={2} />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : comments.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title="No messages yet"
          message="Ask a question or share feedback — your team will see it against this task."
        />
      ) : (
        <div className="space-y-5">
          {comments.map((comment) => (
            <CommentRow key={comment.id} comment={comment} />
          ))}

          {pageError && <ErrorState message={pageError} onRetry={loadMore} />}

          {hasMore && !pageError && (
            <LoadMoreButton onClick={loadMore} loading={pageLoading} label="Load older messages" />
          )}
        </div>
      )}
    </div>
  );
}

// Same reading order as the project conversation: who, then when, then what.
function CommentRow({ comment }) {
  const fromClient = comment.author_type === "client";
  const initial = String(comment.author_name || "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <article
      className={`rounded-xl border p-5 shadow-card sm:p-6 ${
        fromClient ? "border-primary/30 bg-primary/5" : "border-border bg-card"
      }`}
    >
      <div className="flex items-start gap-4">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
            fromClient ? "bg-primary text-primary-foreground" : "bg-info/10 text-info"
          }`}
          aria-hidden="true"
        >
          {initial}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="text-[15px] font-semibold text-foreground">{comment.author_name}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                fromClient ? "bg-primary/10 text-primary" : "bg-info/10 text-info"
              }`}
            >
              {fromClient ? "Client" : "Team"}
            </span>
          </div>

          <p className="mt-1 text-sm text-muted-foreground" title={formatDateTime(comment.created_at)}>
            {formatRelativeTime(comment.created_at)}
          </p>

          <p className="mt-4 whitespace-pre-line break-words text-[15px] leading-relaxed text-foreground">
            {comment.body}
          </p>
        </div>
      </div>
    </article>
  );
}
