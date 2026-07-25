"use client";

import { useEffect, useState, useCallback } from "react";
import { FolderKanban, Calendar, Clock, ArrowRight } from "lucide-react";
import { authFetch } from "@/utils/authFetch";
import {
  Spinner,
  EmptyState,
  ErrorState,
  StatusBadge,
  ProgressBar,
  SectionHeader,
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

  if (loading) return <Spinner label="Loading your projects…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="My Projects"
        subtitle="Track the status and progress of your projects"
        right={
          <div className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{projects.length}</span> total
          </div>
        }
      />

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
              <button
                key={project.id}
                onClick={() => onViewProject?.(project.id)}
                className="group text-left border border-border rounded-xl overflow-hidden bg-card transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
              >
                <div className="p-5 border-b border-border">
                  <div className="flex justify-between items-start gap-3 mb-3">
                    <h3 className="text-lg font-bold text-foreground line-clamp-1">
                      {project.name || "Untitled Project"}
                    </h3>
                    <StatusBadge status={project.status} />
                  </div>

                  {project.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
                      {project.description}
                    </p>
                  )}

                  <ProgressBar value={project.progress} />
                </div>

                <div className="p-5 flex items-center justify-between">
                  <div className="space-y-1">
                    {project.deadline ? (
                      <>
                        <div className="flex items-center text-sm text-foreground">
                          <Calendar className="w-4 h-4 mr-1.5 text-primary" />
                          <span className="font-medium">{formatDate(project.deadline)}</span>
                        </div>
                        {dl && (
                          <span className="inline-flex items-center text-xs text-muted-foreground">
                            <Clock className="w-3.5 h-3.5 mr-1" />
                            {dl}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">No deadline set</span>
                    )}
                  </div>
                  <span className="inline-flex items-center text-sm font-medium text-primary transition-transform group-hover:translate-x-0.5">
                    View
                    <ArrowRight className="w-4 h-4 ml-1" />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
