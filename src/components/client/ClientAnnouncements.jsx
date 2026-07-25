"use client";

import { useEffect, useState, useCallback } from "react";
import { Megaphone, Globe, FolderKanban } from "lucide-react";
import { authFetch } from "@/utils/authFetch";
import { Spinner, EmptyState, ErrorState, SectionHeader, formatDateTime } from "./ClientShared";

export default function ClientAnnouncements() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const res = await authFetch("/api/client/announcements");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Failed to load announcements.");
        return;
      }
      setItems(Array.isArray(data.announcements) ? data.announcements : Array.isArray(data) ? data : []);
    } catch {
      setError("Something went wrong while loading announcements.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Spinner label="Loading announcements…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="space-y-6">
      <SectionHeader title="Announcements" subtitle="News and updates from your agency" />

      {items.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No announcements yet"
          message="When your agency posts an update, you'll see it here."
        />
      ) : (
        <div className="space-y-4">
          {items.map((a) => {
            const isProject = Boolean(a.project_id || a.project_name);
            return (
              <div key={a.id} className="rounded-xl border border-border bg-card p-5 shadow-card">
                <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
                  <h3 className="text-base font-bold text-foreground">{a.title || "Announcement"}</h3>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                      isProject ? "bg-primary/10 text-primary" : "bg-info/10 text-info"
                    }`}
                  >
                    {isProject ? <FolderKanban className="h-3.5 w-3.5" /> : <Globe className="h-3.5 w-3.5" />}
                    {isProject ? a.project_name || "Project" : "Org-wide"}
                  </span>
                </div>
                {a.body && <p className="text-sm text-muted-foreground whitespace-pre-line">{a.body}</p>}
                {(a.published_at || a.created_at) && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {formatDateTime(a.published_at || a.created_at)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
