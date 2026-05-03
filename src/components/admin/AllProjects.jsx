"use client";
import { useState, useEffect } from "react";
import { showError, showInfo, showSuccess, showWarning } from "@/utils/alerts";

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

      // Fetch projects created by this admin (not assigned_to, but created_by)
      const projectsPromise = supabase
        .from('projects')
        .select('*')
        .or(`created_by.eq.${adminData.id},added_by.eq.${adminData.id},added_by_admin.ilike.%${adminData.email}%`)
        .order('created_at', { ascending: false });

      // Fetch developers added by this admin
      const developersPromise = supabase
        .from('developers')
        .select('*')
        .or(`added_by.eq.${adminData.id},added_by_admin.ilike.%${adminData.email}%`)
        .eq('status', 'active') // Only active developers
        .order('name', { ascending: true });

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

  const handleViewProjectActivity = (projectId) => {
    showInfo("Project activity", `View project ${projectId} activity.`);
  };

  const handleViewProjectProductivity = (projectId) => {
    // Placeholder kept for backwards compatibility (no-op)
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

  // Debug function to check notifications table structure
  const debugCheckNotifications = async () => {
    try {
      // Check what fields exist in notifications table
      const { data: columns, error: columnsError } = await supabase
        .rpc('get_table_columns', { table_name: 'notifications' });

      if (columnsError) {
        // Alternative method
        const { data } = await supabase
          .from('notifications')
          .select('*')
          .limit(1);
      }

      // Check last 5 notifications
      const { data: recentNotifications } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);

    } catch (error) {
      // Silently handle error
    }
  };

  // Show loading state
  if (fetchingProjects) {
    return (
      <div className="bg-white p-6 rounded-lg shadow">
        <div className="text-center py-8">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#009578]"></div>
          <p className="mt-2 text-gray-500">Loading your projects...</p>
        </div>
      </div>
    );
  }

  // Show warning if admin is not logged in
  if (!currentAdmin) {
    return (
      <div className="bg-white p-6 rounded-lg shadow">
        <div className="text-center py-8">
          <p className="text-gray-500">Please log in as an admin to view projects.</p>
        </div>
      </div>
    );
  }

  const activeDevelopers = adminDevelopers.filter(dev => dev.status === 'active');
  const inactiveDevelopers = adminDevelopers.filter(dev => dev.status === 'inactive');

  const getDeadlineSummary = (deadline) => {
    if (!deadline) return { label: 'No deadline set', tone: 'text-gray-600' };

    try {
      const deadlineDate = new Date(deadline);
      const today = new Date();
      const diffTime = deadlineDate - today;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays < 0) {
        return {
          label: `Overdue by ${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? '' : 's'}`,
          tone: 'text-red-600'
        };
      }
      if (diffDays === 0) {
        return { label: 'Due today', tone: 'text-orange-600' };
      }
      if (diffDays === 1) {
        return { label: '1 day left', tone: 'text-orange-600' };
      }

      return {
        label: `${diffDays} days left`,
        tone: diffDays <= 3 ? 'text-orange-600' : 'text-green-600'
      };
    } catch {
      return { label: 'N/A', tone: 'text-gray-600' };
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      {/* Debug Button - Temporary */}


      {/* Header with Add Project Button and Admin Info */}
      <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold">My Projects</h2>

        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <button
            onClick={fetchAdminData}
            className="bg-gray-100 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-200 transition-colors text-sm flex items-center"
            disabled={fetchingProjects}
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
          <button
            onClick={() => setShowAddProject(true)}
            className="bg-[#009578] text-white px-4 py-2 rounded-lg hover:bg-[#0e7762] transition-colors"
            disabled={adminDevelopers.length === 0}
          >
            + Add New Project
          </button>
        </div>
      </div>

      {/* Developer Stats */}


      {/* Add Project Modal */}
      {showAddProject && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded-lg shadow-lg max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">Add New Project</h3>
              <button
                onClick={() => setShowAddProject(false)}
                className="text-gray-500 hover:text-gray-700 text-xl"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddProject} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Project Title *
                </label>
                <input
                  type="text"
                  name="name"
                  value={newProject.name}
                  onChange={handleInputChange}
                  placeholder="Enter project title"
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-[#009578] focus:border-[#009578]"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Deadline *
                </label>
                <input
                  type="date"
                  name="deadline"
                  value={newProject.deadline}
                  onChange={handleInputChange}
                  min={new Date().toISOString().split('T')[0]}
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-[#009578] focus:border-[#009578]"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Project Description
                </label>
                <textarea
                  name="description"
                  value={newProject.description}
                  onChange={handleInputChange}
                  placeholder="Enter project description and requirements..."
                  rows="3"
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-[#009578] focus:border-[#009578]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Assign to Developer *
                </label>
                {adminDevelopers.length > 0 ? (
                  <select
                    name="assigned_developer"
                    value={newProject.assigned_developer}
                    onChange={handleInputChange}
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-[#009578] focus:border-[#009578]"
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
                  <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                    <p className="text-sm text-yellow-700">
                      You haven't added any developers yet. Please add developers first in the "Add Developer" section.
                    </p>
                  </div>
                )}

              </div>



              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Attach Requirements File
                </label>
                <input
                  id="file-input"
                  type="file"
                  onChange={handleFileChange}
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-[#009578] focus:border-[#009578]"
                  accept=".pdf,.doc,.docx,.txt"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Supported format only DOCX  (Max 10MB)
                </p>

                {newProject.file && (
                  <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-md">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-sm font-medium text-green-800">
                          {newProject.file.name}
                        </p>
                        <p className="text-xs text-green-600">
                          {(newProject.file.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={removeSelectedFile}
                        className="text-red-500 hover:text-red-700"
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
                  className={`flex-1 py-2 px-4 rounded-md transition-colors ${loading || uploadingFile || adminDevelopers.length === 0
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-[#009578] hover:bg-[#0e7762]'
                    } text-white`}
                >
                  {uploadingFile ? 'Uploading File...' :
                    loading ? 'Adding...' :
                      adminDevelopers.length === 0 ? 'No Developers Available' :
                        'Add Project'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddProject(false)}
                  className="flex-1 bg-gray-500 text-white py-2 px-4 rounded-md hover:bg-gray-600 transition-colors"
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded-lg shadow-lg max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-red-600">Delete Project</h3>
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setProjectToDelete(null);
                }}
                className="text-gray-500 hover:text-gray-700 text-xl"
                disabled={deleting}
              >
                ✕
              </button>
            </div>

            <div className="mb-6">
              <div className="p-4 bg-red-50 border border-red-200 rounded-md mb-4">
                <div className="flex items-center">
                  <svg className="w-6 h-6 text-red-600 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                  <h4 className="text-lg font-medium text-red-800">Warning: This action cannot be undone</h4>
                </div>
              </div>

              <p className="text-gray-700 mb-4">
                Are you sure you want to delete the project <span className="font-bold">"{projectToDelete?.name}"</span>?
              </p>

              <div className="p-3 bg-gray-100 rounded-md mb-4">
                <p className="text-sm text-gray-600">
                  <span className="font-medium">Assigned to:</span> {projectToDelete?.assigned_developer_name || 'No developer assigned'}
                </p>
                <p className="text-sm text-gray-600 mt-1">
                  <span className="font-medium">Progress:</span> {projectToDelete?.progress}%
                </p>
                {projectToDelete?.deadline && (
                  <p className="text-sm text-gray-600 mt-1">
                    <span className="font-medium">Deadline:</span> {formatDate(projectToDelete.deadline)}
                  </p>
                )}
              </div>

              <p className="text-sm text-gray-500">
                This will permanently remove the project and all associated data. The assigned developer will be notified.
              </p>
            </div>

            <div className="flex space-x-3">
              <button
                onClick={handleConfirmDelete}
                disabled={deleting}
                className={`flex-1 py-2 px-4 rounded-md transition-colors ${deleting
                  ? 'bg-red-400 cursor-not-allowed'
                  : 'bg-red-600 hover:bg-red-700'
                  } text-white flex items-center justify-center`}
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
                className="flex-1 bg-gray-500 text-white py-2 px-4 rounded-md hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Metrics / Productivity Modal */}
      {showMetricsModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded-xl shadow-xl max-w-xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Developer Productivity</h3>
                {metricsData?.project?.name && (
                  <p className="text-sm text-gray-500 mt-1">
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
                className="text-gray-500 hover:text-gray-700 text-xl"
              >
                ✕
              </button>
            </div>

            {metricsLoading ? (
              <div className="py-10 text-center">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#009578]"></div>
                <p className="mt-3 text-gray-500 text-sm">Loading productivity metrics...</p>
              </div>
            ) : metricsError ? (
              <div className="py-6">
                <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">
                  {metricsError}
                </div>
              </div>
            ) : metricsData ? (
              <div className="space-y-4">
                {/* Summary cards similar to developer timesheet */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-white rounded-xl border p-4 text-center shadow-sm">
                    <div className="text-2xl font-bold text-gray-800">{metricsData.totalTasks}</div>
                    <div className="text-xs text-gray-500 mt-1">Total Tasks</div>
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
                    <div className="text-xs text-gray-600 mt-1">Productivity</div>
                    <div className="text-[11px] text-gray-500">
                      Points: {metricsData.productivityPoints >= 0 ? `+${metricsData.productivityPoints}` : metricsData.productivityPoints}
                    </div>
                  </div>
                </div>

                {/* Basic breakdown */}
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-700">
                  <p className="mb-1">
                    <span className="font-semibold">Completed:</span> {metricsData.summary?.completed || 0} ·
                    {" "}
                    <span className="font-semibold text-green-700">On Time:</span> {metricsData.summary?.onTime || 0} ·
                    {" "}
                    <span className="font-semibold text-red-700">Late:</span> {metricsData.summary?.late || 0} ·
                    {" "}
                    <span className="font-semibold">Pending:</span> {(metricsData.summary?.pending || 0) + (metricsData.summary?.inProgress || 0) + (metricsData.summary?.awaiting || 0)} ·
                    {" "}
                    <span className="font-semibold">Rejected:</span> {metricsData.summary?.rejected || 0}
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
            <div key={project.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow relative">
              {/* Delete Button - Top Right Corner */}
              <button
                onClick={() => handleDeleteClick(project)}
                className="absolute top-3 right-3 text-gray-400 hover:text-red-600 transition-colors p-1"
                title="Delete Project"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>

              <div className="flex justify-between items-start mb-2 pr-8">
                <h3 className="text-lg font-semibold">{project.name}</h3>
                <span className={`text-xs px-2 py-1 rounded-full ${project.status === 'active' ? 'bg-green-100 text-green-800' :
                  project.status === 'completed' ? 'bg-blue-100 text-blue-800' :
                    'bg-yellow-100 text-yellow-800'
                  }`}>
                  {project.status}
                </span>
              </div>

              {project.description && (
                <p className="text-sm text-gray-600 mb-3 line-clamp-2">
                  {project.description}
                </p>
              )}

              <div className="mb-2">
                <div className="flex justify-between text-sm mb-1">
                  <span>Progress</span>
                  <span>{project.progress}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-[#009578] h-2 rounded-full"
                    style={{ width: `${project.progress}%` }}
                  ></div>
                </div>
              </div>

              <div className="space-y-1 mb-3">
                <p className="text-sm text-gray-600">
                  <span className="font-medium">Developers:</span> {project.developers_count}
                </p>

                {project.assigned_developer_name && (
                  <div>
                    <p className="text-sm text-gray-600">
                      <span className="font-medium">Assigned to:</span> {project.assigned_developer_name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {project.assigned_developer_email}
                    </p>
                  </div>
                )}

                {project.deadline && (
                  <p className="text-sm text-gray-600">
                    <span className="font-medium">Deadline:</span> {formatDate(project.deadline)}
                  </p>
                )}

                <p className="text-xs text-gray-500">
                  Created: {formatDate(project.created_at)}
                </p>
              </div>

              {project.file_url && (
                <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded-md">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 flex-1 min-w-0">
                      <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="text-sm text-blue-700 truncate">
                        {project.file_name || 'Requirements File'}
                      </span>
                    </div>
                    <button
                      onClick={() => handleDownloadFile(project)}
                      className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                    >
                      Download
                    </button>
                  </div>
                </div>
              )}

              {/* Compact timeline similar to developer view */}
              <div className="mt-2 mb-3 rounded-md bg-gray-50 border border-dashed border-gray-200 p-3">
                <p className="text-xs font-semibold text-gray-600 mb-2 flex items-center">
                  <svg className="w-3 h-3 mr-1 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Project timeline
                </p>
                <div className="flex items-center justify-between text-xs text-gray-600 mb-2">
                  <div>
                    <p className="font-medium">Created</p>
                    <p>{formatDate(project.created_at)}</p>
                  </div>
                  <div className="flex-1 mx-3 h-0.5 bg-gradient-to-r from-gray-300 via-[#009578] to-gray-300 relative">
                    <span className="absolute -top-1 left-1 w-2 h-2 rounded-full bg-gray-400" />
                    <span className="absolute -top-1 right-1 w-2 h-2 rounded-full bg-gray-400" />
                  </div>
                  <div>
                    <p className="font-medium">Deadline</p>
                    <p>{project.deadline ? formatDate(project.deadline) : 'Not set'}</p>
                  </div>
                </div>
                <div className="mt-1">
                  {(() => {
                    const summary = getDeadlineSummary(project.deadline);
                    return (
                      <span className={`inline-flex items-center px-2 py-1 rounded-full bg-white border text-[11px] font-medium ${summary.tone}`}>
                        {summary.label}
                      </span>
                    );
                  })()}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleViewMetrics(project)}
                  className="bg-green-500 text-white py-2 px-2 rounded text-xs hover:bg-green-600 transition-colors flex items-center justify-center"
                  title="View Productivity"
                >
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  Metrics
                </button>
                <button
                  onClick={() => handleViewGanttChart(project.id)}
                  className="bg-purple-500 text-white py-2 px-2 rounded text-xs hover:bg-purple-600 transition-colors flex items-center justify-center"
                  title="View Gantt Chart Timeline"
                >
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Timeline
                </button>
              </div>
              <button
                onClick={() => handleViewProjectDetails(project.id)}
                className="mt-2 w-full bg-blue-600 text-white py-2 px-2 rounded text-xs hover:bg-blue-700 transition-colors flex items-center justify-center"
                title="View Project Details"
              >
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                View Detail
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>


          {adminDevelopers.length === 0 ? (
            <div className="mb-6">
              <p className="text-gray-400 text-sm mb-4">You need to add developers first</p>
            </div>
          ) : (
            <p className="text-gray-400 text-sm mb-6">Start by creating your first project</p>
          )}
        </div>
      )}
    </div>
  );
}