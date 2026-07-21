"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";

export function SessionCard({ session, onClick }) {
  if (!session) return null;
  const start = session.start_time
    ? new Date(session.start_time).toLocaleString()
    : "Unknown";
  const end = session.end_time
    ? new Date(session.end_time).toLocaleString()
    : "Ongoing";

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-xl border border-border bg-card p-4 shadow-card hover:border-primary hover:shadow-md transition"
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm text-muted-foreground">Session ID</div>
          <div className="font-mono text-xs text-foreground truncate max-w-xs">
            {session.session_id}
          </div>
        </div>
        <span className="inline-flex rounded-full bg-info/10 px-3 py-1 text-xs font-medium text-info">
          {session.status || "unknown"}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-muted-foreground">
        <div>
          <span className="font-medium">Start:</span> {start}
        </div>
        <div>
          <span className="font-medium">End:</span> {end}
        </div>
        <div>
          <span className="font-medium">Total duration:</span> {session.total_duration ?? 0} min
        </div>
        <div>
          <span className="font-medium">Productivity score:</span> {session.productivity_score ?? 0}
        </div>
      </div>
    </button>
  );
}

export function KeyboardActivityChart({ data }) {
  if (!data?.length) return <p className="text-sm text-muted-foreground">No keyboard data yet.</p>;

  const chartData = data.map((r) => ({
    time: String(r.minute_timestamp).slice(11, 16),
    wpm: Number(r.words_per_minute) || 0,
    activityPct: Number(r.keyboard_activity_percentage) || 0,
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="time" stroke="#6b7280" fontSize={12} />
          <YAxis yAxisId="left" stroke="#0ea5e9" fontSize={12} />
          <YAxis yAxisId="right" orientation="right" stroke="#22c55e" fontSize={12} />
          <Tooltip />
          <Legend />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="wpm"
            stroke="#0ea5e9"
            strokeWidth={2}
            dot={false}
            name="WPM"
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="activityPct"
            stroke="#22c55e"
            strokeWidth={2}
            dot={false}
            name="Keyboard %"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MouseActivityChart({ data }) {
  if (!data?.length) return <p className="text-sm text-muted-foreground">No mouse data yet.</p>;

  const chartData = data
    .slice()
    .reverse()
    .map((r) => ({
      time: r.timestamp ? new Date(r.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "",
      active: Number(r.active_percentage) || 0,
      idle: Number(r.idle_percentage) || 0,
    }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 10, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="time" stroke="#6b7280" fontSize={12} />
          <YAxis stroke="#6b7280" fontSize={12} />
          <Tooltip />
          <Legend />
          <Bar dataKey="active" stackId="a" fill="#22c55e" name="Active %" />
          <Bar dataKey="idle" stackId="a" fill="#ef4444" name="Idle %" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AppUsageList({ topApps, topBrowser }) {
  if (!topApps?.length) return <p className="text-sm text-muted-foreground">No app usage recorded yet.</p>;

  return (
    <div className="space-y-2 text-sm">
      {topBrowser && (
        <div className="mb-2 rounded-md bg-info/10 px-3 py-2 text-info">
          <span className="font-semibold">Top browser:</span> {topBrowser.browser} ({
            topBrowser.totalMinutes.toFixed(1)
          }
          m)
        </div>
      )}
      <ul className="space-y-1">
        {topApps.map((a) => (
          <li
            key={a.app}
            className="flex items-center justify-between rounded border border-border px-3 py-1.5"
          >
            <span className="truncate mr-2" title={a.app}>
              {a.app}
            </span>
            <span className="font-mono text-xs text-foreground">
              {a.totalMinutes.toFixed(1)} m
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ScreenshotGrid({ screenshots }) {
  if (!screenshots?.length) return <p className="text-sm text-muted-foreground">No screenshots for this session.</p>;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {screenshots.map((shot) => (
        <div
          key={shot.id || shot.filename}
          className="overflow-hidden rounded-lg border border-border bg-card shadow-card"
        >
          <div className="aspect-video bg-muted">
            {/* Coalesce across the possible URL columns (desktop app writes
                public_url; website upload route may write image_url/thumbnail_url). */}
            {(shot.public_url || shot.image_url || shot.thumbnail_url) ? (
              <img
                src={shot.public_url || shot.image_url || shot.thumbnail_url}
                alt={shot.app_active || shot.filename || "Screenshot"}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                No preview
              </div>
            )}
          </div>
          <div className="px-2 py-1.5 text-xs text-muted-foreground space-y-0.5">
            <div className="truncate" title={shot.app_active || "Unknown app"}>
              {shot.app_active || "Unknown app"}
            </div>
            <div className="truncate">
              {shot.timestamp
                ? new Date(shot.timestamp).toLocaleTimeString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : ""}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
