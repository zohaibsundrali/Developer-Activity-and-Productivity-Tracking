"use client";

import { useEffect, useState, useCallback } from "react";
import { FolderKanban, Calendar, Clock } from "lucide-react";
import { authFetch } from "@/utils/authFetch";
import {
  ClientPage,
  EmptyState,
  ErrorState,
  StatusBadge,
  ProgressBar,
  CardsSkeleton,
  surface,
  formatDate,
  deadlineLabel,
} from "./ClientShared";

export default function ClientProjects({ onViewProject }) {
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
        setError(data?.error || "Failed to load projects.");
        return;
      }
      setProjects(Array.isArray(data.projects) ? data.projects : []);
    } catch {
      setError("Something went wrong while loading your projects.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <ClientPage title="My Projects" description="Track the status and progress of your projects" width="wide">
        <CardsSkeleton count={3} />
      </ClientPage>
    );
  }

  if (error) {
    return (
      <ClientPage title="My Projects" description="Track the status and progress of your projects" width="wide">
        <ErrorState message={error} onRetry={load} />
      </ClientPage>
    );
  }

  return (
    <ClientPage
      title="My Projects"
      description="Track the status and progress of your projects"
      width="wide"
      actions={
        <span className="text-base text-muted-foreground">
          <span className="font-semibold text-foreground">{projects.length}</span> total
        </span>
      }
    >
      {projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects linked yet"
          message="Once your agency links a project to your account, it will appear here."
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => {
            const dl = deadlineLabel(project.deadline);
            return (
              // The card is the only control on itself — no separate "View"
              // affordance competing with the thing it sits inside.
              <button
                key={project.id}
                onClick={() => onViewProject?.(project.id)}
                className={`${surface} space-y-5 p-6 text-left transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="line-clamp-2 text-lg font-semibold leading-snug text-foreground">
                    {project.name || "Untitled Project"}
                  </h3>
                  <StatusBadge status={project.status} />
                </div>

                {project.description && (
                  <p className="line-clamp-2 text-[15px] leading-relaxed text-muted-foreground">
                    {project.description}
                  </p>
                )}

                <ProgressBar value={project.progress} />

                <div className="border-t border-border pt-4">
                  {project.deadline ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-[15px] text-foreground">
                        <Calendar className="h-4 w-4 text-primary" aria-hidden="true" />
                        <span className="font-medium">{formatDate(project.deadline)}</span>
                      </div>
                      {dl && (
                        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                          {dl}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">No deadline set</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </ClientPage>
  );
}
