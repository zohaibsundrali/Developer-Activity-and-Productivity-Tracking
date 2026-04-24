"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from '@/utils/supabaseClient';

export default function ProjectProductivityPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId;
  
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState(null);
  const [developerTasks, setDeveloperTasks] = useState([]);
  const [currentAdmin, setCurrentAdmin] = useState(null);
  const [error, setError] = useState(null);
  const [ganttData, setGanttData] = useState([]);

  // Fetch data on component mount
  useEffect(() => {
    if (projectId) {
      fetchProductivityData();
    }
  }, [projectId]);

  const fetchProductivityData = async () => {
    try {
      setLoading(true);
      
      // Get admin from localStorage
      const adminData = JSON.parse(localStorage.getItem("adminUser"));
      if (!adminData) {
        router.push('/admin/login');
        return;
      }
      setCurrentAdmin(adminData);

      // Fetch project details
      const { data: projectData, error: projectError } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .single();

      if (projectError) throw projectError;
      if (!projectData) {
        setError('Project not found');
        return;
      }

      setProject(projectData);

      // Fetch developer tasks for this project
      const { data: tasks, error: tasksError } = await supabase
        .from('developer_tasks')
        .select(`
          *,
          developers (name, email)
        `)
        .eq('project_id', projectId)
        .order('start_date', { ascending: true });

      if (tasksError) throw tasksError;
      
      setDeveloperTasks(tasks || []);
      
      // Prepare Gantt chart data
      if (tasks && tasks.length > 0) {
        const ganttChartData = tasks.map(task => ({
          id: task.id,
          task: task.task_title,
          start: task.start_date,
          end: task.end_date,
          status: task.status,
          working_hours: task.working_hours,
          developer: task.developers?.name || 'Unknown'
        }));
        setGanttData(ganttChartData);
      }

    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
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

  // Calculate productivity metrics
  const calculateProductivityMetrics = () => {
    if (developerTasks.length === 0) {
      return {
        totalTasks: 0,
        completedTasks: 0,
        totalHours: 0,
        averageHoursPerTask: 0,
        completionRate: 0,
        onTimeTasks: 0,
        lateTasks: 0
      };
    }
    
    const totalTasks = developerTasks.length;
    const completedTasks = developerTasks.filter(t => t.status === 'completed').length;
    const totalHours = developerTasks.reduce((sum, task) => sum + (task.working_hours || 0), 0);
    const averageHoursPerTask = totalTasks > 0 ? totalHours / totalTasks : 0;
    const completionRate = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;
    
    const onTimeTasks = developerTasks.filter(task => {
      if (task.status !== 'completed' || !task.end_date) return false;
      const endDate = new Date(task.end_date);
      const today = new Date();
      return endDate <= today;
    }).length;
    
    return {
      totalTasks,
      completedTasks,
      totalHours,
      averageHoursPerTask: averageHoursPerTask.toFixed(1),
      completionRate: completionRate.toFixed(1),
      onTimeTasks,
      lateTasks: completedTasks - onTimeTasks
    };
  };

  // Render Gantt Chart
  const renderGanttChart = () => {
    if (ganttData.length === 0) {
      return (
        <div className="text-center py-8">
          <p className="text-gray-500">No timeline data available</p>
        </div>
      );
    }
    
    const today = new Date();
    
    // Find the date range for the chart
    const startDates = ganttData.map(d => new Date(d.start));
    const endDates = ganttData.map(d => new Date(d.end));
    const minDate = new Date(Math.min(...startDates));
    const maxDate = new Date(Math.max(...endDates));
    
    // Add padding
    minDate.setDate(minDate.getDate() - 2);
    maxDate.setDate(maxDate.getDate() + 2);
    
    const totalDays = Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24));
    
    return (
      <div className="mt-6">
        <h3 className="text-lg font-semibold mb-4">Task Timeline (Gantt Chart)</h3>
        <div className="bg-gray-50 border rounded-lg p-4 overflow-x-auto">
          <div className="min-w-[900px]">
          {/* Timeline Header */}
          <div className="flex mb-2">
            <div className="w-40 sm:w-48 flex-shrink-0 font-medium">Task / Developer</div>
            <div className="flex-1 relative">
              <div className="flex">
                {Array.from({ length: totalDays }).map((_, index) => {
                  const date = new Date(minDate);
                  date.setDate(minDate.getDate() + index);
                  const isToday = date.toDateString() === today.toDateString();
                  
                  return (
                    <div 
                      key={index} 
                      className={`flex-1 text-center text-xs py-1 ${
                        isToday ? 'bg-blue-100 font-bold' : ''
                      }`}
                      style={{ minWidth: '30px' }}
                    >
                      {date.getDate()}
                      <div className="text-xs text-gray-500">
                        {date.toLocaleDateString('en-US', { weekday: 'short' }).charAt(0)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          
          {/* Task Bars */}
          <div className="space-y-2">
            {ganttData.map(task => {
              const startDate = new Date(task.start);
              const endDate = new Date(task.end);
              const taskStartDay = Math.ceil((startDate - minDate) / (1000 * 60 * 60 * 24));
              const taskDuration = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
              
              return (
                <div key={task.id} className="flex items-center">
                  <div className="w-40 sm:w-48 flex-shrink-0">
                    <div className="font-medium text-sm truncate">{task.task}</div>
                    <div className="text-xs text-gray-500">{task.developer}</div>
                  </div>
                  <div className="flex-1 relative h-8">
                    {/* Background Grid */}
                    <div className="absolute inset-0 flex">
                      {Array.from({ length: totalDays }).map((_, index) => (
                        <div 
                          key={index} 
                          className={`flex-1 border-l ${index === 0 ? 'border-l-0' : ''} ${
                            index % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                          }`}
                        ></div>
                      ))}
                    </div>
                    
                    {/* Task Bar */}
                    <div
                      className={`absolute h-6 rounded-md flex items-center px-2 ${
                        task.status === 'completed' ? 'bg-green-500' :
                        task.status === 'in_progress' ? 'bg-blue-500' :
                        'bg-yellow-500'
                      } text-white text-xs font-medium`}
                      style={{
                        left: `${(taskStartDay / totalDays) * 100}%`,
                        width: `${(taskDuration / totalDays) * 100}%`,
                        minWidth: '40px'
                      }}
                    >
                      <span className="truncate">{task.task}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          
          {/* Legend */}
          <div className="mt-4 flex flex-wrap gap-4">
            <div className="flex items-center">
              <div className="w-4 h-4 bg-green-500 rounded mr-2"></div>
              <span className="text-sm">Completed</span>
            </div>
            <div className="flex items-center">
              <div className="w-4 h-4 bg-blue-500 rounded mr-2"></div>
              <span className="text-sm">In Progress</span>
            </div>
            <div className="flex items-center">
              <div className="w-4 h-4 bg-yellow-500 rounded mr-2"></div>
              <span className="text-sm">Pending</span>
            </div>
            <div className="flex items-center">
              <div className="w-0.5 h-4 bg-red-500 mr-2"></div>
              <span className="text-sm">Today</span>
            </div>
          </div>
          </div>
        </div>
      </div>
    );
  };

  // Calculate task duration in days
  const calculateTaskDuration = (startDate, endDate) => {
    if (!startDate || !endDate) return 'N/A';
    const start = new Date(startDate);
    const end = new Date(endDate);
    const duration = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    return `${duration} day${duration !== 1 ? 's' : ''}`;
  };

  // Handle back to projects
  const handleBackToProjects = () => {
    router.push('/admin/dashboard?section=projects');
  };

  // Handle refresh
  const handleRefresh = () => {
    fetchProductivityData();
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <div className="text-xl text-gray-600 mt-4">Loading productivity data...</div>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !project) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center bg-white p-8 rounded-lg shadow-lg">
          <div className="text-red-500 text-xl mb-4">
            {error || 'Project not found'}
          </div>
          <button
            onClick={handleBackToProjects}
            className="bg-blue-500 text-white px-6 py-2 rounded-lg hover:bg-blue-600 transition-colors"
          >
            Back to Projects
          </button>
        </div>
      </div>
    );
  }

  const productivityMetrics = calculateProductivityMetrics();

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4">
        {/* Header */}
        <div className="flex flex-col gap-4 mb-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
            <button
              onClick={handleBackToProjects}
              className="flex items-center text-gray-600 hover:text-gray-800 bg-white px-4 py-2 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-all w-fit"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to Projects
            </button>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-gray-900">Project Productivity</h1>
              <p className="text-sm text-gray-500">
                Admin: {currentAdmin?.name || currentAdmin?.email}
              </p>
            </div>
          </div>
          
          <button
            onClick={handleRefresh}
            className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-colors flex items-center justify-center w-full sm:w-auto"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh Data
          </button>
        </div>

        {/* Project Info Card */}
        <div className="bg-white rounded-lg shadow-lg overflow-hidden mb-6">
          <div className="bg-gradient-to-r from-blue-500 to-blue-600 p-6 text-white">
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-2xl font-bold mb-2">{project.name}</h1>
                <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                  project.status === 'active' ? 'bg-green-100 text-green-800' :
                  project.status === 'completed' ? 'bg-blue-100 text-blue-800' :
                  'bg-yellow-100 text-yellow-800'
                }`}>
                  {project.status?.charAt(0).toUpperCase() + project.status?.slice(1)}
                </span>
              </div>
              <div className="text-right">
                <p className="text-white/80">Progress</p>
                <div className="text-2xl font-bold">{project.progress}%</div>
              </div>
            </div>
          </div>
          
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div className="bg-gray-50 border rounded-lg p-4">
                <p className="text-sm text-gray-500">Assigned Developer</p>
                <p className="font-semibold text-lg">{project.assigned_developer_name || 'Not Assigned'}</p>
                <p className="text-sm text-gray-600">{project.assigned_developer_email}</p>
              </div>
              <div className="bg-gray-50 border rounded-lg p-4">
                <p className="text-sm text-gray-500">Deadline</p>
                <p className="font-semibold text-lg">{formatDate(project.deadline)}</p>
              </div>
              <div className="bg-gray-50 border rounded-lg p-4">
                <p className="text-sm text-gray-500">Created On</p>
                <p className="font-semibold text-lg">{formatDate(project.created_at)}</p>
              </div>
              <div className="bg-gray-50 border rounded-lg p-4">
                <p className="text-sm text-gray-500">Project Status</p>
                <p className="font-semibold text-lg">{project.status?.toUpperCase()}</p>
              </div>
            </div>
            
            {project.description && (
              <div>
                <h3 className="text-lg font-semibold mb-2">Project Description</h3>
                <div className="bg-gray-50 rounded-lg p-4 border">
                  <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
                    {project.description}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Productivity Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="text-2xl font-bold text-blue-700">{productivityMetrics.totalTasks}</div>
            <div className="text-sm text-blue-600">Total Tasks</div>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="text-2xl font-bold text-green-700">{productivityMetrics.completedTasks}</div>
            <div className="text-sm text-green-600">Completed</div>
            <div className="text-xs text-green-500 mt-1">{productivityMetrics.completionRate}% complete</div>
          </div>
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <div className="text-2xl font-bold text-purple-700">{productivityMetrics.totalHours}</div>
            <div className="text-sm text-purple-600">Total Hours</div>
            <div className="text-xs text-purple-500 mt-1">{productivityMetrics.averageHoursPerTask} hrs/task</div>
          </div>
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
            <div className="text-2xl font-bold text-orange-700">{productivityMetrics.onTimeTasks}</div>
            <div className="text-sm text-orange-600">On Time Tasks</div>
            <div className="text-xs text-orange-500 mt-1">
              {productivityMetrics.lateTasks} late
            </div>
          </div>
        </div>

        {/* Tasks Table */}
        <div className="bg-white rounded-lg shadow-lg overflow-hidden mb-6">
          <div className="p-6">
            <h2 className="text-xl font-bold mb-4">Developer Tasks</h2>
            
            {developerTasks.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500">No tasks submitted by the developer yet.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] border-collapse">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border p-3 text-left">Task Title</th>
                      <th className="border p-3 text-left">Description</th>
                      <th className="border p-3 text-left">Start Date</th>
                      <th className="border p-3 text-left">End Date</th>
                      <th className="border p-3 text-left">Duration</th>
                      <th className="border p-3 text-left">Hours</th>
                      <th className="border p-3 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {developerTasks.map(task => (
                      <tr key={task.id} className="hover:bg-gray-50">
                        <td className="border p-3 font-medium">{task.task_title}</td>
                        <td className="border p-3">
                          <div className="max-w-xs truncate" title={task.task_description}>
                            {task.task_description || 'No description'}
                          </div>
                        </td>
                        <td className="border p-3">{formatDate(task.start_date)}</td>
                        <td className="border p-3">{formatDate(task.end_date)}</td>
                        <td className="border p-3">
                          {calculateTaskDuration(task.start_date, task.end_date)}
                        </td>
                        <td className="border p-3">{task.working_hours || 0} hrs</td>
                        <td className="border p-3">
                          <span className={`px-2 py-1 rounded-full text-xs ${
                            task.status === 'completed' ? 'bg-green-100 text-green-800' :
                            task.status === 'in_progress' ? 'bg-blue-100 text-blue-800' :
                            'bg-yellow-100 text-yellow-800'
                          }`}>
                            {task.status?.replace('_', ' ') || 'pending'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Gantt Chart */}
        {developerTasks.length > 0 && (
          <div className="bg-white rounded-lg shadow-lg overflow-hidden mb-6">
            <div className="p-6">
              {renderGanttChart()}
            </div>
          </div>
        )}

        {/* Summary Card */}
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          <div className="p-6">
            <h2 className="text-xl font-bold mb-4">Productivity Summary</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Task Distribution */}
              <div>
                <h3 className="text-lg font-semibold mb-3">Task Distribution</h3>
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between mb-1">
                      <span>Completed Tasks</span>
                      <span className="font-medium">
                        {productivityMetrics.completedTasks} of {productivityMetrics.totalTasks}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div 
                        className="bg-green-500 h-3 rounded-full" 
                        style={{ 
                          width: `${(productivityMetrics.completedTasks / productivityMetrics.totalTasks) * 100}%` 
                        }}
                      ></div>
                    </div>
                  </div>
                  
                  <div>
                    <div className="flex justify-between mb-1">
                      <span>In Progress Tasks</span>
                      <span className="font-medium">
                        {developerTasks.filter(t => t.status === 'in_progress').length}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div 
                        className="bg-blue-500 h-3 rounded-full" 
                        style={{ 
                          width: `${(developerTasks.filter(t => t.status === 'in_progress').length / productivityMetrics.totalTasks) * 100}%` 
                        }}
                      ></div>
                    </div>
                  </div>
                  
                  <div>
                    <div className="flex justify-between mb-1">
                      <span>Pending Tasks</span>
                      <span className="font-medium">
                        {developerTasks.filter(t => t.status === 'pending').length}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div 
                        className="bg-yellow-500 h-3 rounded-full" 
                        style={{ 
                          width: `${(developerTasks.filter(t => t.status === 'pending').length / productivityMetrics.totalTasks) * 100}%` 
                        }}
                      ></div>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Performance Indicators */}
              <div>
                <h3 className="text-lg font-semibold mb-3">Performance Indicators</h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                    <span>Average Hours per Task</span>
                    <span className="font-bold text-lg">{productivityMetrics.averageHoursPerTask} hrs</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                    <span>Completion Rate</span>
                    <span className="font-bold text-lg">{productivityMetrics.completionRate}%</span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                    <span>On-time Delivery Rate</span>
                    <span className="font-bold text-lg">
                      {productivityMetrics.totalTasks > 0 ? 
                        `${Math.round((productivityMetrics.onTimeTasks / productivityMetrics.totalTasks) * 100)}%` : 
                        '0%'
                      }
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                    <span>Total Workload</span>
                    <span className="font-bold text-lg">{productivityMetrics.totalHours} hours</span>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Overall Rating */}
            <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h3 className="text-lg font-semibold mb-2 text-blue-800">Overall Productivity Rating</h3>
              <div className="flex items-center">
                <div className="text-3xl font-bold text-blue-700 mr-4">
                  {productivityMetrics.completionRate >= 80 ? 'Excellent' :
                   productivityMetrics.completionRate >= 60 ? 'Good' :
                   productivityMetrics.completionRate >= 40 ? 'Average' : 'Needs Improvement'}
                </div>
                <div className="text-sm text-blue-600">
                  Based on task completion rate, on-time delivery, and workload efficiency.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}