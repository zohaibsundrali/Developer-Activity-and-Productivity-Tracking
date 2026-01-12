"use client";
import { useState, useEffect } from "react";

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
      const adminData = JSON.parse(localStorage.getItem("adminUser"));
      
      if (!adminData) {
        console.error("No admin logged in");
        setCurrentAdmin(null);
        setProjects([]);
        setAdminDevelopers([]);
        return;
      }
      
      setCurrentAdmin(adminData);
      
      // Fetch projects assigned to this admin
      const projectsPromise = supabase
        .from('projects')
        .select('*')
        .or(`assigned_to.eq.${adminData.id},assigned_to_email.ilike.%${adminData.email}%`)
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
        console.error('Error fetching projects:', projectsResult.error);
        alert('Error fetching projects: ' + projectsResult.error.message);
        setProjects([]);
      } else {
        setProjects(projectsResult.data || []);
      }

      if (developersResult.error) {
        console.error('Error fetching developers:', developersResult.error);
        // Don't alert for developers error, just log it
        setAdminDevelopers([]);
      } else {
        setAdminDevelopers(developersResult.data || []);
      }
      
    } catch (error) {
      console.error('Error in fetchAdminData:', error);
      alert('Error loading data: ' + error.message);
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
    alert(`View Project ${projectId} Activity`);
  };

  const handleViewProjectProductivity = (projectId) => {
    alert(`View Project ${projectId} Productivity`);
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

    // ✅ **FIXED: Add notification with ALL required fields**
    if (projectToDelete.assigned_developer_id) {
      const { error: notificationError } = await supabase
        .from('notifications')
        .insert([
          {
            assigned_developer_id: projectToDelete.assigned_developer_id,
            developer_id: projectToDelete.assigned_developer_id,
            admin_id: currentAdmin.id,
            admin_email: currentAdmin.email,
            message: `🗑️ Project Deleted: "${projectToDelete.name}" has been deleted by admin.`,
            type: 'warning',
            read: false,
            created_at: new Date().toISOString()
          }
        ]);

      if (notificationError) {
        console.error('Notification error:', notificationError);
      }
    }

    // Remove the project from state
    setProjects(projects.filter(p => p.id !== projectToDelete.id));
    
    // Close modal and reset
    setShowDeleteModal(false);
    setProjectToDelete(null);
    
    alert(`Project "${projectToDelete.name}" deleted successfully!`);

  } catch (error) {
    console.error('Error deleting project:', error);
    alert('Error deleting project: ' + error.message);
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
      console.error('File upload error:', error);
      alert('File upload failed: ' + error.message);
      return null;
    } finally {
      setUploadingFile(false);
    }
  };

const handleAddProject = async (e) => {
  e.preventDefault();
  
  if (!currentAdmin) {
    alert("Admin not logged in");
    return;
  }
  
  if (adminDevelopers.length === 0) {
    alert("You need to add developers first before creating a project. Go to 'Add Developer' section.");
    return;
  }
  
  setLoading(true);

  try {
    // Validation
    if (!newProject.name || !newProject.deadline || !newProject.assigned_developer) {
      alert("Please fill in all required fields");
      return;
    }

    let fileUrl = null;
    
    // Upload file if selected
    if (newProject.file) {
      fileUrl = await handleFileUpload(newProject.file);
      if (!fileUrl) {
        alert("File upload failed. Please try again.");
        return;
      }
    }

    // Get assigned developer details from admin's developers
    const assignedDeveloper = adminDevelopers.find(dev => dev.id === newProject.assigned_developer);
    
    if (!assignedDeveloper) {
      alert("Selected developer not found in your added developers");
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
          assigned_to: currentAdmin.id,
          assigned_to_email: currentAdmin.email,
          created_by: currentAdmin.id,
          added_by: currentAdmin.id, // Store who added this project
          added_by_admin: currentAdmin.email,
          created_at: new Date().toISOString()
        }
      ])
      .select();

    if (error) throw error;

    console.log('✅ Project created:', data[0]);

    // ✅ **FIXED: Add notification with ALL required fields**
    const { error: notificationError } = await supabase
      .from('notifications')
      .insert([
        {
          // 🔴 IMPORTANT: Aapke table mein DONO fields hain
          assigned_developer_id: assignedDeveloper.id,  // UUID format
          developer_id: assignedDeveloper.id,            // UUID format
          
          // Admin information (jo aapke table mein hain)
          admin_id: currentAdmin.id,
          admin_email: currentAdmin.email,
          
          message: `🎯 New Project Assigned: "${newProject.name}" has been assigned to you. Start working on it now!`,
          type: 'project_assigned',
          read: false,
          created_at: new Date().toISOString()
        }
      ]);

    if (notificationError) {
      console.error('❌ Notification creation error:', notificationError);
      console.error('Full error details:', JSON.stringify(notificationError, null, 2));
      // Don't throw error for notification, just log it
    } else {
      console.log('✅ Notification created successfully');
      console.log('Notification sent to developer:', assignedDeveloper.id);
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
    alert(`Project "${newProject.name}" added and notification sent to ${assignedDeveloper.name}!`);

  } catch (error) {
    console.error('Error adding project:', error);
    alert('Error adding project: ' + error.message);
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
        alert("File size must be less than 10MB");
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
        alert("Please select a valid file type: PDF, DOC, DOCX, or TXT");
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
    console.log('🔍 Debug: Checking notifications table structure...');
    
    // Check what fields exist in notifications table
    const { data: columns, error: columnsError } = await supabase
      .rpc('get_table_columns', { table_name: 'notifications' });

    if (columnsError) {
      // Alternative method
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .limit(1);
      
      console.log('✅ Notifications table sample:', data);
    } else {
      console.log('📋 Notifications table columns:', columns);
    }

    // Check current admin
    console.log('👨‍💼 Current Admin:', currentAdmin);
    
    // Check available developers
    console.log('👨‍💻 Available developers:', adminDevelopers);
    
    // Check last 5 notifications
    const { data: recentNotifications } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);
    
    console.log('📨 Recent notifications:', recentNotifications);

  } catch (error) {
    console.error('Debug error:', error);
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

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      {/* Debug Button - Temporary */}
      <div className="mb-4">
        <button
          onClick={debugCheckNotifications}
          className="bg-purple-500 text-white px-3 py-1 rounded text-xs"
        >
          🔍 Debug Notifications
        </button>
      </div>

      {/* Header with Add Project Button and Admin Info */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold">My Projects</h2>
          <p className="text-sm text-gray-500">Assigned to: {currentAdmin.name || currentAdmin.email}</p>
          <div className="flex items-center space-x-4 mt-1">
            <p className="text-xs text-gray-400">
              Showing {projects.length} project{projects.length !== 1 ? 's' : ''}
            </p>
            <p className="text-xs text-gray-400">
              {adminDevelopers.length} developer{adminDevelopers.length !== 1 ? 's' : ''} available
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
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
      {adminDevelopers.length > 0 && (
        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-700">Your Available Developers</h3>
              <div className="flex items-center space-x-4 mt-1">
                <span className="text-xs text-green-600">
                  {activeDevelopers.length} Active
                </span>
                <span className="text-xs text-red-600">
                  {inactiveDevelopers.length} Inactive
                </span>
              </div>
            </div>
            {adminDevelopers.length === 0 && (
              <a 
                href="#add-developer" 
                className="text-sm text-[#009578] hover:underline"
              >
                Add your first developer →
              </a>
            )}
          </div>
        </div>
      )}

      {/* Add Project Modal */}
      {showAddProject && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
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
                    {activeDevelopers.map(developer => (
                      <option key={developer.id} value={developer.id}>
                        {developer.name} ({developer.email})
                      </option>
                    ))}
                    {inactiveDevelopers.length > 0 && (
                      <optgroup label="Inactive Developers">
                        {inactiveDevelopers.map(developer => (
                          <option key={developer.id} value={developer.id} disabled>
                            {developer.name} ({developer.email}) - Inactive
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                ) : (
                  <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                    <p className="text-sm text-yellow-700">
                      You haven't added any developers yet. Please add developers first in the "Add Developer" section.
                    </p>
                  </div>
                )}
                <p className="text-xs text-gray-500 mt-1">
                  Only developers added by you are shown here
                </p>
              </div>

              <div className="p-3 bg-gray-50 rounded-md">
                <p className="text-sm text-gray-600 mb-2">
                  <span className="font-medium">Note:</span> This project will be automatically assigned to you ({currentAdmin.name || currentAdmin.email})
                </p>
                <p className="text-xs text-gray-500">
                  Developer must be added by you to appear in the list
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Attach Requirements File (Optional)
                </label>
                <input
                  id="file-input"
                  type="file"
                  onChange={handleFileChange}
                  className="w-full p-2 border border-gray-300 rounded-md focus:ring-[#009578] focus:border-[#009578]"
                  accept=".pdf,.doc,.docx,.txt"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Supported formats: PDF, DOC, DOCX, TXT (Max 10MB)
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
                  className={`flex-1 py-2 px-4 rounded-md transition-colors ${
                    loading || uploadingFile || adminDevelopers.length === 0
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg max-w-md w-full mx-4">
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
                className={`flex-1 py-2 px-4 rounded-md transition-colors ${
                  deleting
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
                <span className={`text-xs px-2 py-1 rounded-full ${
                  project.status === 'active' ? 'bg-green-100 text-green-800' :
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
                    <div className="flex items-center space-x-2">
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

              <div className="flex space-x-2">
                <button 
                  onClick={() => handleViewProjectActivity(project.id)}
                  className="flex-1 bg-blue-500 text-white py-1 px-3 rounded text-sm hover:bg-blue-600"
                >
                  Activity
                </button>
                <button 
                  onClick={() => handleViewProjectProductivity(project.id)}
                  className="flex-1 bg-green-500 text-white py-1 px-3 rounded text-sm hover:bg-green-600"
                >
                  Productivity
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-gray-500 text-lg mb-2">No projects assigned to you yet</p>
          
          {adminDevelopers.length === 0 ? (
            <div className="mb-6">
              <p className="text-gray-400 text-sm mb-4">You need to add developers first</p>
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-md max-w-md mx-auto">
                <p className="text-sm text-yellow-700 mb-3">
                  <span className="font-medium">Step 1:</span> Go to "Add Developer" section and add your first developer
                </p>
                <p className="text-sm text-yellow-700">
                  <span className="font-medium">Step 2:</span> Come back here to create your first project
                </p>
              </div>
            </div>
          ) : (
            <p className="text-gray-400 text-sm mb-6">Start by creating your first project</p>
          )}
          
          <button
            onClick={() => setShowAddProject(true)}
            className="bg-[#009578] text-white px-6 py-3 rounded-lg hover:bg-[#0e7762] transition-colors text-lg"
            disabled={adminDevelopers.length === 0}
          >
            {adminDevelopers.length === 0 ? 'Add Developers First' : '+ Add Your First Project'}
          </button>
        </div>
      )}
    </div>
  );
}