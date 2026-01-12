"use client";
import { useState, useEffect } from "react";

export default function DashboardOverview({ 
  user, 
  assignedProjects, 
  unreadCount, 
  onSectionChange,
  notifications // Add notifications prop
}) {
  const [recentNotifications, setRecentNotifications] = useState([]);
  const [recentAssignedProjects, setRecentAssignedProjects] = useState([]);
  const [isRealTimeActive, setIsRealTimeActive] = useState(true);

  // Format date function
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Get time ago for notifications
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

  // Filter recent notifications and projects
  useEffect(() => {
    if (notifications && notifications.length > 0) {
      // Get latest 3 notifications
      const recentNotifs = [...notifications]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 3);
      setRecentNotifications(recentNotifs);
    }

    if (assignedProjects && assignedProjects.length > 0) {
      // Get recently assigned projects (sorted by assigned_at or created_at)
      const recentProjects = [...assignedProjects]
        .sort((a, b) => new Date(b.assigned_at || b.created_at) - new Date(a.assigned_at || a.created_at))
        .slice(0, 2);
      setRecentAssignedProjects(recentProjects);
    }

    // Simulate real-time status (in real app, this would come from Supabase connection)
    const interval = setInterval(() => {
      setIsRealTimeActive(true);
    }, 5000);

    return () => clearInterval(interval);
  }, [notifications, assignedProjects]);

  // Calculate statistics
  const activeProjectsCount = assignedProjects?.filter(p => p.status === 'active' || p.status === 'in_progress').length || 0;
  const completedProjectsCount = assignedProjects?.filter(p => p.status === 'completed' || p.status === 'done').length || 0;
  const pendingProjectsCount = assignedProjects?.filter(p => p.status === 'pending' || p.status === 'assigned').length || 0;
  
  // Get project assignment notifications
  const projectNotifications = notifications?.filter(n => 
    n.message.toLowerCase().includes('project') || 
    n.type === 'project_assigned'
  ) || [];

  // Get unread project notifications
  const unreadProjectNotifications = projectNotifications.filter(n => !n.read).length;

  return (
    <div className="space-y-6">
      {/* Welcome Section with Stats */}
      <div className="bg-gradient-to-r from-[#009578] to-[#0e7762] text-white p-6 rounded-lg shadow-lg">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center">
          <div>
            <h1 className="text-2xl font-bold">Welcome back, {user?.name || 'Developer'}! 👋</h1>
            <p className="text-blue-100 mt-2">
              Here's what's happening with your projects today.
            </p>
          </div>
          
          {/* Real-time Status Badge */}
          <div className="mt-4 md:mt-0 flex items-center space-x-2 bg-white/20 px-4 py-2 rounded-full">
            <div className={`w-3 h-3 rounded-full ${isRealTimeActive ? 'bg-green-400 animate-pulse' : 'bg-gray-400'}`}></div>
            <span className="text-sm font-medium">
              {isRealTimeActive ? 'Real-time Active' : 'Connecting...'}
            </span>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Total Projects Card */}
        <div className="bg-white p-6 rounded-lg shadow border-l-4 border-blue-500">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-gray-500 text-sm font-medium">Total Projects</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{assignedProjects?.length || 0}</p>
            </div>
            <div className="bg-blue-100 p-3 rounded-lg">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
          </div>
          <div className="mt-4 flex items-center text-sm text-gray-600">
            <span className="text-green-600 font-medium">
              {activeProjectsCount} active
            </span>
            <span className="mx-2">•</span>
            <span>{pendingProjectsCount} pending</span>
          </div>
        </div>

        {/* Active Projects Card */}
        <div className="bg-white p-6 rounded-lg shadow border-l-4 border-green-500">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-gray-500 text-sm font-medium">Active Projects</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{activeProjectsCount}</p>
            </div>
            <div className="bg-green-100 p-3 rounded-lg">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <div className="mt-4">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-green-500 h-2 rounded-full transition-all duration-500" 
                style={{ width: `${assignedProjects?.length > 0 ? (activeProjectsCount / assignedProjects.length) * 100 : 0}%` }}
              ></div>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              {assignedProjects?.length > 0 ? Math.round((activeProjectsCount / assignedProjects.length) * 100) : 0}% of total
            </p>
          </div>
        </div>

        {/* Notifications Card */}
        <div className="bg-white p-6 rounded-lg shadow border-l-4 border-red-500 relative">
          {unreadCount > 0 && (
            <div className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold 
              rounded-full w-6 h-6 flex items-center justify-center animate-ping">
            </div>
          )}
          
          <div className="flex justify-between items-start">
            <div>
              <p className="text-gray-500 text-sm font-medium">Notifications</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{unreadCount}</p>
            </div>
            <div className="bg-red-100 p-3 rounded-lg">
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </div>
          </div>
          
          <div className="mt-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">
                {unreadProjectNotifications > 0 ? (
                  <span className="flex items-center">
                    <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
                    {unreadProjectNotifications} new project{unreadProjectNotifications > 1 ? 's' : ''}
                  </span>
                ) : 'No new projects'}
              </span>
              <button 
                onClick={() => onSectionChange("notifications")}
                className="text-[#009578] hover:text-[#0e7762] font-medium text-sm"
              >
                View all →
              </button>
            </div>
          </div>
        </div>

        {/* Completion Rate Card */}
        <div className="bg-white p-6 rounded-lg shadow border-l-4 border-purple-500">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-gray-500 text-sm font-medium">Completion Rate</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">{completedProjectsCount}</p>
            </div>
            <div className="bg-purple-100 p-3 rounded-lg">
              <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
          </div>
          <div className="mt-4">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-purple-500 h-2 rounded-full transition-all duration-500" 
                style={{ 
                  width: `${assignedProjects?.length > 0 ? 
                    (completedProjectsCount / assignedProjects.length) * 100 : 0}%` 
                }}
              ></div>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              {assignedProjects?.length > 0 ? 
                Math.round((completedProjectsCount / assignedProjects.length) * 100) : 0
              }% completed
            </p>
          </div>
        </div>
      </div>

      {/* Two Column Layout for Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Projects Column */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold text-gray-900">Recent Projects</h3>
              <button 
                onClick={() => onSectionChange("projects")}
                className="text-sm text-[#009578] hover:text-[#0e7762] font-medium"
              >
                View all →
              </button>
            </div>
          </div>
          
          <div className="divide-y divide-gray-100">
            {recentAssignedProjects.length > 0 ? (
              recentAssignedProjects.map((project, index) => (
                <div key={project.id} className="p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2">
                        <h4 className="font-medium text-gray-900">{project.name}</h4>
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          project.status === 'active' || project.status === 'in_progress' 
                            ? 'bg-green-100 text-green-800' 
                            : project.status === 'completed' 
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {project.status?.charAt(0).toUpperCase() + project.status?.slice(1) || 'Pending'}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 mt-1 truncate">
                        {project.description || 'No description available'}
                      </p>
                      <div className="flex items-center justify-between mt-3">
                        <div className="flex items-center space-x-4 text-xs text-gray-500">
                          <span>📅 {formatDate(project.deadline)}</span>
                          <span>🎯 {project.progress || 0}%</span>
                        </div>
                        <span className="text-xs text-gray-400">
                          Assigned {getTimeAgo(project.assigned_at || project.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  {/* Progress Bar */}
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>Progress</span>
                      <span>{project.progress || 0}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-1.5">
                      <div 
                        className="bg-[#009578] h-1.5 rounded-full transition-all duration-500" 
                        style={{ width: `${project.progress || 0}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-6 text-center">
                <svg className="w-12 h-12 text-gray-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-gray-500 mt-2">No projects assigned yet</p>
                <p className="text-gray-400 text-sm mt-1">New projects will appear here when assigned</p>
              </div>
            )}
          </div>
        </div>

        {/* Recent Notifications Column */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold text-gray-900">Recent Notifications</h3>
              <div className="flex items-center space-x-2">
                {unreadCount > 0 && (
                  <span className="bg-red-500 text-white text-xs px-2 py-1 rounded-full animate-pulse">
                    {unreadCount} new
                  </span>
                )}
                <button 
                  onClick={() => onSectionChange("notifications")}
                  className="text-sm text-[#009578] hover:text-[#0e7762] font-medium"
                >
                  View all →
                </button>
              </div>
            </div>
          </div>
          
          <div className="divide-y divide-gray-100">
            {recentNotifications.length > 0 ? (
              recentNotifications.map((notification, index) => {
                const isProjectNotification = notification.message.toLowerCase().includes('project') || 
                                              notification.type === 'project_assigned';
                const isUnread = !notification.read;
                
                return (
                  <div 
                    key={notification.id} 
                    className={`p-4 hover:bg-gray-50 transition-colors ${isUnread ? 'bg-blue-50' : ''}`}
                  >
                    <div className="flex items-start space-x-3">
                      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                        isProjectNotification 
                          ? 'bg-green-100 text-green-600' 
                          : isUnread 
                          ? 'bg-blue-100 text-blue-600'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {isProjectNotification ? '🎯' : '📢'}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start">
                          <p className={`text-sm font-medium ${
                            isUnread ? 'text-gray-900' : 'text-gray-700'
                          }`}>
                            {notification.message}
                          </p>
                          {isUnread && (
                            <span className="flex-shrink-0 ml-2">
                              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                            </span>
                          )}
                        </div>
                        
                        <div className="flex items-center justify-between mt-2">
                          <div className="flex items-center space-x-2">
                            {isProjectNotification && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                Project
                              </span>
                            )}
                            <span className="text-xs text-gray-500">
                              {getTimeAgo(notification.created_at)}
                            </span>
                          </div>
                          {isUnread ? (
                            <span className="text-xs font-medium text-blue-600">NEW</span>
                          ) : (
                            <span className="text-xs text-gray-400">Read</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="p-6 text-center">
                <svg className="w-12 h-12 text-gray-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                <p className="text-gray-500 mt-2">No notifications yet</p>
                <p className="text-gray-400 text-sm mt-1">
                  You'll receive notifications for new projects and updates
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Actions Footer */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button 
            onClick={() => onSectionChange("projects")}
            className="flex items-center justify-center p-4 bg-[#009578] text-white rounded-lg hover:bg-[#0e7762] transition-colors group"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            View All Projects
          </button>
          
          <button 
            onClick={() => onSectionChange("notifications")}
            className="flex items-center justify-center p-4 bg-white border-2 border-[#009578] text-[#009578] rounded-lg hover:bg-[#009578] hover:text-white transition-colors group relative"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            View Notifications
            {unreadCount > 0 && (
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center animate-pulse">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
          
          <button 
            className="flex items-center justify-center p-4 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors group"
            onClick={() => {
              // Refresh data
              window.location.reload();
            }}
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}