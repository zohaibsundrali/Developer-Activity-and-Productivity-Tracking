"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "../../../contexts/AuthContext.jsx";
import {
  useKeyboardRealtime,
  useMouseRealtime,
  useAppUsageRealtime,
  useScreenshotsRealtime,
} from "../../../hooks/activityHooks.js";
import { supabase } from "../../../utils/supabaseClient";
import {
  KeyboardActivityChart,
  MouseActivityChart,
  AppUsageList,
  ScreenshotGrid,
} from "../../../components/developer/SessionUI.jsx";

export default function SessionDetailPage() {
  const { sessionId } = useParams();
  const { user, isLoading: authLoading } = useAuth();

  const userEmail = user?.email || null;
  const [session, setSession] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(false);

  // Fetch this specific session row for the logged-in user
  useEffect(() => {
    if (!userEmail || !sessionId) return;

    const fetchSession = async () => {
      try {
        setSessionLoading(true);
        const { data, error } = await supabase
          .from("productivity_sessions")
          .select("*")
          .eq("user_email", userEmail)
          .eq("session_id", sessionId)
          .limit(1);
        if (error) throw error;
        setSession(data?.[0] || null);
      } catch {
        setSession(null);
      } finally {
        setSessionLoading(false);
      }
    };

    fetchSession();
  }, [userEmail, sessionId]);

  // For this detail route, we care about the specific sessionId from the URL,
  // but we still use the logged-in user's identity for security.
  const developerId = useMemo(() => user?.developer_id || user?.id || null, [user]);

  const keyboard = useKeyboardRealtime({
    sessionId,
    developerId,
    developerEmail: userEmail,
  });

  const mouse = useMouseRealtime({
    sessionId,
    developerId,
    developerEmail: userEmail,
  });

  const apps = useAppUsageRealtime({
    sessionId,
    userEmail,
  });

  const screenshots = useScreenshotsRealtime({
    developerId,
    developerEmail: userEmail,
    session,
  });

  if (authLoading) {
    return <div className="p-6 text-gray-600">Checking authentication…</div>;
  }

  if (!userEmail) {
    return <div className="p-6 text-gray-700">Please log in to view session details.</div>;
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-gray-800">
          Session detail
        </h1>
        <p className="text-sm text-gray-500">
          session_id: <span className="font-mono">{sessionId}</span>
        </p>
        {sessionLoading ? (
          <p className="text-xs text-gray-400">Loading session summary…</p>
        ) : session ? (
          <p className="text-xs text-gray-500">
            {session.start_time &&
              `Started ${new Date(session.start_time).toLocaleString()} | `}
            {session.end_time &&
              `Ended ${new Date(session.end_time).toLocaleString()} | `}
            Score {session.productivity_score ?? 0}
          </p>
        ) : null}
      </header>

      {/* Stat cards row */}
      <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Keyboard
          </h2>
          <p className="text-sm text-gray-700">
            Total keys: <span className="font-semibold">{keyboard.totalKeys}</span>
          </p>
          <p className="text-sm text-gray-700">
            Avg WPM: <span className="font-semibold">{keyboard.avgWpm.toFixed(1)}</span>
          </p>
          <p className="text-sm text-gray-700">
            Activity %: <span className="font-semibold">{keyboard.avgActivityPct.toFixed(1)}</span>
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Mouse
          </h2>
          <p className="text-sm text-gray-700">
            Total events: <span className="font-semibold">{mouse.totalEvents}</span>
          </p>
          <p className="text-sm text-gray-700">
            Avg active %: <span className="font-semibold">{mouse.avgActivePct.toFixed(1)}</span>
          </p>
          <p className="text-sm text-gray-700">
            Avg idle %: <span className="font-semibold">{mouse.avgIdlePct.toFixed(1)}</span>
          </p>
          {mouse.latest?.activity_status && (
            <p className="mt-1 text-xs text-gray-500">
              Latest status: {mouse.latest.activity_status}
            </p>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Apps
          </h2>
          <p className="text-sm text-gray-700">
            Unique apps: <span className="font-semibold">{apps.topApps.length}</span>
          </p>
          {apps.topBrowser && (
            <p className="text-sm text-gray-700">
              Top browser: <span className="font-semibold">{apps.topBrowser.browser}</span>
            </p>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
            Screenshots
          </h2>
          <p className="text-sm text-gray-700">
            Count: <span className="font-semibold">{screenshots.count}</span>
          </p>
        </div>
      </section>

      {/* Charts and lists */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-gray-800">Keyboard activity</h2>
          <KeyboardActivityChart data={keyboard.rows} />
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-gray-800">Mouse activity</h2>
          <MouseActivityChart data={mouse.rows} />
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-gray-800">App usage</h2>
          <AppUsageList topApps={apps.topApps} topBrowser={apps.topBrowser} />
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-gray-800">Screenshots</h2>
          <ScreenshotGrid screenshots={screenshots.recentThree} />
        </div>
      </section>
    </main>
  );
}
