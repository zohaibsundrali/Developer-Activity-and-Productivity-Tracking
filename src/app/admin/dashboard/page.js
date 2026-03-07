"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from '@supabase/supabase-js';
import Header from "@/components/admin/Header";
import Navigation from "@/components/admin/Navigation";
import DashboardOverview from "@/components/admin/DashboardOverview";
import AllProjects from "@/components/admin/AllProjects";
import Notifications from "@/components/admin/Notifications";
import AddDeveloper from "@/components/admin/AddDeveloper";
import ViewDevelopers from "@/components/admin/ViewDevelopers";
import DeveloperActivity from "@/components/admin/DeveloperActivity";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Authentication check function for admin
const checkAdminAuth = () => {
  if (typeof window === 'undefined') return false;
  
  const adminUser = localStorage.getItem("adminUser");
  if (!adminUser) return false;

  try {
    const userData = JSON.parse(adminUser);
    
    // Verify it's actually an admin
    if (userData.role !== 'admin') {
      localStorage.removeItem("adminUser");
      return false;
    }
    
    // Session expiry check (24 hours)
    const loginTime = new Date(userData.loginTime);
    const currentTime = new Date();
    const hoursDiff = (currentTime - loginTime) / (1000 * 60 * 60);
    
    if (hoursDiff > 24) {
      localStorage.removeItem("adminUser");
      document.cookie = "admin_auth=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
      return false;
    }
    
    return userData;
  } catch (error) {
    return false;
  }
};

// Higher Order Component for Admin Auth
const withAdminAuth = (WrappedComponent) => {
  return (props) => {
    const router = useRouter();
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      const authCheck = () => {
        const user = checkAdminAuth();
        if (!user) {
          // Clear any existing auth data
          localStorage.removeItem("adminUser");
          document.cookie = "admin_auth=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
          // Redirect to login
          router.push("/login?redirect=" + encodeURIComponent(window.location.pathname));
        } else {
          setIsAuthenticated(true);
          setLoading(false);
        }
      };

      authCheck();

      // Listen for storage changes
      const handleStorageChange = (e) => {
        if (e.key === "adminUser" && !e.newValue) {
          router.push("/login");
        }
      };

      // Auto logout after inactivity
      let inactivityTimer;
      const resetInactivityTimer = () => {
        clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => {
          handleLogout();
        }, 30 * 60 * 1000); // 30 minutes
      };

      // Event listeners for activity
      const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
      
      activityEvents.forEach(event => {
        window.addEventListener(event, resetInactivityTimer);
      });

      resetInactivityTimer(); // Start timer

      window.addEventListener("storage", handleStorageChange);

      return () => {
        clearTimeout(inactivityTimer);
        activityEvents.forEach(event => {
          window.removeEventListener(event, resetInactivityTimer);
        });
        window.removeEventListener("storage", handleStorageChange);
      };
    }, [router]);

    const handleLogout = () => {
      localStorage.removeItem("adminUser");
      document.cookie = "admin_auth=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
      router.push("/login");
    };

    if (loading) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-[#009578]">
          <div className="text-white text-xl">Loading...</div>
        </div>
      );
    }

    if (!isAuthenticated) {
      return null; // Will redirect in useEffect
    }

    return <WrappedComponent {...props} onLogout={handleLogout} />;
  };
};

function AdminDashboardContent({ onLogout: parentLogout }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState("overview");
  const [developers, setDevelopers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const router = useRouter();

  useEffect(() => {
    const authUser = checkAdminAuth();
    if (!authUser) {
      router.push("/login");
      return;
    }

    setUser(authUser);
    fetchDashboardData();
    
    // Set up real-time subscription for notifications
    const notificationsSubscription = supabase
      .channel('notifications-changes')
      .on('postgres_changes', 
        { 
          event: '*', 
          schema: 'public', 
          table: 'notifications',
          filter: `admin_id=eq.${authUser.id}` // Only listen for current admin's notifications
        }, 
        (payload) => {
          fetchNotifications();
        }
      )
      .subscribe();

    // Set up interval to check session every minute
    const sessionCheckInterval = setInterval(() => {
      const currentUser = checkAdminAuth();
      if (!currentUser) {
        handleLogout();
      }
    }, 60000); // Check every minute

    return () => {
      supabase.removeChannel(notificationsSubscription);
      clearInterval(sessionCheckInterval);
    };
  }, [router]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      
      // Verify user is still authenticated
      const currentUser = checkAdminAuth();
      if (!currentUser) {
        handleLogout();
        return;
      }

      // Fetch all developers
      const { data: developersData } = await supabase
        .from('developers')
        .select('*')
        .order('created_at', { ascending: false });
      setDevelopers(developersData || []);

      // Fetch projects
      const { data: projectsData } = await supabase
        .from('projects')
        .select('*')
        .order('created_at', { ascending: false });
      setProjects(projectsData || []);

      // Fetch notifications
      await fetchNotifications();

    } catch (error) {
      // Silently handle error
    } finally {
      setLoading(false);
    }
  };

  const fetchNotifications = async () => {
    try {
      const currentAdmin = checkAdminAuth();
      
      if (!currentAdmin) {
        handleLogout();
        return;
      }

      // Fetch notifications for current admin only
      const { data: notificationsData, error } = await supabase
        .from('notifications')
        .select('*')
        .or(`admin_id.eq.${currentAdmin.id},admin_email.ilike.%${currentAdmin.email}%`)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setNotifications(notificationsData || []);
      
      // Calculate unread count for current admin
      const unread = notificationsData?.filter(notif => !notif.read).length || 0;
      setUnreadCount(unread);
      
    } catch (error) {
      // Silently handle error
    }
  };

  const handleMarkAsRead = async (notificationId) => {
    try {
      // Verify user is authenticated
      const currentUser = checkAdminAuth();
      if (!currentUser) {
        handleLogout();
        return;
      }
      
      const { error } = await supabase
        .from('notifications')
        .update({ 
          read: true, 
          read_at: new Date().toISOString() 
        })
        .eq('id', notificationId);

      if (error) throw error;

      // Optimistically update local state
      setNotifications(prev => 
        prev.map(notif => 
          notif.id === notificationId 
            ? { ...notif, read: true }
            : notif
        )
      );

      // Update unread count
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (error) {
      // Silently handle error
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      const currentUser = checkAdminAuth();
      if (!currentUser) {
        handleLogout();
        return;
      }
      
      // Get unread notification IDs for current admin
      const unreadIds = notifications
        .filter(notif => !notif.read)
        .map(notif => notif.id);

      if (unreadIds.length === 0) return;
      


      const { error } = await supabase
        .from('notifications')
        .update({ 
          read: true, 
          read_at: new Date().toISOString() 
        })
        .in('id', unreadIds);

      if (error) throw error;

      // Optimistically update all notifications
      setNotifications(prev => 
        prev.map(notif => ({ ...notif, read: true }))
      );

      // Set unread count to 0
      setUnreadCount(0);
    } catch (error) {
      // Silently handle error
    }
  };

  // Function to handle unread count change from Notifications component
  const handleUnreadCountChange = (updater) => {
    if (typeof updater === 'function') {
      setUnreadCount(updater);
    } else {
      setUnreadCount(updater);
    }
  };

  const handleLogout = () => {
    if (parentLogout) {
      parentLogout();
    } else {
      localStorage.removeItem("adminUser");
      document.cookie = "admin_auth=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
      router.push("/login");
    }
  };

  // Check URL for active section
  useEffect(() => {
    const getActiveSectionFromURL = () => {
      if (typeof window === 'undefined') return 'overview';
      
      const path = window.location.pathname;
      if (path.includes('/admin/all-projects')) return 'all-projects';
      if (path.includes('/admin/notifications')) return 'notifications';
      if (path.includes('/admin/add-developer')) return 'add-developer';
      if (path.includes('/admin/view-developers')) return 'view-developers';
      if (path.includes('/admin/developer-activity')) return 'developer-activity';
      return 'overview';
    };

    const handleRouteChange = () => {
      const section = getActiveSectionFromURL();
      setActiveSection(section);
    };

    handleRouteChange();

    window.addEventListener('popstate', handleRouteChange);

    return () => {
      window.removeEventListener('popstate', handleRouteChange);
    };
  }, []);

  const renderContent = () => {
    if (!user) return null;

    const contentProps = {
      user,
      developers,
      projects,
      notifications,
      onRefresh: fetchDashboardData,
      supabase,
      onMarkAsRead: handleMarkAsRead,
      onLogout: handleLogout
    };

    switch (activeSection) {
      case "all-projects":
        return <AllProjects {...contentProps} />;
      case "notifications":
        return (
          <Notifications 
            notifications={notifications}
            onMarkAsRead={handleMarkAsRead}
            unreadCount={unreadCount}
            onUnreadCountChange={handleUnreadCountChange} // ✅ IMPORTANT: Add this prop
            supabase={supabase}
            user={user}
          />
        );
      case "add-developer":
        return <AddDeveloper {...contentProps} />;
      case "developer-activity":
        return <DeveloperActivity user={user} supabase={supabase} />;
      case "view-developers":
        return <ViewDevelopers {...contentProps} />;
      default:
        return <DashboardOverview {...contentProps} />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#009578]">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#009578]">
        <div className="text-white text-xl">Redirecting to login...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <Header user={user} onLogout={handleLogout} />
      <Navigation 
        activeSection={activeSection} 
        onSectionChange={setActiveSection}
        notificationCount={unreadCount}
      />
      
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="border-4 border-dashed border-gray-200 rounded-lg min-h-96 p-8">
            {renderContent()}
          </div>
        </div>
      </main>
      
      {/* Debug info (remove in production) */}
      {process.env.NODE_ENV === 'development' && (
        <div className="fixed bottom-4 right-4 bg-black bg-opacity-80 text-white p-3 rounded text-xs">
          <div>Unread Count: {unreadCount}</div>
          <div>Total Notifications: {notifications.length}</div>
          <div>Unread Notifications: {notifications.filter(n => !n.read).length}</div>
        </div>
      )}
    </div>
  );
}

// Wrap with auth HOC
export default withAdminAuth(AdminDashboardContent);