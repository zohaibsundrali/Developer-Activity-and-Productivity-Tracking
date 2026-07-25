"use client";

import { useEffect, useState, useCallback } from "react";
import { FolderKanban, Zap, CheckCircle2, CalendarClock, ArrowRight } from "lucide-react";
import { authFetch } from "@/utils/authFetch";
import StatCard from "@/components/shell/StatCard";
import {
  Spinner,
  EmptyState,
  ErrorState,
  StatusBadge,
  ProgressBar,
  formatDate,
} from "./ClientShared";

const isInProgress = (s) => ["active", "in_progress", "in progress", "ongoing"].includes(String(s || "").toLowerCase());
const isCompleted = (s) => ["completed", "done"].includes(String(s || "").toLowerCase());

export default function ClientOverview({ user, onViewProject, onSectionChange }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const res = await authFetch("/api/client/projects");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Failed to load your projects.");
        return;
      }
      setProjects(Array.isArray(data.projects) ? data.projects : []);
    } catch {
      setError("Something went wrong while loading your dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const greetingName = user?.name || user?.full_name || "there";
  const orgName = user?.organization_name;

  if (loading) return <Spinner label="Loading your dashboard…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const total = projects.length;
  const inProgress = projects.filter((p) => isInProgress(p.status)).length;
  const completed = projects.filter((p) => isCompleted(p.status)).length;

  // Next milestone = nearest upcoming deadline across active projects.
  const upcoming = projects
    .filter((p) => p.deadline && !isCompleted(p.status))
    .map((p) => ({ ...p, _t: new Date(p.deadline).getTime() }))
    .filter((p) => !isNaN(p._t) && p._t >= Date.now() - 24 * 60 * 60 * 1000)
    .sort((a, b) => a._t - b._t);
  const nextDeadline = upcoming[0];

  return (
    <div className="space-y-8">
      {/* Greeting */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-card">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">
          Welcome back, {greetingName}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {orgName ? `Here's the latest across your projects with ${orgName}.` : "Here's the latest across your projects."}
        </p>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Total Projects" value={total} icon={FolderKanban} tone="primary" />
        <StatCard title="In Progress" value={inProgress} icon={Zap} tone="info" />
        <StatCard title="Completed" value={completed} icon={CheckCircle2} tone="success" />
        <StatCard
          title="Next Milestone"
          value={nextDeadline ? formatDate(nextDeadline.deadline) : "—"}
          icon={CalendarClock}
          tone="warning"
          hint={
            nextDeadline ? (
              <span className="truncate text-muted-foreground">{nextDeadline.name}</span>
            ) : undefined
          }
        />
      </div>

      {/* Projects */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold tracking-tight text-foreground">Your Projects</h3>
          {total > 0 && (
            <button
              onClick={() => onSectionChange?.("projects")}
              className="inline-flex items-center text-sm font-medium text-primary hover:underline"
            >
              View all
              <ArrowRight className="ml-1 h-4 w-4" />
            </button>
          )}
        </div>

        {total === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title="No projects linked yet"
            message="Once your agency links a project to your account, it will appear here."
          />
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {projects.slice(0, 6).map((project) => (
              <button
                key={project.id}
                onClick={() => onViewProject?.(project.id)}
                className="group text-left border border-border rounded-xl bg-card p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <h4 className="text-base font-bold text-foreground line-clamp-1">
                    {project.name || "Untitled Project"}
                  </h4>
                  <StatusBadge status={project.status} />
                </div>
                {project.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
                    {project.description}
                  </p>
                )}
                <ProgressBar value={project.progress} />
                {project.deadline && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Deadline: <span className="font-medium text-foreground">{formatDate(project.deadline)}</span>
                  </p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
