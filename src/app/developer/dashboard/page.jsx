"use client";
import { useEffect, useState, useRef } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { createClient } from '@supabase/supabase-js';
import Header from "@/components/developer/Header";
import Navigation from "@/components/developer/Navigation";
import DashboardOverview from "@/components/developer/DashboardOverview";
import MyProjects from "@/components/developer/MyProjects";
import ProjectDetails from "@/components/developer/ProjectDetails";
import Account from "@/components/developer/Account";
import { isSessionExpired, clearDeveloperSession, touchDeveloperSession } from "@/utils/sessionPolicy";

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

    // Sliding inactivity expiry check (7 days)
    if (isSessionExpired(userData)) {
      clearDeveloperSession();
      return false;
    }
    
    return userData;
  } catch (error) {
    clearDeveloperSession();
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
          clearDeveloperSession();
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
          // Update last activity + refresh cookies
          touchDeveloperSession(user);
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

  // Pagination state
  const [notificationPage, setNotificationPage] = useState(0);
  const [hasMoreNotifications, setHasMoreNotifications] = useState(false);
  const [isLoadingMoreNotifications, setIsLoadingMoreNotifications] = useState(false);
  const NOTIFICATIONS_PER_PAGE = 10;

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

          // Recalculate unread count from current notifications
          setNotifications(currentNotifs => {
            const updated = currentNotifs.map(notif =>
              notif.id === payload.new.id ? payload.new : notif
            );
            const newUnreadCount = updated.filter(n => !n.read).length;
            setUnreadCount(newUnreadCount);
            return updated;
          });
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

    // Ensure cookies exist for middleware + API scoping.
    try {
      touchDeveloperSession(authUser);
    } catch {
      // ignore
    }

    fetchDeveloperData(authUser);
    
    // Request notification permission
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
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

  const fetchNotifications = async (developerData, page = 0, append = false) => {
    try {
      const startRange = page * NOTIFICATIONS_PER_PAGE;
      const endRange = startRange + NOTIFICATIONS_PER_PAGE - 1;

      const { data: notificationsData, error: notificationsError } = await supabase
        .from('notifications')
        .select('*')
        .or(`assigned_developer_id.eq.${developerData.id},developer_id.eq.${developerData.id}`)
        .order('created_at', { ascending: false })
        .range(startRange, endRange + 1); // Fetch one extra to check if more exist

      if (notificationsError) throw notificationsError;

      // Check if there are more notifications
      const hasMore = notificationsData && notificationsData.length > NOTIFICATIONS_PER_PAGE;

      // Remove the extra item if it exists
      const actualNotifications = hasMore
        ? notificationsData.slice(0, NOTIFICATIONS_PER_PAGE)
        : notificationsData;

      setHasMoreNotifications(hasMore);

      if (append) {
        // Append to existing notifications (for Load More)
        setNotifications(prev => {
          const updated = [...prev, ...(actualNotifications || [])];
          // Calculate unread count from the updated list
          const unread = updated.filter(notif => !notif.read).length || 0;
          setUnreadCount(unread);
          return updated;
        });
      } else {
        // Replace notifications (for initial load)
        setNotifications(actualNotifications || []);
        // Calculate unread count from fresh data
        const unread = actualNotifications?.filter(notif => !notif.read).length || 0;
        setUnreadCount(unread);
      }

    } catch (error) {
      // Silently handle error
      console.error('Error fetching notifications:', error);
    }
  };

  // Load more notifications
  const handleLoadMoreNotifications = async () => {
    if (!user || isLoadingMoreNotifications || !hasMoreNotifications) return;

    setIsLoadingMoreNotifications(true);

    const nextPage = notificationPage + 1;
    setNotificationPage(nextPage);

    await fetchNotifications(user, nextPage, true);

    setIsLoadingMoreNotifications(false);
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

      // Optimistic update - reset count immediately for better UX
      setUnreadCount(0);
      setNotifications(prev =>
        prev.map(notif => ({ ...notif, read: true }))
      );

      // Then update database
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .in('id', unreadNotifications.map(notif => notif.id));

      if (error) {
        // Revert optimistic update on error
        console.error('Error marking all as read:', error);
        const unread = notifications.filter(notif => !notif.read).length;
        setUnreadCount(unread);
      }

    } catch (error) {
      // Silently handle error
      console.error('Error marking all as read:', error);
    }
  };

  const handleLogout = () => {
    // Clear all auth data
    localStorage.removeItem("developerUser");
    // Clear cookies bhi agar hain
    document.cookie = "developer_auth=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    document.cookie = "developer_id=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    
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
      case "account":
        return <Account user={user} />;
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
        notifications={notifications}
        onMarkAllAsRead={handleMarkAllAsRead}
        onLoadMoreNotifications={handleLoadMoreNotifications}
        hasMoreNotifications={hasMoreNotifications}
        isLoadingMoreNotifications={isLoadingMoreNotifications}
      />

      <Navigation
        activeSection={activeSection}
        onSectionChange={handleSectionChange}
        assignedProjectsCount={assignedProjects.length}
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