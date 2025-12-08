"use client";
import { useState, useEffect } from "react";

export default function Notifications({ notifications: initialNotifications, onMarkAsRead, unreadCount, supabase, user }) {
  const [localNotifications, setLocalNotifications] = useState([]);
  const [currentAdmin, setCurrentAdmin] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAdminData = () => {
      try {
        // Get current admin from localStorage (more reliable)
        const adminData = JSON.parse(localStorage.getItem("adminUser"));
        
        if (adminData) {
          console.log("🔔 Notifications: Admin found", adminData.email);
          setCurrentAdmin(adminData);
          
          // If initial notifications provided, filter for this admin
          if (initialNotifications) {
            const filteredNotifications = initialNotifications.filter(notif => 
              notif.admin_id === adminData.id || 
              notif.admin_email === adminData.email
            );
            console.log("🔔 Filtered notifications:", filteredNotifications.length);
            setLocalNotifications(filteredNotifications);
          }
        } else {
          console.log("🔔 No admin found in localStorage");
          setCurrentAdmin(null);
          setLocalNotifications([]);
        }
      } catch (error) {
        console.error("🔔 Error reading admin data:", error);
        setCurrentAdmin(null);
      } finally {
        setLoading(false);
      }
    };

    fetchAdminData();

    // Listen for storage changes
    const handleStorageChange = (e) => {
      if (e.key === "adminUser") {
        fetchAdminData();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [initialNotifications]);

  // Fetch notifications directly if not provided
  useEffect(() => {
    if (supabase && currentAdmin && !initialNotifications) {
      fetchAdminNotifications();
    }
  }, [supabase, currentAdmin, initialNotifications]);

  const fetchAdminNotifications = async () => {
    try {
      setLoading(true);
      
      if (!currentAdmin?.id) {
        console.log("🔔 No admin ID for fetching notifications");
        return;
      }

      console.log("🔔 Fetching notifications for admin:", currentAdmin.email);
      
      // Fetch notifications for current admin only
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .or(`admin_id.eq.${currentAdmin.id},admin_email.ilike.%${currentAdmin.email}%`)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      console.log("🔔 Notifications fetched:", data?.length || 0);
      setLocalNotifications(data || []);
      
    } catch (error) {
      console.error('❌ Error fetching notifications:', error);
      setLocalNotifications([]);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Just now';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleMarkAsRead = async (notificationId) => {
    try {
      console.log("✅ Marking as read:", notificationId);
      
      // Optimistic update
      setLocalNotifications(prev => 
        prev.map(notif => 
          notif.id === notificationId 
            ? { ...notif, read: true }
            : notif
        )
      );

      // Call parent's onMarkAsRead if provided (for Dashboard)
      if (onMarkAsRead) {
        await onMarkAsRead(notificationId);
      } 
      // Or update directly in database
      else if (supabase) {
        const { error } = await supabase
          .from('notifications')
          .update({ read: true, read_at: new Date().toISOString() })
          .eq('id', notificationId);

        if (error) throw error;
      }

      // Refresh to get updated count
      if (supabase && currentAdmin) {
        setTimeout(fetchAdminNotifications, 500);
      }

    } catch (error) {
      console.error('❌ Error marking as read:', error);
      // Revert optimistic update on error
      setLocalNotifications(prev => 
        prev.map(notif => 
          notif.id === notificationId 
            ? { ...notif, read: false }
            : notif
        )
      );
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      const unreadIds = localNotifications
        .filter(notif => !notif.read)
        .map(notif => notif.id);

      if (unreadIds.length === 0) return;

      console.log("✅ Marking all as read:", unreadIds.length, "notifications");

      // Optimistic update
      setLocalNotifications(prev => 
        prev.map(notif => ({ ...notif, read: true }))
      );

      // Call parent's onMarkAsRead for each
      if (onMarkAsRead) {
        unreadIds.forEach(id => onMarkAsRead(id));
      } 
      // Or update in database
      else if (supabase) {
        const { error } = await supabase
          .from('notifications')
          .update({ read: true, read_at: new Date().toISOString() })
          .in('id', unreadIds);

        if (error) throw error;
      }

      // Refresh after marking all
      if (supabase && currentAdmin) {
        setTimeout(fetchAdminNotifications, 500);
      }

    } catch (error) {
      console.error('❌ Error marking all as read:', error);
    }
  };

  // Filter notifications for current admin
  const adminNotifications = localNotifications.filter(notif => {
    if (!currentAdmin) return false;
    
    // Match by admin_id or admin_email
    const isForThisAdmin = 
      (notif.admin_id && notif.admin_id === currentAdmin.id) ||
      (notif.admin_email && notif.admin_email.toLowerCase() === currentAdmin.email.toLowerCase());
    
    return isForThisAdmin;
  });

  const unreadNotifications = adminNotifications.filter(notif => !notif.read);
  const readNotifications = adminNotifications.filter(notif => notif.read);

  console.log("🔔 Current admin:", currentAdmin?.email);
  console.log("🔔 Total notifications:", adminNotifications.length);
  console.log("🔔 Unread notifications:", unreadNotifications.length);

  if (loading) {
    return (
      <div className="bg-white p-6 rounded-lg shadow">
        <div className="text-center py-8">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#009578]"></div>
          <p className="mt-2 text-gray-500">Loading notifications...</p>
        </div>
      </div>
    );
  }

  if (!currentAdmin) {
    return (
      <div className="bg-white p-6 rounded-lg shadow">
        <div className="text-center py-8">
          <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          <p className="text-gray-500 text-lg mb-2">Please login to view notifications</p>
          <button
            onClick={() => window.location.href = '/login'}
            className="mt-4 bg-[#009578] text-white py-2 px-6 rounded-md hover:bg-[#0e7762] transition-colors"
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold">Notifications</h2>
          <div className="flex items-center space-x-4 mt-1">
            <p className="text-sm text-gray-500">
              For: <span className="font-medium">{currentAdmin.name || currentAdmin.email}</span>
            </p>
            {unreadNotifications.length > 0 && (
              <span className="bg-red-100 text-red-800 text-xs px-3 py-1 rounded-full font-medium">
                {unreadNotifications.length} new
              </span>
            )}
          </div>
        </div>
        
        <div className="flex items-center space-x-3">
          <button
            onClick={fetchAdminNotifications}
            className="bg-gray-100 text-gray-700 px-3 py-2 rounded-md hover:bg-gray-200 transition-colors text-sm flex items-center"
            title="Refresh notifications"
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
          
          {unreadNotifications.length > 0 && (
            <button
              onClick={handleMarkAllAsRead}
              className="bg-[#009578] text-white px-4 py-2 rounded-md hover:bg-[#0e7762] transition-colors text-sm font-medium"
            >
              Mark All as Read
            </button>
          )}
        </div>
      </div>

      {/* Unread Notifications Section */}
      {unreadNotifications.length > 0 ? (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center">
              <h3 className="text-lg font-semibold text-gray-700">
                New Notifications
              </h3>
              <span className="ml-2 bg-red-500 text-white text-xs px-3 py-1 rounded-full">
                {unreadNotifications.length}
              </span>
            </div>
            <button
              onClick={handleMarkAllAsRead}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              Mark all read
            </button>
          </div>
          
          <div className="space-y-3">
            {unreadNotifications.map(notification => (
              <div 
                key={notification.id} 
                className={`p-4 rounded-lg border-l-4 relative cursor-pointer hover:shadow-md transition-shadow group ${
                  notification.type === 'success' ? 'border-green-500 bg-green-50 hover:bg-green-100' :
                  notification.type === 'warning' ? 'border-yellow-500 bg-yellow-50 hover:bg-yellow-100' :
                  notification.type === 'error' ? 'border-red-500 bg-red-50 hover:bg-red-100' :
                  'border-blue-500 bg-blue-50 hover:bg-blue-100'
                }`}
                onClick={() => handleMarkAsRead(notification.id)}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <p className="text-gray-800 font-medium">{notification.message}</p>
                    
                    {notification.project_id && (
                      <p className="text-sm text-gray-600 mt-1">
                        Project: <span className="font-medium">{notification.project_id}</span>
                      </p>
                    )}
                    
                    <p className="text-sm text-gray-500 mt-2">
                      {formatDate(notification.created_at)}
                    </p>
                  </div>
                  
                  <div className="flex items-center space-x-2 ml-4">
                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMarkAsRead(notification.id);
                      }}
                      className="text-xs bg-white px-3 py-1 rounded-md border border-gray-300 hover:bg-gray-50 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      Mark as Read
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        unreadNotifications.length === 0 && adminNotifications.length > 0 && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <svg className="w-5 h-5 text-green-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-green-800 font-medium">All caught up! No new notifications.</p>
              </div>
              <span className="text-green-600 text-sm">✓ All read</span>
            </div>
          </div>
        )
      )}

      {/* Read Notifications Section */}
      {readNotifications.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center">
              <h3 className="text-lg font-semibold text-gray-500">
                Earlier Notifications
              </h3>
              <span className="ml-2 bg-gray-200 text-gray-700 text-xs px-3 py-1 rounded-full">
                {readNotifications.length}
              </span>
            </div>
          </div>
          
          <div className="space-y-3">
            {readNotifications.map(notification => (
              <div 
                key={notification.id} 
                className={`p-4 rounded-lg border-l-4 opacity-75 hover:opacity-100 transition-opacity ${
                  notification.type === 'success' ? 'border-green-300 bg-green-25' :
                  notification.type === 'warning' ? 'border-yellow-300 bg-yellow-25' :
                  notification.type === 'error' ? 'border-red-300 bg-red-25' :
                  'border-blue-300 bg-blue-25'
                }`}
              >
                <p className="text-gray-600">{notification.message}</p>
                
                {notification.project_id && (
                  <p className="text-sm text-gray-500 mt-1">
                    Project: <span className="font-medium">{notification.project_id}</span>
                  </p>
                )}
                
                <div className="flex justify-between items-center mt-2">
                  <p className="text-sm text-gray-400">
                    {formatDate(notification.created_at)}
                  </p>
                  <span className="text-green-600 text-xs font-medium flex items-center">
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Read
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {adminNotifications.length === 0 && !loading && (
        <div className="text-center py-12">
          <svg className="w-20 h-20 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          <p className="text-gray-500 text-lg mb-2">No notifications yet</p>
          <p className="text-gray-400 text-sm">You'll see notifications here for your activities</p>
          <p className="text-xs text-gray-400 mt-2">
            Notifications are specific to your admin account
          </p>
        </div>
      )}

      {/* Admin info footer */}
      {currentAdmin && adminNotifications.length > 0 && (
        <div className="mt-8 pt-6 border-t border-gray-200">
          <div className="flex justify-between items-center text-xs text-gray-500">
            <div>
              <span className="font-medium">Account:</span> {currentAdmin.email}
            </div>
            <div>
              <span className="font-medium">Total:</span> {adminNotifications.length} notifications
            </div>
          </div>
        </div>
      )}
    </div>
  );
}