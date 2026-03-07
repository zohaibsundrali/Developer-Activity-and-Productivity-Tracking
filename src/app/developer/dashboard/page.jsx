"use client";
import { useEffect, useState, useRef } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  
  const [user, setUser] = useState(null);
  const [assignedProjects, setAssignedProjects] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [activeSection, setActiveSection] = useState("overview");
  const [unreadCount, setUnreadCount] = useState(0);
  const audioRef = useRef(null);

  // Notification sound setup
  useEffect(() => {
    audioRef.current = new Audio('/notification-sound.mp3');
    audioRef.current.volume = 0.5;
    
    // Cleanup
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // Play notification sound
  const playNotificationSound = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    }
  };

  // Show browser notification
  const showBrowserNotification = (notification) => {
    if (!("Notification" in window)) return;
    
    if (Notification.permission === "granted") {
      new Notification("New Notification", {
        body: notification.message,
        icon: "/favicon.ico"
      });
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then(permission => {
        if (permission === "granted") {
          new Notification("New Notification", {
            body: notification.message,
            icon: "/favicon.ico"
          });
        }
      });
    }
  };

  // Setup realtime notifications subscription
  const setupRealtimeNotifications = (developerId) => {
    const channel = supabase
      .channel(`notifications-${developerId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `assigned_developer_id=eq.${developerId}`
        },
        (payload) => {
          // Add new notification to the beginning of array
          setNotifications(prev => [payload.new, ...prev]);
          
          // Increase unread count
          setUnreadCount(prev => prev + 1);
          
          // Play sound
          playNotificationSound();
          
          // Show browser notification for project assignments
          if (payload.new.type === 'project_assigned' || payload.new.message.includes('project')) {
            showBrowserNotification(payload.new);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `assigned_developer_id=eq.${developerId}`
        },
        (payload) => {
          // Update notification if marked as read from another tab/device
          setNotifications(prev => 
            prev.map(notif => 
              notif.id === payload.new.id ? payload.new : notif
            )
          );
          
          // Update unread count
          const newUnreadCount = notifications.filter(n => !n.read).length;
          setUnreadCount(newUnreadCount);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  // Initialize user and data
  useEffect(() => {
    const authUser = checkAuth();
    if (!authUser) {
      router.push("/login");
      return;
    }
    
    setUser(authUser);
    fetchDeveloperData(authUser);
    
    // Request notification permission
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
    
    // Auto logout after 30 minutes of inactivity
    const inactivityTimeout = setTimeout(() => {
      handleLogout();
    }, 30 * 60 * 1000);

    return () => clearTimeout(inactivityTimeout);
  }, [router]);

  // Setup realtime notifications
  useEffect(() => {
    if (user?.id) {
      const cleanup = setupRealtimeNotifications(user.id);
      return cleanup;
    }
  }, [user?.id]);

  // ✅ FIXED: Update active section based on URL
  useEffect(() => {
    const updateActiveSection = () => {
      const sectionParam = searchParams.get('section');
      
      if (sectionParam) {
        setActiveSection(sectionParam);
      } else {
        // Default section based on path or default to overview
        setActiveSection('overview');
      }
    };

    updateActiveSection();
  }, [pathname, searchParams]);

  // ✅ FIXED: Handle section change with URL update
  const handleSectionChange = (section) => {
    setActiveSection(section);
    
    // Update URL without page reload
    const params = new URLSearchParams(searchParams.toString());
    params.set('section', section);
    
    // Update URL - maintain path as /developer/dashboard
    router.push(`/developer/dashboard?${params.toString()}`, { scroll: false });
  };

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
      // Silently handle error
    }
  };

  const fetchNotifications = async (developerData) => {
    try {
      const { data: notificationsData, error: notificationsError } = await supabase
        .from('notifications')
        .select('*')
        .or(`assigned_developer_id.eq.${developerData.id},message.ilike.%${developerData.name}%`)
        .order('created_at', { ascending: false })
        .limit(50);

      if (notificationsError) throw notificationsError;
      
      setNotifications(notificationsData || []);
      
      const unread = notificationsData?.filter(notif => !notif.read).length || 0;
      setUnreadCount(unread);

    } catch (error) {
      // Silently handle error
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
      // Silently handle error
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
      // Silently handle error
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

  // ✅ FIXED: Handle project details navigation
  const handleViewProjectDetails = (project) => {
    // Navigate to project details page
    router.push(`/developer/project-details?id=${project.id}&name=${encodeURIComponent(project.name)}&description=${encodeURIComponent(project.description || '')}&status=${project.status}&progress=${project.progress}&deadline=${project.deadline}&created_at=${project.created_at}&file_url=${project.file_url || ''}&file_name=${encodeURIComponent(project.file_name || '')}&assigned_at=${project.assigned_at || ''}&assigned_developer_name=${encodeURIComponent(project.assigned_developer_name || '')}&assigned_developer_email=${project.assigned_developer_email || ''}`);
  };

  const renderContent = () => {
    const contentProps = {
      user,
      assignedProjects,
      notifications,
      unreadCount,
      onMarkAsRead: handleMarkAsRead,
      onMarkAllAsRead: handleMarkAllAsRead,
      onSectionChange: handleSectionChange,
      onViewProjectDetails: handleViewProjectDetails, // Add this prop
      supabase,
      onLogout: handleLogout
    };

    // Check if we're on project-details page
    if (pathname.includes('/project-details')) {
      return <ProjectDetails />;
    }

    // Render based on active section
    switch (activeSection) {
      case "projects":
        return <MyProjects {...contentProps} />;
      case "notifications":
        return <Notifications {...contentProps} />;
      case "overview":
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
        unreadCount={unreadCount}
      />
      
      <Navigation 
        activeSection={activeSection}
        onSectionChange={handleSectionChange}
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