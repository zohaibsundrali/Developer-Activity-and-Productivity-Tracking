"use client";

import { useCallback, useEffect, useState } from "react";
import { Award, Target } from "lucide-react";

import {
  Badge,
  EmptyState,
  ErrorState,
  PageHeader,
  Section,
  Skeleton,
} from "@/components/ui";
import { authFetch } from "@/utils/authFetch";

/**
 * My Reviews — the feedback about you that somebody has decided to show you.
 *
 * SHARED ONLY, and that is the feature rather than a limitation. A review moves
 * draft -> submitted -> shared, and this screen sees the last state alone. A
 * half-written assessment is not feedback; it is a draft its author would edit
 * if they knew it was being read. The route filters on status, and the RLS
 * policy in 083 says the same thing independently, so neither is the only thing
 * standing there.
 *
 * GOALS ARE NOT SECRET, which is why they appear whatever their state. A goal
 * you cannot see is not a goal — it is a way of being judged against something
 * nobody told you.
 *
 * One component for both shells, like MyAttendance and MyLeave: an HR lead is
 * reviewed too, and there is one shape to "what was said about me".
 */

const GOAL_TONE = {
  open: "outline",
  met: "success",
  missed: "destructive",
  dropped: "secondary",
};

const stars = (n) => (Number.isInteger(n) && n >= 1 && n <= 5 ? "★".repeat(n) + "☆".repeat(5 - n) : null);

export default function MyReviews() {
  const [reviews, setReviews] = useState([]);
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await authFetch("/api/performance?view=mine");
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) throw new Error(json?.error || "Could not load this.");
      setReviews(json.reviews || []);
      setGoals(json.goals || []);
    } catch (e) {
      setError(e?.message || "Could not load this.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error) {
    return <ErrorState title="Unavailable" description={error} onRetry={load} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Reviews"
        description="Feedback that has been shared with you, and the goals you are working to."
      />

      <Section title="Goals">
        {goals.length === 0 ? (
          <EmptyState
            icon={Target}
            title="No goals set"
            description="Goals appear here once your manager or HR sets one."
          />
        ) : (
          <ul className="divide-y divide-border">
            {goals.map((g) => (
              <li key={g.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{g.title}</p>
                  {g.description && (
                    <p className="text-xs text-muted-foreground">{g.description}</p>
                  )}
                  {g.due_date && (
                    <p className="text-xs text-muted-foreground">Due {g.due_date}</p>
                  )}
                </div>
                <Badge variant={GOAL_TONE[g.status] || "outline"}>{g.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Shared reviews">
        {reviews.length === 0 ? (
          <EmptyState
            icon={Award}
            title="Nothing shared yet"
            description="A review appears here when it has been completed and shared with you. Reviews still being written are not shown."
          />
        ) : (
          <ul className="space-y-4">
            {reviews.map((r) => (
              <li key={r.id} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">
                    {r.review_cycles?.name || "Review"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.review_cycles?.period_start} — {r.review_cycles?.period_end}
                  </p>
                </div>
                {/* No rating renders as nothing, not as zero stars: unrated and
                    rated-lowest are different facts. */}
                {stars(r.rating) && (
                  <p className="mt-2 text-lg tabular-nums text-foreground" aria-label={`Rated ${r.rating} of 5`}>
                    {stars(r.rating)}
                  </p>
                )}
                {r.strengths && (
                  <div className="mt-3">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">Strengths</p>
                    <p className="whitespace-pre-wrap text-sm text-foreground">{r.strengths}</p>
                  </div>
                )}
                {r.improvements && (
                  <div className="mt-3">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">
                      To work on
                    </p>
                    <p className="whitespace-pre-wrap text-sm text-foreground">{r.improvements}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
