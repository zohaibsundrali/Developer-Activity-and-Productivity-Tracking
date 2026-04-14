"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../utils/supabaseClient";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { SessionCard } from "../../components/developer/SessionUI.jsx";

export default function SessionsPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && user?.email) {
      fetchSessions(user.email);
    }
  }, [authLoading, user?.email]);

  const fetchSessions = async (email) => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("productivity_sessions")
        .select("*")
        .eq("user_email", email)
        .order("start_time", { ascending: false })
        .limit(50);
      if (error) throw error;
      setSessions(data || []);
    } catch {
      // Silent; real apps could surface a toast
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) {
    return <div className="p-6 text-gray-600">Checking authentication…</div>;
  }

  if (!user?.email) {
    return <div className="p-6 text-gray-700">Please log in to view your sessions.</div>;
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800">Session history</h1>
          <p className="text-sm text-gray-500">
            productivity_sessions for {user.email}
          </p>
        </div>
        <button
          type="button"
          onClick={() => fetchSessions(user.email)}
          disabled={loading}
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {sessions.length === 0 ? (
        <p className="text-sm text-gray-500">No sessions found yet.</p>
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
    </main>
  );
}
