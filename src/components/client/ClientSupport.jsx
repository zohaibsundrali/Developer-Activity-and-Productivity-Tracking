"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { LifeBuoy, Plus, ArrowLeft, Send, MessagesSquare } from "lucide-react";
import { authFetch } from "@/utils/authFetch";
import { showError } from "@/utils/alerts";
import { Button, Field, Input } from "@/components/ui";
import {
  ClientPage,
  Panel,
  EmptyState,
  ErrorState,
  StatusBadge,
  RowsSkeleton,
  surface,
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
    <ClientPage
      title="Support"
      description="Message your agency and track your requests"
      actions={
        <Button size="lg" onClick={onNew}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          New request
        </Button>
      }
    >
      {loading ? (
        <RowsSkeleton count={3} />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : threads.length === 0 ? (
        <EmptyState
          icon={LifeBuoy}
          title="No support requests yet"
          message="Start a conversation with your agency and it will appear here."
          action={
            <Button size="lg" onClick={onNew}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              New request
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {threads.map((t) => (
            <button
              key={t.id}
              onClick={() => onOpen(t.id)}
              className={`${surface} flex w-full items-start justify-between gap-5 p-6 text-left transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
            >
              <div className="flex min-w-0 items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <MessagesSquare className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-[15px] font-semibold text-foreground">
                    {t.subject || "Support request"}
                  </p>
                  {(t.last_message || t.preview) && (
                    <p className="truncate text-[15px] text-muted-foreground">{t.last_message || t.preview}</p>
                  )}
                  {t.project_name && <p className="text-sm font-medium text-primary">{t.project_name}</p>}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                {t.status && <StatusBadge status={t.status} />}
                <span className="whitespace-nowrap text-sm text-muted-foreground">
                  {formatDateTime(t.updated_at || t.last_message_at || t.created_at)}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </ClientPage>
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

  if (loading) {
    return (
      <ClientPage>
        <BackBtn onBack={onBack} />
        <RowsSkeleton count={3} />
      </ClientPage>
    );
  }

  if (error) {
    return (
      <ClientPage>
        <BackBtn onBack={onBack} />
        <ErrorState message={error} onRetry={load} />
      </ClientPage>
    );
  }

  const subject = thread?.subject || "Support request";

  return (
    <ClientPage>
      <BackBtn onBack={onBack} />

      <div className={`${surface} flex flex-col overflow-hidden`}>
        <div className="flex items-center justify-between gap-4 border-b border-border p-6">
          <div className="min-w-0 space-y-1">
            <h2 className="truncate text-xl font-semibold tracking-tight text-foreground">{subject}</h2>
            {thread?.project_name && (
              <p className="text-sm font-medium text-primary">{thread.project_name}</p>
            )}
          </div>
          {thread?.status && <StatusBadge status={thread.status} />}
        </div>

        {/* Messages */}
        <div className="flex max-h-[55vh] min-h-[280px] flex-col gap-4 overflow-y-auto bg-muted/30 p-6">
          {messages.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-[15px] text-muted-foreground">
              No messages yet. Say hello!
            </div>
          ) : (
            messages.map((m) => {
              const mine = isFromClient(m);
              return (
                <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[80%] space-y-2 rounded-2xl px-5 py-3.5 text-[15px] leading-relaxed shadow-card ${
                      mine
                        ? "rounded-br-sm bg-primary text-primary-foreground"
                        : "rounded-bl-sm border border-border bg-card text-foreground"
                    }`}
                  >
                    {!mine && (m.sender_name || m.author_name) && (
                      <p className="text-sm font-semibold opacity-80">{m.sender_name || m.author_name}</p>
                    )}
                    <p className="whitespace-pre-line break-words">{m.body || m.message}</p>
                    <p className={`text-xs ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
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
        <form onSubmit={handleSend} className="flex items-end gap-3 border-t border-border p-4">
          <label htmlFor={`support-reply-${threadId}`} className="sr-only">
            Type your message
          </label>
          <textarea
            id={`support-reply-${threadId}`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                handleSend(e);
              }
            }}
            placeholder="Type your message…"
            rows={1}
            className="max-h-32 min-h-[44px] flex-1 resize-y rounded-lg border border-input bg-background px-3.5 py-3 text-[15px] leading-relaxed text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
          <Button type="submit" size="lg" disabled={sending || !body.trim()}>
            <Send className="h-4 w-4" aria-hidden="true" />
            Send
          </Button>
        </form>
      </div>
    </ClientPage>
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
    <ClientPage>
      <BackBtn onBack={onCancel} label="Back to Support" />

      <Panel className="space-y-6">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">New support request</h2>
          <p className="text-[15px] text-muted-foreground">Tell us what you need help with.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <Field label="Subject" htmlFor="support-subject">
            <Input
              id="support-subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief summary"
            />
          </Field>

          {projects.length > 0 && (
            <Field label="Related project" htmlFor="support-project" hint="Optional.">
              <select
                id="support-project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-[15px] text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="">None</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="Message" htmlFor="support-body">
            <textarea
              id="support-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Describe your request…"
              rows={6}
              className="w-full resize-y rounded-lg border border-input bg-background px-3.5 py-3 text-[15px] leading-relaxed text-foreground transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </Field>

          {fieldError && (
            <p className="text-sm text-destructive" role="alert">
              {fieldError}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <Button type="submit" size="lg" disabled={submitting}>
              {submitting ? "Sending…" : "Submit request"}
            </Button>
            <Button type="button" variant="outline" size="lg" onClick={onCancel} disabled={submitting}>
              Cancel
            </Button>
          </div>
        </form>
      </Panel>
    </ClientPage>
  );
}

function BackBtn({ onBack, label = "Back to Support" }) {
  return (
    <Button variant="outline" size="lg" onClick={onBack}>
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {label}
    </Button>
  );
}
