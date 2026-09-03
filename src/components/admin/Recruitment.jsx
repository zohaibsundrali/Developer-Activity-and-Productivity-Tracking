"use client";

import { useCallback, useEffect, useState } from "react";
import { Briefcase, CheckCircle2, Plus, UserPlus, XCircle } from "lucide-react";

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
import { showConfirm, showError, showSuccess } from "@/utils/alerts";

/**
 * Recruitment — open roles and the people applying for them.
 *
 * WHO SEES WHAT, because this screen shows two very different things. An
 * opening is ordinary workplace information: a manager planning next quarter
 * needs to know the company is hiring a QA engineer. A CANDIDATE is a named
 * person outside the organization who never agreed to be discussed in it.
 *
 * So the list of openings is offered to the wider people-reading roles, and
 * opening one to see its applicants can answer 403 — for a manager who is not
 * that opening's hiring manager. That is not an error to hide; the screen says
 * it plainly, because "you can see this opening but not its applicants" is a
 * real and reasonable state.
 *
 * STAGE AND OUTCOME ARE SEPARATE, which is why the pipeline can say how many
 * people were rejected AT interview. A single status list would overwrite the
 * stage the moment somebody was rejected and lose the only interesting question
 * about a funnel.
 */

const CONTROL =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

const STAGES = ["applied", "screening", "interview", "offer"];
const STATUS_TONE = {
  draft: "secondary",
  open: "success",
  on_hold: "warning",
  closed: "outline",
  filled: "info",
};
const OUTCOME_TONE = { hired: "success", rejected: "destructive", withdrawn: "secondary" };

export default function Recruitment({ developers = [] }) {
  const [openings, setOpenings] = useState([]);
  const [active, setActive] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [busy, setBusy] = useState(false);
  const [openingForm, setOpeningForm] = useState(null);
  const [candidateForm, setCandidateForm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch("/api/recruitment?view=openings");
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "Could not load openings.");
      setOpenings(json.openings || []);
    } catch (e) {
      setError(e?.message || "Could not load openings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = async (opening) => {
    setBusy(true);
    setDetailError("");
    try {
      const res = await authFetch(
        `/api/recruitment?view=candidates&openingId=${encodeURIComponent(opening.job_opening_id)}`
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        // A 403 here is a real state, not a failure: this person may read the
        // opening and not its applicants. Shown on the detail screen rather
        // than as a toast that disappears.
        setActive(opening);
        setCandidates([]);
        setDetailError(json?.error || "Could not open that.");
        return;
      }
      setActive(opening);
      setCandidates(json.candidates || []);
    } catch (e) {
      showError(e?.message || "Could not open that.");
    } finally {
      setBusy(false);
    }
  };

  const move = async (candidate, patch, confirmText) => {
    if (confirmText) {
      const ok = await showConfirm(confirmText.title, confirmText.body, {
        confirmButtonText: confirmText.button,
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const res = await authFetch("/api/recruitment", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId: candidate.id, ...patch }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "That did not go through.");
      setCandidates((prev) => prev.map((c) => (c.id === candidate.id ? json.candidate : c)));
    } catch (e) {
      showError(e?.message || "That did not go through.");
    } finally {
      setBusy(false);
    }
  };

  const setOpeningStatus = async (opening, status) => {
    setBusy(true);
    try {
      const res = await authFetch("/api/recruitment", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openingId: opening.job_opening_id, status }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "That did not go through.");
      showSuccess("Opening updated.");
      setActive((a) => (a ? { ...a, status } : a));
      await load();
    } catch (e) {
      showError(e?.message || "That did not go through.");
    } finally {
      setBusy(false);
    }
  };

  const submitOpening = async () => {
    if (!openingForm?.title?.trim()) {
      showError("Give the opening a title.");
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch("/api/recruitment?action=opening", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(openingForm),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "Could not create it.");
      showSuccess("Opening created.");
      setOpeningForm(null);
      await load();
    } catch (e) {
      showError(e?.message || "Could not create it.");
    } finally {
      setBusy(false);
    }
  };

  const submitCandidate = async () => {
    if (!candidateForm?.fullName?.trim() || !candidateForm?.email?.trim()) {
      showError("A candidate needs a name and an email.");
      return;
    }
    setBusy(true);
    try {
      const res = await authFetch("/api/recruitment?action=candidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...candidateForm, openingId: active.job_opening_id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "Could not add them.");
      setCandidates((prev) => [json.candidate, ...prev]);
      setCandidateForm(null);
      showSuccess("Candidate added.");
    } catch (e) {
      showError(e?.message || "Could not add them.");
    } finally {
      setBusy(false);
    }
  };

  // ── One opening ─────────────────────────────────────────────────────────
  if (active) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={active.title}
          description={`${active.in_play ?? 0} in play · ${active.hired ?? 0} hired`}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setActive(null)}>Back</Button>
              {active.status === "draft" && (
                <Button onClick={() => setOpeningStatus(active, "open")} disabled={busy}>Open</Button>
              )}
              {active.status === "open" && (
                <>
                  <Button variant="outline" onClick={() => setOpeningStatus(active, "on_hold")} disabled={busy}>
                    Hold
                  </Button>
                  <Button variant="outline" onClick={() => setOpeningStatus(active, "closed")} disabled={busy}>
                    Close
                  </Button>
                  <Button onClick={() => setCandidateForm({ fullName: "", email: "" })} disabled={busy}>
                    <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
                    Add candidate
                  </Button>
                </>
              )}
            </div>
          }
        />

        {detailError ? (
          <Section>
            <EmptyState
              icon={Briefcase}
              title="Applicants are not shown to you"
              description={detailError}
            />
          </Section>
        ) : (
          <Section title="Candidates">
            {candidates.length === 0 ? (
              <EmptyState
                icon={UserPlus}
                title="No applicants yet"
                description="Add somebody who has applied, and move them through the stages as you go."
              />
            ) : (
              <ul className="divide-y divide-border">
                {candidates.map((c) => {
                  const decided = Boolean(c.outcome);
                  return (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{c.full_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {c.email}
                          {c.source ? ` · via ${c.source}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {decided ? (
                          <>
                            <Badge variant={OUTCOME_TONE[c.outcome] || "outline"}>{c.outcome}</Badge>
                            <span className="text-xs text-muted-foreground">at {c.stage}</span>
                            {/* Clearing the outcome is the honest way back, and
                                the trigger in 085 allows exactly that. */}
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => move(c, { outcome: null })}
                            >
                              Reopen
                            </Button>
                          </>
                        ) : (
                          <>
                            <select
                              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                              value={c.stage}
                              disabled={busy}
                              onChange={(e) => move(c, { stage: e.target.value })}
                              aria-label={`Stage for ${c.full_name}`}
                            >
                              {STAGES.map((s) => (
                                <option key={s} value={s}>{s}</option>
                              ))}
                            </select>
                            <Button
                              size="sm"
                              disabled={busy}
                              onClick={() =>
                                move(c, { outcome: "hired" }, {
                                  title: `Hire ${c.full_name}?`,
                                  body: "This records the decision. It does not create a login — that is a separate step on the Employees screen.",
                                  button: "Hire",
                                })
                              }
                            >
                              <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden="true" />
                              Hire
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => move(c, { outcome: "rejected" })}
                            >
                              <XCircle className="mr-1 h-4 w-4" aria-hidden="true" />
                              Reject
                            </Button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        )}

        <Modal open={Boolean(candidateForm)} onClose={() => setCandidateForm(null)} title="Add a candidate">
          {candidateForm && (
            <div className="space-y-4">
              <Field label="Full name">
                <Input
                  value={candidateForm.fullName}
                  onChange={(e) => setCandidateForm((f) => ({ ...f, fullName: e.target.value }))}
                />
              </Field>
              <Field label="Email">
                <Input
                  type="email"
                  value={candidateForm.email}
                  onChange={(e) => setCandidateForm((f) => ({ ...f, email: e.target.value }))}
                />
              </Field>
              <Field label="Phone">
                <Input
                  value={candidateForm.phone || ""}
                  onChange={(e) => setCandidateForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </Field>
              <Field label="CV link" hint="A link. Uploading files needs a private bucket, which this feature does not add.">
                <Input
                  value={candidateForm.resumeUrl || ""}
                  onChange={(e) => setCandidateForm((f) => ({ ...f, resumeUrl: e.target.value }))}
                  placeholder="https://…"
                />
              </Field>
              <Field label="Source">
                <Input
                  value={candidateForm.source || ""}
                  onChange={(e) => setCandidateForm((f) => ({ ...f, source: e.target.value }))}
                  placeholder="Referral, LinkedIn, careers page…"
                />
              </Field>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setCandidateForm(null)} disabled={busy}>Cancel</Button>
                <Button onClick={submitCandidate} disabled={busy}>Add</Button>
              </div>
            </div>
          )}
        </Modal>
      </div>
    );
  }

  // ── The openings list ───────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        title="Recruitment"
        description="Open roles, and how far each applicant has got."
        actions={
          <Button onClick={() => setOpeningForm({ title: "", openingsCount: 1 })}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            New opening
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
      ) : openings.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No openings yet"
          description="Post a role and applicants can be tracked against it."
        />
      ) : (
        <Section>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Role</th>
                  <th className="py-2 pr-4 font-medium">Applied</th>
                  <th className="py-2 pr-4 font-medium">Screening</th>
                  <th className="py-2 pr-4 font-medium">Interview</th>
                  <th className="py-2 pr-4 font-medium">Offer</th>
                  <th className="py-2 pr-4 font-medium">Hired</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {openings.map((o) => (
                  <tr key={o.job_opening_id} className="border-b border-border/60">
                    <td className="py-2 pr-4 text-foreground">
                      {o.title}
                      <Badge variant={STATUS_TONE[o.status] || "outline"} className="ml-2">
                        {o.status}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4 tabular-nums">{o.applied}</td>
                    <td className="py-2 pr-4 tabular-nums">{o.screening}</td>
                    <td className="py-2 pr-4 tabular-nums">{o.interview}</td>
                    <td className="py-2 pr-4 tabular-nums">{o.offer}</td>
                    <td className="py-2 pr-4 tabular-nums">
                      {o.hired}
                      <span className="text-xs text-muted-foreground"> / {o.openings_count}</span>
                    </td>
                    <td className="py-2 text-right">
                      <Button size="sm" variant="outline" onClick={() => openDetail(o)} disabled={busy}>
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

      <Modal open={Boolean(openingForm)} onClose={() => setOpeningForm(null)} title="New job opening">
        {openingForm && (
          <div className="space-y-4">
            <Field label="Title">
              <Input
                value={openingForm.title}
                onChange={(e) => setOpeningForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Senior QA Engineer"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Employment type">
                <select
                  className={CONTROL}
                  value={openingForm.employmentType || ""}
                  onChange={(e) => setOpeningForm((f) => ({ ...f, employmentType: e.target.value }))}
                >
                  <option value="">Not set</option>
                  <option value="full_time">Full time</option>
                  <option value="part_time">Part time</option>
                  <option value="contract">Contract</option>
                  <option value="intern">Intern</option>
                </select>
              </Field>
              <Field label="How many">
                <Input
                  type="number"
                  min={1}
                  value={openingForm.openingsCount}
                  onChange={(e) =>
                    setOpeningForm((f) => ({ ...f, openingsCount: Number(e.target.value) || 1 }))
                  }
                />
              </Field>
            </div>
            <Field
              label="Hiring manager"
              hint="Whoever is named here can see this opening's applicants — and no others."
            >
              <select
                className={CONTROL}
                value={openingForm.hiringManagerId || ""}
                onChange={(e) => setOpeningForm((f) => ({ ...f, hiringManagerId: e.target.value }))}
              >
                <option value="">Nobody yet</option>
                {developers.map((d) => (
                  <option key={d.id} value={d.id}>{d.name || d.email}</option>
                ))}
              </select>
            </Field>
            <Field label="Description">
              <textarea
                className={CONTROL}
                rows={4}
                value={openingForm.description || ""}
                onChange={(e) => setOpeningForm((f) => ({ ...f, description: e.target.value }))}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpeningForm(null)} disabled={busy}>Cancel</Button>
              <Button onClick={submitOpening} disabled={busy}>Create as draft</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
