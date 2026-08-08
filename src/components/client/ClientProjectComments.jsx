"use client";

// Project-level conversation. Distinct from Support, which is org-level: this
// thread is scoped to one project so a question about a deliverable stays next
// to the work it is about. Staff may post internally on the same thread; those
// rows never reach this component (RLS in migration 032), which is why nothing
// here filters on an `internal` flag — a client simply cannot receive one.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessagesSquare, Paperclip, Send, X, Download, Loader2 } from "lucide-react";
import { authFetch } from "@/utils/authFetch";
import { showError } from "@/utils/alerts";
import { uploadOrgFile } from "@/utils/orgFiles";
import { getOrgId } from "@/utils/orgContext";
import {
  Spinner,
  EmptyState,
  ErrorState,
  SectionHeader,
  LoadMoreButton,
  formatDateTime,
  formatRelativeTime,
  formatFileSize,
} from "./ClientShared";

const PAGE_SIZE = 20;

// The `org-files` bucket rejects anything larger (migration 020). Catching it
// here turns a silent storage failure into a sentence the user can act on.
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export default function ClientProjectComments({ projectId, showHeader = false, projectName }) {
  const [comments, setComments] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState("");

  const [body, setBody] = useState("");
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [composeError, setComposeError] = useState("");
  const fileInputRef = useRef(null);

  const fetchPage = useCallback(
    async (before) => {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      if (before) params.set("before", before);

      const res = await authFetch(`/api/client/projects/${projectId}/comments?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to load the conversation.");
      return {
        comments: Array.isArray(data.comments) ? data.comments : [],
        hasMore: Boolean(data.hasMore),
      };
    },
    [projectId]
  );

  const load = useCallback(async () => {
    if (!projectId) return;
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
  }, [projectId, fetchPage]);

  useEffect(() => {
    load();
  }, [load]);

  // Same keyset rule as the timeline: page on the oldest row on screen, never
  // on an offset that shifts every time someone posts.
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

  const handlePickFile = (event) => {
    const picked = event.target.files?.[0] || null;
    setComposeError("");
    if (picked && picked.size > MAX_ATTACHMENT_BYTES) {
      setComposeError("That file is larger than 25 MB. Please attach a smaller one.");
      event.target.value = "";
      return;
    }
    setFile(picked);
  };

  const clearFile = () => {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

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
      // The file goes to private storage first; only the resulting path travels
      // in the request. The response mints its own short-lived signed URL, so
      // there is nothing to optimistically render — the server owns that link.
      let attachment;
      if (file) {
        const orgId = getOrgId();
        if (!orgId) {
          setComposeError("Your session is missing an organization. Please sign in again to attach files.");
          return;
        }
        const path = await uploadOrgFile({
          orgId,
          category: "client-comments",
          subPath: String(projectId),
          file,
        });
        attachment = {
          path,
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
        };
      }

      const res = await authFetch(`/api/client/projects/${projectId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(attachment ? { body: text, attachment } : { body: text }),
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
      clearFile();
    } catch (err) {
      showError("Message not sent", err?.message || "Something went wrong. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const header = showHeader ? (
    <SectionHeader
      title="Conversation"
      subtitle={projectName ? `Talk to the team about ${projectName}` : "Talk to the team about this project"}
    />
  ) : null;

  return (
    <div className="space-y-5">
      {header}

      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-border bg-card p-4 shadow-card"
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a message to your team…"
          rows={3}
          className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
        />

        {file && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/50 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2 text-sm text-foreground">
              <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{file.name}</span>
              {formatFileSize(file.size) && (
                <span className="shrink-0 text-xs text-muted-foreground">{formatFileSize(file.size)}</span>
              )}
            </div>
            <button
              type="button"
              onClick={clearFile}
              aria-label="Remove attachment"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {composeError && <p className="mt-3 text-sm text-destructive">{composeError}</p>}

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <label className="inline-flex cursor-pointer items-center self-start rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">
            <Paperclip className="mr-1.5 h-4 w-4" />
            Attach file
            <input ref={fileInputRef} type="file" onChange={handlePickFile} className="sr-only" />
          </label>

          <button
            type="submit"
            disabled={sending || !body.trim()}
            className="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {sending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </form>

      {loading ? (
        <Spinner label="Loading conversation…" />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : comments.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title="No messages yet"
          message="Ask a question or share feedback — your team will see it against this project."
        />
      ) : (
        <div className="space-y-3">
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

function CommentRow({ comment }) {
  const fromClient = comment.author_type === "client";
  const initial = String(comment.author_name || "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <article
      className={`rounded-xl border p-4 shadow-card ${
        fromClient ? "border-primary/30 bg-primary/5" : "border-border bg-card"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
            fromClient ? "bg-primary text-primary-foreground" : "bg-info/10 text-info"
          }`}
          aria-hidden="true"
        >
          {initial}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-foreground">{comment.author_name}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  fromClient ? "bg-primary/10 text-primary" : "bg-info/10 text-info"
                }`}
              >
                {fromClient ? "Client" : "Team"}
              </span>
            </div>
            <span
              className="whitespace-nowrap text-xs text-muted-foreground"
              title={formatDateTime(comment.created_at)}
            >
              {formatRelativeTime(comment.created_at)}
            </span>
          </div>

          <p className="mt-2 whitespace-pre-line break-words text-sm text-foreground">{comment.body}</p>

          {comment.attachment_name && (
            <div className="mt-3">
              {comment.attachment_url ? (
                <a
                  href={comment.attachment_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex max-w-full items-center rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-muted"
                >
                  <Download className="mr-1.5 h-4 w-4 shrink-0" />
                  <span className="truncate">{comment.attachment_name}</span>
                </a>
              ) : (
                // A signed URL is minted per response and expires; an old row
                // read from state can legitimately have the name without a link.
                <span className="inline-flex items-center rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
                  <Paperclip className="mr-1.5 h-4 w-4 shrink-0" />
                  <span className="truncate">{comment.attachment_name}</span>
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
