"use client";
import { useState, useEffect } from "react";
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function DeveloperActivity() {
  const [currentAdmin, setCurrentAdmin] = useState(null); // Changed to store full admin object
  const [developers, setDevelopers] = useState([]);
  const [selectedDeveloper, setSelectedDeveloper] = useState("");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [timeRange, setTimeRange] = useState("today");
  const [activityData, setActivityData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [productivityScore, setProductivityScore] = useState(0);

  // Step 1: Get current admin from localStorage (like your ViewDevelopers component)
  useEffect(() => {
    const getCurrentAdmin = () => {
      try {
        const adminData = JSON.parse(localStorage.getItem("adminUser"));
        
        if (adminData && adminData.email) {
          console.log("Admin found in localStorage:", adminData);
          setCurrentAdmin(adminData);
        } else {
          console.log("No admin found in localStorage");
          setCurrentAdmin(null);
        }
      } catch (error) {
        console.error("Error reading admin from localStorage:", error);
        setCurrentAdmin(null);
      }
    };

    getCurrentAdmin();

    // Listen for storage changes (if other components update it)
    const handleStorageChange = (e) => {
      if (e.key === "adminUser") {
        getCurrentAdmin();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    
    // Also check periodically (optional)
    const interval = setInterval(getCurrentAdmin, 5000);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  // Step 2: Fetch developers added by current admin
  useEffect(() => {
    if (currentAdmin) {
      console.log("Fetching developers for admin:", currentAdmin.email);
      fetchAddedDevelopers();
    } else {
      console.log("No admin, clearing developers");
      setDevelopers([]);
      setSelectedDeveloper("");
    }
  }, [currentAdmin]);

  const fetchAddedDevelopers = async () => {
    try {
      if (!currentAdmin) {
        console.log("No admin available to fetch developers");
        return;
      }

      console.log("Fetching developers for admin ID:", currentAdmin.id, "Email:", currentAdmin.email);

      // Try different possible column names based on your database structure
      let query = supabase
        .from('developers')
        .select('*')
        .order('name', { ascending: true });

      // Check which column exists in your database
      // Option 1: added_by_admin column
      query = query.or(`added_by_admin.eq.${currentAdmin.id},added_by_admin.ilike.%${currentAdmin.email}%`);

      // Option 2: If above doesn't work, try other possible column names
      // query = query.or(`
      //   added_by.eq.${currentAdmin.id},
      //   added_by_email.eq.${currentAdmin.email},
      //   admin_id.eq.${currentAdmin.id},
      //   created_by.eq.${currentAdmin.id}
      // `);

      const { data: developers, error } = await query;

      if (error) {
        console.error("Supabase error fetching developers:", error);
        // Try with more simple query
        const { data: allDevelopers } = await supabase
          .from('developers')
          .select('*')
          .order('name', { ascending: true });
        
        console.log("All developers (debug):", allDevelopers);
        setDevelopers([]);
        return;
      }
      
      console.log("Developers fetched:", developers?.length || 0, developers);
      setDevelopers(developers || []);
      
      // Reset selected developer if it's not in the list
      if (selectedDeveloper && developers && !developers.find(d => d.id === selectedDeveloper)) {
        setSelectedDeveloper("");
      }
    } catch (error) {
      console.error('Error fetching developers:', error);
    }
  };

  useEffect(() => {
    if (selectedDeveloper) {
      fetchDeveloperActivity();
    }
  }, [selectedDeveloper, selectedDate, timeRange]);

  const fetchDeveloperActivity = async () => {
    setLoading(true);
    try {
      const dateFilter = getDateFilter();
      
      // Fetch activities
      const { data: activities } = await supabase
        .from('developer_activities')
        .select('*')
        .eq('developer_id', selectedDeveloper)
        .gte('timestamp', dateFilter.start)
        .lte('timestamp', dateFilter.end)
        .order('timestamp', { ascending: true });

      // Fetch screenshots
      const { data: screenshots } = await supabase
        .from('screenshots')
        .select('*')
        .eq('developer_id', selectedDeveloper)
        .gte('timestamp', dateFilter.start)
        .lte('timestamp', dateFilter.end)
        .order('timestamp', { ascending: true });

      // Fetch productivity scores
      const { data: productivity } = await supabase
        .from('productivity_scores')
        .select('*')
        .eq('developer_id', selectedDeveloper)
        .gte('date', selectedDate)
        .order('date', { ascending: false });

      // Calculate productivity metrics
      const metrics = calculateProductivityMetrics(activities || []);
      
      setActivityData({
        activities: activities || [],
        screenshots: screenshots || [],
        productivity: productivity || [],
        metrics: metrics
      });

      setProductivityScore(metrics.productivityPercentage);

    } catch (error) {
      console.error('Error fetching activity data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getDateFilter = () => {
    const start = new Date(selectedDate);
    const end = new Date(selectedDate);
    
    switch (timeRange) {
      case 'week':
        start.setDate(start.getDate() - 7);
        break;
      case 'month':
        start.setMonth(start.getMonth() - 1);
        break;
      default: // today
        end.setDate(end.getDate() + 1);
    }
    
    return {
      start: start.toISOString(),
      end: end.toISOString()
    };
  };

  const calculateProductivityMetrics = (activities) => {
    if (!activities.length) {
      return { 
        productivityPercentage: 0, 
        activeTime: 0, 
        idleTime: 0,
        appUsage: [],
        websiteUsage: [],
        totalActivities: 0
      };
    }
    
    let totalScore = 0;
    let activeTime = 0;
    let idleTime = 0;
    const appUsage = {};
    const websiteUsage = {};
    
    activities.forEach(activity => {
      totalScore += activity.productivity_score || 0;
      
      if (activity.activity_type === 'idle') {
        idleTime += activity.activity_data?.idle_time_seconds || 0;
      } else {
        activeTime += 60;
      }
      
      if (activity.activity_type === 'app_switch') {
        const app = activity.activity_data?.application;
        if (app) {
          appUsage[app] = (appUsage[app] || 0) + 1;
        }
      }
      
      if (activity.activity_data?.url) {
        const domain = extractDomain(activity.activity_data.url);
        if (domain) {
          websiteUsage[domain] = (websiteUsage[domain] || 0) + 1;
        }
      }
    });
    
    const productivityPercentage = activities.length > 0 ? (totalScore / activities.length) * 100 : 0;
    
    return {
      productivityPercentage: Math.round(productivityPercentage),
      activeTime: Math.round(activeTime / 60),
      idleTime: Math.round(idleTime / 60),
      appUsage: Object.entries(appUsage)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10),
      websiteUsage: Object.entries(websiteUsage)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10),
      totalActivities: activities.length
    };
  };

  const extractDomain = (url) => {
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  };

  const getProductivityColor = (score) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getProductivityLevel = (score) => {
    if (score >= 80) return 'High';
    if (score >= 60) return 'Medium';
    return 'Low';
  };

  const getActivityTypeColor = (type) => {
    switch (type) {
      case 'mouse': return 'bg-blue-500';
      case 'keyboard': return 'bg-green-500';
      case 'app_switch': return 'bg-purple-500';
      case 'idle': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getActivityTypeIcon = (type) => {
    switch (type) {
      case 'mouse': return '🖱️';
      case 'keyboard': return '⌨️';
      case 'app_switch': return '💻';
      case 'idle': return '⏸️';
      default: return '📊';
    }
  };

  // Refresh admin data (if needed)
  const refreshAdminData = () => {
    try {
      const adminData = JSON.parse(localStorage.getItem("adminUser"));
      if (adminData) {
        setCurrentAdmin(adminData);
        console.log("Admin data refreshed:", adminData);
      }
    } catch (error) {
      console.error("Error refreshing admin data:", error);
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Developer Activity Tracking</h2>
        
        {/* Admin info section */}
        <div className="flex items-center space-x-4">
          {currentAdmin && (
            <div className="text-right">
              <p className="text-sm font-medium text-gray-700">
                {currentAdmin.name || currentAdmin.email}
              </p>
              <p className="text-xs text-gray-500">Logged in as Admin</p>
            </div>
          )}
          <button
            onClick={refreshAdminData}
            className="bg-gray-100 text-gray-700 px-3 py-1 rounded-md hover:bg-gray-200 transition-colors text-sm"
            title="Refresh admin session"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select Developer
          </label>
          <select
            value={selectedDeveloper}
            onChange={(e) => setSelectedDeveloper(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-[#009578] focus:border-[#009578]"
            disabled={!currentAdmin || developers.length === 0}
          >
            <option value="">Choose Developer</option>
            {developers.map(dev => (
              <option key={dev.id} value={dev.id}>
                {dev.name} ({dev.email})
              </option>
            ))}
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
          {currentAdmin && developers.length === 0 && (
            <p className="text-xs text-yellow-500 mt-1">No developers added yet</p>
          )}
          {currentAdmin && developers.length > 0 && (
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

        <div className="flex items-end">
          <button
            onClick={fetchDeveloperActivity}
            disabled={!selectedDeveloper}
            className="w-full bg-[#009578] text-white py-2 px-4 rounded-md hover:bg-[#0e7762] disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            Refresh Data
          </button>
        </div>
      </div>

      {/* Debug info (remove in production) */}
      <div className="mb-4 p-3 bg-gray-50 rounded text-sm hidden"> {/* Add 'hidden' class to hide in production */}
        <p><strong>Debug Info:</strong></p>
        <p>Admin: {currentAdmin ? JSON.stringify(currentAdmin) : 'Not logged in'}</p>
        <p>Developers found: {developers.length}</p>
        <p>Selected Developer: {selectedDeveloper || 'None'}</p>
      </div>

      {loading && (
        <div className="text-center py-8">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#009578]"></div>
          <p className="text-gray-500 mt-2">Loading activity data...</p>
        </div>
      )}

      {activityData && !loading && (
        <div className="space-y-6">
          {/* Productivity Overview */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-blue-50 p-4 rounded-lg border-l-4 border-blue-500">
              <h3 className="text-lg font-semibold text-blue-800">Productivity Score</h3>
              <p className={`text-3xl font-bold ${getProductivityColor(productivityScore)}`}>
                {productivityScore}%
              </p>
              <p className="text-sm text-blue-600">
                {getProductivityLevel(productivityScore)} Performance
              </p>
            </div>
            
            <div className="bg-green-50 p-4 rounded-lg border-l-4 border-green-500">
              <h3 className="text-lg font-semibold text-green-800">Active Time</h3>
              <p className="text-3xl font-bold text-green-600">
                {activityData.metrics.activeTime}m
              </p>
              <p className="text-sm text-green-600">Productive Work</p>
            </div>
            
            <div className="bg-red-50 p-4 rounded-lg border-l-4 border-red-500">
              <h3 className="text-lg font-semibold text-red-800">Idle Time</h3>
              <p className="text-3xl font-bold text-red-600">
                {activityData.metrics.idleTime}m
              </p>
              <p className="text-sm text-red-600">Inactive Periods</p>
            </div>
            
            <div className="bg-purple-50 p-4 rounded-lg border-l-4 border-purple-500">
              <h3 className="text-lg font-semibold text-purple-800">Total Activities</h3>
              <p className="text-3xl font-bold text-purple-600">
                {activityData.metrics.totalActivities}
              </p>
              <p className="text-sm text-purple-600">Mouse, Keyboard, Apps</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Applications Used */}
            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="text-lg font-semibold mb-4">Top Applications</h3>
              <div className="space-y-2">
                {activityData.metrics.appUsage.length > 0 ? (
                  activityData.metrics.appUsage.map(([app, count], index) => (
                    <div key={index} className="flex justify-between items-center p-2 bg-white rounded border">
                      <span className="text-sm font-medium truncate">{app}</span>
                      <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                        {count} uses
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-gray-500 text-center py-4">No application data available</p>
                )}
              </div>
            </div>

            {/* Websites Visited */}
            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="text-lg font-semibold mb-4">Top Websites</h3>
              <div className="space-y-2">
                {activityData.metrics.websiteUsage.length > 0 ? (
                  activityData.metrics.websiteUsage.map(([website, count], index) => (
                    <div key={index} className="flex justify-between items-center p-2 bg-white rounded border">
                      <span className="text-sm font-medium truncate">{website}</span>
                      <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                        {count} visits
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-gray-500 text-center py-4">No website data available</p>
                )}
              </div>
            </div>
          </div>

          {/* Activity Timeline */}
          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="text-lg font-semibold mb-4">Recent Activity Timeline</h3>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {activityData.activities.length > 0 ? (
                activityData.activities.slice(0, 100).map((activity, index) => (
                  <div key={index} className="flex items-center space-x-3 p-3 bg-white rounded border hover:shadow-md transition-shadow">
                    <div className="text-lg">
                      {getActivityTypeIcon(activity.activity_type)}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center space-x-2">
                        <p className="text-sm font-medium capitalize">{activity.activity_type}</p>
                        <span className={`text-xs px-2 py-1 rounded ${getActivityTypeColor(activity.activity_type)} text-white`}>
                          {Math.round((activity.productivity_score || 0) * 100)}%
                        </span>
                      </div>
                      <p className="text-xs text-gray-500">
                        {new Date(activity.timestamp).toLocaleString()}
                      </p>
                      {activity.activity_data?.application && (
                        <p className="text-xs text-gray-600">
                          App: {activity.activity_data.application}
                        </p>
                      )}
                      {activity.activity_data?.url && (
                        <p className="text-xs text-blue-600 truncate">
                          URL: {activity.activity_data.url}
                        </p>
                      )}
                      {activity.activity_data?.idle_time_seconds && (
                        <p className="text-xs text-red-600">
                          Idle: {Math.round(activity.activity_data.idle_time_seconds / 60)} minutes
                        </p>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-gray-500 text-center py-4">No activity data available</p>
              )}
            </div>
          </div>

          {/* Screenshots */}
          {activityData.screenshots.length > 0 && (
            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="text-lg font-semibold mb-4">
                Screenshots ({activityData.screenshots.length})
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {activityData.screenshots.map((screenshot, index) => (
                  <div key={index} className="border rounded-lg overflow-hidden bg-white hover:shadow-md transition-shadow">
                    <img 
                      src={screenshot.image_url} 
                      alt={`Screenshot ${index + 1}`}
                      className="w-full h-32 object-cover cursor-pointer hover:opacity-80 transition-opacity"
                      onClick={() => window.open(screenshot.image_url, '_blank')}
                    />
                    <div className="p-2">
                      <p className="text-xs text-gray-600 truncate">
                        {screenshot.activity_context || 'Screenshot'}
                      </p>
                      <p className="text-xs text-gray-500">
                        {new Date(screenshot.timestamp).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activityData.screenshots.length === 0 && (
            <div className="text-center py-8 bg-gray-50 rounded-lg">
              <p className="text-gray-500">No screenshots available for the selected period</p>
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
          <p className="text-gray-500 text-lg">No activity data found</p>
          <p className="text-gray-400 text-sm mt-2">Select a different date or time range</p>
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
                  <p className="text-gray-400 text-sm">No developers found added by you</p>
                  <button
                    onClick={() => window.location.href = '/add-developer'} // Adjust this URL
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