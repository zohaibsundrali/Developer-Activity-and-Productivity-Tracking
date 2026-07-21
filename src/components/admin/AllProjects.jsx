"use client";
import { useState, useEffect } from "react";
import { RefreshCw, Plus, X, Trash2, AlertTriangle, FileText, BarChart3, Calendar, Eye, Download } from "lucide-react";
import { showError, showInfo, showSuccess, showWarning } from "@/utils/alerts";
import { getOrgId } from "@/utils/orgContext";

const statusPill = (status) => {
  const s = String(status || "").toLowerCase();
  if (["completed","done","approved","active","reviewed"].includes(s)) return "bg-success/10 text-success";
  if (["in_progress","in progress","awaiting_approval","pending_review"].includes(s)) return "bg-info/10 text-info";
  if (["pending","assigned","draft","on_hold"].includes(s)) return "bg-warning/10 text-warning";
  if (["rejected","cancelled","overdue"].includes(s)) return "bg-destructive/10 text-destructive";
  return "bg-muted text-muted-foreground";
};

export default function AllProjects({ developers: initialDevelopers, supabase }) {
  const [showAddProject, setShowAddProject] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [fetchingProjects, setFetchingProjects] = useState(true);
  const [projects, setProjects] = useState([]);
  const [currentAdmin, setCurrentAdmin] = useState(null);
  const [adminDevelopers, setAdminDevelopers] = useState([]); // Only developers added by current admin
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [showMetricsModal, setShowMetricsModal] = useState(false);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState("");
  const [metricsData, setMetricsData] = useState(null);

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
      setShowMetricsModal(true);

      const url = `/api/productivity?type=project&projectId=${project.id}&developerId=${project.assigned_developer_id}`;
      const res = await fetch(url);
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

  const handleFileUpload = async (file) => {
    try {
      setUploadingFile(true);

      // Create unique file name
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random().toString(36).substring(2)}_${Date.now()}.${fileExt}`;

      // Upload file to Supabase Storage
      const { data, error } = await supabase.storage
        .from('documents')
        .upload(fileName, file);

      if (error) throw error;

      // Get public URL for the uploaded file
      const { data: urlData } = supabase.storage
        .from('documents')
        .getPublicUrl(fileName);

      return urlData.publicUrl;

    } catch (error) {
      showError("Upload failed", `File upload failed: ${error.message}`);
      return null;
    } finally {
      setUploadingFile(false);
    }
  };

  const generateAiTasks = async (projectId, fileUrl, fileName) => {
    if (!projectId || !fileUrl) return null;
    const lowerName = (fileName || "").toLowerCase();
    if (!lowerName.endsWith(".docx")) return null;

    try {
      const res = await fetch("/api/ai-generate-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, fileUrl }),
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

  const handleDownloadFile = async (project) => {
    if (project.file_url) {
      window.open(project.file_url, '_blank');
    }
  };

  const removeSelectedFile = () => {
    setNewProject(prev => ({
      ...prev,
      file: null
    }));
    const fileInput = document.getElementById('file-input');
    if (fileInput) fileInput.value = '';
  };

  // Show loading state
  if (fetchingProjects) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 shadow-card">
        <div className="text-center py-8">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="mt-2 text-muted-foreground">Loading your projects...</p>
        </div>
      </div>
    );
  }

  // Show warning if admin is not logged in
  if (!currentAdmin) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 shadow-card">
        <div className="text-center py-8">
          <p className="text-muted-foreground">Please log in as an admin to view projects.</p>
        </div>
      </div>
    );
  }

  const getDeadlineSummary = (deadline) => {
    if (!deadline) return { label: 'No deadline set', tone: 'text-muted-foreground' };

    try {
      const deadlineDate = new Date(deadline);
      const today = new Date();
      const diffTime = deadlineDate - today;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays < 0) {
        return {
          label: `Overdue by ${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? '' : 's'}`,
          tone: 'text-destructive'
        };
      }
      if (diffDays === 0) {
        return { label: 'Due today', tone: 'text-warning' };
      }
      if (diffDays === 1) {
        return { label: '1 day left', tone: 'text-warning' };
      }

      return {
        label: `${diffDays} days left`,
        tone: diffDays <= 3 ? 'text-warning' : 'text-success'
      };
    } catch {
      return { label: 'N/A', tone: 'text-muted-foreground' };
    }
  };

  return (
    <div className="space-y-6 rounded-xl border border-border bg-card p-6 shadow-card">
      {/* Debug Button - Temporary */}


      {/* Header with Add Project Button and Admin Info */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">My Projects</h2>

        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <button
            onClick={fetchAdminData}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            disabled={fetchingProjects}
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <button
            onClick={() => setShowAddProject(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            disabled={adminDevelopers.length === 0}
          >
            <Plus className="w-4 h-4" />
            Add New Project
          </button>
        </div>
      </div>

      {/* Developer Stats */}


      {/* Add Project Modal */}
      {showAddProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-popover max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-foreground">Add New Project</h3>
              <button
                onClick={() => setShowAddProject(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddProject} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Project Title *
                </label>
                <input
                  type="text"
                  name="name"
                  value={newProject.name}
                  onChange={handleInputChange}
                  placeholder="Enter project title"
                  className="w-full rounded-lg border border-input bg-background p-2 text-foreground focus:border-primary focus:ring-2 focus:ring-primary/30"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Deadline *
                </label>
                <input
                  type="date"
                  name="deadline"
                  value={newProject.deadline}
                  onChange={handleInputChange}
                  min={new Date().toISOString().split('T')[0]}
                  className="w-full rounded-lg border border-input bg-background p-2 text-foreground focus:border-primary focus:ring-2 focus:ring-primary/30"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Project Description
                </label>
                <textarea
                  name="description"
                  value={newProject.description}
                  onChange={handleInputChange}
                  placeholder="Enter project description and requirements..."
                  rows="3"
                  className="w-full rounded-lg border border-input bg-background p-2 text-foreground focus:border-primary focus:ring-2 focus:ring-primary/30"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Assign to Developer *
                </label>
                {adminDevelopers.length > 0 ? (
                  <select
                    name="assigned_developer"
                    value={newProject.assigned_developer}
                    onChange={handleInputChange}
                    className="w-full rounded-lg border border-input bg-background p-2 text-foreground focus:border-primary focus:ring-2 focus:ring-primary/30"
                    required
                  >
                    <option value="">Select Developer (Added by you)</option>
                    {adminDevelopers.map(developer => (
                      <option key={developer.id} value={developer.id}>
                        {developer.name} ({developer.email})
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="p-3 bg-warning/10 border border-warning/30 rounded-lg">
                    <p className="text-sm text-warning">
                      You haven't added any developers yet. Please add developers first in the "Add Developer" section.
                    </p>
                  </div>
                )}

              </div>



              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Attach Requirements File
                </label>
                <input
                  id="file-input"
                  type="file"
                  onChange={handleFileChange}
                  className="w-full rounded-lg border border-input bg-background p-2 text-foreground focus:border-primary focus:ring-2 focus:ring-primary/30"
                  accept=".pdf,.doc,.docx,.txt"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Supported format only DOCX  (Max 10MB)
                </p>

                {newProject.file && (
                  <div className="mt-2 p-3 bg-success/10 border border-success/30 rounded-lg">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-sm font-medium text-success">
                          {newProject.file.name}
                        </p>
                        <p className="text-xs text-success">
                          {(newProject.file.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={removeSelectedFile}
                        className="text-destructive hover:text-destructive/80"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  type="submit"
                  disabled={loading || uploadingFile || adminDevelopers.length === 0}
                  className={`flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors ${loading || uploadingFile || adminDevelopers.length === 0
                    ? 'bg-primary/50 cursor-not-allowed'
                    : 'bg-primary hover:bg-primary/90'
                    }`}
                >
                  {uploadingFile ? 'Uploading File...' :
                    loading ? 'Adding...' :
                      adminDevelopers.length === 0 ? 'No Developers Available' :
                        'Add Project'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddProject(false)}
                  className="flex-1 inline-flex items-center justify-center rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-popover max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-destructive">Delete Project</h3>
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setProjectToDelete(null);
                }}
                className="text-muted-foreground hover:text-foreground"
                disabled={deleting}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-6">
              <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-lg mb-4">
                <div className="flex items-center">
                  <AlertTriangle className="w-6 h-6 text-destructive mr-3" />
                  <h4 className="text-lg font-medium text-destructive">Warning: This action cannot be undone</h4>
                </div>
              </div>

              <p className="text-foreground mb-4">
                Are you sure you want to delete the project <span className="font-bold">"{projectToDelete?.name}"</span>?
              </p>

              <div className="p-3 bg-muted rounded-lg mb-4">
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Assigned to:</span> {projectToDelete?.assigned_developer_name || 'No developer assigned'}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  <span className="font-medium text-foreground">Progress:</span> {projectToDelete?.progress}%
                </p>
                {projectToDelete?.deadline && (
                  <p className="text-sm text-muted-foreground mt-1">
                    <span className="font-medium text-foreground">Deadline:</span> {formatDate(projectToDelete.deadline)}
                  </p>
                )}
              </div>

              <p className="text-sm text-muted-foreground">
                This will permanently remove the project and all associated data. The assigned developer will be notified.
              </p>
            </div>

            <div className="flex space-x-3">
              <button
                onClick={handleConfirmDelete}
                disabled={deleting}
                className={`flex-1 py-2 px-4 rounded-lg transition-colors text-destructive-foreground flex items-center justify-center ${deleting
                  ? 'bg-destructive/60 cursor-not-allowed'
                  : 'bg-destructive hover:bg-destructive/90'
                  }`}
              >
                {deleting ? (
                  <>
                    <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Deleting...
                  </>
                ) : (
                  'Yes, Delete Project'
                )}
              </button>
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setProjectToDelete(null);
                }}
                disabled={deleting}
                className="flex-1 inline-flex items-center justify-center rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Metrics / Productivity Modal */}
      {showMetricsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl rounded-xl border border-border bg-card p-6 shadow-popover max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="text-xl font-bold text-foreground">Developer Productivity</h3>
                {metricsData?.project?.name && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {metricsData.project.name}
                  </p>
                )}
              </div>
              <button
                onClick={() => {
                  setShowMetricsModal(false);
                  setMetricsData(null);
                  setMetricsError("");
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {metricsLoading ? (
              <div className="py-10 text-center">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                <p className="mt-3 text-muted-foreground text-sm">Loading productivity metrics...</p>
              </div>
            ) : metricsError ? (
              <div className="py-6">
                <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 text-sm text-destructive">
                  {metricsError}
                </div>
              </div>
            ) : metricsData ? (
              <div className="space-y-4">
                {/* Summary cards similar to developer timesheet */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-card rounded-xl border border-border p-4 text-center shadow-card">
                    <div className="text-2xl font-bold text-foreground">{metricsData.totalTasks}</div>
                    <div className="text-xs text-muted-foreground mt-1">Total Tasks</div>
                  </div>
                  <div className="bg-success/10 rounded-xl border border-success/30 p-4 text-center shadow-card">
                    <div className="text-2xl font-bold text-success">{metricsData.summary?.onTime || 0}</div>
                    <div className="text-xs text-success mt-1">On Time</div>
                    <div className="text-[11px] text-success">+{metricsData.summary?.onTime || 0} pts</div>
                  </div>
                  <div className="bg-destructive/10 rounded-xl border border-destructive/30 p-4 text-center shadow-card">
                    <div className="text-2xl font-bold text-destructive">{metricsData.summary?.late || 0}</div>
                    <div className="text-xs text-destructive mt-1">Late</div>
                    <div className="text-[11px] text-destructive">-{metricsData.summary?.late || 0} pts</div>
                  </div>
                  <div
                    className={`rounded-xl border p-4 text-center shadow-card ${parseFloat(metricsData.productivityPercentage || 0) >= 80
                      ? "bg-success/10 border-success/30"
                      : parseFloat(metricsData.productivityPercentage || 0) >= 50
                        ? "bg-warning/10 border-warning/30"
                        : "bg-destructive/10 border-destructive/30"
                      }`}
                  >
                    <div
                      className={`text-2xl font-bold ${parseFloat(metricsData.productivityPercentage || 0) >= 80
                        ? "text-success"
                        : parseFloat(metricsData.productivityPercentage || 0) >= 50
                          ? "text-warning"
                          : "text-destructive"
                        }`}
                    >
                      {metricsData.productivityPercentage || 0}%
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">Productivity</div>
                    <div className="text-[11px] text-muted-foreground">
                      Points: {metricsData.productivityPoints >= 0 ? `+${metricsData.productivityPoints}` : metricsData.productivityPoints}
                    </div>
                  </div>
                </div>

                {/* Basic breakdown */}
                <div className="bg-muted border border-border rounded-lg p-3 text-xs text-muted-foreground">
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
            ) : null}
          </div>
        </div>
      )}

      {/* Projects Grid */}
      {projects.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map(project => (
            <div key={project.id} className="rounded-xl border border-border bg-card p-4 shadow-card hover:shadow-elevated transition-shadow relative">
              {/* Delete Button - Top Right Corner */}
              <button
                onClick={() => handleDeleteClick(project)}
                className="absolute top-3 right-3 text-muted-foreground hover:text-destructive transition-colors p-1"
                title="Delete Project"
              >
                <Trash2 className="w-5 h-5" />
              </button>

              <div className="flex justify-between items-start mb-2 pr-8">
                <h3 className="text-lg font-semibold text-foreground">{project.name}</h3>
                <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${statusPill(project.status)}`}>
                  {project.status}
                </span>
              </div>

              {project.description && (
                <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                  {project.description}
                </p>
              )}

              <div className="mb-2">
                <div className="flex justify-between text-sm mb-1 text-foreground">
                  <span>Progress</span>
                  <span>{project.progress}%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div
                    className="bg-primary h-2 rounded-full"
                    style={{ width: `${project.progress}%` }}
                  ></div>
                </div>
              </div>

              <div className="space-y-1 mb-3">
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Developers:</span> {project.developers_count}
                </p>

                {project.assigned_developer_name && (
                  <div>
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">Assigned to:</span> {project.assigned_developer_name}
                    </p>
                    <p className="text-xs text-muted-foreground">
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
                <div className="mb-3 p-2 bg-info/10 border border-info/30 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 flex-1 min-w-0">
                      <FileText className="w-4 h-4 text-info" />
                      <span className="text-sm text-info truncate">
                        {project.file_name || 'Requirements File'}
                      </span>
                    </div>
                    <button
                      onClick={() => handleDownloadFile(project)}
                      className="inline-flex items-center gap-1 text-info hover:text-info/80 text-sm font-medium"
                    >
                      <Download className="w-4 h-4" />
                      Download
                    </button>
                  </div>
                </div>
              )}

              {/* Compact timeline similar to developer view */}
              <div className="mt-2 mb-3 rounded-lg bg-muted/50 border border-dashed border-border p-3">
                <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center">
                  <Calendar className="w-3 h-3 mr-1 text-muted-foreground" />
                  Project timeline
                </p>
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                  <div>
                    <p className="font-medium text-foreground">Created</p>
                    <p>{formatDate(project.created_at)}</p>
                  </div>
                  <div className="flex-1 mx-3 h-0.5 bg-gradient-to-r from-border via-primary to-border relative">
                    <span className="absolute -top-1 left-1 w-2 h-2 rounded-full bg-muted-foreground/50" />
                    <span className="absolute -top-1 right-1 w-2 h-2 rounded-full bg-muted-foreground/50" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">Deadline</p>
                    <p>{project.deadline ? formatDate(project.deadline) : 'Not set'}</p>
                  </div>
                </div>
                <div className="mt-1">
                  {(() => {
                    const summary = getDeadlineSummary(project.deadline);
                    return (
                      <span className={`inline-flex items-center px-2 py-1 rounded-full bg-card border border-border text-[11px] font-medium ${summary.tone}`}>
                        {summary.label}
                      </span>
                    );
                  })()}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleViewMetrics(project)}
                  className="bg-success/10 text-success py-2 px-2 rounded-lg text-xs font-semibold hover:bg-success/20 transition-colors flex items-center justify-center"
                  title="View Productivity"
                >
                  <BarChart3 className="w-4 h-4 mr-1" />
                  Metrics
                </button>
                <button
                  onClick={() => handleViewGanttChart(project.id)}
                  className="bg-violet-500/10 text-violet-600 py-2 px-2 rounded-lg text-xs font-semibold hover:bg-violet-500/20 transition-colors flex items-center justify-center"
                  title="View Gantt Chart Timeline"
                >
                  <Calendar className="w-4 h-4 mr-1" />
                  Timeline
                </button>
              </div>
              <button
                onClick={() => handleViewProjectDetails(project.id)}
                className="mt-2 w-full bg-primary text-primary-foreground py-2 px-2 rounded-lg text-xs font-semibold hover:bg-primary/90 transition-colors flex items-center justify-center"
                title="View Project Details"
              >
                <Eye className="w-4 h-4 mr-1" />
                View Detail
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <FileText className="w-16 h-16 text-muted-foreground/40 mx-auto mb-4" strokeWidth={1} />


          {adminDevelopers.length === 0 ? (
            <div className="mb-6">
              <p className="text-muted-foreground text-sm mb-4">You need to add developers first</p>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm mb-6">Start by creating your first project</p>
          )}
        </div>
      )}
    </div>
  );
}