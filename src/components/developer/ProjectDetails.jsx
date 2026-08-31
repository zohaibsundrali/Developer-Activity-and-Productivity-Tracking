"use client";
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabase } from '@/utils/supabaseClient'; // Correct path
import { showInfo } from "@/utils/alerts";
// Scheme check for the one query parameter this screen FOLLOWS rather than
// renders. See handleDownloadFile.
import { safeHref } from "@/utils/safeUrl";
import {
  ArrowLeft,
  CalendarClock,
  CalendarCheck2,
  CalendarPlus,
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
  StatusPill,
} from "@/components/ui";

// Presentational only: maps a raw project status onto a StatusPill state, which
// carries a glyph shape as well as a colour so it survives greyscale.
const statusPillKey = (status) => {
  const s = String(status || "").toLowerCase();
  if (["completed", "done", "approved", "reviewed"].includes(s)) return "success";
  if (["active", "in_progress", "in progress"].includes(s)) return "active";
  if (["pending", "assigned", "draft", "on_hold", "awaiting_approval"].includes(s)) return "pending";
  if (["rejected", "cancelled", "overdue"].includes(s)) return "error";
  return "unknown";
};

const statusLabel = (status) =>
  String(status || "unknown")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

// `progress` reaches this screen through parseInt() on a URL query parameter, so
// a hand-edited or missing value arrives as NaN and used to render "NaN%" in the
// headline number and `width: NaN%` on the bar.
const clampPercent = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
};

// One tile shape, used for all three timeline dates, so the row reads as a row
// rather than as three unrelated widgets.
function DateTile({ icon: Icon, label, date, time, note }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      </div>
      <p className="mt-3 text-sm font-medium tabular-nums text-foreground">{date}</p>
      <p className="mt-1 text-sm tabular-nums text-muted-foreground">{time}</p>
      {/* Reserved so all three tiles are the same height. */}
      <div className="mt-2 flex min-h-[1.5rem] items-center">{note}</div>
    </div>
  );
}

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
    // SANITISED AT THE SOURCE. This object wins whenever the id is absent or
    // the row lookup fails, both of which the person who crafted the link
    // controls, and `file_url` is the only field here that gets handed to the
    // browser as a URL. `javascript:` in it meant `window.open` executing
    // script in this page's origin with the signed-in session. safeHref keeps
    // http(s) and site-relative paths and returns "" for everything else,
    // including the control-character `java\nscript:` spelling that walks
    // straight past a prefix check.
    file_url: safeHref(searchParams.get('file_url')),
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

  // Re-checked after the merge rather than trusted from either branch: the
  // other branch is `setProjectData(data)` off a `select('*')`, so a stored
  // `javascript:` in projects.file_url would be the same bug one hop later.
  // Nothing below may read `project.file_url` directly.
  const fileHref = safeHref(project.file_url);

  // Format date function. "Invalid date" is a developer's error message, not a
  // date — an unusable value now reads the same as an absent one.
  const formatDate = (dateString) => {
    if (!dateString || dateString === 'null' || dateString === 'undefined') return 'Not set';

    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return 'Not set';

      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch (error) {
      return 'Not set';
    }
  };

  // The time of day only, to sit under the date without repeating it.
  const formatTime = (dateString) => {
    if (!dateString || dateString === 'null' || dateString === 'undefined') return '';

    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return '';

      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      return '';
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

  // `window.open` on an unchecked query parameter was a reflected DOM XSS: a
  // `javascript:` URL opened that way runs in this document's origin, so a link
  // sent to a signed-in developer executed as them. `fileHref` is "" for any
  // scheme that is not http(s), and "" is not opened.
  const handleDownloadFile = () => {
    if (!fileHref) {
      showInfo("No file", "No file available for download.");
      return;
    }
    window.open(fileHref, '_blank');
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
  const progress = clampPercent(project.progress);

  // One deadline summary, computed once, rendered in one place.
  const deadlineSummary = (() => {
    if (!project.deadline || project.deadline === 'null' || project.deadline === 'undefined') {
      return null;
    }
    try {
      const deadline = new Date(project.deadline);
      const diffDays = Math.ceil((deadline - new Date()) / (1000 * 60 * 60 * 24));
      if (!Number.isFinite(diffDays)) return null;
      if (diffDays < 0) return { label: 'Overdue', variant: 'destructive' };
      if (diffDays === 0) return { label: 'Due today', variant: 'warning' };
      if (diffDays === 1) return { label: '1 day left', variant: 'warning' };
      if (diffDays <= 3) return { label: `${diffDays} days left`, variant: 'warning' };
      return { label: `${diffDays} days left`, variant: 'secondary' };
    } catch {
      return null;
    }
  })();

  const assignedNote =
    daysSinceAssignment === null
      ? null
      : daysSinceAssignment === 0
        ? 'Assigned today'
        : daysSinceAssignment === 1
          ? 'Assigned yesterday'
          : `Assigned ${daysSinceAssignment} days ago`;

  // Loading — a skeleton shaped like the page, not a spinner over a blank one.
  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8" aria-busy="true">
        <div className="mb-6 space-y-2">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-96" />
        </div>
        {/* Shaped like the page that will arrive: summary card, three date
            tiles, description block, file block. */}
        <div className="space-y-6">
          <div className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-card sm:p-5">
            <Skeleton className="h-6 w-28 rounded-full" />
            <Skeleton className="h-2.5 w-full rounded-full" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-40 w-full rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
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

        {/* Summary — state, progress and who owns it. The project name is not
            repeated here: PageHeader above already carries it. */}
        <div className="rounded-xl border border-border bg-card p-4 shadow-card sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill
              status={statusPillKey(project.status)}
              label={statusLabel(project.status)}
            />
            {deadlineSummary && (
              <Badge size="sm" variant={deadlineSummary.variant}>
                {deadlineSummary.label}
              </Badge>
            )}
          </div>

          {/* One progress indicator — a labelled bar, nothing else. */}
          <div className="mt-4">
            <div className="mb-1.5 flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">Progress</span>
              <span className="font-semibold tabular-nums text-foreground">{progress}%</span>
            </div>
            <div
              className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Project progress"
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-3 border-t border-border pt-4 sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Assigned to
              </dt>
              <dd className="mt-0.5 truncate text-sm text-foreground">
                {project.assigned_developer_name || "Unassigned"}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Contact
              </dt>
              <dd className="mt-0.5 truncate text-sm text-foreground">
                {project.assigned_developer_email || "Not set"}
              </dd>
            </div>
          </dl>
        </div>

        <Section
          title="Timeline"
          description="When this work was created, handed to you, and is due."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <DateTile
              icon={CalendarPlus}
              label="Created"
              date={formatDate(project.created_at)}
              time={formatTime(project.created_at)}
            />
            <DateTile
              icon={CalendarCheck2}
              label="Assigned"
              date={formatDate(assignedDate)}
              time={formatTime(assignedDate)}
              note={
                assignedNote && (
                  <span className="text-sm text-muted-foreground">{assignedNote}</span>
                )
              }
            />
            <DateTile
              icon={CalendarClock}
              label="Deadline"
              date={formatDate(project.deadline)}
              time={formatTime(project.deadline)}
              note={
                deadlineSummary && (
                  <Badge size="sm" variant={deadlineSummary.variant}>
                    {deadlineSummary.label}
                  </Badge>
                )
              }
            />
          </div>
        </Section>

        <Section title="Description &amp; requirements">
          {project.description ? (
            <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-card sm:p-5">
              {String(project.description)
                .split("\n")
                .map((paragraph, index) => (
                  <p key={index} className="text-sm leading-relaxed text-foreground">
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
        </Section>

        <Section title="Files &amp; resources">
          {fileHref ? (
            <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-card sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <FileText className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {project.file_name || "Requirements file"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Specifications and guidelines for this project
                  </p>
                </div>
              </div>
              <Button variant="outline" onClick={handleDownloadFile} className="shrink-0">
                <Download className="h-4 w-4" aria-hidden="true" />
                Download file
              </Button>
            </div>
          ) : (
            <EmptyState
              icon={FileText}
              title="No file attached"
              description="This project was created without a requirements document."
            />
          )}
        </Section>

        {/* Actions — one primary per screen. */}
        <div className="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:justify-between">
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
  );
}