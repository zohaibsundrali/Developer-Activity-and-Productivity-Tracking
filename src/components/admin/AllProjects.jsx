"use client";
import { useState, useEffect } from "react";
import {
  RefreshCw,
  Plus,
  Trash2,
  AlertTriangle,
  FileText,
  BarChart3,
  Calendar,
  Eye,
  Download,
  ShieldAlert,
  Inbox,
} from "lucide-react";
import { showError, showInfo, showSuccess, showWarning } from "@/utils/alerts";
import { getOrgId } from "@/utils/orgContext";
import { authFetch } from "@/utils/authFetch";
import { uploadOrgFile, resolveOrgFileUrl } from "@/utils/orgFiles";
import {
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  Badge,
  StatusPill,
  EmptyState,
  ErrorState,
  Skeleton,
  SkeletonCard,
  Modal,
  Field,
  Button,
  Input,
} from "@/components/ui";

// Presentational only: maps a raw project status onto a StatusPill status key.
// The pill carries colour + shape + text, so the state survives greyscale.
const statusPillKey = (status) => {
  const s = String(status || "").toLowerCase();
  if (["completed", "done", "approved", "reviewed"].includes(s)) return "success";
  if (["active"].includes(s)) return "active";
  if (["in_progress", "in progress", "awaiting_approval", "pending_review"].includes(s)) return "pending";
  if (["pending", "assigned", "draft", "on_hold"].includes(s)) return "pending";
  if (["rejected", "cancelled", "overdue"].includes(s)) return "error";
  return "unknown";
};

const statusLabel = (status) =>
  String(status || "unknown")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * How many developers a project has — derived from the assignment that exists,
 * not read from a stored counter.
 *
 * `projects.developers_count` is written once as the literal `1` by this form's
 * insert and is never read, incremented or recomputed by anything, and no trigger
 * maintains it. So it was right only for projects created through this form, and
 * a project created anywhere else rendered a stale number or a blank (the column
 * defaults to 0). The schema carries one `assigned_developer_email` per project,
 * so the real count is simply whether that assignment is filled in. The stored
 * column is now read by nothing; it is left in place because dropping it is a
 * migration, which this fix deliberately does not make.
 */
const assignedDeveloperCount = (project) =>
  project?.assigned_developer_email || project?.assigned_developer_id ? 1 : 0;

// Native controls the kit has no primitive for (select / textarea / file).
const CONTROL_CLASS =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export default function AllProjects({ developers: initialDevelopers, supabase }) {
  const [showAddProject, setShowAddProject] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [fetchingProjects, setFetchingProjects] = useState(true);
  const [projects, setProjects] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [currentAdmin, setCurrentAdmin] = useState(null);
  const [adminDevelopers, setAdminDevelopers] = useState([]); // Only developers added by current admin
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [showMetricsModal, setShowMetricsModal] = useState(false);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState("");
  const [metricsData, setMetricsData] = useState(null);
  // Remembers which project the open metrics modal is for, so the error state's
  // Retry can call handleViewMetrics with the exact same argument. Never used
  // to decide what is fetched.
  const [metricsProject, setMetricsProject] = useState(null);

  const [newProject, setNewProject] = useState({
    name: "",
    deadline: "",
    description: "",
    assigned_developer: "",
    file: null
  });

  // Fetch current admin and their data on component mount
  useEffect(() => {
    fetchAdminData();
  }, []);

  const fetchAdminData = async () => {
    try {
      setFetchingProjects(true);
      setLoadError("");

      // Get admin from localStorage
      const adminData = JSON.parse(sessionStorage.getItem("adminUser"));

      if (!adminData) {
        setCurrentAdmin(null);
        setProjects([]);
        setAdminDevelopers([]);
        return;
      }

      setCurrentAdmin(adminData);

      const orgId = getOrgId();

      // Fetch projects created by this admin (not assigned_to, but created_by)
      let projectsQuery = supabase
        .from('projects')
        .select('*')
        .or(`created_by.eq.${adminData.id},added_by.eq.${adminData.id},added_by_admin.ilike.%${adminData.email}%`)
        .order('created_at', { ascending: false });
      if (orgId) projectsQuery = projectsQuery.eq('organization_id', orgId);
      const projectsPromise = projectsQuery;

      // Fetch developers added by this admin
      let developersQuery = supabase
        .from('developers')
        .select('*')
        .or(`added_by.eq.${adminData.id},added_by_admin.ilike.%${adminData.email}%`)
        .eq('status', 'active') // Only active developers
        .order('name', { ascending: true });
      if (orgId) developersQuery = developersQuery.eq('organization_id', orgId);
      const developersPromise = developersQuery;

      // Execute both promises in parallel
      const [projectsResult, developersResult] = await Promise.all([
        projectsPromise,
        developersPromise
      ]);

      if (projectsResult.error) {
        showError(
          "Load failed",
          `Error fetching projects: ${projectsResult.error.message}`
        );
        setLoadError(projectsResult.error.message || "Error fetching projects.");
        setProjects([]);
      } else {
        setProjects(projectsResult.data || []);
      }

      if (developersResult.error) {
        // Don't alert for developers error, just log it
        setAdminDevelopers([]);
      } else {
        setAdminDevelopers(developersResult.data || []);
      }

    } catch (error) {
      showError("Load failed", `Error loading data: ${error.message}`);
      setLoadError(error.message || "Error loading data.");
      setProjects([]);
      setAdminDevelopers([]);
    } finally {
      setFetchingProjects(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'No date';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const handleViewGanttChart = (projectId) => {
    // Navigate to Gantt chart page
    window.location.href = `/admin/gantt-chart/${projectId}`;
  };

  const handleViewProjectDetails = (projectId) => {
    window.location.href = `/admin/project-details/${projectId}`;
  };

  const handleViewMetrics = async (project) => {
    if (!project) return;

    if (!project.assigned_developer_id) {
      showWarning(
        "Missing assignment",
        "Please assign a developer to this project to see productivity metrics."
      );
      return;
    }

    try {
      setMetricsLoading(true);
      setMetricsError("");
      setMetricsData(null);
      setMetricsProject(project);
      setShowMetricsModal(true);

      const url = `/api/productivity?type=project&projectId=${project.id}&developerId=${project.assigned_developer_id}`;
      const res = await authFetch(url);
      const data = await res.json();

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

  // New function to handle delete confirmation
  const handleDeleteClick = (project) => {
    setProjectToDelete(project);
    setShowDeleteModal(true);
  };

  // New function to delete project
  const handleConfirmDelete = async () => {
    if (!projectToDelete) return;

    setDeleting(true);
    try {
      // Delete the project from database
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', projectToDelete.id);

      if (error) throw error;

      // ✅ Create TWO notifications: one for developer, one for admin

      // 1. Notification for Developer (if assigned)
      if (projectToDelete.assigned_developer_id) {
        const { error: devNotificationError } = await supabase
          .from('notifications')
          .insert([
            {
              assigned_developer_id: projectToDelete.assigned_developer_id,
              developer_id: projectToDelete.assigned_developer_id,
              admin_id: null,
              admin_email: null,
              message: `🗑️ Project Deleted: "${projectToDelete.name}" has been deleted by admin.`,
              type: 'warning',
              read: false,
              created_at: new Date().toISOString()
            }
          ]);

        if (devNotificationError) {
          console.error('Developer notification error:', devNotificationError);
        }
      }

      // 2. Notification for Admin (confirmation)
      const { error: adminNotificationError } = await supabase
        .from('notifications')
        .insert([
          {
            assigned_developer_id: null,
            developer_id: null,
            admin_id: currentAdmin.id,
            admin_email: currentAdmin.email,
            message: `🗑️ You deleted project "${projectToDelete.name}"`,
            type: 'info',
            read: false,
            created_at: new Date().toISOString()
          }
        ]);

      if (adminNotificationError) {
        console.error('Admin notification error:', adminNotificationError);
      }

      // Remove the project from state
      setProjects(projects.filter(p => p.id !== projectToDelete.id));

      // Close modal and reset
      setShowDeleteModal(false);
      setProjectToDelete(null);

      showSuccess("Deleted", `Project "${projectToDelete.name}" deleted successfully.`);

    } catch (error) {
      showError("Delete failed", `Error deleting project: ${error.message}`);
    } finally {
      setDeleting(false);
    }
  };

  // Project requirement documents used to land in the PUBLIC `documents` bucket
  // at the bucket ROOT with no organization prefix at all, so one tenant's files
  // sat beside another's and any URL holder could read them. They now go to the
  // private `org-files` bucket under the caller's org, and the stored value is a
  // storage path rather than a URL (audit finding H2).
  const handleFileUpload = async (file) => {
    try {
      setUploadingFile(true);
      return await uploadOrgFile({ orgId: getOrgId(), category: 'project-docs', file });
    } catch (error) {
      showError("Upload failed", `File upload failed: ${error.message}`);
      return null;
    } finally {
      setUploadingFile(false);
    }
  };

  // filePath is the private storage path returned by the upload. The route
  // signs it server-side; it is no longer a fetchable URL. authFetch is required
  // because the route resolves the caller's organization from their token.
  const generateAiTasks = async (projectId, filePath, fileName) => {
    if (!projectId || !filePath) return null;
    const lowerName = (fileName || "").toLowerCase();
    if (!lowerName.endsWith(".docx")) return null;

    try {
      const res = await authFetch("/api/ai-generate-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, filePath }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const detail = err.details ? ` (${err.details})` : "";
        showError(
          "AI task generation failed",
          `AI task generation failed: ${err.error || res.statusText}${detail}`
        );
        return null;
      }
      const data = await res.json();
      if (!data?.tasks?.length) {
        showWarning("No tasks generated", "AI task generation returned no tasks.");
      }
      return data?.tasks || null;
    } catch {
      showError("AI task generation failed", "AI task generation failed: network error.");
      return null;
    }
  };

  const handleAddProject = async (e) => {
    e.preventDefault();

    if (!currentAdmin) {
      showWarning("Login required", "Admin not logged in.");
      return;
    }

    if (adminDevelopers.length === 0) {
      showInfo(
        "Add developers first",
        "You need to add developers before creating a project. Go to the Add Developer section."
      );
      return;
    }

    setLoading(true);

    try {
      // Validation
      if (!newProject.name || !newProject.deadline || !newProject.assigned_developer) {
        showWarning("Validation error", "Please fill in all required fields.");
        return;
      }

      let fileUrl = null;

      // Upload file if selected
      if (newProject.file) {
        fileUrl = await handleFileUpload(newProject.file);
        if (!fileUrl) {
          showError("Upload failed", "File upload failed. Please try again.");
          return;
        }
      }

      // Get assigned developer details from admin's developers
      const assignedDeveloper = adminDevelopers.find(dev => dev.id === newProject.assigned_developer);

      if (!assignedDeveloper) {
        showWarning(
          "Developer not found",
          "Selected developer not found in your added developers."
        );
        return;
      }

      // Insert project into Supabase with admin assignment
      const { data, error } = await supabase
        .from('projects')
        .insert([
          {
            name: newProject.name,
            deadline: newProject.deadline,
            description: newProject.description,
            assigned_developer_id: newProject.assigned_developer,
            assigned_developer_name: assignedDeveloper.name,
            assigned_developer_email: assignedDeveloper.email,
            file_url: fileUrl,
            file_name: newProject.file ? newProject.file.name : null,
            progress: 0,
            developers_count: 1,
            status: 'active',
            // Task plan workflow defaults (Admin cannot approve/reject until developer submits)
            task_plan_submitted: false,
            task_plan_status: 'draft',
            task_plan_submitted_at: null,
            task_plan_reviewed_at: null,
            task_plan_reviewed_by: null,
            task_plan_rejection_reason: null,
            assigned_to: newProject.assigned_developer, // ✅ Fixed: Use developer ID, not admin ID
            assigned_to_email: assignedDeveloper.email, // ✅ Fixed: Use developer email
            created_by: currentAdmin.id,
            added_by: currentAdmin.id, // Store who added this project
            added_by_admin: currentAdmin.email,
            organization_id: getOrgId(),
            created_at: new Date().toISOString()
          }
        ])
        .select();

      if (error) throw error;

      const createdProject = data?.[0];
      if (createdProject?.id && fileUrl) {
        await generateAiTasks(createdProject.id, fileUrl, newProject.file?.name);
        await fetchAdminData(); // <-- Add this line

      }

      // ✅ Create TWO notifications: one for developer, one for admin

      // 1. Notification for Developer
      const { error: devNotificationError } = await supabase
        .from('notifications')
        .insert([
          {
            assigned_developer_id: assignedDeveloper.id,
            developer_id: assignedDeveloper.id,
            admin_id: null, // Not for admin dashboard
            admin_email: null,
            message: `🎯 New Project Assigned: "${newProject.name}" has been assigned to you. Start working on it now!`,
            type: 'project_assigned',
            read: false,
            created_at: new Date().toISOString()
          }
        ]);

      if (devNotificationError) {
        console.error('Developer notification error:', devNotificationError);
      }

      // 2. Notification for Admin (confirmation)
      const { error: adminNotificationError } = await supabase
        .from('notifications')
        .insert([
          {
            assigned_developer_id: null, // Not for developer dashboard
            developer_id: null,
            admin_id: currentAdmin.id,
            admin_email: currentAdmin.email,
            message: `✅ Project "${newProject.name}" successfully assigned to ${assignedDeveloper.name}`,
            type: 'info',
            read: false,
            created_at: new Date().toISOString()
          }
        ]);

      if (adminNotificationError) {
        console.error('Admin notification error:', adminNotificationError);
      }

      // Refresh the projects list
      await fetchAdminData();

      // Reset form
      setNewProject({
        name: "",
        deadline: "",
        description: "",
        assigned_developer: "",
        file: null
      });

      setShowAddProject(false);
      showSuccess(
        "Project created",
        `Project "${newProject.name}" added and notification sent to ${assignedDeveloper.name}.`
      );

    } catch (error) {
      showError("Save failed", `Error adding project: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setNewProject(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      // Check file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        showWarning("File too large", "File size must be less than 10MB.");
        return;
      }

      // Check file type
      const allowedTypes = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain'
      ];

      if (!allowedTypes.includes(file.type)) {
        showWarning(
          "Invalid file type",
          "Please select a valid file type: PDF, DOC, DOCX, or TXT."
        );
        return;
      }

      setNewProject(prev => ({
        ...prev,
        file: file
      }));
    }
  };

  // file_url now holds a private storage path. Sign it on click so the link is
  // short-lived; rows written before the move still hold a full URL and
  // resolveOrgFileUrl passes those through unchanged.
  const handleDownloadFile = async (project) => {
    if (!project.file_url) return;
    const url = await resolveOrgFileUrl(project.file_url);
    if (!url) {
      showError("Unavailable", "That file could not be opened. It may have been removed.");
      return;
    }
    window.open(url, '_blank');
  };

  const removeSelectedFile = () => {
    setNewProject(prev => ({
      ...prev,
      file: null
    }));
    const fileInput = document.getElementById('file-input');
    if (fileInput) fileInput.value = '';
  };

  const headerActions = (
    <>
      <Button
        variant="outline"
        onClick={fetchAdminData}
        disabled={fetchingProjects}
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        Refresh
      </Button>
      <Button
        onClick={() => setShowAddProject(true)}
        disabled={adminDevelopers.length === 0}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add New Project
      </Button>
    </>
  );

  // Show loading state
  if (fetchingProjects) {
    return (
      <div>
        <PageHeader
          title="My Projects"
          description="Projects you created, with progress, deadlines and assigned developers."
          actions={headerActions}
        />
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Show warning if admin is not logged in
  if (!currentAdmin) {
    return (
      <div>
        <PageHeader
          title="My Projects"
          description="Projects you created, with progress, deadlines and assigned developers."
          actions={headerActions}
        />
        <div className="space-y-6">
          <EmptyState
            icon={ShieldAlert}
            title="Admin sign-in required"
            description="Please log in as an admin to view projects."
          />
        </div>
      </div>
    );
  }

  const getDeadlineSummary = (deadline) => {
    if (!deadline) return { label: 'No deadline set', variant: 'outline' };

    try {
      const deadlineDate = new Date(deadline);
      const today = new Date();
      const diffTime = deadlineDate - today;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays < 0) {
        return {
          label: `Overdue by ${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? '' : 's'}`,
          variant: 'destructive'
        };
      }
      if (diffDays === 0) {
        return { label: 'Due today', variant: 'warning' };
      }
      if (diffDays === 1) {
        return { label: '1 day left', variant: 'warning' };
      }

      return {
        label: `${diffDays} days left`,
        variant: diffDays <= 3 ? 'warning' : 'success'
      };
    } catch {
      return { label: 'N/A', variant: 'outline' };
    }
  };

  return (
    <div>
      <PageHeader
        title="My Projects"
        description="Projects you created, with progress, deadlines and assigned developers."
        actions={headerActions}
      />

      <div className="space-y-6">
        {/* Add Project Modal */}
        {showAddProject && (
          <Modal
            open
            onClose={() => setShowAddProject(false)}
            title="Add New Project"
            description="Assign a new project to one of the developers you added."
            size="md"
          >
            <form onSubmit={handleAddProject} className="space-y-4">
              <Field label="Project Title" htmlFor="project-name" required>
                <Input
                  id="project-name"
                  type="text"
                  name="name"
                  value={newProject.name}
                  onChange={handleInputChange}
                  placeholder="Enter project title"
                  required
                />
              </Field>

              <Field label="Deadline" htmlFor="project-deadline" required>
                <Input
                  id="project-deadline"
                  type="date"
                  name="deadline"
                  value={newProject.deadline}
                  onChange={handleInputChange}
                  min={new Date().toISOString().split('T')[0]}
                  required
                />
              </Field>

              <Field
                label="Project Description"
                htmlFor="project-description"
                hint="Requirements, scope and anything the developer needs up front."
              >
                <textarea
                  id="project-description"
                  name="description"
                  value={newProject.description}
                  onChange={handleInputChange}
                  placeholder="Enter project description and requirements..."
                  rows="3"
                  className={CONTROL_CLASS}
                />
              </Field>

              {adminDevelopers.length > 0 ? (
                <Field label="Assign to Developer" htmlFor="project-developer" required>
                  <select
                    id="project-developer"
                    name="assigned_developer"
                    value={newProject.assigned_developer}
                    onChange={handleInputChange}
                    className={CONTROL_CLASS}
                    required
                  >
                    <option value="">Select Developer (Added by you)</option>
                    {adminDevelopers.map(developer => (
                      <option key={developer.id} value={developer.id}>
                        {developer.name} ({developer.email})
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                  <p className="text-sm text-warning">
                    You haven&apos;t added any developers yet. Please add developers first in the &quot;Add Developer&quot; section.
                  </p>
                </div>
              )}

              <Field
                label="Attach Requirements File"
                htmlFor="file-input"
                hint="Supported format only DOCX (Max 10MB)"
              >
                <input
                  id="file-input"
                  type="file"
                  onChange={handleFileChange}
                  className={CONTROL_CLASS}
                  accept=".pdf,.doc,.docx,.txt"
                />
              </Field>

              {newProject.file && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-success/30 bg-success/10 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-success">
                      {newProject.file.name}
                    </p>
                    <p className="text-xs text-success">
                      {(newProject.file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                  <Button type="button" variant="ghost" onClick={removeSelectedFile}>
                    Remove
                  </Button>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button
                  type="submit"
                  disabled={loading || uploadingFile || adminDevelopers.length === 0}
                  className="flex-1"
                >
                  {uploadingFile ? 'Uploading File...' :
                    loading ? 'Adding...' :
                      adminDevelopers.length === 0 ? 'No Developers Available' :
                        'Add Project'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowAddProject(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            </form>
          </Modal>
        )}

        {/* Delete Confirmation Modal */}
        {showDeleteModal && (
          <Modal
            open
            onClose={() => {
              if (deleting) return;
              setShowDeleteModal(false);
              setProjectToDelete(null);
            }}
            title="Delete Project"
            description="This will permanently remove the project and all associated data."
            size="md"
          >
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
                <p className="text-sm font-medium text-destructive">
                  Warning: this action cannot be undone.
                </p>
              </div>

              <p className="text-sm text-foreground">
                Are you sure you want to delete the project{" "}
                <span className="font-semibold">&quot;{projectToDelete?.name}&quot;</span>?
              </p>

              <div className="rounded-lg bg-muted p-3">
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Assigned to:</span> {projectToDelete?.assigned_developer_name || 'No developer assigned'}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Progress:</span> {projectToDelete?.progress}%
                </p>
                {projectToDelete?.deadline && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Deadline:</span> {formatDate(projectToDelete.deadline)}
                  </p>
                )}
              </div>

              <p className="text-sm text-muted-foreground">
                The assigned developer will be notified.
              </p>

              <div className="flex gap-3">
                <Button
                  variant="destructive"
                  onClick={handleConfirmDelete}
                  disabled={deleting}
                  className="flex-1"
                >
                  {deleting ? 'Deleting...' : 'Yes, Delete Project'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowDeleteModal(false);
                    setProjectToDelete(null);
                  }}
                  disabled={deleting}
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </Modal>
        )}

        {/* Metrics / Productivity Modal */}
        {showMetricsModal && (
          <Modal
            open
            onClose={() => {
              setShowMetricsModal(false);
              setMetricsData(null);
              setMetricsError("");
            }}
            title="Developer Productivity"
            description={metricsData?.project?.name || undefined}
            size="lg"
          >
            {metricsLoading ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
                  {[0, 1, 2, 3].map((i) => (
                    <SkeletonCard key={i} />
                  ))}
                </div>
                <Skeleton className="h-16 w-full rounded-lg" />
              </div>
            ) : metricsError ? (
              <ErrorState
                title="Couldn't load productivity metrics"
                description={metricsError}
                onRetry={() => handleViewMetrics(metricsProject)}
              />
            ) : metricsData ? (
              <div className="animate-fade-in space-y-4">
                {/* Summary tiles similar to developer timesheet */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
                  <div className="rounded-xl border border-border bg-card p-4 text-center shadow-card">
                    <div className="text-2xl font-bold tabular-nums text-foreground">{metricsData.totalTasks}</div>
                    <div className="mt-1 text-xs text-muted-foreground">Total Tasks</div>
                  </div>
                  <div className="rounded-xl border border-border bg-card p-4 text-center shadow-card">
                    <div className="text-2xl font-bold tabular-nums text-success">{metricsData.summary?.onTime || 0}</div>
                    <div className="mt-1 text-xs text-muted-foreground">On Time</div>
                    <div className="mt-1 text-[11px] text-success">+{metricsData.summary?.onTime || 0} pts</div>
                  </div>
                  <div className="rounded-xl border border-border bg-card p-4 text-center shadow-card">
                    <div className="text-2xl font-bold tabular-nums text-destructive">{metricsData.summary?.late || 0}</div>
                    <div className="mt-1 text-xs text-muted-foreground">Late</div>
                    <div className="mt-1 text-[11px] text-destructive">-{metricsData.summary?.late || 0} pts</div>
                  </div>
                  <div className="rounded-xl border border-border bg-card p-4 text-center shadow-card">
                    <div className="text-2xl font-bold tabular-nums text-foreground">
                      {metricsData.productivityPercentage || 0}%
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">Productivity</div>
                    <div className="mt-2 flex justify-center">
                      <Badge
                        size="sm"
                        variant={
                          parseFloat(metricsData.productivityPercentage || 0) >= 80
                            ? "success"
                            : parseFloat(metricsData.productivityPercentage || 0) >= 50
                              ? "warning"
                              : "destructive"
                        }
                      >
                        {parseFloat(metricsData.productivityPercentage || 0) >= 80
                          ? "On track"
                          : parseFloat(metricsData.productivityPercentage || 0) >= 50
                            ? "Needs attention"
                            : "At risk"}
                      </Badge>
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Points: {metricsData.productivityPoints >= 0 ? `+${metricsData.productivityPoints}` : metricsData.productivityPoints}
                    </div>
                  </div>
                </div>

                {/* Basic breakdown */}
                <div className="rounded-lg border border-border bg-muted p-3 text-xs text-muted-foreground">
                  <p className="mb-1">
                    <span className="font-semibold text-foreground">Completed:</span> {metricsData.summary?.completed || 0} ·
                    {" "}
                    <span className="font-semibold text-success">On Time:</span> {metricsData.summary?.onTime || 0} ·
                    {" "}
                    <span className="font-semibold text-destructive">Late:</span> {metricsData.summary?.late || 0} ·
                    {" "}
                    <span className="font-semibold text-foreground">Pending:</span> {(metricsData.summary?.pending || 0) + (metricsData.summary?.inProgress || 0) + (metricsData.summary?.awaiting || 0)} ·
                    {" "}
                    <span className="font-semibold text-foreground">Rejected:</span> {metricsData.summary?.rejected || 0}
                  </p>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={BarChart3}
                title="No productivity data"
                description="This project has no productivity metrics to show yet."
              />
            )}
          </Modal>
        )}

        {/* Projects */}
        {loadError ? (
          <ErrorState
            title="Couldn't load your projects"
            description={loadError}
            onRetry={fetchAdminData}
          />
        ) : projects.length > 0 ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {projects.map(project => {
              const deadlineSummary = getDeadlineSummary(project.deadline);
              return (
                <Card key={project.id} className="animate-fade-in">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <CardTitle className="truncate">{project.name}</CardTitle>
                        {project.description && (
                          <CardDescription className="line-clamp-2">
                            {project.description}
                          </CardDescription>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDeleteClick(project)}
                        aria-label={`Delete project ${project.name}`}
                        title="Delete Project"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                    <div className="pt-1">
                      <StatusPill
                        size="sm"
                        status={statusPillKey(project.status)}
                        label={statusLabel(project.status)}
                      />
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-3">
                    <div>
                      <div className="mb-1 flex justify-between text-sm text-foreground">
                        <span>Progress</span>
                        <span className="tabular-nums">{project.progress}%</span>
                      </div>
                      <div
                        className="h-2 w-full overflow-hidden rounded-full bg-muted"
                        role="progressbar"
                        aria-valuenow={Number(project.progress) || 0}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${project.name} progress`}
                      >
                        <div
                          className="h-2 rounded-full bg-primary"
                          style={{ width: `${project.progress}%` }}
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">Developers:</span> {assignedDeveloperCount(project)}
                      </p>

                      {project.assigned_developer_name && (
                        <div>
                          <p className="text-sm text-muted-foreground">
                            <span className="font-medium text-foreground">Assigned to:</span> {project.assigned_developer_name}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {project.assigned_developer_email}
                          </p>
                        </div>
                      )}

                      {project.deadline && (
                        <p className="text-sm text-muted-foreground">
                          <span className="font-medium text-foreground">Deadline:</span> {formatDate(project.deadline)}
                        </p>
                      )}

                      <p className="text-xs text-muted-foreground">
                        Created: {formatDate(project.created_at)}
                      </p>
                    </div>

                    {project.file_url && (
                      <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 p-2">
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="truncate text-sm text-foreground">
                            {project.file_name || 'Requirements File'}
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDownloadFile(project)}
                        >
                          <Download className="h-4 w-4" aria-hidden="true" />
                          Download
                        </Button>
                      </div>
                    )}

                    {/* Compact timeline similar to developer view */}
                    <div className="rounded-lg border border-border bg-muted/40 p-3">
                      <p className="mb-2 flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        <Calendar className="h-4 w-4" aria-hidden="true" />
                        Project timeline
                      </p>
                      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                        <div>
                          <p className="font-medium text-foreground">Created</p>
                          <p>{formatDate(project.created_at)}</p>
                        </div>
                        <div className="relative mx-3 h-0.5 flex-1 bg-border">
                          <span className="absolute -top-1 left-0 h-2 w-2 rounded-full bg-muted-foreground/50" />
                          <span className="absolute -top-1 right-0 h-2 w-2 rounded-full bg-muted-foreground/50" />
                        </div>
                        <div className="text-right">
                          <p className="font-medium text-foreground">Deadline</p>
                          <p>{project.deadline ? formatDate(project.deadline) : 'Not set'}</p>
                        </div>
                      </div>
                      <Badge size="sm" variant={deadlineSummary.variant}>
                        {deadlineSummary.label}
                      </Badge>
                    </div>
                  </CardContent>

                  <CardFooter className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleViewMetrics(project)}
                      title="View Productivity"
                    >
                      <BarChart3 className="h-4 w-4" aria-hidden="true" />
                      Metrics
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleViewGanttChart(project.id)}
                      title="View Gantt Chart Timeline"
                    >
                      <Calendar className="h-4 w-4" aria-hidden="true" />
                      Timeline
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleViewProjectDetails(project.id)}
                      title="View Project Details"
                      className="ml-auto"
                    >
                      <Eye className="h-4 w-4" aria-hidden="true" />
                      View Detail
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={Inbox}
            title="No projects yet"
            description={
              adminDevelopers.length === 0
                ? "You need to add developers first — add them in the Add Developer section, then assign a project."
                : "Start by creating your first project and assigning it to one of your developers."
            }
            action={
              adminDevelopers.length === 0 ? undefined : (
                <Button variant="outline" onClick={() => setShowAddProject(true)}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add New Project
                </Button>
              )
            }
          />
        )}
      </div>
    </div>
  );
}
