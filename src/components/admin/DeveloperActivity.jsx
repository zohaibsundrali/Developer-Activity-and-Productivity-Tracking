"use client";
import { useState, useEffect } from "react";
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function DeveloperActivity() {
  const [currentAdmin, setCurrentAdmin] = useState(null);
  const [developers, setDevelopers] = useState([]);
  const [selectedDeveloper, setSelectedDeveloper] = useState("");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [timeRange, setTimeRange] = useState("today");
  const [activityData, setActivityData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetchingDevelopers, setFetchingDevelopers] = useState(false);
  const [productivityScore, setProductivityScore] = useState(0);
  const [viewMode, setViewMode] = useState("overview");

  // Get current admin from localStorage
  useEffect(() => {
    const getCurrentAdmin = () => {
      try {
        const adminData = JSON.parse(localStorage.getItem("adminUser"));
        if (adminData && adminData.email) {
          setCurrentAdmin(adminData);
        } else {
          setCurrentAdmin(null);
        }
      } catch (error) {
        console.error("Error reading admin from localStorage:", error);
        setCurrentAdmin(null);
      }
    };

    getCurrentAdmin();
    window.addEventListener('storage', getCurrentAdmin);
    
    return () => {
      window.removeEventListener('storage', getCurrentAdmin);
    };
  }, []);

  // Fetch developers added by current admin
  useEffect(() => {
    if (currentAdmin && currentAdmin.id) {
      fetchAdminDevelopers();
    } else {
      setDevelopers([]);
      setSelectedDeveloper("");
    }
  }, [currentAdmin]);

  const fetchAdminDevelopers = async () => {
    setFetchingDevelopers(true);
    try {
      if (!currentAdmin || !currentAdmin.id) {
        return;
      }

      let developersData = [];

      // Try different approaches to find developers added by this admin
      const possibleColumns = ['added_by_admin', 'added_by', 'admin_id', 'created_by'];
      
      for (const column of possibleColumns) {
        // Try with admin ID
        const { data, error } = await supabase
          .from('developers')
          .select('*')
          .eq(column, currentAdmin.id);
          
        if (!error && data && data.length > 0) {
          developersData = data;
          break;
        }
        
        // Try with admin email if available
        if (currentAdmin.email) {
          const { data: dataByEmail } = await supabase
            .from('developers')
            .select('*')
            .eq(column, currentAdmin.email);
            
          if (dataByEmail && dataByEmail.length > 0) {
            developersData = dataByEmail;
            break;
          }
        }
      }

      // If no results, try OR query
      if (developersData.length === 0 && currentAdmin.id) {
        const { data: orData } = await supabase
          .from('developers')
          .select('*')
          .or(`added_by_admin.eq.${currentAdmin.id},added_by.eq.${currentAdmin.id},admin_id.eq.${currentAdmin.id}`);
          
        if (orData) {
          developersData = orData;
        }
      }

      // If still no results, show message
      if (developersData.length === 0) {
        console.log('No developers found for this admin');
      }

      setDevelopers(developersData);

      // Reset selected developer if not in list
      if (selectedDeveloper && developersData.length > 0 && !developersData.find(d => d.id === selectedDeveloper)) {
        setSelectedDeveloper("");
      }

    } catch (error) {
      console.error('Error fetching developers:', error);
    } finally {
      setFetchingDevelopers(false);
    }
  };

  // Fetch activity data when developer or date changes
  useEffect(() => {
    if (selectedDeveloper) {
      fetchDeveloperActivity();
    }
  }, [selectedDeveloper, selectedDate, timeRange]);

const fetchDeveloperActivity = async () => {
  setLoading(true);
  try {
    const dateFilter = getDateFilter();
    const developer = developers.find(d => d.id === selectedDeveloper);
    
    if (!developer) {
      setActivityData(null);
      return;
    }

    console.log('Fetching for developer:', developer.email);
    
    // ✅ FIXED: Check which columns exist and try different options
    let sessions = [];
    let appEvents = [];
    
    // Try different column names for sessions
    const sessionColumnOptions = [
      { column: 'user_email', value: developer.email },
      { column: 'developer_email', value: developer.email },
      { column: 'email', value: developer.email },
      { column: 'developer_id', value: developer.id },
      { column: 'user_id', value: developer.id }
    ];
    
    for (const option of sessionColumnOptions) {
      try {
        const { data, error } = await supabase
          .from('productivity_sessions')
          .select('*')
          .eq(option.column, option.value)
          .gte('start_time', dateFilter.start)
          .lte('start_time', dateFilter.end);
        
        if (!error && data && data.length > 0) {
          console.log(`Found sessions using column "${option.column}"`);
          sessions = data;
          break;
        }
      } catch (err) {
        continue;
      }
    }
    
    // Try different column names for app events
    const appEventsColumnOptions = [
      { column: 'user_email', value: developer.email },
      { column: 'developer_email', value: developer.email },
      { column: 'email', value: developer.email },
      { column: 'developer_id', value: developer.id }
    ];
    
    for (const option of appEventsColumnOptions) {
      try {
        const { data, error } = await supabase
          .from('app_events')
          .select('*')
          .eq(option.column, option.value)
          .gte('timestamp', dateFilter.start)
          .lte('timestamp', dateFilter.end);
        
        if (!error && data && data.length > 0) {
          console.log(`Found app events using column "${option.column}"`);
          appEvents = data;
          break;
        }
      } catch (err) {
        continue;
      }
    }
    
    console.log('Sessions found:', sessions.length);
    console.log('App events found:', appEvents.length);
    
    // If still no data, check table structure
    if (sessions.length === 0) {
      console.log('Checking table structure...');
      
      // Get first row to see columns
      const { data: sampleData } = await supabase
        .from('productivity_sessions')
        .select('*')
        .limit(1);
      
      if (sampleData && sampleData.length > 0) {
        console.log('Available columns in productivity_sessions:', Object.keys(sampleData[0]));
        console.log('Sample row:', sampleData[0]);
      }
    }
    
    // Process the data
    const processedData = processActivityData(sessions, appEvents, developer);
    setActivityData(processedData);
    setProductivityScore(processedData.overallProductivityScore);

  } catch (error) {
    console.error('Error fetching activity data:', error);
    setActivityData(null);
  } finally {
    setLoading(false);
  }
};
  const getDateFilter = () => {
    const start = new Date(selectedDate);
    const end = new Date(selectedDate);
    
    // Set to beginning and end of day for proper filtering
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    
    switch (timeRange) {
      case 'week':
        start.setDate(start.getDate() - 7);
        break;
      case 'month':
        start.setMonth(start.getMonth() - 1);
        break;
    }
    
    return {
      start: start.toISOString(),
      end: end.toISOString()
    };
  };

  const processActivityData = (sessions, appEvents, developer) => {
    if (!sessions || sessions.length === 0) {
      return {
        developer,
        sessions: [],
        appEvents: [],
        overallProductivityScore: 0,
        totalActiveTime: 0,
        totalIdleTime: 0,
        appUsage: [],
        topApps: [],
        totalSessions: 0,
        totalMouseEvents: 0,
        totalKeyboardEvents: 0,
        totalAppSwitches: 0
      };
    }

    // Calculate metrics
    let totalProductivityScore = 0;
    let totalActiveTime = 0;
    let totalIdleTime = 0;
    let totalMouseEvents = 0;
    let totalKeyboardEvents = 0;
    let totalAppSwitches = 0;
    const appUsageMap = {};
    
    sessions.forEach(session => {
      totalProductivityScore += session.productivity_score || 0;
      totalActiveTime += session.active_duration || 0;
      totalIdleTime += session.idle_duration || 0;
      totalMouseEvents += session.mouse_events || 0;
      totalKeyboardEvents += session.keyboard_events || 0;
      totalAppSwitches += session.app_switches || 0;

      // Parse apps_used if available
      if (session.apps_used) {
        try {
          const appsData = JSON.parse(session.apps_used);
          if (appsData.top_apps && Array.isArray(appsData.top_apps)) {
            appsData.top_apps.forEach(app => {
              if (app && typeof app === 'string') {
                appUsageMap[app] = (appUsageMap[app] || 0) + 1;
              }
            });
          }
        } catch (error) {
          console.log('Error parsing apps_used:', error);
        }
      }
    });

    // Also process app events
    if (appEvents && appEvents.length > 0) {
      appEvents.forEach(event => {
        const appName = event.app_name;
        if (appName) {
          appUsageMap[appName] = (appUsageMap[appName] || 0) + 1;
        }
      });
    }

    const overallProductivityScore = sessions.length > 0 
      ? totalProductivityScore / sessions.length 
      : 0;

    // Convert app usage to sorted array
    const appUsage = Object.entries(appUsageMap)
      .map(([app, count]) => ({ app, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topApps = appUsage.slice(0, 5);

    return {
      developer,
      sessions,
      appEvents,
      overallProductivityScore,
      totalActiveTime: totalActiveTime / 3600, // Convert to hours
      totalIdleTime: totalIdleTime / 3600, // Convert to hours
      totalSessions: sessions.length,
      totalMouseEvents,
      totalKeyboardEvents,
      totalAppSwitches,
      appUsage,
      topApps
    };
  };

  const getProductivityColor = (score) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getProductivityBgColor = (score) => {
    if (score >= 80) return 'bg-green-100';
    if (score >= 60) return 'bg-yellow-100';
    return 'bg-red-100';
  };

  const getProductivityLevel = (score) => {
    if (score >= 80) return 'High';
    if (score >= 60) return 'Medium';
    return 'Low';
  };

  const formatTime = (seconds) => {
    if (!seconds) return '0m';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const formatDateTime = (isoString) => {
    if (!isoString) return 'N/A';
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const refreshAdminData = () => {
    try {
      const adminData = JSON.parse(localStorage.getItem("adminUser"));
      if (adminData) {
        setCurrentAdmin(adminData);
        fetchAdminDevelopers();
      }
    } catch (error) {
      console.error("Error refreshing admin data:", error);
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Developer Activity Dashboard</h2>
        
        <div className="flex items-center space-x-4">
          {currentAdmin && (
            <div className="text-right">
              <p className="text-sm font-medium text-gray-700">
                {currentAdmin.name || currentAdmin.email}
              </p>
              <p className="text-xs text-gray-500">Admin Dashboard</p>
            </div>
          )}
          <button
            onClick={refreshAdminData}
            className="bg-gray-100 text-gray-700 px-3 py-1 rounded-md hover:bg-gray-200 transition-colors text-sm"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select Developer
          </label>
          <select
            value={selectedDeveloper}
            onChange={(e) => setSelectedDeveloper(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-[#009578] focus:border-[#009578]"
            disabled={!currentAdmin || fetchingDevelopers}
          >
            <option value="">Choose Developer</option>
            {fetchingDevelopers ? (
              <option value="" disabled>Loading developers...</option>
            ) : (
              developers.map(dev => (
                <option key={dev.id} value={dev.id}>
                  {dev.name} ({dev.email})
                </option>
              ))
            )}
          </select>
          {!currentAdmin && (
            <div className="mt-1">
              <p className="text-xs text-red-500">Please login to view developers</p>
              <button
                onClick={() => window.location.href = '/login'}
                className="text-xs text-blue-500 hover:text-blue-700 underline"
              >
                Go to Login
              </button>
            </div>
          )}
          {currentAdmin && fetchingDevelopers && (
            <p className="text-xs text-gray-500 mt-1">Loading developers...</p>
          )}
          {currentAdmin && !fetchingDevelopers && developers.length === 0 && (
            <div className="mt-1">
              <p className="text-xs text-yellow-500">No developers added by you yet</p>
              <button
                onClick={() => window.location.href = '/add-developer'}
                className="text-xs text-green-600 hover:text-green-800 underline"
              >
                Add Developers
              </button>
            </div>
          )}
          {currentAdmin && !fetchingDevelopers && developers.length > 0 && (
            <p className="text-xs text-gray-500 mt-1">
              Showing {developers.length} developer{developers.length !== 1 ? 's' : ''} added by you
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Date
          </label>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-[#009578] focus:border-[#009578]"
            disabled={!selectedDeveloper}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Time Range
          </label>
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-[#009578] focus:border-[#009578]"
            disabled={!selectedDeveloper}
          >
            <option value="today">Today</option>
            <option value="week">Last 7 Days</option>
            <option value="month">Last 30 Days</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            View Mode
          </label>
          <select
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-[#009578] focus:border-[#009578]"
            disabled={!selectedDeveloper}
          >
            <option value="overview">Overview</option>
            <option value="apps">App Usage</option>
            <option value="timeline">Timeline</option>
          </select>
        </div>

        <div className="flex items-end">
          <button
            onClick={fetchDeveloperActivity}
            disabled={!selectedDeveloper || loading}
            className="w-full bg-[#009578] text-white py-2 px-4 rounded-md hover:bg-[#0e7762] disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Loading...' : 'Refresh Data'}
          </button>
        </div>
      </div>

      {loading && (
        <div className="text-center py-8">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#009578]"></div>
          <p className="text-gray-500 mt-2">Loading activity data...</p>
        </div>
      )}

      {activityData && !loading && (
        <div className="space-y-6">
          {/* Developer Header */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-6 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-2xl font-bold text-gray-800">{activityData.developer.name}</h3>
                <p className="text-gray-600">{activityData.developer.email}</p>
                <p className="text-sm text-gray-500 mt-1">
                  Total Sessions: {activityData.totalSessions} • Added by: You
                </p>
              </div>
              <div className={`px-6 py-3 rounded-full ${getProductivityBgColor(productivityScore)}`}>
                <p className="text-sm text-gray-600">Overall Productivity</p>
                <p className={`text-3xl font-bold ${getProductivityColor(productivityScore)}`}>
                  {productivityScore.toFixed(1)}%
                </p>
                <p className="text-sm text-gray-500">{getProductivityLevel(productivityScore)}</p>
              </div>
            </div>
          </div>

          {/* Overview Cards */}
          {viewMode === "overview" && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white p-6 rounded-lg border shadow-sm">
                  <div className="flex items-center">
                    <div className="bg-green-100 p-3 rounded-lg mr-4">
                      <span className="text-2xl">⏱️</span>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Total Active Time</p>
                      <p className="text-2xl font-bold text-gray-800">
                        {activityData.totalActiveTime.toFixed(1)} hrs
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-6 rounded-lg border shadow-sm">
                  <div className="flex items-center">
                    <div className="bg-red-100 p-3 rounded-lg mr-4">
                      <span className="text-2xl">⏸️</span>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Total Idle Time</p>
                      <p className="text-2xl font-bold text-gray-800">
                        {activityData.totalIdleTime.toFixed(1)} hrs
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-6 rounded-lg border shadow-sm">
                  <div className="flex items-center">
                    <div className="bg-blue-100 p-3 rounded-lg mr-4">
                      <span className="text-2xl">📊</span>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Sessions Tracked</p>
                      <p className="text-2xl font-bold text-gray-800">
                        {activityData.totalSessions}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-6 rounded-lg border shadow-sm">
                  <div className="flex items-center">
                    <div className="bg-purple-100 p-3 rounded-lg mr-4">
                      <span className="text-2xl">💻</span>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Unique Apps</p>
                      <p className="text-2xl font-bold text-gray-800">
                        {activityData.appUsage.length}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Activity Stats */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-gray-50 p-6 rounded-lg">
                  <h3 className="text-lg font-semibold mb-4">Activity Summary</h3>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">Mouse Events:</span>
                      <span className="font-bold text-blue-600">{activityData.totalMouseEvents}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">Keyboard Events:</span>
                      <span className="font-bold text-green-600">{activityData.totalKeyboardEvents}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">App Switches:</span>
                      <span className="font-bold text-purple-600">{activityData.totalAppSwitches}</span>
                    </div>
                  </div>
                </div>

                {/* Top Applications */}
                <div className="bg-gray-50 p-6 rounded-lg md:col-span-2">
                  <h3 className="text-lg font-semibold mb-4">Top Applications Used</h3>
                  <div className="space-y-2">
                    {activityData.appUsage.length > 0 ? (
                      activityData.appUsage.map((item, index) => (
                        <div key={index} className="flex justify-between items-center p-3 bg-white rounded border hover:bg-gray-50">
                          <div className="flex items-center">
                            <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center mr-3">
                              <span className="text-blue-600">💻</span>
                            </div>
                            <span className="font-medium">{item.app}</span>
                          </div>
                          <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm">
                            Used {item.count} times
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="text-gray-500 text-center py-4">No application data available</p>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Session Timeline View */}
          {viewMode === "timeline" && (
            <div className="bg-white p-6 rounded-lg border shadow-sm">
              <h3 className="text-lg font-semibold mb-4">Session Timeline ({activityData.sessions.length})</h3>
              <div className="space-y-4 max-h-96 overflow-y-auto">
                {activityData.sessions.length > 0 ? (
                  activityData.sessions.map((session, index) => (
                    <div key={index} className="border-l-4 border-blue-500 pl-4 py-4 bg-white rounded hover:shadow-md transition-shadow">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="font-semibold text-gray-800">
                            Session {session.session_id?.slice(-8) || `#${index + 1}`}
                          </h4>
                          <p className="text-sm text-gray-600">
                            {formatDateTime(session.start_time)}
                            {session.end_time && ` → ${formatDateTime(session.end_time)}`}
                          </p>
                          <div className="flex flex-wrap gap-2 mt-2">
                            <span className={`px-3 py-1 rounded-full text-xs font-medium ${getProductivityBgColor(session.productivity_score)} ${getProductivityColor(session.productivity_score)}`}>
                              Score: {session.productivity_score?.toFixed(1) || 0}%
                            </span>
                            <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs">
                              ⏱️ {formatTime(session.total_duration)}
                            </span>
                            {session.mouse_events > 0 && (
                              <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs">
                                🖱️ {session.mouse_events}
                              </span>
                            )}
                            {session.keyboard_events > 0 && (
                              <span className="px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-xs">
                                ⌨️ {session.keyboard_events}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <span className={`text-xs px-2 py-1 rounded ${session.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                            {session.status || 'completed'}
                          </span>
                        </div>
                      </div>
                      
                      {/* App Usage in Session */}
                      {(session.apps_used) && (
                        <div className="mt-3 pt-3 border-t">
                          <p className="text-sm font-medium text-gray-700 mb-1">Apps in this session:</p>
                          <div className="flex flex-wrap gap-1">
                            {(() => {
                              try {
                                let apps = [];
                                if (session.apps_used) {
                                  const appsData = JSON.parse(session.apps_used);
                                  if (appsData.top_apps) {
                                    apps = appsData.top_apps.slice(0, 5);
                                  }
                                }
                                
                                return apps.map((app, i) => (
                                  <span key={i} className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">
                                    {app}
                                  </span>
                                ));
                              } catch {
                                return (
                                  <span className="text-xs text-gray-500">App data available</span>
                                );
                              }
                            })()}
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-gray-500 text-center py-4">No sessions found for selected period</p>
                )}
              </div>
            </div>
          )}

          {/* App Events Detailed View */}
          {viewMode === "apps" && activityData.appEvents.length > 0 && (
            <div className="bg-gray-50 p-6 rounded-lg">
              <h3 className="text-lg font-semibold mb-4">Detailed App Usage ({activityData.appEvents.length} events)</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">App Name</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Duration</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">CPU</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Memory</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {activityData.appEvents.slice(0, 20).map((event, index) => (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-8 w-8 bg-blue-100 rounded-lg flex items-center justify-center">
                              <span className="text-blue-600">📱</span>
                            </div>
                            <div className="ml-3">
                              <div className="text-sm font-medium text-gray-900 truncate max-w-xs">
                                {event.app_name}
                              </div>
                              <div className="text-xs text-gray-500">PID: {event.process_id}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                          {formatTime(event.duration)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded">
                            {event.cpu_percent?.toFixed(1) || 0}%
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded">
                            {event.memory_percent?.toFixed(1) || 0}%
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                          {formatDateTime(event.timestamp)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {activityData.appEvents.length > 20 && (
                <p className="text-center text-sm text-gray-500 mt-3">
                  Showing 20 of {activityData.appEvents.length} app events
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {!activityData && !loading && selectedDeveloper && (
        <div className="text-center py-12">
          <div className="text-gray-400 mb-4">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 17h6l2 2V7a2 2 0 00-2-2H9a2 2 0 00-2 2v12l2-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v8" />
            </svg>
          </div>
          <p className="text-gray-500 text-lg">No activity data found for selected period</p>
          <p className="text-gray-400 text-sm mt-2">
            Make sure the developer has tracking sessions on {selectedDate}
          </p>
        </div>
      )}

      {!selectedDeveloper && !loading && (
        <div className="text-center py-12">
          <div className="text-gray-400 mb-4">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
            </svg>
          </div>
          {currentAdmin ? (
            <div>
              <p className="text-gray-500 text-lg">Select a developer to view activity data</p>
              {developers.length === 0 && (
                <div className="mt-4">
                  <p className="text-gray-400 text-sm">No developers added by you yet</p>
                  <button
                    onClick={() => window.location.href = '/add-developer'}
                    className="mt-2 text-blue-500 hover:text-blue-700 underline text-sm"
                  >
                    Add Developers First
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div>
              <p className="text-gray-500 text-lg">Please login to access developer activity</p>
              <p className="text-gray-400 text-sm mt-2">Only admins can view developer activity data</p>
              <button
                onClick={() => window.location.href = '/login'}
                className="mt-4 bg-[#009578] text-white py-2 px-4 rounded-md hover:bg-[#0e7762] transition-colors"
              >
                Go to Login
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}