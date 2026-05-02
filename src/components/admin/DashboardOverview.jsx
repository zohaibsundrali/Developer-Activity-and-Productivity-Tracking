import { useState, useEffect } from "react"; // Add this import at the top

export default function DashboardOverview({ user, developers, projects, notifications, onRefresh, supabase }) {
  const [realTimeStats, setRealTimeStats] = useState({
    myDevelopers: 0,
    myProjects: 0,
    activeDevelopers: 0,
    pendingNotifications: 0
  });
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  useEffect(() => {
    if (user && developers && projects && notifications) {
      calculateRealTimeStats();
    }
  }, [user, developers, projects, notifications]);

  const calculateRealTimeStats = () => {
    try {
      // Get current admin from localStorage (more reliable)
      const currentAdmin = JSON.parse(localStorage.getItem("adminUser")) || user;
      const adminId = currentAdmin?.id;
      const adminEmail = currentAdmin?.email;

      if (!adminId && !adminEmail) return;

      // 1. Count developers added by this admin
      const myDevelopers = developers.filter(dev => {
        const addedByIdMatch = adminId && dev.added_by === adminId;
        const addedByEmailMatch = adminEmail && dev.added_by_admin && dev.added_by_admin.toLowerCase() === adminEmail.toLowerCase();
        return addedByIdMatch || addedByEmailMatch;
      }).length;

      // 2. Count projects created/assigned by this admin
      //    Based on projects table schema: created_by, added_by, added_by_admin
      const myProjects = projects.filter(project => {
        const createdByMatch = adminId && project.created_by === adminId;
        const addedByIdMatch = adminId && project.added_by === adminId;
        const addedByEmailMatch = adminEmail && project.added_by_admin && project.added_by_admin.toLowerCase() === adminEmail.toLowerCase();
        return createdByMatch || addedByIdMatch || addedByEmailMatch;
      }).length;

      // 3. Count active developers added by this admin
      const activeDevelopers = developers.filter(dev => {
        const addedByIdMatch = adminId && dev.added_by === adminId;
        const addedByEmailMatch = adminEmail && dev.added_by_admin && dev.added_by_admin.toLowerCase() === adminEmail.toLowerCase();
        const isMyDeveloper = addedByIdMatch || addedByEmailMatch;
        return isMyDeveloper && dev.status === 'active';
      }).length;

      // 4. Count unread notifications for this admin
      const pendingNotifications = notifications.filter(notif => {
        return !notif.read && 
               (notif.admin_id === adminId || 
                notif.admin_email === adminEmail);
      }).length;

      setRealTimeStats({
        myDevelopers,
        myProjects,
        activeDevelopers,
        pendingNotifications
      });
      
      setLastUpdated(new Date());
    } catch (error) {
      // Silently handle error
    }
  };

  // Fetch real-time data from database
  const fetchRealTimeData = async () => {
    if (!supabase || !user) return;

    try {
      setLoading(true);

      const currentAdmin = JSON.parse(localStorage.getItem("adminUser")) || user;
      const adminId = currentAdmin?.id;
      const adminEmail = currentAdmin?.email;

      if (!adminId && !adminEmail) return;

      // Fetch developers added by this admin
      const orFilters = [];
      if (adminId) {
        orFilters.push(`added_by.eq.${adminId}`);
      }
      if (adminEmail) {
        orFilters.push(`added_by_admin.ilike.%${adminEmail}%`);
      }

      const { data: myDevsData } = await supabase
        .from('developers')
        .select('*')
        .or(orFilters.join(','));

      // Fetch projects created/assigned by this admin
      const projectOrFilters = [];
      if (adminId) {
        projectOrFilters.push(`created_by.eq.${adminId}`);
        projectOrFilters.push(`added_by.eq.${adminId}`);
      }
      if (adminEmail) {
        projectOrFilters.push(`added_by_admin.ilike.%${adminEmail}%`);
      }

      const { data: myProjectsData } = await supabase
        .from('projects')
        .select('*')
        .or(projectOrFilters.join(','));

      // Fetch unread notifications
      const { data: unreadNotifications } = await supabase
        .from('notifications')
        .select('*')
        .eq('read', false)
        .or(`admin_id.eq.${adminId},admin_email.ilike.%${adminEmail}%`);

      // Calculate statistics
      const myDevelopers = myDevsData?.length || 0;
      const myProjects = myProjectsData?.length || 0;
      const activeDevelopers = myDevsData?.filter(dev => dev.status === 'active').length || 0;
      const pendingNotifications = unreadNotifications?.length || 0;

      setRealTimeStats({
        myDevelopers,
        myProjects,
        activeDevelopers,
        pendingNotifications
      });
      
      setLastUpdated(new Date());
    } catch (error) {
      // Silently handle error
    } finally {
      setLoading(false);
    }
  };

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (supabase && user) {
        fetchRealTimeData();
      }
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [supabase, user]);

  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  return (
    <div className="text-center">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-700">
            Dashboard Overview
          </h2>
          <p className="text-gray-600 mt-2">
            Welcome back, <span className="font-semibold text-[#009578]">{user?.full_name || user?.name}</span>
          </p>
        </div>
        
        <div className="flex items-center space-x-3">
          <button 
            onClick={fetchRealTimeData}
            disabled={loading}
            className="flex items-center bg-[#009578] text-white px-4 py-2 rounded hover:bg-[#0e7762] transition-colors disabled:opacity-50"
          >
            {loading ? (
              <>
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Refreshing...
              </>
            ) : (
              <>
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh Stats
              </>
            )}
          </button>
        </div>
      </div>
      

      
      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {/* My Developers Card */}
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-6 rounded-xl shadow-lg border border-blue-200">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-blue-500 p-3 rounded-lg">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13 0c1.013 0 1.827.833 1.827 1.86 0 1.03-.814 1.86-1.827 1.86s-1.827-.83-1.827-1.86c0-1.027.814-1.86 1.827-1.86z" />
              </svg>
            </div>
            <span className="text-sm font-medium text-blue-600 bg-blue-100 px-3 py-1 rounded-full">
              Assigned to you
            </span>
          </div>
          <h3 className="text-3xl font-bold text-gray-800 mb-2">
            {realTimeStats.myDevelopers}
          </h3>
          <p className="text-gray-600 font-medium">My Developers</p>
          <div className="mt-4 pt-4 border-t border-blue-200">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500">Active</span>
              <span className="text-sm font-semibold text-green-600">
                {realTimeStats.activeDevelopers}
              </span>
            </div>
          </div>
        </div>

        {/* My Projects Card */}
        <div className="bg-gradient-to-br from-green-50 to-green-100 p-6 rounded-xl shadow-lg border border-green-200">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-green-500 p-3 rounded-lg">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <span className="text-sm font-medium text-green-600 bg-green-100 px-3 py-1 rounded-full">
              Your projects
            </span>
          </div>
          <h3 className="text-3xl font-bold text-gray-800 mb-2">
            {realTimeStats.myProjects}
          </h3>
          <p className="text-gray-600 font-medium">My Projects</p>
        </div>

        {/* Pending Notifications Card */}
        <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 p-6 rounded-xl shadow-lg border border-yellow-200">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-yellow-500 p-3 rounded-lg">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </div>
            {realTimeStats.pendingNotifications > 0 && (
              <span className="animate-pulse bg-red-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                {realTimeStats.pendingNotifications} new
              </span>
            )}
          </div>
          <h3 className={`text-3xl font-bold mb-2 ${
            realTimeStats.pendingNotifications > 0 ? 'text-red-600' : 'text-gray-800'
          }`}>
            {realTimeStats.pendingNotifications}
          </h3>
          <p className="text-gray-600 font-medium">Pending Notifications</p>
          <div className="mt-4 pt-4 border-t border-yellow-200">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500">Require action</span>
              <span className="text-sm font-semibold text-yellow-600">
                {realTimeStats.pendingNotifications > 0 ? 'Yes' : 'No'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Profile Information Only */}
      <div className="grid grid-cols-1 lg:grid-cols-1 gap-6">
        <div className="bg-white p-6 rounded-xl shadow border border-gray-200">
          <h3 className="text-lg font-semibold mb-4 text-gray-800">Profile Information</h3>
          <div className="space-y-3 text-left">
            <div className="flex items-center">
              <svg className="w-5 h-5 text-gray-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <div>
                <p className="text-sm text-gray-500">Full Name</p>
                <p className="font-medium">{user?.full_name || user?.name || 'Not specified'}</p>
              </div>
            </div>
            <div className="flex items-center">
              <svg className="w-5 h-5 text-gray-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <div>
                <p className="text-sm text-gray-500">Email</p>
                <p className="font-medium">{user?.email || 'Not specified'}</p>
              </div>
            </div>
            <div className="flex items-center">
              <svg className="w-5 h-5 text-gray-400 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              <div>
                <p className="text-sm text-gray-500">Role</p>
                <p className="font-medium capitalize">{user?.role || 'Admin'}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Last Updated */}
      <div className="mt-8 pt-6 border-t border-gray-200">
        <p className="text-sm text-gray-500">
          Stats update automatically every 30 seconds. Last updated: {formatTime(lastUpdated)}
        </p>
      </div>
    </div>
  );
}