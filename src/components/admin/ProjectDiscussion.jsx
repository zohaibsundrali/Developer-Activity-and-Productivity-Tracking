"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { MessagesSquare, Send, Lock } from "lucide-react";
import { loadProjectDiscussion, postProjectDiscussion } from "@/utils/pmData";
import { getOrgContext } from "@/utils/orgContext";
import { showError } from "@/utils/alerts";
import { Button, EmptyState, Skeleton } from "@/components/ui";

/**
 * The internal thread for one project.
 *
 * This is where the founder and the project manager talk, and where the
 * manager talks to the team, about a project — separately from anything the
 * client sees. It writes `project_comments` with `internal = true`; the client
 * portal reads the same table with `internal = false`, and the two threads
 * never meet.
 *
 * The lock line at the top is not decoration. Somebody typing here is deciding,
 * in that moment, whether a sentence about a slipping deadline is safe to
 * write — and the honest answer depends on who can read it. Saying so on the
 * screen is cheaper than any amount of documentation nobody opens.
 */

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

function whenLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (sameDay) return time;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${time}`;
}

export default function ProjectDiscussion({ projectId, pollIntervalMs = 20000 }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);
  const me = getOrgContext();

  const load = useCallback(
    async ({ quiet = false } = {}) => {
      if (!projectId) return;
      if (!quiet) setLoading(true);
      try {
        setMessages(await loadProjectDiscussion(projectId));
        setError(null);
      } catch (e) {
        setError(e?.message || "Could not load the discussion.");
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Quiet polling: a refresh must not blank the thread somebody is reading,
  // so the interval reload does not touch `loading`.
  useEffect(() => {
    if (!projectId || !pollIntervalMs) return;
    const t = setInterval(() => load({ quiet: true }), pollIntervalMs);
    return () => clearInterval(t);
  }, [projectId, pollIntervalMs, load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const send = async (e) => {
    e?.preventDefault?.();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const { comment, error: err } = await postProjectDiscussion(projectId, text);
      if (err) throw err;
      // Append locally rather than refetching: the poll will reconcile, and a
      // round trip before the message appears makes the box feel broken.
      if (comment) setMessages((prev) => [...prev, comment]);
      setDraft("");
    } catch (err) {
      showError("Message not sent", err?.message || "Please try again.");
    } finally {
      setSending(false);
    }
  };

  // Enter sends, Shift+Enter is a newline — the convention every chat uses.
  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Lock aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        Internal to your team — the client cannot see this thread.
      </p>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {loading ? (
          <div className="space-y-3" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-3 w-full max-w-md" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/[0.06] p-3 text-sm text-foreground">
            {error}{" "}
            <button type="button" onClick={() => load()} className="underline underline-offset-2">
              Try again
            </button>
          </div>
        ) : messages.length === 0 ? (
          <EmptyState
            icon={MessagesSquare}
            title="No discussion yet"
            description="Ask the project manager for an update, or leave a note for whoever picks this up next."
          />
        ) : (
          messages.map((m) => {
            const mine = me?.userId && m.author_id === me.userId;
            return (
              <div key={m.id} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
                >
                  {initials(m.author_name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium text-foreground">
                      {m.author_name || "A team member"}
                      {mine ? <span className="text-muted-foreground"> (you)</span> : null}
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {whenLabel(m.created_at)}
                    </span>
                  </p>
                  {/* whitespace-pre-wrap so a multi-line message keeps its
                      shape; break-words so a pasted URL cannot widen the panel
                      and push the rest of the page sideways. */}
                  <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                    {m.body}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={send} className="mt-3 flex items-end gap-2 border-t border-border pt-3">
        <label htmlFor="project-discussion-input" className="sr-only">
          Message
        </label>
        <textarea
          id="project-discussion-input"
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={5000}
          placeholder="Write a message…  (Enter to send, Shift+Enter for a new line)"
          className="min-h-[44px] flex-1 resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <Button type="submit" disabled={!draft.trim() || sending} className="shrink-0">
          <Send aria-hidden="true" className="h-4 w-4" />
          <span className="sr-only sm:not-sr-only sm:ml-1.5">
            {sending ? "Sending…" : "Send"}
          </span>
        </Button>
      </form>
    </div>
  );
}
