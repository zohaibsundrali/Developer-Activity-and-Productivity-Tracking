"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/utils/supabaseClient";
import AdminGanttChart from "@/components/admin/AdminGanttChart";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Download,
  GanttChartSquare,
  ListChecks,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import StatCard from "@/components/shell/StatCard";
import {
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Section,
  Skeleton,
} from "@/components/ui";
import { isSessionExpired, clearDeveloperSession, touchDeveloperSession } from "@/utils/sessionPolicy";

const checkDeveloperAuth = () => {
  if (typeof window === "undefined") return false;

  const developerUser = sessionStorage.getItem("developerUser");
  if (!developerUser) return false;

  try {
    const userData = JSON.parse(developerUser);

    if (isSessionExpired(userData)) {
      clearDeveloperSession();
      return false;
    }

    return userData;
  } catch {
    clearDeveloperSession();
    return false;
  }
};

export default function DeveloperGanttChartPage() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.projectId;

  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [developer, setDeveloper] = useState(null);
  const [developers, setDevelopers] = useState({});
  const [currentDeveloper, setCurrentDeveloper] = useState(null);
  const [error, setError] = useState(null);

  const realtimeCleanupRef = useRef(null);

  const developerId = useMemo(() => {
    // Prefer developer profile returned by API, else fall back to stored session ID.
    if (developer?.id != null) return developer.id;
    if (currentDeveloper?.id != null) return currentDeveloper.id;
    return null;
  }, [developer?.id, currentDeveloper?.id]);

  useEffect(() => {
    const devData = checkDeveloperAuth();
    if (!devData) {
      router.push("/login?redirect=/developer/gantt-chart/" + projectId);
      return;
    }

    // Normalize session shape so cookie scoping always has an id.
    const normalizedDeveloper = {
      ...devData,
      id: devData?.id ?? devData?.user?.id ?? devData?.user_id,
    };

    setCurrentDeveloper(normalizedDeveloper);

    // Ensure cookies exist for API scoping (developer_auth + developer_id)
    try {
      touchDeveloperSession(normalizedDeveloper);
    } catch {
      // ignore
    }

    fetchProjectData();
  }, [projectId, router]);

  // Set up realtime updates for *this developer* only.
  useEffect(() => {
    if (!developerId) return;

    if (realtimeCleanupRef.current) {
      realtimeCleanupRef.current();
      realtimeCleanupRef.current = null;
    }

    const channel = supabase
      .channel(`developer-tasks-${developerId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "developer_tasks",
          filter: `developer_id=eq.${developerId}`,
        },
        (payload) => {
          // Only refresh for the current project.
          const nextProjectId = payload?.new?.project_id ?? payload?.old?.project_id;
          if (String(nextProjectId) !== String(projectId)) return;
          fetchProjectData();
        }
      )
      .subscribe();

    realtimeCleanupRef.current = () => {
      supabase.removeChannel(channel);
    };

    return () => {
      if (realtimeCleanupRef.current) realtimeCleanupRef.current();
      realtimeCleanupRef.current = null;
    };
  }, [developerId, projectId]);

  const fetchProjectData = async () => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch(`/api/developer-gantt?projectId=${projectId}&developerId=${encodeURIComponent(String(developerId || ''))}`, {
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.success) {
        setError(data?.error || "Failed to load project timeline");
        return;
      }

      setProject(data.project || null);
      setTasks(data.tasks || []);
      setDeveloper(data.developer || null);

      // Build developers map (same shape as Admin page expects)
      const devsMap = {};
      (data.tasks || []).forEach((task) => {
        if (task.developer && task.developer_id) {
          devsMap[task.developer_id] = task.developer;
        }
      });
      if (data.developer?.id) {
        devsMap[data.developer.id] = data.developer;
      }
      setDevelopers(devsMap);
    } catch (err) {
      setError(err?.message || "Error fetching project data");
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    router.push("/developer/dashboard?section=projects");
  };

  const handleRefresh = () => {
    fetchProjectData();
  };

  const handleExportData = () => {
    const exportedBy =
      currentDeveloper?.name || currentDeveloper?.full_name || currentDeveloper?.email || "Developer";

    const exportData = {
      project: project
        ? {
            name: project.name,
            description: project.description,
            deadline: project.deadline,
            progress: project.progress,
            status: project.status,
          }
        : null,
      tasks: (tasks || []).map((task) => ({
        title: task.task_title,
        description: task.task_description,
        start_date: task.start_date,
        end_date: task.end_date,
        status: task.status,
        developer: task.developer?.name,
        progress_percentage: task.progress_percentage ?? null,
      })),
      exportedAt: new Date().toISOString(),
      exportedBy,
    };

    const dataStr = JSON.stringify(exportData, null, 2);
    const dataBlob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `project-${project?.name?.replace(/\s+/g, "-") || projectId}-timeline-${new Date()
      .toISOString()
      .split("T")[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Skeleton shaped like the real page: header, four tiles, then the chart.
  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8" aria-busy="true">
          <div className="mb-6 space-y-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-80" />
          </div>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-[420px] w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
          <ErrorState
            title="Couldn't load this timeline"
            description={error}
            onRetry={handleRefresh}
          />
          <div className="mt-4 flex justify-center">
            <Button variant="outline" onClick={handleBack}>
              Back to dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
          <EmptyState
            icon={GanttChartSquare}
            title="Project not found"
            description="This project either does not exist or is not assigned to you."
            action={<Button onClick={handleBack}>Back to dashboard</Button>}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <PageHeader
          breadcrumbs={[
            { label: "Projects", href: "/developer/dashboard?section=projects" },
            { label: project.name },
          ]}
          title={project.name}
          description="Project timeline and task management"
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={handleBack}>
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back
              </Button>
              <Button variant="outline" onClick={handleRefresh}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Refresh
              </Button>
              <Button onClick={handleExportData}>
                <Download className="h-4 w-4" aria-hidden="true" />
                Export
              </Button>
            </div>
          }
        />

        {/* Project overview stats */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Total tasks" value={tasks.length} icon={ListChecks} tone="info" />
          <StatCard
            title="Completed"
            value={tasks.filter((t) => t.status === "completed").length}
            icon={CheckCircle2}
            tone="success"
          />
          <StatCard title="Progress" value={`${project.progress ?? 0}%`} icon={TrendingUp} tone="primary" />
          <StatCard
            title="Deadline"
            value={project.deadline ? new Date(project.deadline).toLocaleDateString() : "Not set"}
            icon={CalendarClock}
            tone="warning"
          />
        </div>

        {/* Gantt Chart Component (same UI as Admin, but hides developer selector in developer view) */}
        <AdminGanttChart
          tasks={tasks}
          projectName={project.name}
          developers={developers}
          showProgress
          showDeveloperFilter={false}
        />

        {/* Assigned Developers (will be just the current dev in this view) */}
        {Object.keys(developers).length > 0 && (
          <Section
            title="Assigned developers"
            description="Who is working on this project, and how far along they are."
            className="mt-6 rounded-xl border border-border bg-card p-4 shadow-card sm:p-5"
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Object.values(developers).map((dev) => {
                const devTasks = tasks.filter((t) => t.developer_id === dev.id);
                const completedTasks = devTasks.filter((t) => t.status === "completed").length;

                return (
                  <div
                    key={dev.id}
                    className="rounded-lg border border-border p-4 transition-shadow duration-150 hover:shadow-card"
                  >
                    <div className="mb-3 flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">
                        {dev.name?.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground" title={dev.name}>{dev.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{dev.designation || "Developer"}</p>
                      </div>
                    </div>
                    <div className="mt-3 border-t border-border pt-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Tasks</span>
                        <span className="font-semibold tabular-nums text-foreground">
                          {completedTasks}/{devTasks.length}
                        </span>
                      </div>
                      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-2 rounded-full bg-primary"
                          style={{ width: `${devTasks.length > 0 ? (completedTasks / devTasks.length) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
