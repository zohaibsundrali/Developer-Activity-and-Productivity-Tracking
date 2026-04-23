"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import AdminGanttChart from "@/components/admin/AdminGanttChart";
import { isSessionExpired, clearDeveloperSession, touchDeveloperSession } from "@/utils/sessionPolicy";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const checkDeveloperAuth = () => {
  if (typeof window === "undefined") return false;

  const developerUser = localStorage.getItem("developerUser");
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

      const res = await fetch(`/api/developer-gantt?projectId=${projectId}`, {
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-[#009578] mb-4"></div>
          <p className="text-xl text-gray-600">Loading Gantt Chart...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <svg className="w-16 h-16 text-red-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h2 className="text-xl font-bold text-red-800 mb-2">Error Loading Project</h2>
            <p className="text-red-600 mb-4">{error}</p>
            <button
              onClick={handleBack}
              className="bg-red-600 text-white px-6 py-2 rounded-lg hover:bg-red-700 transition-colors"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-xl text-gray-600">Project not found</p>
          <button
            onClick={handleBack}
            className="mt-4 bg-[#009578] text-white px-6 py-2 rounded-lg hover:bg-[#0e7762] transition-colors"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center">
            <button
              onClick={handleBack}
              className="flex items-center text-gray-600 hover:text-gray-800 mr-4 bg-white px-4 py-2 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-all"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to Dashboard
            </button>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">{project.name}</h1>
              <p className="text-gray-600 mt-1">Project Timeline & Task Management</p>
            </div>
          </div>

          <div className="flex space-x-3">
            <button
              onClick={handleRefresh}
              className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors font-medium flex items-center"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
            <button
              onClick={handleExportData}
              className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-colors font-medium flex items-center"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export Data
            </button>
          </div>
        </div>

        {/* Project Overview Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center">
              <div className="bg-blue-100 p-3 rounded-lg mr-4">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <div>
                <p className="text-sm text-gray-600">Total Tasks</p>
                <p className="text-2xl font-bold text-gray-900">{tasks.length}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center">
              <div className="bg-green-100 p-3 rounded-lg mr-4">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm text-gray-600">Completed</p>
                <p className="text-2xl font-bold text-gray-900">{tasks.filter((t) => t.status === "completed").length}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center">
              <div className="bg-purple-100 p-3 rounded-lg mr-4">
                <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              </div>
              <div>
                <p className="text-sm text-gray-600">Progress</p>
                <p className="text-2xl font-bold text-gray-900">{project.progress}%</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center">
              <div className="bg-amber-100 p-3 rounded-lg mr-4">
                <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm text-gray-600">Deadline</p>
                <p className="text-sm font-bold text-gray-900">
                  {project.deadline ? new Date(project.deadline).toLocaleDateString() : "Not set"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Gantt Chart Component (same UI as Admin, but shows progress %) */}
        <AdminGanttChart tasks={tasks} projectName={project.name} developers={developers} showProgress />

        {/* Assigned Developers (will be just the current dev in this view) */}
        {Object.keys(developers).length > 0 && (
          <div className="mt-6 bg-white rounded-lg shadow p-6">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Assigned Developers</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Object.values(developers).map((dev) => {
                const devTasks = tasks.filter((t) => t.developer_id === dev.id);
                const completedTasks = devTasks.filter((t) => t.status === "completed").length;

                return (
                  <div key={dev.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                    <div className="flex items-center mb-3">
                      <div className="w-10 h-10 bg-[#009578] rounded-full flex items-center justify-center text-white font-bold mr-3">
                        {dev.name?.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-semibold text-gray-800">{dev.name}</p>
                        <p className="text-xs text-gray-500">{dev.designation || "Developer"}</p>
                      </div>
                    </div>
                    <div className="mt-3 pt-3 border-t">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Tasks:</span>
                        <span className="font-semibold">
                          {completedTasks}/{devTasks.length}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                        <div
                          className="bg-[#009578] h-2 rounded-full"
                          style={{ width: `${devTasks.length > 0 ? (completedTasks / devTasks.length) * 100 : 0}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
