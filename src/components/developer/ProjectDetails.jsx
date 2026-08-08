"use client";
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabase } from '@/utils/supabaseClient'; // Correct path
import { showInfo } from "@/utils/alerts";
import {
  ArrowLeft,
  CalendarClock,
  CalendarCheck2,
  Download,
  FileText,
  LayoutDashboard,
  FolderKanban,
  CheckCircle2,
} from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Section,
  Skeleton,
} from "@/components/ui";

export default function ProjectDetails() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // State for project data and loading
  const [projectData, setProjectData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dataSource, setDataSource] = useState('url'); // 'supabase' or 'url'

  // URL parameters se initial project data get karein (fallback ke liye)
  const urlProject = {
    id: searchParams.get('id'),
    name: searchParams.get('name'),
    description: searchParams.get('description'),
    status: searchParams.get('status'),
    progress: parseInt(searchParams.get('progress') || '0'),
    deadline: searchParams.get('deadline'),
    created_at: searchParams.get('created_at'),
    assigned_at: searchParams.get('assigned_at'),
    assigned_date: searchParams.get('assigned_date'),
    file_url: searchParams.get('file_url'),
    file_name: searchParams.get('file_name'),
    assigned_developer_name: searchParams.get('assigned_developer_name'),
    assigned_developer_email: searchParams.get('assigned_developer_email')
  };

  // Supabase se project data fetch karein
  useEffect(() => {
    const fetchProjectFromSupabase = async () => {
      try {
        setLoading(true);
        const projectId = searchParams.get('id');
        
        if (!projectId || projectId === 'null') {
          setProjectData(urlProject);
          setDataSource('url');
          return;
        }

        // Supabase se project data fetch karein
        const { data, error } = await supabase
          .from('projects') // Aapki table ka naam - agar alag hai to change karein
          .select('*')
          .eq('id', projectId)
          .single();

        if (error) {
          throw error;
        }

        if (data) {
          setProjectData(data);
          setDataSource('supabase');
        } else {
          setProjectData(urlProject);
          setDataSource('url');
        }
      } catch (err) {
        setError(err.message);
        // Fallback: URL parameters se data use karein
        setProjectData(urlProject);
        setDataSource('url');
      } finally {
        setLoading(false);
      }
    };

    fetchProjectFromSupabase();
  }, [searchParams]);

  // Use projectData ya fallback urlProject
  const project = projectData || urlProject;

  // Format date function
  const formatDate = (dateString) => {
    if (!dateString || dateString === 'null' || dateString === 'undefined') return 'Not set';
    
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return 'Invalid date';
      
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long'
      });
    } catch (error) {
      return 'Invalid date';
    }
  };

  // Format date with time
  const formatDateTime = (dateString) => {
    if (!dateString || dateString === 'null' || dateString === 'undefined') return 'Not set';
    
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return 'Invalid date';
      
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      return 'Invalid date';
    }
  };

  // Calculate days since assignment
  const getDaysSinceAssignment = (dateString) => {
    if (!dateString || dateString === 'null' || dateString === 'undefined') return null;
    
    try {
      const assignedDate = new Date(dateString);
      const today = new Date();
      
      if (isNaN(assignedDate.getTime())) return null;
      
      const diffTime = Math.abs(today - assignedDate);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      return diffDays;
    } catch (error) {
      return null;
    }
  };

  const handleDownloadFile = () => {
    if (project.file_url && project.file_url !== 'null') {
      window.open(project.file_url, '_blank');
    }
  };

  // ✅ FIXED: Back navigation to developer dashboard
  const handleBack = () => {
    // Check if we have a referrer or go to default dashboard
    if (document.referrer && document.referrer.includes(window.location.origin)) {
      router.back();
    } else {
      // Default fallback to developer dashboard
      router.push('/developer/dashboard');
    }
  };

  // ✅ ALTERNATIVE: Explicit navigation to specific sections
  const handleBackToDashboard = () => {
    router.push('/developer/dashboard');
  };

  const handleBackToProjects = () => {
    router.push('/developer/dashboard?section=projects');
  };

  const handleSubmitWork = () => {
    showInfo("Submit work", `Submit work for project ${project.id}.`);
  };

  // Get assigned date (priority: assigned_at > assigned_date > created_at)
  const getAssignedDate = () => {
    if (project.assigned_at && project.assigned_at !== 'null' && project.assigned_at !== 'undefined') {
      return project.assigned_at;
    }
    if (project.assigned_date && project.assigned_date !== 'null' && project.assigned_date !== 'undefined') {
      return project.assigned_date;
    }
    return project.created_at; // Fallback to created_at (Supabase se aayega)
  };

  const assignedDate = getAssignedDate();
  const daysSinceAssignment = getDaysSinceAssignment(assignedDate);

  // Loading — a skeleton shaped like the page, not a spinner over a blank one.
  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8" aria-busy="true">
        <div className="mb-6 space-y-2">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="space-y-6 rounded-xl border border-border bg-card p-5 shadow-card">
          <Skeleton className="h-24 w-full rounded-lg" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-36 w-full rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-28 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  // Error state
  if (error && !project.id) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
        <ErrorState title="Couldn't load this project" description={error} />
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={handleBackToDashboard}>
            Go to dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumbs={[
          { label: "Dashboard", href: "/developer/dashboard" },
          { label: "Projects", href: "/developer/dashboard?section=projects" },
          { label: project.name || "Project" },
        ]}
        title={project.name || "Unnamed project"}
        description="Everything you were given for this piece of work."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={handleBack}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back
            </Button>
            <Button variant="outline" onClick={handleBackToProjects}>
              <FolderKanban className="h-4 w-4" aria-hidden="true" />
              All projects
            </Button>
          </div>
        }
      />

      <div className="space-y-6">
        {/* Project not found warning */}
        {(!project.id || project.id === "null") && (
          <div className="rounded-lg border border-warning/20 bg-warning/10 p-4" role="status">
            <p className="text-sm font-medium text-warning">Project data did not load properly</p>
            <p className="text-sm text-warning">Go back to the projects list and open it again.</p>
          </div>
        )}

        {/* Project summary */}
        <div className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="min-w-0 text-lg font-semibold tracking-tight text-foreground">
              {project.name || "Unnamed project"}
            </h2>
            <Badge
              variant={
                project.status === "completed" || project.status === "active"
                  ? "success"
                  : project.status === "pending"
                  ? "warning"
                  : "secondary"
              }
            >
              {project.status
                ? project.status.charAt(0).toUpperCase() + project.status.slice(1)
                : "Unknown"}
            </Badge>
          </div>

          {project.assigned_developer_name && (
            <p className="mt-2 text-sm text-muted-foreground">
              Assigned to{" "}
              <span className="font-medium text-foreground">{project.assigned_developer_name}</span>
              {project.assigned_developer_email && ` (${project.assigned_developer_email})`}
            </p>
          )}

          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <dt className="text-muted-foreground">Created</dt>
              <dd className="font-medium tabular-nums text-foreground">{formatDate(project.created_at)}</dd>
            </div>
            {assignedDate && (
              <div className="flex items-center gap-2">
                <CalendarCheck2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <dt className="text-muted-foreground">Assigned</dt>
                <dd className="font-medium tabular-nums text-foreground">{formatDate(assignedDate)}</dd>
              </div>
            )}
          </dl>
        </div>

        <div className="rounded-xl border border-border bg-card shadow-card">
          {/* Project Content */}
          <div className="p-8">
            {/* Progress Section */}
            <div className="mb-10">
              <h2 className="text-xl font-bold tracking-tight mb-6 text-foreground flex items-center">
                <svg className="w-6 h-6 mr-3 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                Project Progress
              </h2>

              <div className="bg-muted/50 rounded-2xl p-6 border border-border">
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <span className="text-lg font-semibold text-foreground">Completion Status</span>
                    <p className="text-sm text-muted-foreground mt-1">Track your progress towards completion</p>
                  </div>
                  <div className="text-right">
                    <span className="text-4xl font-bold tabular-nums text-primary">{project.progress}%</span>
                    <p className="text-sm text-muted-foreground">completed</p>
                  </div>
                </div>

                <div className="mb-2">
                  <div className="w-full bg-muted rounded-full h-4">
                    <div
                      className="h-4 rounded-full bg-primary transition-all duration-150"
                      style={{ width: `${project.progress}%` }}
                    ></div>
                  </div>
                </div>

                <div className="flex justify-between text-sm text-muted-foreground mt-2">
                  <span>0%</span>
                  <span>25%</span>
                  <span>50%</span>
                  <span>75%</span>
                  <span>100%</span>
                </div>
              </div>
            </div>

            {/* Timeline Section */}
            <div className="mb-10">
              <h2 className="text-xl font-bold tracking-tight mb-6 text-foreground flex items-center">
                <svg className="w-6 h-6 mr-3 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Project timeline
              </h2>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Created Date Card */}
                <div className="bg-card rounded-xl p-6 border border-border shadow-card">
                  <div className="flex items-center mb-4">
                    <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mr-4">
                      <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">Created On</h3>
                      <p className="text-sm text-muted-foreground">Project creation date</p>
                    </div>
                  </div>
                  <div className="mt-4">
                    <p className="text-lg font-medium tabular-nums text-foreground">{formatDate(project.created_at)}</p>
                    <p className="text-sm text-muted-foreground mt-1">{formatDateTime(project.created_at)}</p>
                  </div>
                </div>

                {/* ✅ ASSIGNED DATE CARD - HIGHLIGHTED */}
                <div className="bg-success/10 rounded-xl p-6 border border-success/20 shadow-card relative overflow-hidden">
                  <div className="absolute -top-4 -right-4 w-16 h-16 bg-success/20 rounded-full opacity-20"></div>
                  <div className="absolute -bottom-4 -left-4 w-12 h-12 bg-success/30 rounded-full opacity-10"></div>

                  <div className="flex items-center mb-4 relative z-10">
                    <div className="w-12 h-12 bg-success/10 rounded-lg flex items-center justify-center mr-4">
                      <svg className="w-6 h-6 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <div className="flex items-center">
                        <h3 className="font-semibold text-foreground">Assigned On</h3>
                        <span className="ml-2 px-2 py-1 bg-success/10 text-success text-xs font-medium rounded-full">
                          🎯 Key Date
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">When project was assigned to you</p>
                    </div>
                  </div>
                  <div className="mt-4 relative z-10">
                    <p className="text-lg font-bold tabular-nums text-success">{formatDate(assignedDate)}</p>
                    <p className="text-sm text-success mt-1">{formatDateTime(assignedDate)}</p>

                    {daysSinceAssignment !== null && (
                      <div className="mt-3 p-2 bg-success/10 rounded-lg">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-success">
                            {daysSinceAssignment === 0 ? 'Assigned today' :
                             daysSinceAssignment === 1 ? 'Assigned yesterday' :
                             `Assigned ${daysSinceAssignment} days ago`}
                          </span>
                          <span className="text-xs bg-success/20 text-success px-2 py-1 rounded-full font-medium">
                            {daysSinceAssignment}d
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Deadline Card */}
                {project.deadline && project.deadline !== 'null' && (
                  <div className="bg-warning/10 rounded-xl p-6 border border-warning/20 shadow-card">
                    <div className="flex items-center mb-4">
                      <div className="w-12 h-12 bg-warning/10 rounded-lg flex items-center justify-center mr-4">
                        <svg className="w-6 h-6 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground">Deadline</h3>
                        <p className="text-sm text-muted-foreground">Submission due date</p>
                      </div>
                    </div>
                    <div className="mt-4">
                      <p className="text-lg font-medium tabular-nums text-foreground">{formatDate(project.deadline)}</p>
                      <p className="text-sm text-muted-foreground mt-1">{formatDateTime(project.deadline)}</p>

                      {/* Days remaining calculation */}
                      {project.deadline && project.deadline !== 'null' && (
                        <div className="mt-3">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Time remaining:</span>
                            <span className="font-medium text-warning">
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
                  </div>
                )}
              </div>
            </div>

            {/* Description Section */}
            <div className="mb-10">
              <h2 className="text-xl font-bold tracking-tight mb-6 text-foreground flex items-center">
                <svg className="w-6 h-6 mr-3 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Project Description & Requirements
              </h2>

              <div className="bg-muted/50 rounded-2xl p-8 border border-border">
                <div className="prose max-w-none">
                  {project.description ? (
                    <div className="text-foreground leading-relaxed space-y-4">
                      {project.description.split('\n').map((paragraph, index) => (
                        <p key={index} className="text-lg">
                          {paragraph}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      icon={FileText}
                      title="No description provided"
                      description="Ask the project manager for the brief, or check the attached requirements file."
                    />
                  )}
                </div>
              </div>
            </div>

            {/* File Attachment */}
            {project.file_url && project.file_url !== 'null' && (
              <div className="mb-10">
                <h2 className="text-xl font-bold tracking-tight mb-6 text-foreground flex items-center">
                  <svg className="w-6 h-6 mr-3 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                  Project Files & Resources
                </h2>

                <div className="bg-muted/50 rounded-2xl p-6 border border-border">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="flex items-center space-x-4">
                      <div className="w-16 h-16 bg-card rounded-xl flex items-center justify-center shadow-card">
                        <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-bold text-foreground text-lg">
                          {project.file_name || 'Project Requirements Document'}
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">
                          Contains all project specifications, guidelines, and requirements
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <Button onClick={handleDownloadFile}>
                        <Download className="h-4 w-4" aria-hidden="true" />
                        Download file
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Actions — one primary per screen. */}
            <div className="flex flex-col gap-3 border-t border-border pt-8 sm:flex-row sm:justify-between">
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button variant="outline" onClick={handleBackToDashboard}>
                  <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
                  Dashboard
                </Button>
                <Button variant="outline" onClick={handleBackToProjects}>
                  <FolderKanban className="h-4 w-4" aria-hidden="true" />
                  All projects
                </Button>
              </div>
              <Button onClick={handleSubmitWork}>
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                Submit completed work
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}