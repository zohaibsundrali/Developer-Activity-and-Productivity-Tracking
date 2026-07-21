"use client";
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { showInfo, showWarning } from "@/utils/alerts";
import { Zap, CheckCircle2, Clock } from "lucide-react";
import StatCard from "@/components/shell/StatCard";

export default function MyProjects({
  assignedProjects,
  onViewProjectDetails, // ✅ Added prop for navigation
  user
}) {
  const router = useRouter();
  const [sortBy, setSortBy] = useState('recent');
  const [filterStatus, setFilterStatus] = useState('all');

  const [showMetricsModal, setShowMetricsModal] = useState(false);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState("");
  const [metricsData, setMetricsData] = useState(null);

  const formatDate = (dateString) => {
    if (!dateString) return 'Not set';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Get time ago for assigned date
  const getTimeAgo = (dateString) => {
    if (!dateString) return 'N/A';
    const now = new Date();
    const date = new Date(dateString);
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return formatDate(dateString);
  };

  const handleDownloadFile = (project) => {
    if (project.file_url) {
      window.open(project.file_url, '_blank');
    } else {
      showInfo("No file", "No file available for this project.");
    }
  };

  // ✅ FIXED: Use the navigation function from parent
  const handleViewProject = (project) => {
    if (onViewProjectDetails) {
      onViewProjectDetails(project);
    } else {
      // Fallback if prop not provided
      showInfo("Project", `Viewing project: ${project.name}.`);
    }
  };

  const handleSubmitWork = (project) => {
    showInfo("Submit work", `Submit work for project: ${project.name}.`);
    // You can implement actual submission logic here
  };

  const handleViewTimeline = (project) => {
    if (!project?.id) return;
    router.push(`/developer/gantt-chart/${project.id}`);
  };

  const handleViewMetrics = async (project) => {
    if (!project?.id) return;

    if (!user?.id) {
      showWarning("Not logged in", "Please login again to view metrics.");
      return;
    }

    try {
      setMetricsLoading(true);
      setMetricsError("");
      setMetricsData(null);
      setShowMetricsModal(true);

      // Developer-side metrics must be scoped to the logged-in developer.
      const url = `/api/productivity?type=project&projectId=${project.id}&developerId=${encodeURIComponent(String(user.id))}`;
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        setMetricsError(data.error || "Failed to load productivity metrics.");
        return;
      }

      setMetricsData({
        ...data,
        project,
      });
    } catch (err) {
      setMetricsError("Error loading productivity metrics. Please try again.");
    } finally {
      setMetricsLoading(false);
    }
  };

  // Filter projects based on status
  const filteredProjects = assignedProjects.filter(project => {
    if (filterStatus === 'all') return true;
    if (filterStatus === 'active') return project.status === 'active' || project.status === 'in_progress';
    if (filterStatus === 'completed') return project.status === 'completed' || project.status === 'done';
    if (filterStatus === 'pending') return project.status === 'pending' || project.status === 'assigned';
    return true;
  });

  // Sort projects
  const sortedProjects = [...filteredProjects].sort((a, b) => {
    if (sortBy === 'recent') {
      return new Date(b.created_at || b.assigned_at) - new Date(a.created_at || a.assigned_at);
    }
    if (sortBy === 'deadline') {
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return new Date(a.deadline) - new Date(b.deadline);
    }
    if (sortBy === 'progress') {
      return (b.progress || 0) - (a.progress || 0);
    }
    return 0;
  });

  // Calculate statistics
  const activeProjectsCount = assignedProjects.filter(p =>
    p.status === 'active' || p.status === 'in_progress'
  ).length;

  const completedProjectsCount = assignedProjects.filter(p =>
    p.status === 'completed' || p.status === 'done'
  ).length;

  const pendingProjectsCount = assignedProjects.filter(p =>
    p.status === 'pending' || p.status === 'assigned'
  ).length;

  return (
    <div className="space-y-6">
      {/* Header with Stats */}
      <div>
        <div className="mb-5 flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-foreground">My Projects</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage and track all your assigned projects
            </p>
          </div>
          <div className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{assignedProjects.length}</span> total projects
          </div>
        </div>

        {/* Stats Cards */}
        <div className="mb-6 grid grid-cols-1 gap-5 md:grid-cols-3">
          <StatCard title="Active Projects" value={activeProjectsCount} icon={Zap} tone="primary" />
          <StatCard title="Completed" value={completedProjectsCount} icon={CheckCircle2} tone="success" />
          <StatCard title="Pending" value={pendingProjectsCount} icon={Clock} tone="warning" />
        </div>

        {/* Filters */}
        <div className="flex flex-col justify-between gap-4 rounded-xl border border-border bg-card p-4 shadow-card md:flex-row md:items-end">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Sort by</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
              >
                <option value="recent">Most Recent</option>
                <option value="deadline">Deadline</option>
                <option value="progress">Progress</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Status</label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
              >
                <option value="all">All Projects</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="pending">Pending</option>
              </select>
            </div>
          </div>

          <div className="text-sm text-muted-foreground">
            Showing <span className="font-semibold text-foreground">{sortedProjects.length}</span> of {assignedProjects.length} projects
          </div>
        </div>
      </div>

      {/* Projects Grid */}
      <div className="p-6">
        {/* Metrics / Productivity Modal (Developer view) */}
        {showMetricsModal && (
          <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-card p-6 rounded-xl shadow-xl max-w-xl w-full mx-4 max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-xl font-bold text-foreground">Develper Productivity</h3>
                  {metricsData?.project?.name && (
                    <p className="text-sm text-muted-foreground mt-1">{metricsData.project.name}</p>
                  )}
                </div>
                <button
                  onClick={() => {
                    setShowMetricsModal(false);
                    setMetricsData(null);
                    setMetricsError("");
                  }}
                  className="text-muted-foreground hover:text-foreground text-xl"
                >
                  ✕
                </button>
              </div>

              {metricsLoading ? (
                <div className="py-10 text-center">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  <p className="mt-3 text-muted-foreground text-sm">Loading productivity metrics...</p>
                </div>
              ) : metricsError ? (
                <div className="py-6">
                  <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">
                    {metricsError}
                  </div>
                </div>
              ) : metricsData ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-card rounded-xl border p-4 text-center shadow-sm">
                      <div className="text-2xl font-bold text-foreground">{metricsData.totalTasks}</div>
                      <div className="text-xs text-muted-foreground mt-1">Total Tasks</div>
                    </div>
                    <div className="bg-green-50 rounded-xl border border-green-200 p-4 text-center shadow-sm">
                      <div className="text-2xl font-bold text-green-600">{metricsData.summary?.onTime || 0}</div>
                      <div className="text-xs text-green-700 mt-1">On Time</div>
                      <div className="text-[11px] text-green-600">+{metricsData.summary?.onTime || 0} pts</div>
                    </div>
                    <div className="bg-red-50 rounded-xl border border-red-200 p-4 text-center shadow-sm">
                      <div className="text-2xl font-bold text-red-600">{metricsData.summary?.late || 0}</div>
                      <div className="text-xs text-red-700 mt-1">Late</div>
                      <div className="text-[11px] text-red-600">-{metricsData.summary?.late || 0} pts</div>
                    </div>
                    <div
                      className={`rounded-xl border p-4 text-center shadow-sm ${parseFloat(metricsData.productivityPercentage || 0) >= 80
                        ? "bg-green-50 border-green-200"
                        : parseFloat(metricsData.productivityPercentage || 0) >= 50
                          ? "bg-yellow-50 border-yellow-200"
                          : "bg-red-50 border-red-200"
                        }`}
                    >
                      <div
                        className={`text-2xl font-bold ${parseFloat(metricsData.productivityPercentage || 0) >= 80
                          ? "text-green-600"
                          : parseFloat(metricsData.productivityPercentage || 0) >= 50
                            ? "text-yellow-600"
                            : "text-red-600"
                          }`}
                      >
                        {metricsData.productivityPercentage || 0}%
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">Productivity</div>
                      <div className="text-[11px] text-muted-foreground">
                        Points:{" "}
                        {metricsData.productivityPoints >= 0
                          ? `+${metricsData.productivityPoints}`
                          : metricsData.productivityPoints}
                      </div>
                    </div>
                  </div>

                  <div className="bg-muted/50 border border-border rounded-lg p-3 text-xs text-foreground">
                    <p className="mb-1">
                      <span className="font-semibold">Completed:</span> {metricsData.summary?.completed || 0} ·{" "}
                      <span className="font-semibold text-green-700">On Time:</span> {metricsData.summary?.onTime || 0} ·{" "}
                      <span className="font-semibold text-red-700">Late:</span> {metricsData.summary?.late || 0} ·{" "}
                      <span className="font-semibold">Pending:</span>{" "}
                      {(metricsData.summary?.pending || 0) +
                        (metricsData.summary?.inProgress || 0) +
                        (metricsData.summary?.awaiting || 0)}{" "}
                      · <span className="font-semibold">Rejected:</span> {metricsData.summary?.rejected || 0}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {sortedProjects.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {sortedProjects.map(project => {
              const assignedDate = project.assigned_at || project.created_at;
              const daysAgo = getTimeAgo(assignedDate);

              return (
                <div
                  key={project.id}
                  className="border border-border rounded-xl overflow-hidden hover:shadow-lg transition-all duration-300 hover:-translate-y-1 bg-card"
                >
                  {/* Project Header */}
                  <div className="p-5 border-b border-border">
                    <div className="flex justify-between items-start mb-3">
                      <h3 className="text-lg font-bold text-foreground line-clamp-1">
                        {project.name}
                      </h3>
                      <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${project.status === 'active' || project.status === 'in_progress'
                        ? 'bg-green-100 text-green-800'
                        : project.status === 'completed'
                          ? 'bg-info/10 text-info'
                          : project.status === 'pending' || project.status === 'assigned'
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-muted text-foreground'
                        }`}>
                        {project.status?.charAt(0).toUpperCase() + project.status?.slice(1) || 'Pending'}
                      </span>
                    </div>

                    {project.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
                        {project.description}
                      </p>
                    )}

                    {/* Progress Bar */}
                    <div className="mb-2">
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-foreground font-medium">Progress</span>
                        <span className="font-bold text-primary">{project.progress || 0}%</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className="bg-primary h-2 rounded-full transition-all duration-500"
                          style={{ width: `${project.progress || 0}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>

                  {/* Project Details */}
                  <div className="p-5">
                    {/* Timeline Info */}
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <p className="text-xs text-muted-foreground font-medium mb-1">Assigned</p>
                        <div className="flex items-center">
                          <svg className="w-4 h-4 text-green-500 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <p className="text-sm font-medium text-foreground">{formatDate(assignedDate)}</p>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{daysAgo}</p>
                      </div>

                      {project.deadline && (
                        <div>
                          <p className="text-xs text-muted-foreground font-medium mb-1">Deadline</p>
                          <div className="flex items-center">
                            <svg className="w-4 h-4 text-orange-500 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <p className="text-sm font-medium text-foreground">{formatDate(project.deadline)}</p>
                          </div>
                          <div className="mt-1">
                            <span className="text-xs px-2 py-1 rounded-full bg-orange-100 text-orange-800 font-medium">
                              {(() => {
                                try {
                                  const deadline = new Date(project.deadline);
                                  const today = new Date();
                                  const diffTime = deadline - today;
                                  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                                  if (diffDays < 0) return 'Overdue';
                                  if (diffDays === 0) return 'Due today';
                                  if (diffDays === 1) return '1 day left';
                                  return `${diffDays} days left`;
                                } catch {
                                  return 'N/A';
                                }
                              })()}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* File Attachment */}
                    {project.file_url && (
                      <div className="mb-4 p-3 bg-primary/5 border border-primary/15 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <div className="w-8 h-8 bg-card rounded-lg flex items-center justify-center border border-primary/20">
                              <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                            </div>
                            <div>
                              <p className="text-sm font-medium text-foreground truncate max-w-[150px]">
                                {project.file_name || 'Requirements File'}
                              </p>
                              <p className="text-xs text-primary">Project requirements</p>
                            </div>
                          </div>
                          <button
                            onClick={() => handleDownloadFile(project)}
                            className="text-primary hover:text-primary/80 text-sm font-medium flex items-center"
                          >
                            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Download
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Action Buttons (match Admin: Metrics + Timeline, then View Detail) */}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => handleViewMetrics(project)}
                        className="bg-success text-success-foreground py-2 px-2 rounded-lg text-xs hover:bg-success/90 transition-colors flex items-center justify-center"
                        title="View Productivity"
                      >
                        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                        </svg>
                        Metrics
                      </button>
                      <button
                        onClick={() => handleViewTimeline(project)}
                        className="bg-violet-500 text-white py-2 px-2 rounded-lg text-xs hover:bg-violet-600 transition-colors flex items-center justify-center"
                        title="View Gantt Chart Timeline"
                      >
                        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        Timeline
                      </button>
                    </div>
                    <button
                      onClick={() => handleViewProject(project)}
                      className="mt-2 w-full bg-primary text-primary-foreground py-2 px-2 rounded-lg text-xs hover:bg-primary/90 transition-colors flex items-center justify-center"
                      title="View Project Details"
                    >
                      <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      View Detail
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-muted rounded-full mb-6">
              <svg className="w-10 h-10 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-foreground mb-2">No Projects Found</h3>
            <p className="text-muted-foreground max-w-md mx-auto mb-8">
              {filterStatus === 'all'
                ? "You haven't been assigned any projects yet. Projects assigned to you will appear here."
                : `No ${filterStatus} projects found. Try changing the status filter.`
              }
            </p>

            {filterStatus !== 'all' && (
              <button
                onClick={() => setFilterStatus('all')}
                className="bg-primary text-primary-foreground px-6 py-2 rounded-lg hover:bg-primary/90 transition-colors font-medium"
              >
                Show All Projects
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}