"use client";

import { useEffect, useState, useCallback } from "react";
import { Megaphone, Globe, FolderKanban } from "lucide-react";
import { authFetch } from "@/utils/authFetch";
import { Badge } from "@/components/ui";
import {
  ClientPage,
  Panel,
  EmptyState,
  ErrorState,
  RowsSkeleton,
  formatDateTime,
} from "./ClientShared";

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

  if (loading) {
    return (
      <ClientPage title="Announcements" description="News and updates from your agency">
        <RowsSkeleton count={3} />
      </ClientPage>
    );
  }

  if (error) {
    return (
      <ClientPage title="Announcements" description="News and updates from your agency">
        <ErrorState description={error} onRetry={load} />
      </ClientPage>
    );
  }

  return (
    <ClientPage title="Announcements" description="News and updates from your agency">
      {items.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No announcements yet"
          description="When your agency posts an update, you'll see it here."
        />
      ) : (
        <div className="space-y-6">
          {items.map((a) => {
            const isProject = Boolean(a.project_id || a.project_name);
            return (
              <Panel key={a.id} className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h2 className="text-lg font-semibold leading-snug text-foreground">
                    {a.title || "Announcement"}
                  </h2>
                  <Badge variant={isProject ? "default" : "info"}>
                    {isProject ? (
                      <FolderKanban className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {isProject ? a.project_name || "Project" : "Org-wide"}
                  </Badge>
                </div>
                {a.body && (
                  <p className="whitespace-pre-line text-[15px] leading-relaxed text-muted-foreground">{a.body}</p>
                )}
                {(a.published_at || a.created_at) && (
                  <p className="text-sm text-muted-foreground">
                    {formatDateTime(a.published_at || a.created_at)}
                  </p>
                )}
              </Panel>
            );
          })}
        </div>
      )}
    </ClientPage>
  );
}
