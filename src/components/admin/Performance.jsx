"use client";

import { useCallback, useEffect, useState } from "react";
import { Award, Lock, Plus, Send, Share2, Unlock } from "lucide-react";

import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  Section,
  Skeleton,
} from "@/components/ui";
import { authFetch } from "@/utils/authFetch";
import { getOrgContext } from "@/utils/orgContext";
import { showConfirm, showError, showSuccess } from "@/utils/alerts";

/**
 * Performance — running a review cycle.
 *
 * THREE STATES AND TWO DIFFERENT PEOPLE, which is the whole design.
 *
 *   draft      the reviewer is still writing. Nobody else reads it.
 *   submitted  the reviewer is finished. HR can read it; the subject cannot.
 *   shared     HR has decided it is ready. The subject can now read it.
 *
 * Submitting is the REVIEWER's act and sharing is HR's, because they are
 * different decisions: one says "I have finished", the other says "this should
 * be read". Collapsing them would mean either HR editing somebody's words or a
 * reviewer publishing without review.
 *
 * A CLOSED CYCLE still allows sharing. Closing ends the writing, not the
 * reading — an HR lead who closes the cycle and then shares the reviews is
 * doing the normal thing, and the trigger in 083 permits exactly that one edit.
 */

const CONTROL =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

const CYCLE_TONE = { draft: "secondary", open: "success", closed: "outline" };
const REVIEW_TONE = { draft: "outline", submitted: "warning", shared: "success" };

export default function Performance({ developers = [] }) {
  const [cycles, setCycles] = useState([]);
  const [active, setActive] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cycleForm, setCycleForm] = useState(null);
  const [reviewForm, setReviewForm] = useState(null);

  const me = getOrgContext()?.userId || null;

  const nameOf = useCallback(
    (id) => {
      const d = developers.find((x) => String(x.id) === String(id));
      return d?.name || d?.full_name || d?.email || "Someone";
    },
    [developers]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch("/api/performance?view=cycles");
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "Could not load cycles.");
      setCycles(json.cycles || []);
    } catch (e) {
      setError(e?.message || "Could not load cycles.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCycle = async (cycle) => {
    setBusy(true);
    try {
      const res = await authFetch(
        `/api/performance?view=reviews&cycleId=${encodeURIComponent(cycle.cycle_id)}`
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "Could not open that cycle.");
      setActive(cycle);
      setReviews(json.reviews || []);
    } catch (e) {
      showError(e?.message || "Could not open that cycle.");
    } finally {
      setBusy(false);
    }
  };

  const setCycleStatus = async (cycle, status) => {
    const ok = await showConfirm(
      status === "closed" ? "Close this cycle?" : status === "open" ? "Open this cycle?" : "Return to draft?",
      status === "closed"
        ? "No more reviews can be written or edited. Sharing completed reviews still works."
        : "Reviewers will be able to write in it.",
      { confirmButtonText: status === "closed" ? "Close" : "Open" }
    );
    if (!ok) return;
    setBusy(true);
    try {
      const res = await authFetch("/api/performance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cycleId: cycle.cycle_id, status }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "That did not go through.");
      showSuccess("Cycle updated.");
      setActive((a) => (a ? { ...a, status } : a));
      await load();
    } catch (e) {
      showError(e?.message || "That did not go through.");
    } finally {
      setBusy(false);
    }
  };

  const act = async (review, action) => {
    if (action === "share") {
      const ok = await showConfirm(
        "Share this review?",
        `${nameOf(review.subject_user_id)} will be able to read it. This cannot be undone.`,
        { confirmButtonText: "Share" }
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      const res = await authFetch("/api/performance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId: review.id, action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "That did not go through.");
      setReviews((prev) => prev.map((r) => (r.id === review.id ? { ...r, ...json.review } : r)));
      showSuccess(action === "share" ? "Review shared." : "Review submitted.");
    } catch (e) {
      showError(e?.message || "That did not go through.");
    } finally {
      setBusy(false);
    }
  };

  const submitCycle = async () => {
    if (!cycleForm?.name?.trim() || !cycleForm?.periodStart || !cycleForm?.periodEnd) {
      showError("Name the cycle and give it a period.");
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch("/api/performance?action=cycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cycleForm),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "Could not create it.");
      showSuccess("Cycle created.");
      setCycleForm(null);
      await load();
    } catch (e) {
      showError(e?.message || "Could not create it.");
    } finally {
      setBusy(false);
    }
  };

  const submitReview = async () => {
    if (!reviewForm?.subjectUserId) {
      showError("Choose who the review is about.");
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch("/api/performance?action=review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...reviewForm, cycleId: active.cycle_id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "Could not start it.");
      setReviews((prev) => [...prev, json.review]);
      setReviewForm(null);
      showSuccess("Review started as a draft.");
    } catch (e) {
      showError(e?.message || "Could not start it.");
    } finally {
      setBusy(false);
    }
  };

  // ── One cycle, opened ───────────────────────────────────────────────────
  if (active) {
    const closed = active.status === "closed";
    return (
      <div className="space-y-6">
        <PageHeader
          title={active.name}
          description={`${active.period_start} — ${active.period_end} · ${active.status}`}
          actions={
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setActive(null)}>Back</Button>
              {active.status === "open" && (
                <Button variant="outline" onClick={() => setCycleStatus(active, "closed")} disabled={busy}>
                  <Lock className="mr-2 h-4 w-4" aria-hidden="true" />
                  Close cycle
                </Button>
              )}
              {closed && (
                <Button variant="outline" onClick={() => setCycleStatus(active, "open")} disabled={busy}>
                  <Unlock className="mr-2 h-4 w-4" aria-hidden="true" />
                  Reopen
                </Button>
              )}
              {active.status === "draft" && (
                <Button onClick={() => setCycleStatus(active, "open")} disabled={busy}>
                  Open for reviews
                </Button>
              )}
              {active.status === "open" && (
                <Button onClick={() => setReviewForm({ subjectUserId: "", rating: "" })} disabled={busy}>
                  <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                  Start a review
                </Button>
              )}
            </div>
          }
        />

        {closed && (
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
            This cycle is closed. Reviews cannot be written or edited — sharing a completed one
            still works.
          </div>
        )}

        <Section title="Reviews in this cycle">
          {reviews.length === 0 ? (
            <EmptyState
              icon={Award}
              title="No reviews yet"
              description="Start one for each person being reviewed in this cycle."
            />
          ) : (
            <ul className="divide-y divide-border">
              {reviews.map((r) => {
                const mine = me && String(r.reviewer_user_id) === String(me);
                return (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {nameOf(r.subject_user_id)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        reviewed by {mine ? "you" : nameOf(r.reviewer_user_id)}
                        {r.rating ? ` · rated ${r.rating}/5` : " · not rated"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={REVIEW_TONE[r.status] || "outline"}>{r.status}</Badge>
                      {/* Submitting is the reviewer's act — the route refuses
                          it from anybody else, so the button follows. */}
                      {r.status === "draft" && mine && (
                        <Button size="sm" onClick={() => act(r, "submit")} disabled={busy || closed}>
                          <Send className="mr-1 h-4 w-4" aria-hidden="true" />
                          Submit
                        </Button>
                      )}
                      {r.status === "submitted" && (
                        <Button size="sm" onClick={() => act(r, "share")} disabled={busy}>
                          <Share2 className="mr-1 h-4 w-4" aria-hidden="true" />
                          Share
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Modal open={Boolean(reviewForm)} onClose={() => setReviewForm(null)} title="Start a review">
          {reviewForm && (
            <div className="space-y-4">
              <Field label="About">
                <select
                  className={CONTROL}
                  value={reviewForm.subjectUserId}
                  onChange={(e) => setReviewForm((f) => ({ ...f, subjectUserId: e.target.value }))}
                >
                  <option value="">Choose…</option>
                  {/* You cannot review yourself — the CHECK in 083 refuses it,
                      so the option is not offered either. */}
                  {developers
                    .filter((d) => String(d.id) !== String(me))
                    .map((d) => (
                      <option key={d.id} value={d.id}>{d.name || d.email}</option>
                    ))}
                </select>
              </Field>
              <Field label="Rating (optional)" hint="Leave blank rather than guessing — an unchosen score averages into every report.">
                <select
                  className={CONTROL}
                  value={reviewForm.rating}
                  onChange={(e) => setReviewForm((f) => ({ ...f, rating: e.target.value }))}
                >
                  <option value="">Not rated</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </Field>
              <Field label="Strengths">
                <textarea
                  className={CONTROL}
                  rows={3}
                  value={reviewForm.strengths || ""}
                  onChange={(e) => setReviewForm((f) => ({ ...f, strengths: e.target.value }))}
                />
              </Field>
              <Field label="To work on">
                <textarea
                  className={CONTROL}
                  rows={3}
                  value={reviewForm.improvements || ""}
                  onChange={(e) => setReviewForm((f) => ({ ...f, improvements: e.target.value }))}
                />
              </Field>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setReviewForm(null)} disabled={busy}>Cancel</Button>
                <Button onClick={submitReview} disabled={busy}>Start as draft</Button>
              </div>
            </div>
          )}
        </Modal>
      </div>
    );
  }

  // ── The cycle list ──────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        title="Performance"
        description="Review cycles, and what has been written in them."
        actions={
          <Button onClick={() => setCycleForm({ name: "", periodStart: "", periodEnd: "" })}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            New cycle
          </Button>
        }
      />

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : error ? (
        <ErrorState title="Could not load" description={error} onRetry={load} />
      ) : cycles.length === 0 ? (
        <EmptyState
          icon={Award}
          title="No review cycles yet"
          description="A cycle is the period being reviewed — a quarter, a half-year, a probation period."
        />
      ) : (
        <Section>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Cycle</th>
                  <th className="py-2 pr-4 font-medium">Period</th>
                  <th className="py-2 pr-4 font-medium">People</th>
                  <th className="py-2 pr-4 font-medium">Submitted</th>
                  <th className="py-2 pr-4 font-medium">Shared</th>
                  <th className="py-2 pr-4 font-medium">Avg</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {cycles.map((c) => (
                  <tr key={c.cycle_id} className="border-b border-border/60">
                    <td className="py-2 pr-4 text-foreground">
                      {c.name}
                      <Badge variant={CYCLE_TONE[c.status] || "outline"} className="ml-2">
                        {c.status}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {c.period_start} — {c.period_end}
                    </td>
                    <td className="py-2 pr-4 tabular-nums">{c.people}</td>
                    <td className="py-2 pr-4 tabular-nums">{c.submitted}</td>
                    <td className="py-2 pr-4 tabular-nums">{c.shared}</td>
                    {/* No average where nothing is rated — 0.00 would read as
                        "everybody scored zero". */}
                    <td className="py-2 pr-4 tabular-nums text-muted-foreground">
                      {c.average_rating ?? "—"}
                    </td>
                    <td className="py-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => openCycle(c)} disabled={busy}>
                        Open
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Modal open={Boolean(cycleForm)} onClose={() => setCycleForm(null)} title="New review cycle">
        {cycleForm && (
          <div className="space-y-4">
            <Field label="Name">
              <Input
                value={cycleForm.name}
                onChange={(e) => setCycleForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="H2 2026"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Period start">
                <input
                  type="date"
                  className={CONTROL}
                  value={cycleForm.periodStart}
                  onChange={(e) => setCycleForm((f) => ({ ...f, periodStart: e.target.value }))}
                />
              </Field>
              <Field label="Period end">
                <input
                  type="date"
                  className={CONTROL}
                  min={cycleForm.periodStart}
                  value={cycleForm.periodEnd}
                  onChange={(e) => setCycleForm((f) => ({ ...f, periodEnd: e.target.value }))}
                />
              </Field>
            </div>
            <p className="text-sm text-muted-foreground">
              It starts as a draft. Open it when reviewers should begin writing.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCycleForm(null)} disabled={busy}>Cancel</Button>
              <Button onClick={submitCycle} disabled={busy}>Create</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
