"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Circle, Lock, Star, Undo2, AlertTriangle } from "lucide-react";

import { Button, Field, Skeleton } from "@/components/ui";
import { authFetch } from "@/utils/authFetch";
import { showConfirm, showError, showSuccess } from "@/utils/alerts";

/**
 * Closing a project — the same panel for the team and for the client.
 *
 * ONE COMPONENT, NOT TWO. Closure is three people taking three turns at one
 * object, and the interesting part is what has already happened: a client
 * asking "have they finished?" and a PM asking "has the client replied yet?"
 * want the same three lines on screen. Two components would answer that
 * question twice and eventually differently.
 *
 * WHAT MAY BE DONE IS NOT DECIDED HERE. `can` comes from the route, which
 * decides it against the caller's verified token and decides it again when the
 * button is pressed. This file renders what it is told. Nothing in it needs to
 * know who is looking, which is why it can sit in the client portal and the
 * admin console without a `role` prop that could be wrong.
 *
 * `gate.reasons` is why the complete button is gray. A disabled control with no
 * explanation is the thing that gets reported as a bug about the button.
 */

const CONTROL =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

const surface = "rounded-xl border border-border bg-card shadow-card";

function formatWhen(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** One of the three steps: done (with its date) or still to come. */
function Step({ title, description, at, icon: Icon }) {
  const when = formatWhen(at);
  const done = Boolean(at);

  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          done ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
        }`}
      >
        {done ? <Icon className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">
          {title}
          {/* The state is never the tick alone — it is spelled out, because a
              green circle and a gray circle are the same circle to a lot of
              people. */}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {done ? when || "Done" : "Not yet"}
          </span>
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
      </span>
    </li>
  );
}

/** 1–5, as radios rather than clickable stars, so it is reachable by keyboard. */
function RatingInput({ value, onChange, disabled }) {
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="text-sm font-medium text-foreground">
        How did it go? <span className="font-normal text-muted-foreground">(optional)</span>
      </legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {[1, 2, 3, 4, 5].map((n) => {
          const active = value === n;
          return (
            <label
              key={n}
              className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors duration-150 motion-reduce:transition-none ${
                active
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              <input
                type="radio"
                name="project-rating"
                value={n}
                checked={active}
                onChange={() => onChange(n)}
                className="sr-only"
              />
              <Star
                className={`h-4 w-4 ${active ? "fill-current text-warning" : ""}`}
                aria-hidden="true"
              />
              <span className="tabular-nums">{n}</span>
            </label>
          );
        })}
        {value !== null && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            Clear
          </Button>
        )}
      </div>
    </fieldset>
  );
}

export default function ProjectClosurePanel({ projectId, onChanged, className = "" }) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  // sign-off form
  const [rating, setRating] = useState(null);
  const [feedback, setFeedback] = useState("");
  // closure note
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`/api/projects/${projectId}/closure`);
      const data = await res.json().catch(() => ({}));
      // authFetch RESOLVES on a 4xx rather than throwing, so the response has
      // to be inspected — otherwise a 403 renders as an empty, working panel.
      if (!res.ok) throw new Error(data?.error || "Could not load the closure state.");
      setState(data);
    } catch (e) {
      setError(e?.message || "Could not load the closure state.");
      setState(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const act = useCallback(
    async (action, payload = {}) => {
      setBusy(action);
      try {
        const res = await authFetch(`/api/projects/${projectId}/closure`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...payload }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          // `detail` is the gate's own sentence — "2 of 5 milestones still
          // open." — and is the whole reason the refusal is useful.
          showError(data?.error || "Not saved", data?.detail || "");
          return false;
        }
        await load();
        await onChanged?.();
        return true;
      } catch (e) {
        showError("Not saved", e?.message || "The change could not be saved.");
        return false;
      } finally {
        setBusy(null);
      }
    },
    [projectId, load, onChanged]
  );

  if (loading) {
    return (
      <div className={`${surface} p-5 ${className}`} aria-busy="true">
        <Skeleton className="h-5 w-32" />
        <div className="mt-4 space-y-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      </div>
    );
  }

  if (error || !state?.project) {
    return (
      <div className={`${surface} p-5 ${className}`}>
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Closure unavailable</p>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={load}>
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const { project, gate, can } = state;
  const closed = Boolean(project.closed_at);

  return (
    <section className={`${surface} p-5 ${className}`} aria-labelledby="closure-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="closure-heading" className="text-base font-semibold text-foreground">
            Closure
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Three separate words: the team&apos;s, the client&apos;s, and the
            administrator&apos;s.
          </p>
        </div>
        {closed && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            Closed
          </span>
        )}
      </div>

      <ol className="mt-5 space-y-4">
        <Step
          title="Work complete"
          description="The project manager says the work is finished."
          at={project.completed_at}
          icon={CheckCircle2}
        />
        <Step
          title="Client signed off"
          description="The client agrees it is finished."
          at={project.client_signed_off_at}
          icon={CheckCircle2}
        />
        <Step
          title="Project closed"
          description="The file is shut."
          at={project.closed_at}
          icon={Lock}
        />
      </ol>

      {/* What the client said, once they have said it. */}
      {project.client_signed_off_at && (project.client_rating || project.client_feedback) && (
        <div className="mt-5 rounded-lg border border-border bg-muted/40 p-4">
          {project.client_rating && (
            <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Star className="h-4 w-4 fill-current text-warning" aria-hidden="true" />
              <span className="tabular-nums">{project.client_rating}</span>
              <span className="font-normal text-muted-foreground">out of 5</span>
            </p>
          )}
          {project.client_feedback && (
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
              {project.client_feedback}
            </p>
          )}
        </div>
      )}

      {project.closure_note && (
        <p className="mt-4 whitespace-pre-wrap text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Closing note: </span>
          {project.closure_note}
        </p>
      )}

      {/* ── Mark complete ─────────────────────────────────────────────── */}
      {!project.completed_at && !closed && gate && (
        <div className="mt-5 border-t border-border pt-5">
          {gate.ready ? (
            <>
              <p className="text-sm text-muted-foreground">
                Every milestone is done and no bugs are open.
              </p>
              {can?.complete && (
                <Button
                  className="mt-3"
                  onClick={() => act("complete")}
                  disabled={busy === "complete"}
                >
                  {busy === "complete" ? "Saving…" : "Mark work complete"}
                </Button>
              )}
            </>
          ) : (
            // Shown to everybody, not only to whoever can press the button. A
            // client reading "3 bugs still open" learns more from this line
            // than from a screen with nothing on it.
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-4">
              <p className="text-sm font-medium text-foreground">
                Not ready to be marked complete
              </p>
              <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-muted-foreground">
                {gate.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ── Client sign-off ───────────────────────────────────────────── */}
      {can?.signOff && (
        <div className="mt-5 space-y-4 border-t border-border pt-5">
          <RatingInput value={rating} onChange={setRating} disabled={busy === "sign_off"} />

          <Field label="Anything you want to add?" htmlFor="closure-feedback">
            <textarea
              id="closure-feedback"
              rows={3}
              className={`${CONTROL} w-full resize-y`}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              maxLength={5000}
              disabled={busy === "sign_off"}
              placeholder="Optional — the team will read this."
            />
          </Field>

          <Button
            onClick={() => act("sign_off", { rating, feedback })}
            disabled={busy === "sign_off"}
          >
            {busy === "sign_off" ? "Sending…" : "Sign off this project"}
          </Button>
        </div>
      )}

      {/* ── Close ─────────────────────────────────────────────────────── */}
      {can?.close && (
        <div className="mt-5 space-y-4 border-t border-border pt-5">
          {!project.client_signed_off_at && (
            // Said plainly rather than blocked. Clients go quiet, and a
            // finished project should not stay open forever waiting for a
            // reply — but whoever closes it should know that is what they are
            // doing.
            <p className="text-sm text-muted-foreground">
              The client has not signed off. You can still close it; the record
              will show it was closed unsigned.
            </p>
          )}
          <Field label="Closing note" htmlFor="closure-note" hint="Optional.">
            <textarea
              id="closure-note"
              rows={2}
              className={`${CONTROL} w-full resize-y`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={5000}
              disabled={busy === "close"}
            />
          </Field>
          <Button onClick={() => act("close", { note })} disabled={busy === "close"}>
            <Lock className="h-4 w-4" aria-hidden="true" />
            {busy === "close" ? "Closing…" : "Close project"}
          </Button>
        </div>
      )}

      {/* ── Reopen ────────────────────────────────────────────────────── */}
      {can?.reopen && (
        <div className="mt-5 border-t border-border pt-5">
          <Button
            variant="outline"
            onClick={async () => {
              // Spelled out because it is not obvious and it is not
              // reversible: reopening withdraws the client's sign-off along
              // with the rating and comment they left.
              const ok = await showConfirm(
                "Reopen this project?",
                "This clears the completion, the client's sign-off, and the rating and feedback they gave. They would need to sign off again.",
                { confirmButtonText: "Reopen" }
              );
              if (!ok) return;
              if (await act("reopen")) {
                setRating(null);
                setFeedback("");
                setNote("");
                showSuccess("Reopened", "The project is open again.");
              }
            }}
            disabled={busy === "reopen"}
          >
            <Undo2 className="h-4 w-4" aria-hidden="true" />
            {busy === "reopen" ? "Reopening…" : "Reopen project"}
          </Button>
        </div>
      )}
    </section>
  );
}
