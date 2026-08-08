"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { History, LogIn, RefreshCw } from "lucide-react";
import { supabase } from "../../utils/supabaseClient";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { SessionCard } from "../../components/developer/SessionUI.jsx";
import {
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
} from "@/components/ui";

/** Skeleton shaped like a SessionCard, so the list does not reflow on load. */
function SessionCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-48" />
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-3 w-full" />
        ))}
      </div>
    </div>
  );
}

export default function SessionsPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!authLoading && user?.email) {
      fetchSessions(user.email);
    }
  }, [authLoading, user?.email]);

  const fetchSessions = async (email) => {
    try {
      setLoading(true);
      setError("");
      const { data, error } = await supabase
        .from("productivity_sessions")
        .select("*")
        .eq("user_email", email)
        .order("start_time", { ascending: false })
        .limit(50);
      if (error) throw error;
      setSessions(data || []);
    } catch (err) {
      // Previously swallowed silently, which left the screen showing "no
      // sessions" after a failed read. Surface it with a retry instead.
      setError(err?.message || "Could not load your sessions.");
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="space-y-6">
          <div className="space-y-2">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-4 w-72" />
          </div>
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <SessionCardSkeleton key={i} />
            ))}
          </div>
        </div>
      </main>
    );
  }

  if (!user?.email) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <EmptyState
          icon={LogIn}
          title="Sign in to view your sessions"
          description="Your tracked work sessions are private to your account."
          action={
            <Button onClick={() => router.push("/login")}>Go to login</Button>
          }
        />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="Session history"
        description={`Your 50 most recent tracked sessions · ${user.email}`}
        actions={
          <Button
            variant="outline"
            onClick={() => fetchSessions(user.email)}
            disabled={loading}
          >
            <RefreshCw
              className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`}
              aria-hidden="true"
            />
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        }
      />

      <div className="space-y-6">
        {loading ? (
          <div className="space-y-3" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <SessionCardSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <ErrorState
            title="Couldn't load your sessions"
            description={error}
            onRetry={() => fetchSessions(user.email)}
          />
        ) : sessions.length === 0 ? (
          <EmptyState
            icon={History}
            title="No sessions yet"
            description="Start the desktop tracker and your work sessions will show up here."
          />
        ) : (
          <div className="space-y-3">
            {sessions.map((s) => (
              <SessionCard
                key={s.session_id}
                session={s}
                onClick={() => router.push(`/sessions/${encodeURIComponent(s.session_id)}`)}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
