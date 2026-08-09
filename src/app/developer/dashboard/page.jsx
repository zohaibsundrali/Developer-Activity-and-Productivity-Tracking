"use client";
import { useEffect, useState, useRef, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { supabase } from "@/utils/supabaseClient";
import AppShell from "@/components/shell/AppShell";
import { staffNav, sectionTitle } from "@/components/shell/navConfig";
import NotificationDropdown from "@/components/developer/NotificationDropdown";
import DashboardOverview from "@/components/developer/DashboardOverview";
import MyProjects from "@/components/developer/MyProjects";
import ProjectDetails from "@/components/developer/ProjectDetails";
import Account from "@/components/developer/Account";
import TeamPanel from "@/components/developer/TeamPanel";
import { isSessionExpired, clearDeveloperSession, touchDeveloperSession } from "@/utils/sessionPolicy";
import { Skeleton } from "@/components/ui";

/**
 * The dashboard chrome while auth or the user record resolves.
 *
 * Both gates used to render a bare spinner (and one rendered `null`), so the
 * page flashed empty before the shell appeared. This is the shell's shape:
 * a header line, a stat row, then a wide panel.
 */
function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8" aria-busy="true">
        <div className="mb-6 space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="mb-6 h-32 w-full rounded-xl" />
        <div className="mb-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    </div>
  );
}

// Authentication check karne ka function
const checkAuth = () => {
  if (typeof window === 'undefined') return false;
  
  const developerUser = sessionStorage.getItem("developerUser");
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
      return <DashboardSkeleton />;
    }

    // Redirecting — keep the shell's shape rather than flashing a blank page.
    if (!isAuthenticated) {
      return <DashboardSkeleton />;
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
  const [activeSection, setActiveSection] = useState("overview");
  const [isNavigating, startNavigation] = useTransition();
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

  // Alerting only. The bell's own list, badge and mark-read paths live in the
  // shared notification centre, which runs its own per-user subscription; what
  // does not exist anywhere else is the audible ping and the OS-level notice on
  // a new assignment, and those are the only reason this channel is still here.
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
          // Play sound
          playNotificationSound();

          // Show browser notification for project assignments
          if (payload.new.type === 'project_assigned' || payload.new.message.includes('project')) {
            showBrowserNotification(payload.new);
          }
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

  // Section change: paint the new section immediately, then catch the URL up.
  const handleSectionChange = (section) => {
    if (section === activeSection) return;
    setActiveSection(section);

    const params = new URLSearchParams(searchParams.toString());
    params.set('section', section);

    // No `scroll: false` here any more. A section is a new screen, so it should
    // open at the top; leaving the previous screen's scroll offset in place
    // dropped you into the middle of a list you had never seen. Back/forward
    // still restores the old offset — the router handles popstate itself, and
    // that is the case `scroll: false` was blunting.
    startNavigation(() => {
      router.push(`/developer/dashboard?${params.toString()}`);
    });
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

    } catch (error) {
      // Silently handle error
    }
  };

  const handleLogout = () => {
    try { supabase.auth.signOut(); } catch {}
    clearDeveloperSession();

    // Redirect to login
    router.push("/login");
  };

  // ✅ FIXED: Handle project details navigation
  const handleViewProjectDetails = (project) => {
    // Navigate to project details page
    startNavigation(() => {
      router.push(`/developer/project-details?id=${project.id}&name=${encodeURIComponent(project.name)}&description=${encodeURIComponent(project.description || '')}&status=${project.status}&progress=${project.progress}&deadline=${project.deadline}&created_at=${project.created_at}&file_url=${project.file_url || ''}&file_name=${encodeURIComponent(project.file_name || '')}&assigned_at=${project.assigned_at || ''}&assigned_developer_name=${encodeURIComponent(project.assigned_developer_name || '')}&assigned_developer_email=${project.assigned_developer_email || ''}`);
    });
  };

  const renderContent = () => {
    const contentProps = {
      user,
      assignedProjects,
      onSectionChange: handleSectionChange,
      onViewProjectDetails: handleViewProjectDetails, // Add this prop
      supabase,
      onLogout: handleLogout
    };

    // Check if we're on project-details page
    if (pathname.includes('/project-details')) {
      return <ProjectDetails />;
    }

    // Manager-only oversight section. Guard by role so a developer/employee
    // can't reach it by editing the URL (?section=team).
    const effectiveRole = user?.membership_role || "developer";
    const isManager = ["manager", "team_lead", "hr", "admin", "owner"].includes(effectiveRole);

    // Render based on active section
    switch (activeSection) {
      case "projects":
        return <MyProjects {...contentProps} />;
      case "team":
        return isManager ? <TeamPanel /> : <DashboardOverview {...contentProps} />;
      case "account":
        return <Account user={user} />;
      case "overview":
      default:
        return <DashboardOverview {...contentProps} />;
    }
  };

  if (!user) {
    return <DashboardSkeleton />;
  }

  const effectiveRole = user?.membership_role || "developer";

  return (
    <AppShell
      role={effectiveRole}
      navItems={staffNav(effectiveRole)}
      activeSection={activeSection}
      onNavigate={handleSectionChange}
      user={user}
      onLogout={handleLogout}
      title={sectionTitle(activeSection, effectiveRole)}
      subtitle={user?.name ? `Welcome back, ${user.name}` : undefined}
      navPending={isNavigating}
      notificationSlot={<NotificationDropdown user={user} />}
    >
      {renderContent()}
    </AppShell>
  );
}

// Wrap main component with auth HOC
export default withAuth(DeveloperDashboardContent);