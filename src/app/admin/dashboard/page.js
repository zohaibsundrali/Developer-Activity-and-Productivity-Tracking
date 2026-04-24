"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from '@supabase/supabase-js';
import Header from "@/components/admin/Header";
import Navigation from "@/components/admin/Navigation";
import DashboardOverview from "@/components/admin/DashboardOverview";
import AllProjects from "@/components/admin/AllProjects";
import AddDeveloper from "@/components/admin/AddDeveloper";
import ViewDevelopers from "@/components/admin/ViewDevelopers";
import DeveloperActivity from "@/components/admin/DeveloperActivity";
import TaskReviewPanel from "@/components/admin/TaskReviewPanel";
import ProductivityDashboard from "@/components/admin/ProductivityDashboard";
import { isSessionExpired, clearAdminSession } from "@/utils/sessionPolicy";

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
      clearAdminSession();
      return false;
    }
    
    // Session expiry check (7 days)
    if (isSessionExpired(userData)) {
      clearAdminSession();
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
      window.addEventListener("storage", handleStorageChange);

      return () => {
        window.removeEventListener("storage", handleStorageChange);
      };
    }, [router]);

    const handleLogout = () => {
      clearAdminSession();
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
  const [developers, setDevelopers] =  useState([]);
  const [projects, setProjects] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeSection = searchParams?.get("section") || "overview";

  // Pagination state for notifications
  const [notificationPage, setNotificationPage] = useState(0);
  const [hasMoreNotifications, setHasMoreNotifications] = useState(false);
  const [isLoadingMoreNotifications, setIsLoadingMoreNotifications] = useState(false);
  const NOTIFICATIONS_PER_PAGE = 10;

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
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `admin_id=eq.${authUser.id}`
        },
        (payload) => {
          // Add new notification to beginning of array
          setNotifications(prev => [payload.new, ...prev]);

          // Increase unread count if new notification is unread
          if (!payload.new.read) {
            setUnreadCount(prev => prev + 1);
          }
        }
      )
      .on('postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `admin_id=eq.${authUser.id}`
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

  const fetchNotifications = async (page = 0, append = false) => {
    try {
      const currentAdmin = checkAdminAuth();

      if (!currentAdmin) {
        handleLogout();
        return;
      }

      const startRange = page * NOTIFICATIONS_PER_PAGE;
      const endRange = startRange + NOTIFICATIONS_PER_PAGE - 1;

      // Fetch notifications for current admin only with pagination
      const { data: notificationsData, error } = await supabase
        .from('notifications')
        .select('*')
        .or(`admin_id.eq.${currentAdmin.id},admin_email.ilike.%${currentAdmin.email}%`)
        .order('created_at', { ascending: false })
        .range(startRange, endRange + 1); // Fetch one extra to check if more exist

      if (error) throw error;

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

    await fetchNotifications(nextPage, true);

    setIsLoadingMoreNotifications(false);
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

      // Get unread notifications for current admin
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
      console.error('Error marking all as read:', error);
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
      case "add-developer":
        return <AddDeveloper {...contentProps} />;
      case "developer-activity":
        return <DeveloperActivity user={user} supabase={supabase} />;
      case "view-developers":
        return <ViewDevelopers {...contentProps} />;
      case "task-reviews":
        return <TaskReviewPanel currentAdmin={user} />;
      case "productivity":
        return <ProductivityDashboard currentAdmin={user} />;
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
      <Header
        user={user}
        onLogout={handleLogout}
        unreadCount={unreadCount}
        notifications={notifications}
        onMarkAllAsRead={handleMarkAllAsRead}
        onLoadMoreNotifications={handleLoadMoreNotifications}
        hasMoreNotifications={hasMoreNotifications}
        isLoadingMoreNotifications={isLoadingMoreNotifications}
      />
      <Navigation
        notificationCount={unreadCount}
      />
      
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="border-4 border-dashed border-gray-200 rounded-lg min-h-96 p-4 sm:p-6 lg:p-8">
            {renderContent()}
          </div>
        </div>
      </main>
    </div>
  );
}

// Wrap with auth HOC
export default withAdminAuth(AdminDashboardContent);