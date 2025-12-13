"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from '@supabase/supabase-js';
import Header from "@/components/developer/Header";
import Navigation from "@/components/developer/Navigation";
import DashboardOverview from "@/components/developer/DashboardOverview";
import MyProjects from "@/components/developer/MyProjects";
import Notifications from "@/components/developer/Notifications";
import ProjectDetails from "@/components/developer/ProjectDetails";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Authentication check karne ka function
const checkAuth = () => {
  if (typeof window === 'undefined') return false;
  
  const developerUser = localStorage.getItem("developerUser");
  if (!developerUser) return false;

  try {
    const userData = JSON.parse(developerUser);
    
    // Session expiry check (24 hours)
    const loginTime = new Date(userData.loginTime);
    const currentTime = new Date();
    const hoursDiff = (currentTime - loginTime) / (1000 * 60 * 60);
    
    if (hoursDiff > 24) {
      localStorage.removeItem("developerUser");
      return false;
    }
    
    return userData;
  } catch (error) {
    return false;
  }
};

// Auth check ke liye HOC
const withAuth = (WrappedComponent) => {
  return (props) => {
    const router = useRouter();
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      const authCheck = () => {
        const user = checkAuth();
        if (!user) {
          // Clear any existing auth data
          localStorage.removeItem("developerUser");
          // Redirect to login
          router.push("/login");
        } else {
          setIsAuthenticated(true);
          setLoading(false);
        }
      };

      authCheck();

      // Listen for storage changes (for logout from other tabs)
      const handleStorageChange = (e) => {
        if (e.key === "developerUser" && !e.newValue) {
          router.push("/login");
        }
      };

      // Listen for beforeunload to maintain session
      const handleBeforeUnload = () => {
        const user = checkAuth();
        if (user) {
          // Update last activity time
          user.lastActivity = new Date().toISOString();
          localStorage.setItem("developerUser", JSON.stringify(user));
        }
      };

      window.addEventListener("storage", handleStorageChange);
      window.addEventListener("beforeunload", handleBeforeUnload);

      return () => {
        window.removeEventListener("storage", handleStorageChange);
        window.removeEventListener("beforeunload", handleBeforeUnload);
      };
    }, [router]);

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

    return <WrappedComponent {...props} />;
  };
};

function DeveloperDashboardContent() {
  const [user, setUser] = useState(null);
  const [assignedProjects, setAssignedProjects] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [activeSection, setActiveSection] = useState("overview");
  const [unreadCount, setUnreadCount] = useState(0);
  const router = useRouter();

  useEffect(() => {
    const authUser = checkAuth();
    if (!authUser) {
      router.push("/login");
      return;
    }
    
    setUser(authUser);
    fetchDeveloperData(authUser);
    
    // Auto logout after 30 minutes of inactivity
    const inactivityTimeout = setTimeout(() => {
      handleLogout();
    }, 30 * 60 * 1000);

    return () => clearTimeout(inactivityTimeout);
  }, [router]);

  const fetchDeveloperData = async (developerData) => {
    try {
      // Fetch assigned projects
      const { data: projectsData, error: projectsError } = await supabase
        .from('projects')
        .select('*')
        .eq('assigned_developer_id', developerData.id)
        .order('created_at', { ascending: false });

      if (projectsError) throw projectsError;
      setAssignedProjects(projectsData || []);

      // Fetch notifications
      await fetchNotifications(developerData);

    } catch (error) {
      console.error('Error fetching developer data:', error);
    }
  };

  const fetchNotifications = async (developerData) => {
    try {
      const { data: notificationsData, error: notificationsError } = await supabase
        .from('notifications')
        .select('*')
        .or(`assigned_developer_id.eq.${developerData.id},message.ilike.%${developerData.name}%`)
        .order('created_at', { ascending: false })
        .limit(20);

      if (notificationsError) throw notificationsError;
      
      setNotifications(notificationsData || []);
      
      const unread = notificationsData?.filter(notif => !notif.read).length || 0;
      setUnreadCount(unread);

    } catch (error) {
      console.error('Error fetching notifications:', error);
    }
  };

  const handleMarkAsRead = async (notificationId) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', notificationId);

      if (error) throw error;

      setNotifications(prev => 
        prev.map(notif => 
          notif.id === notificationId 
            ? { ...notif, read: true }
            : notif
        )
      );

      setUnreadCount(prev => Math.max(0, prev - 1));

    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      const unreadNotifications = notifications.filter(notif => !notif.read);
      
      if (unreadNotifications.length === 0) return;

      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .in('id', unreadNotifications.map(notif => notif.id));

      if (error) throw error;

      setNotifications(prev => 
        prev.map(notif => ({ ...notif, read: true }))
      );

      setUnreadCount(0);

    } catch (error) {
      console.error('Error marking all notifications as read:', error);
    }
  };

  const handleLogout = () => {
    // Clear all auth data
    localStorage.removeItem("developerUser");
    // Clear cookies bhi agar hain
    document.cookie = "developer_auth=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    
    // Redirect to login
    router.push("/login");
  };

  const getActiveSectionFromURL = () => {
    if (typeof window === 'undefined') return 'overview';
    
    const path = window.location.pathname;
    if (path.includes('/project-details')) return 'project-details';
    if (path.includes('/notifications')) return 'notifications';
    if (path.includes('/projects')) return 'projects';
    return 'overview';
  };

  useEffect(() => {
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
    const contentProps = {
      user,
      assignedProjects,
      notifications,
      unreadCount,
      onMarkAsRead: handleMarkAsRead,
      onMarkAllAsRead: handleMarkAllAsRead,
      onSectionChange: setActiveSection,
      supabase,
      onLogout: handleLogout // Add logout function to props
    };

    if (typeof window !== 'undefined' && window.location.pathname.includes('/project-details')) {
      return <ProjectDetails user={user} />;
    }

    switch (activeSection) {
      case "projects":
        return <MyProjects {...contentProps} />;
      case "notifications":
        return <Notifications {...contentProps} />;
      case "project-details":
        return <ProjectDetails user={user} />;
      default:
        return <DashboardOverview {...contentProps} />;
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#009578]">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <Header 
        user={user} 
        assignedProjects={assignedProjects} 
        onLogout={handleLogout} 
      />
      
      <Navigation 
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        assignedProjectsCount={assignedProjects.length}
        unreadCount={unreadCount}
      />

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="border-4 border-dashed border-gray-200 rounded-lg min-h-96 p-8">
            {renderContent()}
          </div>
        </div>
      </main>
    </div>
  );
}

// Wrap main component with auth HOC
export default withAuth(DeveloperDashboardContent);