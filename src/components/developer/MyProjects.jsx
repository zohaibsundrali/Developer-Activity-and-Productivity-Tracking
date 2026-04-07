"use client";
import { useState } from 'react';

export default function MyProjects({ 
  assignedProjects, 
  onViewProjectDetails, // ✅ Added prop for navigation
  user 
}) {
  const [sortBy, setSortBy] = useState('recent');
  const [filterStatus, setFilterStatus] = useState('all');

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
      alert('No file available for this project');
    }
  };

  // ✅ FIXED: Use the navigation function from parent
  const handleViewProject = (project) => {
    if (onViewProjectDetails) {
      onViewProjectDetails(project);
    } else {
      // Fallback if prop not provided
      alert(`Viewing project: ${project.name}`);
    }
  };

  const handleSubmitWork = (project) => {
    alert(`Submit work for project: ${project.name}`);
    // You can implement actual submission logic here
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
    <div className="bg-white rounded-lg shadow">
      {/* Header with Stats */}
      <div className="p-6 border-b border-gray-200">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">My Projects</h2>
            <p className="text-gray-600 text-sm mt-1">
              Manage and track all your assigned projects
            </p>
          </div>
          
          <div className="flex items-center space-x-4 mt-4 md:mt-0">
            <div className="text-sm text-gray-600">
              <span className="font-semibold">{assignedProjects.length}</span> total projects
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-gradient-to-r from-blue-50 to-blue-100 border border-blue-200 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-blue-800">Active Projects</p>
                <p className="text-2xl font-bold text-blue-900 mt-1">{activeProjectsCount}</p>
              </div>
              <div className="bg-blue-200 p-3 rounded-lg">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
            </div>
          </div>
          
          <div className="bg-gradient-to-r from-green-50 to-green-100 border border-green-200 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-green-800">Completed</p>
                <p className="text-2xl font-bold text-green-900 mt-1">{completedProjectsCount}</p>
              </div>
              <div className="bg-green-200 p-3 rounded-lg">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
          </div>
          
          <div className="bg-gradient-to-r from-yellow-50 to-yellow-100 border border-yellow-200 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-yellow-800">Pending</p>
                <p className="text-2xl font-bold text-yellow-900 mt-1">{pendingProjectsCount}</p>
              </div>
              <div className="bg-yellow-200 p-3 rounded-lg">
                <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col md:flex-row md:items-center justify-between space-y-4 md:space-y-0">
          <div className="flex items-center space-x-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sort by</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="recent">Most Recent</option>
                <option value="deadline">Deadline</option>
                <option value="progress">Progress</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="all">All Projects</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="pending">Pending</option>
              </select>
            </div>
          </div>
          
          <div className="text-sm text-gray-600">
            Showing <span className="font-semibold">{sortedProjects.length}</span> of {assignedProjects.length} projects
          </div>
        </div>
      </div>

      {/* Projects Grid */}
      <div className="p-6">
        {sortedProjects.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {sortedProjects.map(project => {
              const assignedDate = project.assigned_at || project.created_at;
              const daysAgo = getTimeAgo(assignedDate);
              
              return (
                <div 
                  key={project.id} 
                  className="border border-gray-200 rounded-xl overflow-hidden hover:shadow-lg transition-all duration-300 hover:-translate-y-1 bg-white"
                >
                  {/* Project Header */}
                  <div className="p-5 border-b border-gray-100">
                    <div className="flex justify-between items-start mb-3">
                      <h3 className="text-lg font-bold text-gray-900 line-clamp-1">
                        {project.name}
                      </h3>
                      <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${
                        project.status === 'active' || project.status === 'in_progress' 
                          ? 'bg-green-100 text-green-800' 
                          : project.status === 'completed' 
                          ? 'bg-blue-100 text-blue-800'
                          : project.status === 'pending' || project.status === 'assigned'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {project.status?.charAt(0).toUpperCase() + project.status?.slice(1) || 'Pending'}
                      </span>
                    </div>
                    
                    {project.description && (
                      <p className="text-sm text-gray-600 line-clamp-2 mb-4">
                        {project.description}
                      </p>
                    )}
                    
                    {/* Progress Bar */}
                    <div className="mb-2">
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-700 font-medium">Progress</span>
                        <span className="font-bold text-blue-600">{project.progress || 0}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-gradient-to-r from-blue-500 to-blue-600 h-2 rounded-full transition-all duration-500"
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
                        <p className="text-xs text-gray-500 font-medium mb-1">Assigned</p>
                        <div className="flex items-center">
                          <svg className="w-4 h-4 text-green-500 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <p className="text-sm font-medium text-gray-900">{formatDate(assignedDate)}</p>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">{daysAgo}</p>
                      </div>
                      
                      {project.deadline && (
                        <div>
                          <p className="text-xs text-gray-500 font-medium mb-1">Deadline</p>
                          <div className="flex items-center">
                            <svg className="w-4 h-4 text-orange-500 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <p className="text-sm font-medium text-gray-900">{formatDate(project.deadline)}</p>
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
                      <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center border border-blue-200">
                              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                            </div>
                            <div>
                              <p className="text-sm font-medium text-blue-900 truncate max-w-[150px]">
                                {project.file_name || 'Requirements File'}
                              </p>
                              <p className="text-xs text-blue-600">Project requirements</p>
                            </div>
                          </div>
                          <button
                            onClick={() => handleDownloadFile(project)}
                            className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center"
                          >
                            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Download
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex space-x-3">
                      <button 
                        onClick={() => handleViewProject(project)}
                        className="flex-1 bg-gradient-to-r from-blue-500 to-blue-600 text-white py-2 px-4 rounded-lg hover:from-blue-600 hover:to-blue-700 transition-all font-medium text-sm flex items-center justify-center"
                      >
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                        View Details
                      </button>
                    
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-gray-100 rounded-full mb-6">
              <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No Projects Found</h3>
            <p className="text-gray-600 max-w-md mx-auto mb-8">
              {filterStatus === 'all' 
                ? "You haven't been assigned any projects yet. Projects assigned to you will appear here."
                : `No ${filterStatus} projects found. Try changing the status filter.`
              }
            </p>
            
            {filterStatus !== 'all' && (
              <button
                onClick={() => setFilterStatus('all')}
                className="bg-blue-500 text-white px-6 py-2 rounded-lg hover:bg-blue-600 transition-colors font-medium"
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