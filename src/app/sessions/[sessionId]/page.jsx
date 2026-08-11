"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Camera, Keyboard, LogIn, MousePointer2, Monitor } from "lucide-react";
import { useAuth } from "../../../contexts/AuthContext.jsx";
import {
  useKeyboardRealtime,
  useMouseRealtime,
  useAppUsageRealtime,
  useWebsiteUsageRealtime,
  useScreenshotsRealtime,
} from "../../../hooks/activityHooks.js";
import { supabase } from "../../../utils/supabaseClient";
import {
  KeyboardActivityChart,
  MouseActivityChart,
  AppUsageList,
  WebsiteUsageList,
  ScreenshotGrid,
} from "../../../components/developer/SessionUI.jsx";
import {
  Button,
  EmptyState,
  PageHeader,
  Section,
  Skeleton,
  StatusPill,
} from "@/components/ui";

/**
 * One metric tile. Figures are tabular so the four tiles line up, and the
 * loading variant is the same shape so the row never changes height.
 */
function MetricTile({ icon: Icon, title, rows, loading }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5">
      <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden="true" />
        {title}
      </h2>
      <dl className="mt-3 space-y-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3 text-sm">
            <dt className="truncate text-muted-foreground">{row.label}</dt>
            <dd className="shrink-0 font-semibold tabular-nums text-foreground">
              {loading ? <Skeleton className="h-4 w-12" /> : row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function SessionDetailPage() {
  const { sessionId } = useParams();
  const router = useRouter();
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

  const websites = useWebsiteUsageRealtime({
    sessionId,
    userEmail,
  });

  const screenshots = useScreenshotsRealtime({
    developerId,
    developerEmail: userEmail,
    session,
  });

  if (authLoading) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="space-y-6">
          <div className="space-y-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-80" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32 w-full rounded-xl" />
            ))}
          </div>
        </div>
      </main>
    );
  }

  if (!userEmail) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <EmptyState
          icon={LogIn}
          title="Sign in to view this session"
          description="Session detail is private to the account that recorded it."
          action={<Button onClick={() => router.push("/login")}>Go to login</Button>}
        />
      </main>
    );
  }

  const started = session?.start_time ? new Date(session.start_time).toLocaleString() : null;
  const ended = session?.end_time ? new Date(session.end_time).toLocaleString() : null;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumbs={[{ label: "Sessions", href: "/sessions" }, { label: "Session detail" }]}
        title="Session detail"
        description={
          <span className="font-mono text-xs tabular-nums">{sessionId}</span>
        }
        actions={
          session?.status ? (
            <StatusPill
              status={String(session.status).toLowerCase() === "active" ? "active" : "success"}
              label={session.status}
            />
          ) : null
        }
      />

      <div className="space-y-6">
        {/* Session summary line — a skeleton while it loads, never a bare null. */}
        <div className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5">
          {sessionLoading ? (
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-24" />
            </div>
          ) : session ? (
            <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <div className="flex items-baseline gap-2">
                <dt className="text-muted-foreground">Started</dt>
                <dd className="tabular-nums text-foreground">{started || "—"}</dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="text-muted-foreground">Ended</dt>
                <dd className="tabular-nums text-foreground">{ended || "Ongoing"}</dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="text-muted-foreground">Productivity score</dt>
                <dd className="font-semibold tabular-nums text-foreground">
                  {session.productivity_score ?? 0}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              No summary row was found for this session — the activity below is still live.
            </p>
          )}
        </div>

        {/* Metric tiles */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricTile
            icon={Keyboard}
            title="Keyboard"
            loading={keyboard.loading}
            rows={[
              { label: "Total keys", value: keyboard.totalKeys },
              { label: "Avg WPM", value: keyboard.avgWpm.toFixed(1) },
              { label: "Activity %", value: `${keyboard.avgActivityPct.toFixed(1)}%` },
            ]}
          />
          <MetricTile
            icon={MousePointer2}
            title="Mouse"
            loading={mouse.loading}
            rows={[
              { label: "Total events", value: mouse.totalEvents },
              { label: "Avg active %", value: `${mouse.avgActivePct.toFixed(1)}%` },
              { label: "Avg idle %", value: `${mouse.avgIdlePct.toFixed(1)}%` },
            ]}
          />
          <MetricTile
            icon={Monitor}
            title="Apps"
            loading={apps.loading}
            rows={[
              { label: "Unique apps", value: apps.topApps.length },
              { label: "Top browser", value: apps.topBrowser?.browser || "—" },
            ]}
          />
          <MetricTile
            icon={Camera}
            title="Screenshots"
            loading={screenshots.loading}
            rows={[{ label: "Captured", value: screenshots.count }]}
          />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Section
            title="Keyboard activity"
            description="Words per minute against keyboard activity share, per minute."
            className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5"
          >
            <KeyboardActivityChart
              data={keyboard.rows}
              loading={keyboard.loading}
              error={keyboard.error}
              onRetry={keyboard.refresh}
            />
          </Section>

          <Section
            title="Mouse activity"
            description="Active and idle share of each tracked minute."
            className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5"
          >
            <MouseActivityChart
              data={mouse.rows}
              loading={mouse.loading}
              error={mouse.error}
              onRetry={mouse.refresh}
            />
          </Section>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Section
            title="App usage"
            description="Applications used in this session, longest first."
            className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5"
          >
            <AppUsageList
              topApps={apps.topApps}
              topBrowser={apps.topBrowser}
              loading={apps.loading}
              error={apps.error}
              onRetry={apps.refresh}
            />
          </Section>

          <Section
            title="Websites"
            description="Time per domain in this session, longest first. Domains only — no page addresses are recorded."
            className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5"
          >
            <WebsiteUsageList
              sites={websites.topSites}
              loading={websites.loading}
              error={websites.error}
              onRetry={websites.refresh}
            />
          </Section>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Section
            title="Screenshots"
            description="Three most recent captures."
            className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5"
          >
            <ScreenshotGrid
              screenshots={screenshots.recentThree}
              loading={screenshots.loading}
              error={screenshots.error}
              onRetry={screenshots.refresh}
            />
          </Section>
        </div>
      </div>
    </main>
  );
}
