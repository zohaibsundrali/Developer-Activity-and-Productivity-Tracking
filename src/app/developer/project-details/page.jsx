"use client";
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import { supabase } from '@/utils/supabaseClient';
import TaskCompletionModal from "@/components/developer/TaskCompletionModal";

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
  const [showGanttChart, setShowGanttChart] = useState(false);
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [completionTask, setCompletionTask] = useState(null);

  // Get project data from URL parameters (fallback)
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

  const project = projectData || getProjectDataFromURL();

  // Get assigned date
  const getAssignedDate = () => {
    if (project.assigned_at && project.assigned_at !== 'null' && project.assigned_at !== 'undefined') {
      return project.assigned_at;
    }
    if (project.assigned_date && project.assigned_date !== 'null' && project.assigned_date !== 'undefined') {
      return project.assigned_date;
    }
    return project.created_at;
  };

  const assignedDate = getAssignedDate();

  const taskPlanStatus = project?.task_plan_status || (isSubmitted ? "pending" : null);
  const isPlanApproved = taskPlanStatus === "approved";
  const isPlanPending = taskPlanStatus === "pending";
  const isPlanRejected = taskPlanStatus === "rejected";
  const canEditTasks = !isSubmitted || isPlanRejected;

  const addDays = (startDate, days) => {
    if (!startDate || !days) return "";
    const date = new Date(startDate);
    if (isNaN(date.getTime())) return "";
    const safeDays = Math.max(0, Number(days) - 1);
    date.setDate(date.getDate() + safeDays);
    return date.toISOString().split("T")[0];
  };

  const getNoOfDays = (startDate, endDate) => {
    if (!startDate || !endDate) return 0;
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
    const diffTime = Math.abs(end - start);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  };

  const parseTemplate = (template) => {
    if (!template) return [];
    if (Array.isArray(template)) return template;
    if (typeof template === "string") {
      try {
        const parsed = JSON.parse(template);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  const buildTasksFromTemplate = (template, assignedDateStr) => {
    const items = parseTemplate(template);
    if (!items.length) return [];
    return items.map((item, index) => {
      const noOfDays = Number(item.noOfDays || item.no_of_days || item.days || 1);
      const startDate = assignedDateStr;
      const endDate = addDays(startDate, noOfDays);
      return {
        id: Date.now() + index,
        title: item.title || "Untitled Task",
        description: item.description || "",
        startDate,
        endDate,
        noOfDays,
        status: item.status || "pending",
      };
    });
  };
  
  // Validation messages state
  const [validationError, setValidationError] = useState('');
  const [validationSuccess, setValidationSuccess] = useState('');
  
  // Current logged-in developer state
  const [currentDeveloper, setCurrentDeveloper] = useState(null);
  const [developerLoading, setDeveloperLoading] = useState(true);

  // Navigation functions
  const handleBack = () => {
    router.push('/developer/dashboard');
  };

  const handleBackToProjects = () => {
    router.push('/developer/dashboard?section=projects');
  };

  // Get current logged-in developer from localStorage and Supabase
  useEffect(() => {
    const getCurrentDeveloper = async () => {
      try {
        setDeveloperLoading(true);
        
        // First, check localStorage for user session
        const storedUser = localStorage.getItem("developerUser");
        
        if (storedUser) {
          try {
            const userData = JSON.parse(storedUser);
            
            // Set from localStorage immediately for better UX
            setCurrentDeveloper({
              id: userData.user?.id || userData.id,
              name: userData.user?.user_metadata?.full_name || userData.user?.email?.split('@')[0] || 'Developer',
              email: userData.user?.email || userData.email,
              user_id: userData.user?.id || userData.id
            });
          } catch (localStorageError) {
            // Silently handle error
          }
        }
        
        // Then verify with Supabase
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        
        if (userError) {
          // Don't return, try to continue with localStorage data
        }
        
        if (user) {
          
          // Get developer profile from developers table
          const { data: developer, error: devError } = await supabase
            .from('developers')
            .select('*')
            .eq('user_id', user.id)
            .single();
          
          if (devError) {
            // Use user data if developer not found in database
            const developerData = {
              id: user.id,
              name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Developer',
              email: user.email,
              user_id: user.id
            };
            setCurrentDeveloper(developerData);
          } else if (developer) {
            setCurrentDeveloper(developer);
          }
          
          // Update localStorage with fresh data
          localStorage.setItem("developerUser", JSON.stringify({
            user: user,
            timestamp: new Date().toISOString()
          }));
        } else {
          // If no user found and no localStorage, redirect to login
          if (!storedUser) {
            router.push('/developer/login');
          }
        }
      } catch (err) {
        // Silently handle error
      } finally {
        setDeveloperLoading(false);
      }
    };
    
    getCurrentDeveloper();
  }, [router]);

  // Validate all tasks before submission
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
      
      // Check if task title is empty
      if (!task.title || task.title.trim() === '') {
        invalidTasks.push(`Task ${taskNumber}: Task title is required`);
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

  // Save tasks to Supabase - SIMPLIFIED VERSION
  const saveTasksToSupabase = async () => {
    try {
      
      // Step 1: Get developer info
      let developerToUse = currentDeveloper;
      
      // If developer not in state, try localStorage
      if (!developerToUse || !developerToUse.id) {
        const storedUser = localStorage.getItem("developerUser");
        if (storedUser) {
          try {
            const userData = JSON.parse(storedUser);
            const userId = userData.user?.id || userData.id;
            
            if (userId) {
              developerToUse = {
                id: userId,
                name: userData.user?.user_metadata?.full_name || 
                      userData.user?.email?.split('@')[0] || 
                      'Developer',
                email: userData.user?.email || userData.email || 'unknown@example.com',
                user_id: userId
              };
            }
          } catch (e) {
            // Silently handle error
          }
        }
      }
      
      // If still no developer, try Supabase auth directly
      if (!developerToUse || !developerToUse.id) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          developerToUse = {
            id: user.id,
            name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Developer',
            email: user.email,
            user_id: user.id
          };
        }
      }
      
      // Final check for developer
      if (!developerToUse || !developerToUse.id) {
        throw new Error('Please log in to submit work.');
      }
      
      // Step 2: Check project
      if (!project || !project.id) {
        throw new Error('Project information not available.');
      }
      
      // Step 3: Prepare tasks for Supabase
      const tasksToSave = tasks.map((task, index) => {
        // Validate required fields
        if (!task.title || task.title.trim() === '') {
          throw new Error(`Task ${index + 1} title is required`);
        }
        if (!task.startDate || task.startDate.trim() === '') {
          throw new Error(`Task ${index + 1} start date is required`);
        }
        if (!task.endDate || task.endDate.trim() === '') {
          throw new Error(`Task ${index + 1} end date is required`);
        }
        
        // Validate dates
        const startDate = new Date(task.startDate);
        const endDate = new Date(task.endDate);
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          throw new Error(`Task ${index + 1} has invalid dates`);
        }
        if (endDate < startDate) {
          throw new Error(`Task ${index + 1}: End date cannot be before start date`);
        }
        
        return {
          project_id: project.id,
          developer_id: developerToUse.id,
          task_title: task.title,
          task_description: task.description || '',
          task_order: index,
          start_date: task.startDate,
          end_date: task.endDate,
          status: 'pending',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
      });
      
      // Step 4: Delete existing tasks for this project/developer
      const { error: deleteError } = await supabase
        .from('developer_tasks')
        .delete()
        .eq('project_id', project.id)
        .eq('developer_id', developerToUse.id);
      
      if (deleteError) {
        // Continue anyway - might be first submission
      }
      
      // Step 5: Insert new tasks
      const { data, error } = await supabase
        .from('developer_tasks')
        .insert(tasksToSave)
        .select();
      
      if (error) {
        throw new Error(`Failed to save tasks: ${error.message}`);
      }
      
      return data;
      
    } catch (error) {
      throw error;
    }
  };

  // Handle submit work with Supabase integration - SIMPLIFIED VERSION
  const handleSubmitWork = async () => {
    try {
      
      // Step 1: Validate all tasks
      const validation = validateAllTasks();
      
      if (!validation.isValid) {
        setValidationError(validation.message);
        setTimeout(() => setValidationError(''), 5000);
        return;
      }
      
      // Step 2: Confirm submission
      const developerName = currentDeveloper?.name || 'You';
      const confirmMessage = `Are you sure you want to submit these tasks?\n\n` +
        `Developer: ${developerName}\n` +
        `Project: ${project.name}\n` +
        `Total Tasks: ${tasks.length}\n\n` +
        `This action cannot be undone.`;
      
      if (!confirm(confirmMessage)) {
        return;
      }
      
      // Step 3: Save to Supabase
      const savedTasks = await saveTasksToSupabase();

      // Step 3b: Update project task plan status
      const { error: planStatusError } = await supabase
        .from('projects')
        .update({
          task_plan_status: 'pending',
          task_plan_submitted_at: new Date().toISOString(),
          task_plan_reviewed_at: null,
          task_plan_reviewed_by: null,
          task_plan_rejection_reason: null
        })
        .eq('id', project.id);

      if (planStatusError) {
        throw new Error(`Failed to submit task plan: ${planStatusError.message}`);
      }
      
      // Step 4: Update local tasks with real Supabase UUIDs so workflow buttons work
      if (savedTasks && savedTasks.length > 0) {
        const updatedTasks = savedTasks.map(t => ({
          id: t.id,
          title: t.task_title,
          description: t.task_description,
          startDate: t.start_date,
          endDate: t.end_date,
          status: t.status || 'pending',
          supabaseId: t.id
        }));
        setTasks(updatedTasks);
      }

      // Step 5: Update local state
      setShowSubmitSuccess(true);
      setIsSubmitted(true);
      setProjectData(prev => ({
        ...(prev || project),
        task_plan_status: 'pending',
        task_plan_submitted_at: new Date().toISOString(),
        task_plan_reviewed_at: null,
        task_plan_reviewed_by: null,
        task_plan_rejection_reason: null
      }));
      
      // Update localStorage
      localStorage.setItem(`project_submitted_${project.id}`, 'true');
      localStorage.setItem(`project_tasks_${project.id}`, JSON.stringify(tasks));
      
      // Step 5: Show success message
      setValidationSuccess('Tasks submitted successfully! Admin can now view your work.');
      
      // Step 6: Send notification to admin (optional)
      try {
        if (currentDeveloper?.id && project.id) {
          const { data: projectData } = await supabase
            .from('projects')
            .select('assigned_to, assigned_to_email')
            .eq('id', project.id)
            .single();
          
          if (projectData) {
            await supabase
              .from('notifications')
              .insert({
                assigned_developer_id: currentDeveloper.id,
                developer_id: currentDeveloper.id,
                admin_id: projectData.assigned_to,
                admin_email: projectData.assigned_to_email,
                message: `Tasks Submitted: ${currentDeveloper.name} submitted ${tasks.length} tasks for "${project.name}".`,
                type: 'task_submitted',
                read: false,
                created_at: new Date().toISOString()
              });
          }
        }
      } catch (notifError) {
        // Silently handle error
      }
      
      // Auto-hide messages
      setTimeout(() => {
        setShowSubmitSuccess(false);
        setValidationSuccess('');
      }, 5000);
      
    } catch (error) {
      
      // Better error message
      let errorMessage = `Error submitting tasks: ${error.message}`;
      
      if (error.message.includes('Please log in')) {
        errorMessage = 'Please log in to submit work.';
        router.push('/developer/login');
      } else if (error.message.includes('Project information')) {
        errorMessage = 'Project information is missing. Please refresh the page.';
      } else if (error.message.includes('network') || error.message.includes('fetch')) {
        errorMessage = 'Network error. Check your internet connection.';
      }
      
      alert(errorMessage);
    }
  };

  // ===== SEQUENTIAL TASK WORKFLOW HELPERS =====

  // Can start task only if it's the first, or the previous task is approved/completed
  const canStartTask = (taskIndex) => {
    if (taskIndex === 0) return true;
    const prev = tasks[taskIndex - 1];
    return prev?.status === 'completed';
  };

  // Returns index of the currently in-progress task, or -1
  const getInProgressTaskIndex = () => tasks.findIndex(t => t.status === 'in_progress');

  // Start a task: pending → in_progress
  const handleStartTask = async (taskId, taskIndex) => {
    if (!isPlanApproved) {
      alert('Task plan is awaiting admin approval.');
      return;
    }
    if (!canStartTask(taskIndex)) {
      alert('Please complete the previous task first.');
      return;
    }
    if (getInProgressTaskIndex() !== -1) {
      alert('A task is already in progress. Complete it before starting a new one.');
      return;
    }
    try {
      const { error } = await supabase
        .from('developer_tasks')
        .update({ status: 'in_progress', updated_at: new Date().toISOString() })
        .eq('id', taskId);
      if (error) throw error;
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'in_progress' } : t));
    } catch (err) {
      alert('Failed to start task: ' + err.message);
    }
  };

  // Open the Task Completion Modal
  const handleOpenCompletionModal = (task) => {
    setCompletionTask(task);
    setShowCompletionModal(true);
  };

  // Called by TaskCompletionModal when submission succeeds
  const handleTaskUpdated = (updatedTask) => {
    setTasks(prev => prev.map(t =>
      t.id === updatedTask.id ? { ...t, status: updatedTask.status || 'awaiting_approval' } : t
    ));
    setShowCompletionModal(false);
    setCompletionTask(null);
  };

  // Load tasks from Supabase if already submitted
  const loadTasksFromSupabase = async () => {
    try {
      if (!currentDeveloper || !project || !project.id) return;
      
      const { data, error } = await supabase
        .from('developer_tasks')
        .select('*')
        .eq('project_id', project.id)
        .eq('developer_id', currentDeveloper.id)
        .order('task_order', { ascending: true });
      
      if (error) {
        return;
      }
      
      if (data && data.length > 0) {
        // Convert Supabase tasks to local format
        const formattedTasks = data.map(task => ({
          id: task.id,
          title: task.task_title,
          description: task.task_description,
          startDate: task.start_date,
          endDate: task.end_date,
          noOfDays: getNoOfDays(task.start_date, task.end_date),
          status: task.status || 'pending',
          rejection_reason: task.rejection_reason,
          admin_comments: task.admin_comments,
          actual_completion_date: task.actual_completion_date,
          is_on_time: task.is_on_time,
          productivity_points: task.productivity_points,
          supabaseId: task.id
        }));
        
        setTasks(formattedTasks);
        setIsSubmitted(true);
        localStorage.setItem(`project_submitted_${project.id}`, 'true');
        localStorage.setItem(`project_tasks_${project.id}`, JSON.stringify(formattedTasks));
      }
    } catch (error) {
      // Silently handle error
    }
  };

  // Check if task is valid
  const isTaskValid = (task) => {
    if (!task.title || task.title.trim() === '') return false;
    if (!task.startDate || task.startDate.trim() === '') return false;
    if (!task.endDate || task.endDate.trim() === '') return false;
    
    const startDate = new Date(task.startDate);
    const endDate = new Date(task.endDate);
    
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return false;
    if (endDate < startDate) return false;
    
    return true;
  };

  // Calculate validation statistics
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

  // Calculate task duration
  const calculateDuration = (startDate, endDate) => {
    if (!startDate || !endDate) return 'N/A';
    
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return 'Invalid date';
    
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    
    return `${diffDays} day${diffDays !== 1 ? 's' : ''}`;
  };

  // Fetch project from Supabase
  useEffect(() => {
    const fetchProjectFromSupabase = async () => {
      try {
        setLoading(true);
        const projectId = searchParams.get('id');
        
        if (!projectId || projectId === 'null') {
          const urlProject = getProjectDataFromURL();
          setProjectData(urlProject);
          return;
        }

        const { data, error } = await supabase
          .from('projects')
          .select('*')
          .eq('id', projectId)
          .single();

        if (error) {
          throw error;
        }

        if (data) {
          setProjectData(data);
        } else {
          setProjectData(getProjectDataFromURL());
        }
      } catch (err) {
        setError(err.message);
        setProjectData(getProjectDataFromURL());
      } finally {
        setLoading(false);
      }
    };

    fetchProjectFromSupabase();
  }, [searchParams]);

  // Load tasks when project and developer are available
  useEffect(() => {
    if (project.id && currentDeveloper && !developerLoading) {
      loadTasksFromSupabase();
    }
  }, [project, currentDeveloper, developerLoading]);

  // File Download Function
  const handleDownloadFile = async () => {
    if (!project.file_url || project.file_url === 'null') {
      alert('No file available for download');
      return;
    }

    try {
      setDownloading(true);
      
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
      
      const fileName = project.file_name || 
                      project.file_url.split('/').pop() || 
                      'project_file';
      
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      
      window.URL.revokeObjectURL(url);
      document.body.removeChild(link);
      
    } catch (error) {
      
      try {
        const link = document.createElement('a');
        link.href = project.file_url;
        link.download = project.file_name || 'project_file';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (fallbackError) {
        
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
  }, [project]);

  // Initial tasks load
  useEffect(() => {
    const savedTasks = localStorage.getItem(`project_tasks_${project.id}`);
    if (savedTasks && !isSubmitted) {
      setTasks(JSON.parse(savedTasks));
    } else if (!isSubmitted) {
      // Default tasks with assigned date as start date
      const assignedDateStr = getAssignedDate() || new Date().toISOString().split('T')[0];
      const templateTasks = buildTasksFromTemplate(project?.ai_task_template, assignedDateStr);
      if (templateTasks.length > 0) {
        setTasks(templateTasks);
        return;
      }
      const defaultTasks = [
        {
          id: 1,
          title: 'Functional Requirements Understanding',
          description: 'Understand and analyze project requirements',
          startDate: assignedDateStr,
          endDate: addDays(assignedDateStr, 1),
          noOfDays: 1,
          status: 'pending'
        },
        {
          id: 2,
          title: 'Website Design',
          description: 'Create UI/UX design and wireframes',
          startDate: assignedDateStr,
          endDate: addDays(assignedDateStr, 1),
          noOfDays: 1,
          status: 'pending'
        },
        {
          id: 3,
          title: 'Frontend Development',
          description: 'Develop frontend components and pages',
          startDate: assignedDateStr,
          endDate: addDays(assignedDateStr, 1),
          noOfDays: 1,
          status: 'pending'
        },
        {
          id: 4,
          title: 'Backend Development',
          description: 'Develop backend APIs and server logic',
          startDate: assignedDateStr,
          endDate: addDays(assignedDateStr, 1),
          noOfDays: 1,
          status: 'pending'
        }
      ];
      setTasks(defaultTasks);
    }
  }, [project, isSubmitted]);

  // Save tasks to localStorage
  useEffect(() => {
    if (tasks.length > 0 && canEditTasks) {
      localStorage.setItem(`project_tasks_${project.id}`, JSON.stringify(tasks));
    }
  }, [tasks, project, canEditTasks]);

  const formatDate = (dateString) => {
    if (!dateString || dateString === 'null') return 'Not set';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Task edit functions
  const handleEditTask = (task) => {
    if (!canEditTasks) return;
    setEditingTask({ ...task });
  };

  const handleEditFieldChange = (field, value) => {
    setEditingTask((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [field]: value };

      if (field === "noOfDays") {
        const days = Number(value);
        if (next.startDate && days > 0) {
          next.endDate = addDays(next.startDate, days);
        }
      }

      if (field === "startDate") {
        if (next.noOfDays && Number(next.noOfDays) > 0) {
          next.endDate = addDays(value, Number(next.noOfDays));
        } else if (next.endDate) {
          next.noOfDays = getNoOfDays(value, next.endDate);
        }
      }

      if (field === "endDate") {
        next.noOfDays = getNoOfDays(next.startDate, value);
      }

      return next;
    });
  };

  const normalizeTitle = (title) => {
    if (!title) return "";
    return title
      .replace(/_/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim();
  };

  const formatTaskTitle = (title) => normalizeTitle(title);

  const handleUpdateTask = async () => {
    if (!editingTask || !canEditTasks) return;

    const updatedTask = {
      ...editingTask,
      title: normalizeTitle(editingTask.title)
    };

    setTasks(prev => prev.map(task =>
      task.id === updatedTask.id ? updatedTask : task
    ));

    if (updatedTask.supabaseId || (isSubmitted && updatedTask.id)) {
      try {
        const taskId = updatedTask.supabaseId || updatedTask.id;
        const { error } = await supabase
          .from("developer_tasks")
          .update({
            task_title: updatedTask.title,
            task_description: updatedTask.description || "",
            start_date: updatedTask.startDate,
            end_date: updatedTask.endDate,
            updated_at: new Date().toISOString()
          })
          .eq("id", taskId);

        if (error) throw error;
      } catch (err) {
        alert("Failed to update task: " + err.message);
      }
    }

    setEditingTask(null);
  };

  const handleDeleteTask = (taskId) => {
    if (!canEditTasks) return;
    
    if (confirm('Are you sure you want to delete this task?')) {
      setTasks(prev => prev.filter(task => task.id !== taskId));
    }
  };

  const handleAddTask = (afterTaskId = null) => {
    if (!canEditTasks) return;

    const newTask = {
      id: Date.now(),
      title: '',
      description: '',
      startDate: assignedDate || new Date().toISOString().split('T')[0],
      endDate: addDays(assignedDate || new Date().toISOString().split('T')[0], 1),
      noOfDays: 1,
      status: 'pending'
    };

    if (afterTaskId) {
      const taskIndex = tasks.findIndex(task => task.id === afterTaskId);
      if (taskIndex !== -1) {
        const newTasks = [...tasks];
        newTasks.splice(taskIndex + 1, 0, newTask);
        setTasks(newTasks);
      }
    } else {
      setTasks(prev => [...prev, newTask]);
    }
    
    setEditingTask(newTask);
  };

  const handleCancelEdit = () => {
    setEditingTask(null);
  };

  // Calculate task summary
  const getTaskSummary = () => {
    const total = tasks.length;
    const completed = tasks.filter(t => t.status === 'completed').length;
    const inProgress = tasks.filter(t => t.status === 'in_progress').length;
    const pending = tasks.filter(t => t.status === 'pending').length;
    const awaitingReview = tasks.filter(t => t.status === 'awaiting_approval').length;
    const rejected = tasks.filter(t => t.status === 'rejected').length;
    return { total, completed, inProgress, pending, awaitingReview, rejected };
  };

  const taskSummary = getTaskSummary();
  const validationStats = getValidationStats();

  // Simple Gantt Chart Component
  const GanttChart = () => {
    if (!tasks.length) return null;
    
    // Find min and max dates
    const dates = tasks.filter(t => t.startDate && t.endDate).flatMap(t => [
      new Date(t.startDate),
      new Date(t.endDate)
    ]);
    
    if (dates.length === 0) return null;
    
    const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
    const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));
    
    const totalDays = Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24)) + 1;
    
    return (
      <div className="mt-6 bg-white rounded-lg shadow border p-6">
        <h3 className="text-xl font-bold mb-4 text-gray-800">Gantt Chart</h3>
        <div className="overflow-x-auto">
          <div className="min-w-full">
            <div className="flex items-center mb-2">
              <div className="w-32 text-sm font-medium text-gray-600">Task</div>
              <div className="flex-1 relative h-8">
                <div className="absolute inset-0 flex items-center">
                  {Array.from({ length: totalDays }).map((_, i) => {
                    const date = new Date(minDate);
                    date.setDate(minDate.getDate() + i);
                    return (
                      <div key={i} className="flex-1 border-l border-gray-200 h-4 text-xs text-gray-400 text-center">
                        {i === 0 || i === totalDays - 1 || date.getDate() === 1 ? 
                          date.getDate() : ''}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            
            {tasks.map((task, index) => {
              if (!task.startDate || !task.endDate) return null;
              
              const start = new Date(task.startDate);
              const end = new Date(task.endDate);
              const startDay = Math.max(0, Math.ceil((start - minDate) / (1000 * 60 * 60 * 24)));
              const duration = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1);
              
              const barColor = task.status === 'completed' ? 'bg-green-500' :
                              task.status === 'in_progress' ? 'bg-yellow-500' :
                              task.status === 'awaiting_approval' ? 'bg-orange-400' :
                              task.status === 'rejected' ? 'bg-red-500' :
                              'bg-blue-400';
              
              return (
                <div key={task.id} className="flex items-center mb-3">
                  <div className="w-32 text-sm font-medium text-gray-700 truncate">
                    {task.title}
                  </div>
                  <div className="flex-1 relative h-6 bg-gray-100 rounded">
                    <div 
                      className={`absolute h-4 rounded ${barColor} top-1`}
                      style={{
                        left: `${(startDay / totalDays) * 100}%`,
                        width: `${(duration / totalDays) * 100}%`,
                        minWidth: '10px'
                      }}
                      title={`${task.title}: ${formatDate(task.startDate)} to ${formatDate(task.endDate)}`}
                    >
                      <div className="text-xs text-white px-1 truncate">
                        {duration}d
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-4 flex items-center flex-wrap gap-4 text-sm">
          <div className="flex items-center"><div className="w-3 h-3 bg-blue-400 rounded mr-2"></div><span className="text-gray-600">Pending</span></div>
          <div className="flex items-center"><div className="w-3 h-3 bg-yellow-500 rounded mr-2"></div><span className="text-gray-600">In Progress</span></div>
          <div className="flex items-center"><div className="w-3 h-3 bg-orange-400 rounded mr-2"></div><span className="text-gray-600">Awaiting Review</span></div>
          <div className="flex items-center"><div className="w-3 h-3 bg-green-500 rounded mr-2"></div><span className="text-gray-600">Completed</span></div>
          <div className="flex items-center"><div className="w-3 h-3 bg-red-500 rounded mr-2"></div><span className="text-gray-600">Rejected</span></div>
        </div>
      </div>
    );
  };

  // Loading state
  if (loading || developerLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <div className="text-xl text-gray-600 mt-4">Loading project details...</div>
          <button
            onClick={handleBack}
            className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // Error state
  if (error && (!project || !project.id)) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center bg-white p-8 rounded-lg shadow">
          <div className="text-red-500 text-xl mb-4">Error Loading Project</div>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={handleBack}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // If project data doesn't exist
  if (!project || !project.id) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-xl text-gray-600">Loading project details...</div>
          <button
            onClick={handleBack}
            className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4">
        {/* Header with navigation */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <button
              onClick={handleBack}
              className="flex items-center text-gray-700 hover:text-blue-700 bg-white px-4 py-2 rounded-lg shadow border hover:shadow-md"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Dashboard
            </button>
            
            <button
              onClick={handleBackToProjects}
              className="hidden md:flex items-center text-gray-700 hover:text-blue-700 bg-white px-4 py-2 rounded-lg shadow border hover:shadow-md"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              All Projects
            </button>
            
            <h1 className="text-3xl font-bold text-gray-900 ml-4">Project Details</h1>
          </div>
          
          {/* Developer Info */}
          {currentDeveloper && (
            <div className="hidden md:block bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
              <p className="text-sm font-medium text-blue-800">{currentDeveloper.name}</p>
              <p className="text-xs text-blue-600">{currentDeveloper.email}</p>
            </div>
          )}
          
          {/* Submitted Status */}
          {isSubmitted && !isPlanRejected && (
            <div className="bg-green-100 border border-green-400 text-green-800 px-4 py-2 rounded-lg">
              <div className="flex items-center">
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {isPlanApproved ? 'Task Plan Approved' : 'Task Plan Submitted'}
              </div>
            </div>
          )}
          {isPlanRejected && (
            <div className="bg-red-100 border border-red-400 text-red-800 px-4 py-2 rounded-lg">
              <div className="flex items-center">
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Task Plan Rejected - Edit and Resubmit
              </div>
            </div>
          )}
        </div>

        {isPlanPending && (
          <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-yellow-500 mt-0.5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h4 className="font-semibold text-yellow-800 mb-1">Task plan awaiting admin approval</h4>
                <p className="text-sm text-yellow-700">You can edit tasks until approval.</p>
              </div>
            </div>
          </div>
        )}

        {isPlanRejected && project?.task_plan_rejection_reason && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-red-500 mt-0.5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h4 className="font-semibold text-red-800 mb-1">Admin rejected the task plan</h4>
                <p className="text-sm text-red-700">Reason: {project.task_plan_rejection_reason}</p>
              </div>
            </div>
          </div>
        )}

        {/* Task Summary Banner */}
        <div className="mb-6 bg-white rounded-lg shadow border p-4">
          <div className="flex flex-wrap items-center justify-between">
            <div className="flex items-center flex-wrap gap-6">
              <div className="text-center"><div className="text-2xl font-bold text-gray-800">{taskSummary.total}</div><div className="text-sm text-gray-500">Total</div></div>
              <div className="text-center"><div className="text-2xl font-bold text-gray-500">{taskSummary.pending}</div><div className="text-sm text-gray-500">Pending</div></div>
              <div className="text-center"><div className="text-2xl font-bold text-blue-600">{taskSummary.inProgress}</div><div className="text-sm text-gray-500">In Progress</div></div>
              <div className="text-center"><div className="text-2xl font-bold text-yellow-600">{taskSummary.awaitingReview}</div><div className="text-sm text-gray-500">Awaiting Review</div></div>
              <div className="text-center"><div className="text-2xl font-bold text-green-600">{taskSummary.completed}</div><div className="text-sm text-gray-500">Completed</div></div>
              {taskSummary.rejected > 0 && <div className="text-center"><div className="text-2xl font-bold text-red-600">{taskSummary.rejected}</div><div className="text-sm text-gray-500">Rejected</div></div>}
            </div>
            
            {/* Duration Summary */}
            <div className="mt-4 md:mt-0">
              <div className="text-right">
                <div className="text-lg font-bold text-gray-800">
                  {tasks.filter(t => t.startDate && t.endDate).length} tasks with dates
                </div>
                <div className="text-sm text-gray-500">Tasks scheduled</div>
              </div>
            </div>
          </div>
        </div>

        {/* Validation Error Message */}
        {validationError && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-red-500 mt-0.5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h4 className="font-semibold text-red-800 mb-1">{validationError}</h4>
                {validationStats.invalidTasks > 0 && (
                  <p className="text-sm text-red-600">
                    {validationStats.invalidTasks} task(s) need attention before submission.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Project Details */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow overflow-hidden border">
              <div className="bg-blue-600 p-6 text-white">
                <div className="flex justify-between items-start">
                  <div>
                    <h1 className="text-2xl font-bold mb-2">{project.name}</h1>
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                      project.status === 'active' ? 'bg-green-100 text-green-800' :
                      project.status === 'completed' ? 'bg-blue-100 text-blue-800' :
                      'bg-amber-100 text-amber-800'
                    }`}>
                      {project.status ? project.status.charAt(0).toUpperCase() + project.status.slice(1) : 'Unknown'}
                    </span>
                  </div>
                </div>
              </div>

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
                  <div className="bg-white border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-md font-semibold text-gray-800">Assigned Date</h3>
                    </div>
                    <div className="flex items-center text-gray-600">
                      <svg className="w-4 h-4 mr-2 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>{formatDate(assignedDate)}</span>
                    </div>
                  </div>

                  {project.deadline && project.deadline !== 'null' && (
                    <div className="bg-white border rounded-lg p-4">
                      <h3 className="text-md font-semibold mb-2 text-gray-800">Deadline</h3>
                      <div className="flex items-center text-gray-600">
                        <svg className="w-4 h-4 mr-2 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>{formatDate(project.deadline)}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* File Attachment */}
                {project.file_url && project.file_url !== 'null' && (
                  <div className="mb-6">
                    <h2 className="text-lg font-semibold mb-3 text-gray-800">Project Files</h2>
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center shadow border border-blue-200">
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
                              : 'bg-blue-600 hover:bg-blue-700 text-white'
                          }`}
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
              </div>
            </div>
          </div>

          {/* Right Column - Tasks List */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow overflow-hidden border">
              <div className={`p-6 ${isSubmitted ? 'bg-gray-600' : 'bg-green-600'} text-white`}>
                <h2 className="text-2xl font-bold">Project Tasks</h2>
                <p className="text-white mt-1 opacity-90">
                  {isPlanApproved && 'Task plan approved — work through tasks one by one sequentially'}
                  {isPlanPending && 'Task plan submitted — waiting for admin approval'}
                  {isPlanRejected && 'Task plan rejected — edit and resubmit'}
                  {!isSubmitted && 'Set task names, start dates, and deadlines'}
                </p>
                {currentDeveloper && (
                  <p className="text-white/80 text-sm mt-2">
                    Developer: <span className="font-semibold">{currentDeveloper.name}</span>
                  </p>
                )}
              </div>

              <div className="p-6">
                {/* Task Status Legend */}
                <div className="flex flex-wrap gap-4 mb-6">
                  <div className="flex items-center"><div className="w-3 h-3 rounded-full bg-gray-400 mr-2"></div><span className="text-sm text-gray-600">Pending</span></div>
                  <div className="flex items-center"><div className="w-3 h-3 rounded-full bg-blue-500 mr-2"></div><span className="text-sm text-gray-600">In Progress</span></div>
                  <div className="flex items-center"><div className="w-3 h-3 rounded-full bg-yellow-500 mr-2"></div><span className="text-sm text-gray-600">Awaiting Review</span></div>
                  <div className="flex items-center"><div className="w-3 h-3 rounded-full bg-green-500 mr-2"></div><span className="text-sm text-gray-600">Completed</span></div>
                  <div className="flex items-center"><div className="w-3 h-3 rounded-full bg-red-500 mr-2"></div><span className="text-sm text-gray-600">Rejected</span></div>
                </div>

                {/* Tasks List */}
                <div className="space-y-6">
                  {tasks.map((task, index) => (
                    <div key={task.id}>
                      <div className={`border rounded-lg p-4 ${
                        task.status === 'completed' ? 'bg-green-50 border-green-200' :
                        task.status === 'in_progress' ? 'bg-blue-50 border-blue-200' :
                        task.status === 'awaiting_approval' ? 'bg-yellow-50 border-yellow-200' :
                        task.status === 'rejected' ? 'bg-red-50 border-red-200' :
                        'bg-gray-50 border-gray-200'
                      } ${
                        canEditTasks && !isTaskValid(task) ? 'border-l-4 border-l-red-500' : ''
                      }`}>
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex items-start space-x-3">
                            {/* Task Number and Status Indicator */}
                            <div className="flex flex-col items-center">
                              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center font-bold text-blue-700 border border-blue-200">
                                {index + 1}
                              </div>
                              {/* Status Badge */}
                              <span className={`mt-2 px-2 py-1 rounded-full text-xs font-medium ${
                                task.status === 'completed' ? 'bg-green-100 text-green-800 border border-green-200' :
                                task.status === 'in_progress' ? 'bg-blue-100 text-blue-800 border border-blue-200' :
                                task.status === 'awaiting_approval' ? 'bg-yellow-100 text-yellow-800 border border-yellow-200' :
                                task.status === 'rejected' ? 'bg-red-100 text-red-800 border border-red-200' :
                                'bg-gray-100 text-gray-600 border border-gray-200'
                              }`}>
                                {task.status === 'in_progress' ? 'In Progress' :
                                 task.status === 'completed' ? 'Completed' :
                                 task.status === 'awaiting_approval' ? 'Awaiting Review' :
                                 task.status === 'rejected' ? 'Rejected' : 'Pending'}
                              </span>
                            </div>
                            
                            <div className="flex-1">
                              <h3 className={`text-lg font-semibold ${
                                canEditTasks ? 'text-gray-800' : 'text-gray-600'
                              }`}>
                                {formatTaskTitle(task.title) || 'Untitled Task'}
                              </h3>
                              <p className={`text-sm mt-1 ${
                                canEditTasks ? 'text-gray-600' : 'text-gray-500'
                              }`}>
                                {task.description || 'No description provided'}
                              </p>
                              
                              {/* Task Duration */}
                              {task.startDate && task.endDate && (
                                <div className="mt-2 inline-flex items-center text-xs text-gray-600 bg-white border border-gray-200 px-2 py-1 rounded">
                                  <svg className="w-3 h-3 mr-1 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                  {calculateDuration(task.startDate, task.endDate)}
                                </div>
                              )}
                              
                              {/* Rejection reason */}
                              {task.status === 'rejected' && task.rejection_reason && (
                                <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                                  <strong>Rejection reason:</strong> {task.rejection_reason}
                                </div>
                              )}
                              {task.status === 'rejected' && task.admin_comments && (
                                <div className="mt-1 p-2 bg-orange-50 border border-orange-200 rounded text-sm text-orange-700">
                                  <strong>Admin comments:</strong> {task.admin_comments}
                                </div>
                              )}
                              {task.status === 'completed' && task.admin_comments && (
                                <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-sm text-blue-700">
                                  <strong>Admin comments:</strong> {task.admin_comments}
                                </div>
                              )}
                              {task.status === 'completed' && task.is_on_time !== undefined && task.is_on_time !== null && (
                                <div className={`mt-2 p-2 rounded text-xs font-medium ${task.is_on_time ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                                  {task.is_on_time ? '✓ Completed on time · +1 productivity point' : '⚠ Completed late · −1 productivity point'}
                                </div>
                              )}
                              {/* Validation error messages */}
                              {canEditTasks && !isTaskValid(task) && (
                                <div className="mt-2 text-xs text-red-600 bg-red-50 p-2 rounded border border-red-200">
                                  {!task.title || task.title.trim() === '' ? '• Task title is required' : ''}
                                  {!task.startDate || task.startDate.trim() === '' ? '• Start date is required' : ''}
                                  {!task.endDate || task.endDate.trim() === '' ? '• End date is required' : ''}
                                  {task.startDate && task.endDate && new Date(task.endDate) < new Date(task.startDate) ? '• End date cannot be before start date' : ''}
                                </div>
                              )}
                            </div>
                          </div>
                          
                          {/* Action Buttons */}
                          {canEditTasks && (
                            <div className="flex space-x-2">
                              <button
                                onClick={() => handleEditTask(task)}
                                className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleDeleteTask(task.id)}
                                className="bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700"
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Task Details Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm mt-4">
                          <div>
                            <label className="font-medium text-gray-700 mb-1 block">Start Date</label>
                            <p className={`flex items-center ${canEditTasks ? 'text-gray-600' : 'text-gray-400'}`}>
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
                            <label className="font-medium text-gray-700 mb-1 block">End Date</label>
                            <p className={`flex items-center ${canEditTasks ? 'text-gray-600' : 'text-gray-400'}`}>
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
                          
                          {/* Sequential Task Workflow Actions */}
                          <div>
                            <label className="font-medium text-gray-700 mb-2 block">Action</label>
                            {canEditTasks && (
                              <span className="text-xs text-gray-400 italic">Save task plan first to begin working</span>
                            )}
                            {isSubmitted && isPlanApproved && task.status === 'pending' && (
                              <button
                                onClick={() => handleStartTask(task.id, index)}
                                disabled={!canStartTask(index) || getInProgressTaskIndex() !== -1}
                                title={!canStartTask(index) ? 'Complete the previous task first' : getInProgressTaskIndex() !== -1 ? 'Another task is already in progress' : 'Start working on this task'}
                                className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                                  canStartTask(index) && getInProgressTaskIndex() === -1
                                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                }`}
                              >
                                {canStartTask(index) && getInProgressTaskIndex() === -1 ? '▶ Start Task' : '🔒 Locked'}
                              </button>
                            )}
                            {isSubmitted && isPlanApproved && task.status === 'in_progress' && (
                              <button
                                onClick={() => handleOpenCompletionModal(task)}
                                className="px-3 py-2 rounded-lg text-xs font-medium bg-green-600 text-white hover:bg-green-700 transition-colors"
                              >
                                ✓ Mark as Completed
                              </button>
                            )}
                            {isSubmitted && isPlanApproved && task.status === 'awaiting_approval' && (
                              <span className="px-3 py-2 rounded-lg text-xs bg-yellow-100 text-yellow-800 border border-yellow-200 inline-block">
                                ⏳ Awaiting Admin Review
                              </span>
                            )}
                            {isSubmitted && isPlanApproved && task.status === 'rejected' && (
                              <button
                                onClick={() => handleOpenCompletionModal(task)}
                                className="px-3 py-2 rounded-lg text-xs font-medium bg-orange-600 text-white hover:bg-orange-700 transition-colors"
                              >
                                ↻ Re-submit Work
                              </button>
                            )}
                            {isSubmitted && isPlanApproved && task.status === 'completed' && (
                              <span className="px-3 py-2 rounded-lg text-xs bg-green-100 text-green-800 border border-green-200 inline-block">
                                ✓ Admin Approved{task.is_on_time === true ? ' · +1 pt' : task.is_on_time === false ? ' · −1 pt' : ''}
                              </span>
                            )}
                            {isSubmitted && !isPlanApproved && (
                              <span className="px-3 py-2 rounded-lg text-xs bg-gray-100 text-gray-600 border border-gray-200 inline-block">
                                ⏳ Waiting for admin approval
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      {/* Add Task Button after each task */}
                      {canEditTasks && (
                        <div className="flex justify-center mt-4">
                          <button
                            onClick={() => handleAddTask(task.id)}
                            className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 font-medium flex items-center text-sm"
                          >
                            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            Add Next Task
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Empty State */}
                {tasks.length === 0 && canEditTasks && (
                  <div className="text-center py-8">
                    <button
                      onClick={() => handleAddTask()}
                      className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 font-medium flex items-center mx-auto"
                    >
                      <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Add First Task
                    </button>
                  </div>
                )}

                {tasks.length === 0 && isSubmitted && !canEditTasks && (
                  <div className="text-center py-8">
                    <p className="text-gray-500">No tasks were added for this project.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Gantt Chart - Only show AFTER submission */}
            {isSubmitted && tasks.length > 0 && (
              <div className="mt-6">
                <button
                  onClick={() => setShowGanttChart(!showGanttChart)}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium flex items-center mb-4"
                >
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  {showGanttChart ? 'Hide Gantt Chart' : 'View Gantt Chart'}
                </button>
                
                {showGanttChart && <GanttChart />}
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 mt-6">
          <div className="flex flex-col sm:flex-row gap-4 flex-1">
            <button
              onClick={handleBack}
              className="flex-1 bg-gray-600 text-white py-3 px-6 rounded-lg hover:bg-gray-700 font-medium flex items-center justify-center"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              Go to Dashboard
            </button>
            
            <button
              onClick={handleBackToProjects}
              className="flex-1 bg-blue-600 text-white py-3 px-6 rounded-lg hover:bg-blue-700 font-medium flex items-center justify-center"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              All Projects
            </button>
          </div>
          
          {/* Submit Work Button - Always enabled */}
          {canEditTasks && (
            <button
              onClick={handleSubmitWork}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white py-3 px-6 rounded-lg font-medium flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={tasks.length === 0 || !currentDeveloper}
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {!currentDeveloper ? 'Login Required' : isPlanRejected ? 'Resubmit Task Plan' : 'Save Task Plan'}
            </button>
          )}

          {/* Timesheet View Button removed */}
        </div>

        {/* Success Messages */}
        {showSubmitSuccess && (
          <div className="fixed top-4 right-4 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg animate-bounce z-50">
            <div className="flex items-center">
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Work submitted to Supabase successfully!
            </div>
          </div>
        )}

        {validationSuccess && (
          <div className="fixed top-4 right-4 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg z-50">
            <div className="flex items-center">
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {validationSuccess}
            </div>
          </div>
        )}
      </div>

      {/* Edit Task Modal */}
      {editingTask && canEditTasks && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6 max-h-[90vh] overflow-y-auto border border-gray-200 shadow-lg">
            <h3 className="text-xl font-bold mb-4 text-gray-800">
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
                    onChange={(e) => handleEditFieldChange("startDate", e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Date *</label>
                  <input
                    type="date"
                    value={editingTask.endDate}
                    onChange={(e) => handleEditFieldChange("endDate", e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">No of Days *</label>
                <input
                  type="number"
                  min="1"
                  value={editingTask.noOfDays || ""}
                  onChange={(e) => handleEditFieldChange("noOfDays", e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              {/* Date Validation Check */}
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

            </div>

            <div className="flex space-x-3 mt-6">
              <button
                onClick={handleCancelEdit}
                className="flex-1 bg-gray-600 text-white py-2 px-4 rounded-lg hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateTask}
                className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700"
                disabled={!editingTask.title || !editingTask.startDate || !editingTask.endDate}
              >
                {editingTask.title ? 'Update Task' : 'Add Task'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Task Completion / Re-submission Modal */}
      {showCompletionModal && completionTask && (
        <TaskCompletionModal
          isOpen={showCompletionModal}
          onClose={() => { setShowCompletionModal(false); setCompletionTask(null); }}
          task={completionTask}
          project={project}
          developer={currentDeveloper}
          onTaskUpdated={handleTaskUpdated}
        />
      )}
    </div>
  );
}