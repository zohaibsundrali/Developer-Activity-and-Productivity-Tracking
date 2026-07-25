"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { LifeBuoy, Plus, ArrowLeft, Send, MessagesSquare } from "lucide-react";
import { authFetch } from "@/utils/authFetch";
import { showError } from "@/utils/alerts";
import {
  Spinner,
  EmptyState,
  ErrorState,
  StatusBadge,
  SectionHeader,
  formatDateTime,
} from "./ClientShared";

export default function ClientSupport({ user }) {
  const [view, setView] = useState("list"); // "list" | "thread" | "new"
  const [activeThreadId, setActiveThreadId] = useState(null);

  const openThread = (id) => {
    setActiveThreadId(id);
    setView("thread");
  };

  if (view === "thread" && activeThreadId) {
    return (
      <SupportThread
        threadId={activeThreadId}
        user={user}
        onBack={() => {
          setView("list");
          setActiveThreadId(null);
        }}
      />
    );
  }

  if (view === "new") {
    return (
      <SupportNewRequest
        onCancel={() => setView("list")}
        onCreated={(id) => {
          if (id) openThread(id);
          else setView("list");
        }}
      />
    );
  }

  return <SupportList onOpen={openThread} onNew={() => setView("new")} />;
}

// ---------- Thread list ----------

function SupportList({ onOpen, onNew }) {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const res = await authFetch("/api/client/support");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Failed to load support requests.");
        return;
      }
      setThreads(Array.isArray(data.threads) ? data.threads : Array.isArray(data) ? data : []);
    } catch {
      setError("Something went wrong while loading your requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Support"
        subtitle="Message your agency and track your requests"
        right={
          <button
            onClick={onNew}
            className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            New request
          </button>
        }
      />

      {loading ? (
        <Spinner label="Loading requests…" />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : threads.length === 0 ? (
        <EmptyState
          icon={LifeBuoy}
          title="No support requests yet"
          message="Start a conversation with your agency and it will appear here."
          action={
            <button
              onClick={onNew}
              className="inline-flex items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="mr-1.5 h-4 w-4" />
              New request
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {threads.map((t) => (
            <button
              key={t.id}
              onClick={() => onOpen(t.id)}
              className="flex w-full items-start justify-between gap-4 rounded-xl border border-border bg-card p-4 text-left shadow-card transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <MessagesSquare className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-foreground">{t.subject || "Support request"}</p>
                  {(t.last_message || t.preview) && (
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">{t.last_message || t.preview}</p>
                  )}
                  {t.project_name && (
                    <p className="mt-1 text-xs font-medium text-primary">{t.project_name}</p>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                {t.status && <StatusBadge status={t.status} />}
                <span className="whitespace-nowrap text-xs text-muted-foreground">
                  {formatDateTime(t.updated_at || t.last_message_at || t.created_at)}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Thread / chat view ----------

function isFromClient(message) {
  const sender = String(message.sender || message.sender_type || message.author_role || message.author || "").toLowerCase();
  if (sender) return sender.includes("client");
  // Fallback flags
  if (typeof message.is_client === "boolean") return message.is_client;
  if (typeof message.from_client === "boolean") return message.from_client;
  return false;
}

function SupportThread({ threadId, user, onBack }) {
  const [thread, setThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const res = await authFetch(`/api/client/support/${threadId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Failed to load this conversation.");
        return;
      }
      setThread(data.thread || data);
      setMessages(Array.isArray(data.messages) ? data.messages : []);
    } catch {
      setError("Something went wrong while loading this conversation.");
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    const text = body.trim();
    if (!text || sending) return;

    setSending(true);
    // Optimistic message
    const optimistic = {
      id: `temp-${Date.now()}`,
      body: text,
      sender: "client",
      created_at: new Date().toISOString(),
      _optimistic: true,
    };
    setMessages((m) => [...m, optimistic]);
    setBody("");

    try {
      const res = await authFetch(`/api/client/support/${threadId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessages((m) => m.filter((x) => x.id !== optimistic.id));
        showError("Message not sent", payload?.error || "Please try again.");
        return;
      }
      // Prefer server truth if returned; otherwise reload.
      if (payload?.message) {
        setMessages((m) => m.map((x) => (x.id === optimistic.id ? payload.message : x)));
      } else if (Array.isArray(payload?.messages)) {
        setMessages(payload.messages);
      } else {
        load();
      }
    } catch {
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      showError("Message not sent", "Something went wrong. Please try again.");
    } finally {
      setSending(false);
    }
  };

  if (loading) return <Spinner label="Loading conversation…" />;
  if (error) {
    return (
      <div className="space-y-4">
        <BackBtn onBack={onBack} />
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }

  const subject = thread?.subject || "Support request";

  return (
    <div className="space-y-4">
      <BackBtn onBack={onBack} />

      <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <div className="flex items-center justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold text-foreground">{subject}</h2>
            {thread?.project_name && <p className="text-xs font-medium text-primary">{thread.project_name}</p>}
          </div>
          {thread?.status && <StatusBadge status={thread.status} />}
        </div>

        {/* Messages */}
        <div className="flex max-h-[55vh] min-h-[280px] flex-col gap-3 overflow-y-auto bg-muted/30 p-4">
          {messages.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              No messages yet. Say hello!
            </div>
          ) : (
            messages.map((m) => {
              const mine = isFromClient(m);
              return (
                <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                      mine
                        ? "rounded-br-sm bg-primary text-primary-foreground"
                        : "rounded-bl-sm border border-border bg-card text-foreground"
                    }`}
                  >
                    {!mine && (m.sender_name || m.author_name) && (
                      <p className="mb-0.5 text-xs font-semibold opacity-80">{m.sender_name || m.author_name}</p>
                    )}
                    <p className="whitespace-pre-line break-words">{m.body || m.message}</p>
                    <p className={`mt-1 text-[11px] ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                      {formatDateTime(m.created_at || m.sent_at)}
                    </p>
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {/* Composer */}
        <form onSubmit={handleSend} className="flex items-end gap-2 border-t border-border p-3">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                handleSend(e);
              }
            }}
            placeholder="Type your message…"
            rows={1}
            className="min-h-[44px] max-h-32 flex-1 resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
          />
          <button
            type="submit"
            disabled={sending || !body.trim()}
            className="inline-flex h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            <Send className="mr-1.5 h-4 w-4" />
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

// ---------- New request ----------

function SupportNewRequest({ onCancel, onCreated }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [projectId, setProjectId] = useState("");
  const [projects, setProjects] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState("");

  // Load linked projects to offer an optional association.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await authFetch("/api/client/projects");
        const data = await res.json().catch(() => ({}));
        if (active && res.ok) setProjects(Array.isArray(data.projects) ? data.projects : []);
      } catch {
        // non-blocking
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFieldError("");
    if (!subject.trim() || !body.trim()) {
      setFieldError("Please add a subject and a message.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await authFetch("/api/client/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subject.trim(),
          body: body.trim(),
          projectId: projectId || undefined,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError("Could not create request", payload?.error || "Please try again.");
        return;
      }
      const newId = payload?.thread?.id || payload?.id || payload?.threadId || null;
      onCreated?.(newId);
    } catch {
      showError("Could not create request", "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <BackBtn onBack={onCancel} label="Back to Support" />

      <div className="rounded-xl border border-border bg-card p-6 shadow-card">
        <h2 className="text-lg font-bold text-foreground">New support request</h2>
        <p className="mt-1 text-sm text-muted-foreground">Tell us what you need help with.</p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief summary"
              className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {projects.length > 0 && (
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">
                Related project <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
              >
                <option value="">None</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Message</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Describe your request…"
              rows={5}
              className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {fieldError && <p className="text-sm text-destructive">{fieldError}</p>}

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {submitting ? "Sending…" : "Submit request"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="inline-flex items-center rounded-lg border border-border bg-background px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function BackBtn({ onBack, label = "Back to Support" }) {
  return (
    <button
      onClick={onBack}
      className="inline-flex items-center rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-card transition-all hover:bg-muted"
    >
      <ArrowLeft className="mr-2 h-4 w-4" />
      {label}
    </button>
  );
}
