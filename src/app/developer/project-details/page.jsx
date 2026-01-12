"use client";
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import { supabase } from '@/utils/supabaseClient'; // Supabase client import

export default function ProjectDetailsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tasks, setTasks] = useState([]);
  const [editingTask, setEditingTask] = useState(null);
  const [showSubmitSuccess, setShowSubmitSuccess] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [projectData, setProjectData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);
  
  // ✅ NEW: Validation messages state
  const [validationError, setValidationError] = useState('');
  const [validationSuccess, setValidationSuccess] = useState('');

  // ✅ FIXED: Back navigation functions
  const handleBack = () => {
    router.push('/developer/dashboard');
  };

  const handleBackToProjects = () => {
    router.push('/developer/dashboard?section=projects');
  };

  // ✅ NEW: Validate all tasks before submission
  const validateAllTasks = () => {
    if (tasks.length === 0) {
      return {
        isValid: false,
        message: 'Please add at least one task before submitting.'
      };
    }

    const invalidTasks = [];
    
    tasks.forEach((task, index) => {
      const taskNumber = index + 1;
      
      // Check if start date is missing
      if (!task.startDate || task.startDate.trim() === '') {
        invalidTasks.push(`Task ${taskNumber}: Start date is required`);
        return;
      }
      
      // Check if end date is missing
      if (!task.endDate || task.endDate.trim() === '') {
        invalidTasks.push(`Task ${taskNumber}: End date is required`);
        return;
      }
      
      // Check if start date is valid
      const startDate = new Date(task.startDate);
      if (isNaN(startDate.getTime())) {
        invalidTasks.push(`Task ${taskNumber}: Invalid start date`);
        return;
      }
      
      // Check if end date is valid
      const endDate = new Date(task.endDate);
      if (isNaN(endDate.getTime())) {
        invalidTasks.push(`Task ${taskNumber}: Invalid end date`);
        return;
      }
      
      // Check if end date is before start date
      if (endDate < startDate) {
        invalidTasks.push(`Task ${taskNumber}: End date cannot be before start date`);
        return;
      }
      
      // Check if dates are in reasonable range (not too far in past or future)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      if (startDate < new Date('2000-01-01')) {
        invalidTasks.push(`Task ${taskNumber}: Start date is too far in the past`);
      }
      
      if (endDate > new Date('2100-12-31')) {
        invalidTasks.push(`Task ${taskNumber}: End date is too far in the future`);
      }
    });

    if (invalidTasks.length > 0) {
      return {
        isValid: false,
        message: 'Please fix the following issues:',
        details: invalidTasks
      };
    }

    return {
      isValid: true,
      message: 'All tasks are valid and ready for submission.'
    };
  };

  // ✅ NEW: Enhanced handleSubmitWork with validation
  const handleSubmitWork = () => {
    // Step 1: Validate all tasks
    const validation = validateAllTasks();
    
    if (!validation.isValid) {
      // Show validation error
      setValidationError(validation.message);
      
      // Auto-hide error after 5 seconds
      setTimeout(() => {
        setValidationError('');
      }, 5000);
      
      return; // Stop submission
    }
    
    // Step 2: Confirm submission
    if (!confirm('Are you sure you want to submit all tasks? This action cannot be undone.')) {
      return;
    }
    
    // Step 3: Submit work
    setShowSubmitSuccess(true);
    setIsSubmitted(true);
    localStorage.setItem(`project_submitted_${project.id}`, 'true');
    
    // Step 4: Show success message
    setValidationSuccess('Work submitted successfully! Tasks are now locked.');
    
    // Step 5: Auto-hide messages
    setTimeout(() => {
      setShowSubmitSuccess(false);
      setValidationSuccess('');
    }, 3000);
  };

  // ✅ NEW: Check if task is valid (for UI indicators)
  const isTaskValid = (task) => {
    if (!task.startDate || task.startDate.trim() === '') return false;
    if (!task.endDate || task.endDate.trim() === '') return false;
    
    const startDate = new Date(task.startDate);
    const endDate = new Date(task.endDate);
    
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return false;
    if (endDate < startDate) return false;
    
    return true;
  };

  // ✅ NEW: Calculate validation statistics
  const getValidationStats = () => {
    const totalTasks = tasks.length;
    const validTasks = tasks.filter(isTaskValid).length;
    const invalidTasks = totalTasks - validTasks;
    
    return {
      totalTasks,
      validTasks,
      invalidTasks,
      isAllValid: totalTasks > 0 && validTasks === totalTasks
    };
  };

  // Rest of your existing code remains the same...
  // Supabase se project data fetch karein
  useEffect(() => {
    const fetchProjectFromSupabase = async () => {
      try {
        setLoading(true);
        const projectId = searchParams.get('id');
        
        if (!projectId || projectId === 'null') {
          console.warn('No project ID found in URL');
          // URL parameters se data use karein
          const urlProject = getProjectDataFromURL();
          setProjectData(urlProject);
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
        } else {
          console.warn('No data found in Supabase, using URL params');
          setProjectData(getProjectDataFromURL());
        }
      } catch (err) {
        console.error('Error fetching project from Supabase:', err);
        setError(err.message);
        // Fallback: URL parameters se data use karein
        setProjectData(getProjectDataFromURL());
      } finally {
        setLoading(false);
      }
    };

    fetchProjectFromSupabase();
  }, [searchParams]);

  // URL parameters se project data get karein (fallback ke liye)
  const getProjectDataFromURL = () => {
    return {
      id: searchParams.get('id'),
      name: decodeURIComponent(searchParams.get('name') || ''),
      description: decodeURIComponent(searchParams.get('description') || ''),
      status: searchParams.get('status'),
      progress: parseInt(searchParams.get('progress') || '0'),
      deadline: searchParams.get('deadline'),
      created_at: searchParams.get('created_at'),
      file_url: searchParams.get('file_url'),
      file_name: decodeURIComponent(searchParams.get('file_name') || ''),
      assigned_at: searchParams.get('assigned_at'),
      assigned_date: searchParams.get('assigned_date'),
      assigned_developer_name: searchParams.get('assigned_developer_name'),
      assigned_developer_email: searchParams.get('assigned_developer_email')
    };
  };

  // Final project data - Supabase data ya URL data
  const project = projectData || getProjectDataFromURL();

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

  // ✅ FIXED: File Download Function - Direct Download
  const handleDownloadFile = async () => {
    if (!project.file_url || project.file_url === 'null') {
      alert('No file available for download');
      return;
    }

    try {
      setDownloading(true);
      
      // Method 1: Direct download with fetch API (works for most servers)
      const response = await fetch(project.file_url, {
        mode: 'cors',
        credentials: 'omit'
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      // Get filename from URL or use default
      const fileName = project.file_name || 
                      project.file_url.split('/').pop() || 
                      'project_file';
      
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      
      // Cleanup
      window.URL.revokeObjectURL(url);
      document.body.removeChild(link);
      
    } catch (error) {
      console.error('Fetch download failed:', error);
      
      // Method 2: Fallback to simple download
      try {
        const link = document.createElement('a');
        link.href = project.file_url;
        link.download = project.file_name || 'project_file';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (fallbackError) {
        console.error('Fallback download failed:', fallbackError);
        
        // Method 3: Last resort - open in new tab
        alert('Opening file in new tab. Please use browser\'s "Save as" option to download.');
        window.open(project.file_url, '_blank');
      }
      
    } finally {
      setDownloading(false);
    }
  };

  // Check if work is already submitted
  useEffect(() => {
    const submitted = localStorage.getItem(`project_submitted_${project.id}`);
    if (submitted === 'true') {
      setIsSubmitted(true);
    }
  }, [project.id]);

  // Initial tasks load karein
  useEffect(() => {
    const savedTasks = localStorage.getItem(`project_tasks_${project.id}`);
    if (savedTasks) {
      setTasks(JSON.parse(savedTasks));
    } else {
      // Default tasks create karein with assigned date as start date
      const assignedDate = getAssignedDate() || new Date().toISOString().split('T')[0];
      const defaultTasks = [
        {
          id: 1,
          title: 'Functional Requirements Understanding',
          description: 'Understand and analyze project requirements',
          startDate: assignedDate,
          endDate: '',
          workingHours: '',
          status: 'pending'
        },
        {
          id: 2,
          title: 'Website Design',
          description: 'Create UI/UX design and wireframes',
          startDate: assignedDate,
          endDate: '',
          workingHours: '',
          status: 'pending'
        },
        {
          id: 3,
          title: 'Frontend Development',
          description: 'Develop frontend components and pages',
          startDate: assignedDate,
          endDate: '',
          workingHours: '',
          status: 'pending'
        },
        {
          id: 4,
          title: 'Backend Development',
          description: 'Develop backend APIs and server logic',
          startDate: assignedDate,
          endDate: '',
          workingHours: '',
          status: 'pending'
        }
      ];
      setTasks(defaultTasks);
    }
  }, [project.id]);

  // Tasks save karein localStorage mein
  useEffect(() => {
    if (tasks.length > 0 && !isSubmitted) {
      localStorage.setItem(`project_tasks_${project.id}`, JSON.stringify(tasks));
    }
  }, [tasks, project.id, isSubmitted]);

  const formatDate = (dateString) => {
    if (!dateString || dateString === 'null') return 'Not set';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Task edit start karein
  const handleEditTask = (task) => {
    if (isSubmitted) return; // Submit ke baad edit nahi kar sakte
    setEditingTask({ ...task });
  };

  // Task update karein
  const handleUpdateTask = () => {
    if (!editingTask || isSubmitted) return;

    setTasks(prev => prev.map(task => 
      task.id === editingTask.id ? editingTask : task
    ));
    setEditingTask(null);
  };

  // Task delete karein
  const handleDeleteTask = (taskId) => {
    if (isSubmitted) return; // Submit ke baad delete nahi kar sakte
    
    if (confirm('Are you sure you want to delete this task?')) {
      setTasks(prev => prev.filter(task => task.id !== taskId));
    }
  };

  // New task add karein - har task ke baad button
  const handleAddTask = (afterTaskId = null) => {
    if (isSubmitted) return; // Submit ke baad add nahi kar sakte

    const newTask = {
      id: Date.now(),
      title: '',
      description: '',
      startDate: assignedDate || new Date().toISOString().split('T')[0],
      endDate: '',
      workingHours: '',
      status: 'pending'
    };

    if (afterTaskId) {
      // Specific task ke baad add karein
      const taskIndex = tasks.findIndex(task => task.id === afterTaskId);
      if (taskIndex !== -1) {
        const newTasks = [...tasks];
        newTasks.splice(taskIndex + 1, 0, newTask);
        setTasks(newTasks);
      }
    } else {
      // Last mein add karein
      setTasks(prev => [...prev, newTask]);
    }
    
    setEditingTask(newTask);
  };

  // Edit modal band karein
  const handleCancelEdit = () => {
    setEditingTask(null);
  };

  // Calculate total working hours
  const totalWorkingHours = tasks.reduce((sum, task) => {
    const hours = parseInt(task.workingHours) || 0;
    return sum + hours;
  }, 0);

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <div className="text-xl text-gray-600 mt-4">Loading project details from Supabase...</div>
          <button
            onClick={handleBack}
            className="mt-4 bg-blue-500 text-white px-6 py-2 rounded-lg hover:bg-blue-600 transition-colors"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // Error state
  if (error && !project.id) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center bg-white p-8 rounded-lg shadow-lg">
          <div className="text-red-500 text-xl mb-4">Error Loading Project</div>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={handleBack}
            className="bg-blue-500 text-white px 6 py-2 rounded-lg hover:bg-blue-600 transition-colors"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // Agar project data nahi hai toh loading show karein
  if (!project.id) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-xl text-gray-600">Loading project details...</div>
          <button
            onClick={handleBack}
            className="mt-4 bg-blue-500 text-white px-6 py-2 rounded-lg hover:bg-blue-600 transition-colors"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // ✅ NEW: Get validation stats
  const validationStats = getValidationStats();

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4">
        {/* ✅ FIXED: Header with better navigation options */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <button
              onClick={handleBack}
              className="flex items-center text-gray-600 hover:text-gray-800 bg-white px-4 py-2 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-all"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Dashboard
            </button>
            
            <button
              onClick={handleBackToProjects}
              className="hidden md:flex items-center text-gray-600 hover:text-gray-800 bg-gray-100 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors border border-gray-300"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              All Projects
            </button>
            
            <h1 className="text-3xl font-bold text-gray-900 ml-4">Project Details</h1>
          </div>
          
          {/* Data Source Indicator */}
          {projectData && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-1">
              <p className="text-xs text-blue-700">
                <span className="font-semibold">✓ Live:</span> Supabase Data
              </p>
            </div>
          )}

          {/* Submitted Status */}
          {isSubmitted && (
            <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-2 rounded-lg">
              <div className="flex items-center">
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Work Submitted - Read Only Mode
              </div>
            </div>
          )}
        </div>

        {/* ✅ NEW: Validation Status Banner */}
        {!isSubmitted && tasks.length > 0 && (
          <div className={`mb-6 p-4 rounded-lg border ${
            validationStats.isAllValid 
              ? 'bg-green-50 border-green-200' 
              : 'bg-yellow-50 border-yellow-200'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center mr-3 ${
                  validationStats.isAllValid ? 'bg-green-100' : 'bg-yellow-100'
                }`}>
                  {validationStats.isAllValid ? (
                    <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.698-.833-2.464 0L4.288 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                  )}
                </div>
                <div>
                  <h3 className="font-semibold text-gray-800">
                    {validationStats.isAllValid ? 'Ready to Submit' : 'Validation Required'}
                  </h3>
                  <p className="text-sm text-gray-600">
                    {validationStats.isAllValid 
                      ? `All ${validationStats.totalTasks} tasks have valid dates` 
                      : `${validationStats.validTasks} of ${validationStats.totalTasks} tasks are valid`}
                  </p>
                </div>
              </div>
              
              {!validationStats.isAllValid && (
                <button
                  onClick={() => {
                    // Highlight invalid tasks
                    const invalidTasks = tasks.filter(task => !isTaskValid(task));
                    if (invalidTasks.length > 0) {
                      setEditingTask(invalidTasks[0]);
                    }
                  }}
                  className="text-sm bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded transition-colors"
                >
                  Fix Issues
                </button>
              )}
            </div>
          </div>
        )}

        {/* ✅ NEW: Validation Error Message */}
        {validationError && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 animate-pulse">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-red-500 mt-0.5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h4 className="font-semibold text-red-800 mb-1">{validationError}</h4>
                {validationStats.invalidTasks > 0 && (
                  <p className="text-sm text-red-600">
                    {validationStats.invalidTasks} task(s) have invalid dates. Please fix them before submitting.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Project Details */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-lg overflow-hidden">
              {/* Project Header */}
              <div className="bg-gradient-to-r from-blue-500 to-blue-600 p-6 text-white">
                <div className="flex justify-between items-start">
                  <div>
                    <h1 className="text-2xl font-bold mb-2">{project.name}</h1>
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                      project.status === 'active' ? 'bg-green-100 text-green-800' :
                      project.status === 'completed' ? 'bg-blue-100 text-blue-800' :
                      'bg-yellow-100 text-yellow-800'
                    }`}>
                      {project.status ? project.status.charAt(0).toUpperCase() + project.status.slice(1) : 'Unknown'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Project Content */}
              <div className="p-6">
                {/* Description Section */}
                <div className="mb-6">
                  <h2 className="text-lg font-semibold mb-3 text-gray-800">Project Description</h2>
                  <div className="bg-gray-50 rounded-lg p-4 border">
                    <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
                      {project.description || 'No description provided for this project.'}
                    </p>
                  </div>
                </div>

                {/* Project Timeline */}
                <div className="space-y-4 mb-6">
                  {/* ✅ ASSIGNED DATE - SUPABASE SE */}
                  <div className="bg-white border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-md font-semibold text-gray-800">Assigned Date</h3>
                      {projectData && (
                        <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full">Supabase</span>
                      )}
                    </div>
                    <div className="flex items-center text-gray-600">
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>{formatDate(assignedDate)}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {projectData 
                        ? "Directly from Supabase database" 
                        : "From URL parameters"}
                    </div>
                  </div>

                  {project.deadline && project.deadline !== 'null' && (
                    <div className="bg-white border rounded-lg p-4">
                      <h3 className="text-md font-semibold mb-2 text-gray-800">Deadline</h3>
                      <div className="flex items-center text-gray-600">
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>{formatDate(project.deadline)}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* ✅ FIXED: File Attachment with Download Button */}
               {project.file_url && project.file_url !== 'null' && (
  <div className="mb-6">
    <h2 className="text-lg font-semibold mb-3 text-gray-800">Project Files</h2>
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center shadow-sm">
            <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-blue-900">
              {project.file_name || 'Project Requirements Document'}
            </p>
            <p className="text-xs text-blue-700 mt-1">Click to download file</p>
          </div>
        </div>
        <button
          onClick={handleDownloadFile}
          disabled={downloading}
          className={`px-4 py-2 rounded-lg font-medium text-sm flex items-center ${
            downloading 
              ? 'bg-blue-400 cursor-not-allowed' 
              : 'bg-blue-600 hover:bg-blue-700 transition-colors'
          } text-white`}
        >
          {downloading ? (
            <>
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Downloading...
            </>
          ) : (
            <>
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download
            </>
          )}
        </button>
      </div>
    </div>
  </div>
)}

                {/* Developer Info if available from Supabase */}
            
                {/* Summary */}
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <h3 className="text-md font-semibold mb-2 text-yellow-800">Project Summary</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-yellow-700">Total Tasks:</span>
                      <span className="font-semibold text-yellow-800">{tasks.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-yellow-700">Total Working Hours:</span>
                      <span className="font-semibold text-yellow-800">{totalWorkingHours} hrs</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-yellow-700">Status:</span>
                      <span className={`font-semibold ${
                        isSubmitted ? 'text-green-600' : 'text-yellow-600'
                      }`}>
                        {isSubmitted ? 'Submitted' : 'In Progress'}
                      </span>
                    </div>
                    {/* ✅ NEW: Validation Status in Summary */}
                    {!isSubmitted && (
                      <div className="flex justify-between">
                        <span className="text-yellow-700">Task Validation:</span>
                        <span className={`font-semibold ${
                          validationStats.isAllValid ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {validationStats.validTasks}/{validationStats.totalTasks} valid
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Tasks List */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-lg overflow-hidden">
              <div className={`p-6 ${isSubmitted ? 'bg-gray-500' : 'bg-gradient-to-r from-green-500 to-green-600'} text-white`}>
                <h2 className="text-2xl font-bold">Project Tasks</h2>
                <p className="text-white mt-1 opacity-90">
                  {isSubmitted 
                    ? 'Work submitted - Tasks are now read only' 
                    : 'Manage all tasks and subtasks for this project'
                  }
                </p>
              </div>

              <div className="p-6">
                {/* Tasks List */}
                <div className="space-y-6">
                  {tasks.map((task, index) => (
                    <div key={task.id}>
                      <div className={`border rounded-lg p-4 transition-all ${
                        isSubmitted 
                          ? 'bg-gray-50 border-gray-300' 
                          : 'bg-white hover:shadow-md border-gray-200'
                      } ${
                        !isSubmitted && !isTaskValid(task) ? 'border-l-4 border-l-red-500' : ''
                      }`}>
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex items-start space-x-3">
                            {/* ✅ NEW: Validation Indicator */}
                            {!isSubmitted && (
                              <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-1 ${
                                isTaskValid(task) ? 'bg-green-100' : 'bg-red-100'
                              }`}>
                                {isTaskValid(task) ? (
                                  <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                ) : (
                                  <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                )}
                              </div>
                            )}
                            <div>
                              <h3 className={`text-lg font-semibold ${
                                isSubmitted ? 'text-gray-600' : 'text-gray-800'
                              }`}>
                                {task.title || 'Untitled Task'}
                              </h3>
                              <p className={`text-sm mt-1 ${
                                isSubmitted ? 'text-gray-500' : 'text-gray-600'
                              }`}>
                                {task.description || 'No description provided'}
                              </p>
                              {/* ✅ NEW: Validation error messages for invalid tasks */}
                              {!isSubmitted && !isTaskValid(task) && (
                                <div className="mt-2 text-xs text-red-600 bg-red-50 p-2 rounded">
                                  {!task.startDate || task.startDate.trim() === '' ? '• Start date is required' : ''}
                                  {!task.endDate || task.endDate.trim() === '' ? '• End date is required' : ''}
                                  {task.startDate && task.endDate && new Date(task.endDate) < new Date(task.startDate) ? '• End date cannot be before start date' : ''}
                                </div>
                              )}
                            </div>
                          </div>
                          
                          {/* Action Buttons - Only show if not submitted */}
                          {!isSubmitted && (
                            <div className="flex space-x-2">
                              <button
                                onClick={() => handleEditTask(task)}
                                className="bg-blue-500 text-white px-3 py-1 rounded text-sm hover:bg-blue-600 transition-colors"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleDeleteTask(task.id)}
                                className="bg-red-500 text-white px-3 py-1 rounded text-sm hover:bg-red-600 transition-colors"
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                          <div>
                            <label className={`font-medium ${
                              isSubmitted ? 'text-gray-500' : 'text-gray-700'
                            }`}>Start Date</label>
                            <p className={`flex items-center ${isSubmitted ? 'text-gray-400' : 'text-gray-600'}`}>
                              {!task.startDate || task.startDate.trim() === '' ? (
                                <span className="text-red-500 italic">Not set</span>
                              ) : (
                                <>
                                  <svg className={`w-4 h-4 mr-1 ${
                                    isTaskValid(task) ? 'text-green-500' : 'text-red-500'
                                  }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    {isTaskValid(task) ? (
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    ) : (
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    )}
                                  </svg>
                                  {formatDate(task.startDate)}
                                </>
                              )}
                            </p>
                          </div>
                          <div>
                            <label className={`font-medium ${
                              isSubmitted ? 'text-gray-500' : 'text-gray-700'
                            }`}>End Date</label>
                            <p className={`flex items-center ${isSubmitted ? 'text-gray-400' : 'text-gray-600'}`}>
                              {!task.endDate || task.endDate.trim() === '' ? (
                                <span className="text-red-500 italic">Not set</span>
                              ) : (
                                <>
                                  <svg className={`w-4 h-4 mr-1 ${
                                    isTaskValid(task) ? 'text-green-500' : 'text-red-500'
                                  }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    {isTaskValid(task) ? (
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    ) : (
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    )}
                                  </svg>
                                  {formatDate(task.endDate)}
                                </>
                              )}
                            </p>
                          </div>
                          <div>
                            <label className={`font-medium ${
                              isSubmitted ? 'text-gray-500' : 'text-gray-700'
                            }`}>Working Hours</label>
                            <p className={isSubmitted ? 'text-gray-400' : 'text-gray-600'}>
                              {task.workingHours || 0} hrs
                            </p>
                          </div>
                        </div>
                      </div>
                      
                      {/* Add Task Button after each task - Only show if not submitted */}
                      {!isSubmitted && (
                        <div className="flex justify-center mt-4">
                          <button
                            onClick={() => handleAddTask(task.id)}
                            className="bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition-colors font-medium flex items-center text-sm"
                          >
                            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            Add Task 
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {tasks.length === 0 && !isSubmitted && (
                  <div className="text-center py-8">
                    <button
                      onClick={() => handleAddTask()}
                      className="bg-green-500 text-white px-6 py-3 rounded-lg hover:bg-green-600 transition-colors font-medium flex items-center mx-auto"
                    >
                      <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Add First Task
                    </button>
                  </div>
                )}

                {tasks.length === 0 && isSubmitted && (
                  <div className="text-center py-8">
                    <p className="text-gray-500">No tasks were added for this project.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ✅ FIXED: Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 mt-6">
          <div className="flex flex-col sm:flex-row gap-4 flex-1">
            <button
              onClick={handleBack}
              className="flex-1 bg-gray-500 text-white py-3 px-6 rounded-lg hover:bg-gray-600 transition-colors font-medium flex items-center justify-center"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              Go to Dashboard
            </button>
            
            <button
              onClick={handleBackToProjects}
              className="flex-1 bg-blue-500 text-white py-3 px-6 rounded-lg hover:bg-blue-600 transition-colors font-medium flex items-center justify-center"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              All Projects
            </button>
          </div>
          
          {/* Submit Work Button - Only show if not submitted */}
          {!isSubmitted && (
            <button
              onClick={handleSubmitWork}
              disabled={!validationStats.isAllValid || tasks.length === 0}
              className={`flex-1 py-3 px-6 rounded-lg font-medium flex items-center justify-center ${
                validationStats.isAllValid && tasks.length > 0
                  ? 'bg-green-500 hover:bg-green-600 text-white transition-colors cursor-pointer'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {validationStats.isAllValid ? 'Submit Work' : 'Fix Tasks First'}
            </button>
          )}

          {/* View Gantt Chart Button - Only after Submit Work */}
          {isSubmitted && (
            <button
              onClick={() => router.push(`/developer/gantt-chart?projectId=${project.id}`)}
              className="flex-1 bg-purple-500 text-white py-3 px-6 rounded-lg hover:bg-purple-600 transition-colors font-medium flex items-center justify-center"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              View Gantt Chart
            </button>
          )}
        </div>

        {/* Submit Success Message */}
        {showSubmitSuccess && (
          <div className="fixed top-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg animate-bounce">
            <div className="flex items-center">
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Work submitted successfully! You can now view Gantt Chart.
            </div>
          </div>
        )}

        {/* ✅ NEW: Validation Success Message */}
        {validationSuccess && (
          <div className="fixed top-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg">
            <div className="flex items-center">
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {validationSuccess}
            </div>
          </div>
        )}
      </div>

      {/* Edit Task Modal - Only show if not submitted */}
      {editingTask && !isSubmitted && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4">
              {editingTask.title ? 'Edit Task' : 'Add New Task'}
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Task Title *</label>
                <input
                  type="text"
                  value={editingTask.title}
                  onChange={(e) => setEditingTask({...editingTask, title: e.target.value})}
                  placeholder="Enter task title"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={editingTask.description}
                  onChange={(e) => setEditingTask({...editingTask, description: e.target.value})}
                  placeholder="Enter task description"
                  rows="3"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Date *</label>
                  <input
                    type="date"
                    value={editingTask.startDate}
                    onChange={(e) => setEditingTask({...editingTask, startDate: e.target.value})}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                  {!editingTask.startDate && (
                    <p className="text-xs text-red-500 mt-1">Start date is required</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Date *</label>
                  <input
                    type="date"
                    value={editingTask.endDate}
                    onChange={(e) => setEditingTask({...editingTask, endDate: e.target.value})}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                  {!editingTask.endDate && (
                    <p className="text-xs text-red-500 mt-1">End date is required</p>
                  )}
                </div>
              </div>

              {/* ✅ NEW: Date Validation Check */}
              {editingTask.startDate && editingTask.endDate && 
               new Date(editingTask.endDate) < new Date(editingTask.startDate) && (
                <div className="bg-red-50 border border-red-200 rounded p-3">
                  <p className="text-sm text-red-600 flex items-center">
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    End date cannot be before start date
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Working Hours</label>
                <input
                  type="number"
                  value={editingTask.workingHours}
                  onChange={(e) => setEditingTask({...editingTask, workingHours: e.target.value})}
                  placeholder="Enter working hours"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="flex space-x-3 mt-6">
              <button
                onClick={handleCancelEdit}
                className="flex-1 bg-gray-500 text-white py-2 px-4 rounded-lg hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateTask}
                className="flex-1 bg-blue-500 text-white py-2 px-4 rounded-lg hover:bg-blue-600 transition-colors"
                disabled={!editingTask.title || !editingTask.startDate || !editingTask.endDate}
              >
                {editingTask.title ? 'Update Task' : 'Add Task'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}