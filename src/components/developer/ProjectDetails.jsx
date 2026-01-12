"use client";
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabase } from '@/utils/supabaseClient'; // Correct path

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
          console.warn('No project ID found in URL');
          setProjectData(urlProject);
          setDataSource('url');
          return;
        }

        console.log('Fetching project from Supabase with ID:', projectId);

        // Supabase se project data fetch karein
        const { data, error } = await supabase
          .from('projects') // Aapki table ka naam - agar alag hai to change karein
          .select('*')
          .eq('id', projectId)
          .single();

        if (error) {
          console.error('Supabase error:', error);
          throw error;
        }

        if (data) {
          console.log('Data fetched from Supabase:', data);
          setProjectData(data);
          setDataSource('supabase');
        } else {
          console.warn('No data found in Supabase, using URL params');
          setProjectData(urlProject);
          setDataSource('url');
        }
      } catch (err) {
        console.error('Error fetching project from Supabase:', err);
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
      console.error('Date formatting error:', error);
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
      console.error('Date formatting error:', error);
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
      console.error('Date calculation error:', error);
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
    alert(`Submit work for project ${project.id}`);
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

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 py-8">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Fetching project details from Supabase...</p>
            <p className="text-sm text-gray-400 mt-2">Loading database data</p>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !project.id) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 py-8">
        <div className="max-w-6xl mx-auto px-4">
          <div className="bg-red-50 border border-red-200 rounded-xl p-6">
            <div className="flex items-center">
              <svg className="w-6 h-6 text-red-600 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h3 className="font-semibold text-red-800">Error Loading Project</h3>
                <p className="text-sm text-red-600 mt-1">{error}</p>
                <button
                  onClick={handleBackToDashboard}
                  className="mt-4 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
                >
                  Go to Dashboard
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 py-8">
      <div className="max-w-6xl mx-auto px-4">
        {/* ✅ FIXED: Header with better back button options */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-3">
            <button
              onClick={handleBack}
              className="flex items-center text-gray-600 hover:text-gray-800 bg-white px-4 py-2 rounded-lg shadow-sm hover:shadow transition-all border border-gray-300"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Go Back
            </button>
            
            {/* Alternative back buttons */}
            <div className="hidden md:flex space-x-2">
              <button
                onClick={handleBackToDashboard}
                className="flex items-center text-gray-600 hover:text-gray-800 bg-gray-100 px-3 py-2 rounded-lg hover:bg-gray-200 transition-colors text-sm"
              >
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                Dashboard
              </button>
              <button
                onClick={handleBackToProjects}
                className="flex items-center text-gray-600 hover:text-gray-800 bg-gray-100 px-3 py-2 rounded-lg hover:bg-gray-200 transition-colors text-sm"
              >
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                All Projects
              </button>
            </div>
          </div>
          
          <div className="text-right">
            <h1 className="text-3xl font-bold text-gray-900">Project Details</h1>
            <p className="text-gray-600 mt-1">
              {dataSource === 'supabase' ? "Live data from Supabase" : "Using URL parameters"}
            </p>
          </div>
        </div>

        {/* Data source indicator */}
        {dataSource === 'supabase' && (
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center">
              <svg className="w-5 h-5 text-blue-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <p className="text-sm text-blue-700">
                <span className="font-semibold">✓ Live Data:</span> Project information loaded directly from Supabase database
              </p>
            </div>
          </div>
        )}

        {/* Project not found warning */}
        {(!project.id || project.id === 'null') && (
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-center">
              <svg className="w-6 h-6 text-yellow-600 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <div>
                <p className="font-medium text-yellow-800">Project data not loaded properly</p>
                <p className="text-sm text-yellow-700">Please go back to the projects list and try again</p>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-xl overflow-hidden border border-gray-200">
          {/* Project Header with Gradient */}
          <div className="bg-gradient-to-r from-blue-600 to-blue-800 p-8 text-white relative">
            <div className="absolute top-4 right-4">
              <span className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold ${
                project.status === 'active' ? 'bg-green-500 text-white' :
                project.status === 'completed' ? 'bg-emerald-500 text-white' :
                project.status === 'pending' ? 'bg-yellow-500 text-white' :
                'bg-gray-500 text-white'
              }`}>
                {project.status?.charAt(0).toUpperCase() + project.status?.slice(1)}
              </span>
            </div>
            
            <div className="max-w-3xl">
              <h1 className="text-4xl font-bold mb-4">{project.name || 'Unnamed Project'}</h1>
              
              {project.assigned_developer_name && (
                <div className="flex items-center mb-4">
                  <div className="flex items-center bg-white/20 backdrop-blur-sm rounded-lg px-4 py-2">
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    <span className="font-medium">Assigned to: {project.assigned_developer_name}</span>
                    {project.assigned_developer_email && (
                      <span className="ml-2 text-sm text-blue-200">({project.assigned_developer_email})</span>
                    )}
                  </div>
                </div>
              )}
              
              <div className="flex flex-wrap gap-4 mt-6">
                <div className="flex items-center bg-white/20 backdrop-blur-sm rounded-lg px-4 py-2">
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span>Created: {formatDate(project.created_at)}</span>
                </div>
                
                {assignedDate && (
                  <div className="flex items-center bg-green-500/30 backdrop-blur-sm rounded-lg px-4 py-2">
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="font-semibold">Assigned: {formatDate(assignedDate)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Project Content */}
          <div className="p-8">
            {/* Progress Section */}
            <div className="mb-10">
              <h2 className="text-2xl font-bold mb-6 text-gray-800 flex items-center">
                <svg className="w-6 h-6 mr-3 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                Project Progress
              </h2>
              
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl p-6 border border-blue-100">
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <span className="text-lg font-semibold text-gray-700">Completion Status</span>
                    <p className="text-sm text-gray-500 mt-1">Track your progress towards completion</p>
                  </div>
                  <div className="text-right">
                    <span className="text-4xl font-bold text-blue-600">{project.progress}%</span>
                    <p className="text-sm text-gray-500">completed</p>
                  </div>
                </div>
                
                <div className="mb-2">
                  <div className="w-full bg-gray-200 rounded-full h-4">
                    <div 
                      className="bg-gradient-to-r from-blue-500 to-blue-600 h-4 rounded-full transition-all duration-1000 ease-out"
                      style={{ width: `${project.progress}%` }}
                    ></div>
                  </div>
                </div>
                
                <div className="flex justify-between text-sm text-gray-600 mt-2">
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
              <h2 className="text-2xl font-bold mb-6 text-gray-800 flex items-center">
                <svg className="w-6 h-6 mr-3 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Project Timeline {dataSource === 'supabase' && <span className="text-sm font-normal text-blue-600 ml-2">(Live from Supabase)</span>}
              </h2>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Created Date Card */}
                <div className="bg-gradient-to-br from-gray-50 to-white rounded-xl p-6 border border-gray-200 shadow-sm">
                  <div className="flex items-center mb-4">
                    <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mr-4">
                      <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-800">Created On</h3>
                      <p className="text-sm text-gray-500">Project creation date</p>
                      {dataSource === 'supabase' && (
                        <span className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">Supabase</span>
                      )}
                    </div>
                  </div>
                  <div className="mt-4">
                    <p className="text-lg font-medium text-gray-900">{formatDate(project.created_at)}</p>
                    <p className="text-sm text-gray-500 mt-1">{formatDateTime(project.created_at)}</p>
                  </div>
                </div>

                {/* ✅ ASSIGNED DATE CARD - HIGHLIGHTED */}
                <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-6 border border-green-200 shadow-sm relative overflow-hidden">
                  <div className="absolute -top-4 -right-4 w-16 h-16 bg-green-200 rounded-full opacity-20"></div>
                  <div className="absolute -bottom-4 -left-4 w-12 h-12 bg-green-300 rounded-full opacity-10"></div>
                  
                  <div className="flex items-center mb-4 relative z-10">
                    <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mr-4">
                      <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <div className="flex items-center">
                        <h3 className="font-semibold text-gray-800">Assigned On</h3>
                        <span className="ml-2 px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">
                          🎯 Key Date
                        </span>
                      </div>
                      <p className="text-sm text-gray-500">When project was assigned to you</p>
                    </div>
                  </div>
                  <div className="mt-4 relative z-10">
                    <p className="text-lg font-bold text-green-800">{formatDate(assignedDate)}</p>
                    <p className="text-sm text-green-600 mt-1">{formatDateTime(assignedDate)}</p>
                    
                    {/* Data source indicator */}
                    {dataSource === 'supabase' && assignedDate === project.created_at && (
                      <div className="text-xs text-blue-600 bg-blue-50 p-1 rounded mt-1">
                        ⚡ Using Supabase created_at
                      </div>
                    )}
                    
                    {daysSinceAssignment !== null && (
                      <div className="mt-3 p-2 bg-green-100 rounded-lg">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-green-800">
                            {daysSinceAssignment === 0 ? 'Assigned today' : 
                             daysSinceAssignment === 1 ? 'Assigned yesterday' : 
                             `Assigned ${daysSinceAssignment} days ago`}
                          </span>
                          <span className="text-xs bg-green-200 text-green-800 px-2 py-1 rounded-full font-medium">
                            {daysSinceAssignment}d
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Deadline Card */}
                {project.deadline && project.deadline !== 'null' && (
                  <div className="bg-gradient-to-br from-orange-50 to-red-50 rounded-xl p-6 border border-orange-200 shadow-sm">
                    <div className="flex items-center mb-4">
                      <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center mr-4">
                        <svg className="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-800">Deadline</h3>
                        <p className="text-sm text-gray-500">Submission due date</p>
                      </div>
                    </div>
                    <div className="mt-4">
                      <p className="text-lg font-medium text-gray-900">{formatDate(project.deadline)}</p>
                      <p className="text-sm text-gray-500 mt-1">{formatDateTime(project.deadline)}</p>
                      
                      {/* Days remaining calculation */}
                      {project.deadline && project.deadline !== 'null' && (
                        <div className="mt-3">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-gray-600">Time remaining:</span>
                            <span className="font-medium text-orange-600">
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
              <h2 className="text-2xl font-bold mb-6 text-gray-800 flex items-center">
                <svg className="w-6 h-6 mr-3 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Project Description & Requirements
              </h2>
              
              <div className="bg-gradient-to-r from-gray-50 to-white rounded-2xl p-8 border border-gray-200">
                <div className="prose max-w-none">
                  {project.description ? (
                    <div className="text-gray-700 leading-relaxed space-y-4">
                      {project.description.split('\n').map((paragraph, index) => (
                        <p key={index} className="text-lg">
                          {paragraph}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12">
                      <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <p className="text-gray-500 text-lg">No description provided for this project.</p>
                      <p className="text-gray-400 text-sm mt-2">Contact the project manager for details</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* File Attachment */}
            {project.file_url && project.file_url !== 'null' && (
              <div className="mb-10">
                <h2 className="text-2xl font-bold mb-6 text-gray-800 flex items-center">
                  <svg className="w-6 h-6 mr-3 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                  Project Files & Resources
                </h2>
                
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl p-6 border border-blue-200">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="flex items-center space-x-4">
                      <div className="w-16 h-16 bg-white rounded-xl flex items-center justify-center shadow-sm">
                        <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-bold text-gray-900 text-lg">
                          {project.file_name || 'Project Requirements Document'}
                        </p>
                        <p className="text-sm text-gray-600 mt-1">
                          Contains all project specifications, guidelines, and requirements
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <button
                        onClick={handleDownloadFile}
                        className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-6 py-3 rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all shadow-md hover:shadow-lg font-medium flex items-center justify-center"
                      >
                        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download File
                      </button>
                      <button className="bg-white text-blue-600 px-6 py-3 rounded-lg border border-blue-200 hover:bg-blue-50 transition-colors font-medium">
                        Preview
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ✅ FIXED: Action Buttons with better navigation */}
            <div className="pt-8 border-t border-gray-200">
              <div className="flex flex-col sm:flex-row gap-4 justify-between">
                <div className="flex flex-col sm:flex-row gap-4">
                  <button
                    onClick={handleBackToDashboard}
                    className="flex-1 bg-gray-100 text-gray-700 py-3 px-6 rounded-xl hover:bg-gray-200 transition-colors font-medium flex items-center justify-center border border-gray-300"
                  >
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                    </svg>
                    Dashboard
                  </button>
                  
                  <button
                    onClick={handleBackToProjects}
                    className="flex-1 bg-blue-100 text-blue-600 py-3 px-6 rounded-xl hover:bg-blue-200 transition-colors font-medium flex items-center justify-center border border-blue-300"
                  >
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    All Projects
                  </button>
                </div>
                
                <button
                  onClick={handleSubmitWork}
                  className="flex-1 bg-gradient-to-r from-green-500 to-emerald-600 text-white py-3 px-6 rounded-xl hover:from-green-600 hover:to-emerald-700 transition-all shadow-md hover:shadow-lg font-medium flex items-center justify-center"
                >
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Submit Completed Work
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}