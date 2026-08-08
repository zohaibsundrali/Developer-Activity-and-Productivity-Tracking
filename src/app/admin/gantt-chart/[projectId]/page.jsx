"use client";
import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/utils/supabaseClient";
import AdminGanttChart from "@/components/admin/AdminGanttChart";
import { isSessionExpired, clearAdminSession } from "@/utils/sessionPolicy";
import StatCard from "@/components/shell/StatCard";
import {
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Section,
  Skeleton,
  SkeletonCard,
} from "@/components/ui";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Download,
  ListChecks,
  RefreshCw,
  SearchX,
  TrendingUp,
} from "lucide-react";

// Authentication check function for admin
const checkAdminAuth = () => {
  if (typeof window === 'undefined') return false;

  const adminUser = sessionStorage.getItem("adminUser");
  if (!adminUser) return false;

  try {
    const userData = JSON.parse(adminUser);

    // Verify it's actually an admin
    if (userData.role !== 'admin') {
      clearAdminSession();
      return false;
    }

    // Session expiry check (7 days sliding inactivity)
    if (isSessionExpired(userData)) {
      clearAdminSession();
      return false;
    }

    return userData;
  } catch (error) {
    return false;
  }
};

export default function AdminGanttChartPage() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.projectId;

  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [developers, setDevelopers] = useState({});
  const [currentAdmin, setCurrentAdmin] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Check admin authentication
    const adminData = checkAdminAuth();
    if (!adminData) {
      router.push("/login?redirect=/admin/gantt-chart/" + projectId);
      return;
    }

    setCurrentAdmin(adminData);
    fetchProjectData();

    // Set up real-time subscription for task updates
    const tasksSubscription = supabase
      .channel(`project-tasks-${projectId}`)
      .on('postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'developer_tasks',
          filter: `project_id=eq.${projectId}`
        },
        (payload) => {
          fetchProjectData(); // Refresh data on any change
        }
      )
      .subscribe();

    // Also listen to project changes
    const projectSubscription = supabase
      .channel(`project-${projectId}`)
      .on('postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'projects',
          filter: `id=eq.${projectId}`
        },
        (payload) => {
          setProject(payload.new);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(tasksSubscription);
      supabase.removeChannel(projectSubscription);
    };
  }, [projectId, router]);

  const fetchProjectData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch project details
      const { data: projectData, error: projectError } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .single();

      if (projectError) throw projectError;

      if (!projectData) {
        setError('Project not found');
        return;
      }

      setProject(projectData);

      // Fetch all tasks for this project
      const { data: tasksData, error: tasksError } = await supabase
        .from('developer_tasks')
        .select(`
          *,
          developer:developers (
            id,
            name,
            email
          )
        `)
        .eq('project_id', projectId)
        .order('task_order', { ascending: true });

      if (tasksError) throw tasksError;

      setTasks(tasksData || []);

      // Build developers map
      const devsMap = {};
      tasksData?.forEach(task => {
        if (task.developer && task.developer_id) {
          devsMap[task.developer_id] = task.developer;
        }
      });
      setDevelopers(devsMap);

    } catch (error) {
      console.error('Error fetching project data:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    router.push('/admin/dashboard');
  };

  const handleRefresh = () => {
    fetchProjectData();
  };

  const handleExportData = () => {
    const exportData = {
      project: {
        name: project.name,
        description: project.description,
        deadline: project.deadline,
        progress: project.progress,
        status: project.status
      },
      tasks: tasks.map(task => ({
        title: task.task_title,
        description: task.task_description,
        start_date: task.start_date,
        end_date: task.end_date,
        status: task.status,
        developer: task.developer?.name,
        is_on_time: task.is_on_time,
        productivity_points: task.productivity_points
      })),
      exportedAt: new Date().toISOString(),
      exportedBy: currentAdmin?.full_name || currentAdmin?.email
    };

    const dataStr = JSON.stringify(exportData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `project-${project?.name?.replace(/\s+/g, '-')}-gantt-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const pageFrame = (children) => (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</div>
    </div>
  );

  const crumbs = [
    { label: "Dashboard", href: "/admin/dashboard" },
    { label: project?.name || "Gantt chart" },
  ];

  if (loading) {
    return pageFrame(
      <>
        <PageHeader title="Gantt chart" breadcrumbs={crumbs} />
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <SkeletonCard key={i} lines={1} />
            ))}
          </div>
          <div className="rounded-xl border border-border bg-card p-5 shadow-card">
            <Skeleton className="h-5 w-56" />
            <Skeleton className="mt-4 h-9 w-full" />
            <div className="mt-5 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-3 w-36 shrink-0" />
                  <Skeleton
                    className="h-6 rounded-full"
                    style={{ width: `${25 + ((i * 19) % 55)}%`, marginLeft: `${(i * 13) % 30}%` }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </>
    );
  }

  if (error) {
    return pageFrame(
      <>
        <PageHeader title="Gantt chart" breadcrumbs={crumbs} />
        <ErrorState
          title="Couldn't load this project"
          description={error}
          onRetry={handleRefresh}
        />
        <div className="mt-4 flex justify-center">
          <Button variant="outline" size="lg" onClick={handleBack}>
            <ArrowLeft aria-hidden="true" />
            Back to dashboard
          </Button>
        </div>
      </>
    );
  }

  if (!project) {
    return pageFrame(
      <>
        <PageHeader title="Gantt chart" breadcrumbs={crumbs} />
        <EmptyState
          icon={SearchX}
          title="Project not found"
          description="This project no longer exists, or you do not have access to it."
          action={
            <Button variant="outline" size="lg" onClick={handleBack}>
              <ArrowLeft aria-hidden="true" />
              Back to dashboard
            </Button>
          }
        />
      </>
    );
  }

  const completedCount = tasks.filter((t) => t.status === "completed").length;

  return pageFrame(
    <>
      <PageHeader
        title={project.name}
        description="Project timeline and task management"
        breadcrumbs={crumbs}
        actions={
          <>
            <Button variant="outline" size="lg" onClick={handleBack}>
              <ArrowLeft aria-hidden="true" />
              Back
            </Button>
            <Button variant="outline" size="lg" onClick={handleRefresh}>
              <RefreshCw aria-hidden="true" />
              Refresh
            </Button>
            <Button size="lg" onClick={handleExportData}>
              <Download aria-hidden="true" />
              Export data
            </Button>
          </>
        }
      />

      <div className="space-y-6">
        {/* Project overview stats */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Total tasks" value={tasks.length} icon={ListChecks} tone="info" />
          <StatCard title="Completed" value={completedCount} icon={CheckCircle2} tone="success" />
          <StatCard
            title="Progress"
            value={`${project.progress ?? 0}%`}
            icon={TrendingUp}
            tone="primary"
          />
          <StatCard
            title="Deadline"
            value={
              project.deadline ? new Date(project.deadline).toLocaleDateString() : "Not set"
            }
            icon={CalendarClock}
            tone="warning"
          />
        </div>

        {/* Gantt chart */}
        <AdminGanttChart
          tasks={tasks}
          projectName={project.name}
          developers={developers}
        />

        {/* Assigned developers */}
        {Object.keys(developers).length > 0 && (
          <Section title="Assigned developers">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Object.values(developers).map((dev) => {
                const devTasks = tasks.filter((t) => t.developer_id === dev.id);
                const completedTasks = devTasks.filter((t) => t.status === "completed").length;
                const pct = devTasks.length > 0 ? (completedTasks / devTasks.length) * 100 : 0;

                return (
                  <div
                    key={dev.id}
                    className="rounded-xl border border-border bg-card p-4 shadow-card transition-shadow duration-150 hover:shadow-elevated"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                        {dev.name?.charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{dev.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {dev.designation || "Developer"}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 border-t border-border pt-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Tasks</span>
                        <span className="font-semibold tabular-nums text-foreground">
                          {completedTasks}/{devTasks.length}
                        </span>
                      </div>
                      <div
                        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"
                        role="progressbar"
                        aria-valuenow={completedTasks}
                        aria-valuemin={0}
                        aria-valuemax={devTasks.length}
                        aria-label={`${dev.name} task completion`}
                      >
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${pct}%` }}
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
    </>
  );
}
