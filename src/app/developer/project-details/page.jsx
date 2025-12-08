"use client";
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect } from 'react';

export default function ProjectDetailsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tasks, setTasks] = useState([]);
  const [editingTask, setEditingTask] = useState(null);
  const [showSubmitSuccess, setShowSubmitSuccess] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  // URL parameters se project data get karein
  const getProjectData = () => {
    return {
      id: searchParams.get('id'),
      name: decodeURIComponent(searchParams.get('name') || ''),
      description: decodeURIComponent(searchParams.get('description') || ''),
      status: searchParams.get('status'),
      progress: parseInt(searchParams.get('progress') || '0'),
      deadline: searchParams.get('deadline'),
      created_at: searchParams.get('created_at'), // Yeh Supabase se assigned date hai
      file_url: searchParams.get('file_url'),
      file_name: decodeURIComponent(searchParams.get('file_name') || '')
    };
  };

  const project = getProjectData();

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
      const assignedDate = project.created_at || new Date().toISOString().split('T')[0];
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
        },
        {
          id: 5,
          title: 'Database Schema',
          description: 'Design and implement database structure',
          startDate: assignedDate,
          endDate: '',
          workingHours: '',
          status: 'pending'
        }
      ];
      setTasks(defaultTasks);
    }
  }, [project.id, project.created_at]);

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

  const handleDownloadFile = () => {
    if (project.file_url && project.file_url !== 'null') {
      // Direct download karein
      const link = document.createElement('a');
      link.href = project.file_url;
      link.target = '_blank';
      link.download = project.file_name || 'project_file';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      alert('No file available for download');
    }
  };

  const handleBack = () => {
    router.back();
  };

  const handleSubmitWork = () => {
    // Submit work logic here
    setShowSubmitSuccess(true);
    setIsSubmitted(true);
    localStorage.setItem(`project_submitted_${project.id}`, 'true');
    setTimeout(() => {
      setShowSubmitSuccess(false);
    }, 3000);
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
      startDate: project.created_at || new Date().toISOString().split('T')[0],
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

  // Agar project data nahi hai toh loading show karein
  if (!project.id) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-xl text-gray-600">Loading project details...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4">
        {/* Header with Back Button */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center">
            <button
              onClick={handleBack}
              className="flex items-center text-gray-600 hover:text-gray-800 mr-4 bg-white px-4 py-2 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-all"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to Projects
            </button>
            <h1 className="text-3xl font-bold text-gray-900">Project Details</h1>
          </div>
          
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
                  <div className="bg-white border rounded-lg p-4">
                    <h3 className="text-md font-semibold mb-2 text-gray-800">Assigned Date</h3>
                    <div className="flex items-center text-gray-600">
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span>{formatDate(project.created_at)}</span>
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

                {/* File Attachment */}
                {project.file_url && project.file_url !== 'null' && (
                  <div className="mb-6">
                    <h2 className="text-lg font-semibold mb-3 text-gray-800">Project Files</h2>
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <div>
                            <p className="font-semibold text-blue-900 text-sm">
                              {project.file_name || 'Project Requirements Document'}
                            </p>
                            <p className="text-xs text-blue-700 mt-1">Click download to get the file</p>
                          </div>
                        </div>
                        <button
                          onClick={handleDownloadFile}
                          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm flex items-center"
                        >
                          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          Download
                        </button>
                      </div>
                    </div>
                  </div>
                )}

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
                      }`}>
                        <div className="flex justify-between items-start mb-3">
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
                            <p className={isSubmitted ? 'text-gray-400' : 'text-gray-600'}>
                              {task.startDate ? formatDate(task.startDate) : 'Not set'}
                            </p>
                          </div>
                          <div>
                            <label className={`font-medium ${
                              isSubmitted ? 'text-gray-500' : 'text-gray-700'
                            }`}>End Date</label>
                            <p className={isSubmitted ? 'text-gray-400' : 'text-gray-600'}>
                              {task.endDate ? formatDate(task.endDate) : 'Not set'}
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

        {/* Action Buttons */}
        <div className="flex space-x-4 mt-6">
          <button
            onClick={handleBack}
            className="flex-1 bg-gray-500 text-white py-3 px-6 rounded-lg hover:bg-gray-600 transition-colors font-medium flex items-center justify-center"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Projects
          </button>
          
          {/* Submit Work Button - Only show if not submitted */}
          {!isSubmitted && (
            <button
              onClick={handleSubmitWork}
              className="flex-1 bg-green-500 text-white py-3 px-6 rounded-lg hover:bg-green-600 transition-colors font-medium flex items-center justify-center"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Submit Work
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={editingTask.startDate}
                    onChange={(e) => setEditingTask({...editingTask, startDate: e.target.value})}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                  <input
                    type="date"
                    value={editingTask.endDate}
                    onChange={(e) => setEditingTask({...editingTask, endDate: e.target.value})}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Working Hours</label>
                <input
                  type="number"
                  value={editingTask.workingHours}
                  onChange={(e) => setEditingTask({...editingTask, workingHours: e.target.value})}
                  placeholder="Enter working hours"
                  min="0"
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
                disabled={!editingTask.title}
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