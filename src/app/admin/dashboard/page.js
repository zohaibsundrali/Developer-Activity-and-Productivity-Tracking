"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/utils/supabaseClient";
import AppShell from "@/components/shell/AppShell";
import { adminNavFor, canAccessAdminSection, sectionTitle } from "@/components/shell/navConfig";
import NotificationDropdown from "@/components/admin/NotificationDropdown";
import DashboardOverview from "@/components/admin/DashboardOverview";
import AllProjects from "@/components/admin/AllProjects";
import AddDeveloper from "@/components/admin/AddDeveloper";
import ViewDevelopers from "@/components/admin/ViewDevelopers";
import DeveloperActivity from "@/components/admin/DeveloperActivity";
import TaskReviewPanel from "@/components/admin/TaskReviewPanel";
import ProductivityDashboard from "@/components/admin/ProductivityDashboard";
import OrganizationManagement from "@/components/admin/OrganizationManagement";
import ClientManagement from "@/components/admin/ClientManagement";
import EmployeeDirectory from "@/components/admin/EmployeeDirectory";
import TeamStats from "@/components/admin/TeamStats";
import ProjectBoard from "@/components/admin/ProjectBoard";
import AgileWorkspace from "@/components/admin/AgileWorkspace";
import ProjectViews from "@/components/admin/ProjectViews";
import ProjectOverview from "@/components/admin/ProjectOverview";
import ReportsDashboard from "@/components/admin/ReportsDashboard";
import AutomationRules from "@/components/admin/AutomationRules";
import BillingSubscription from "@/components/admin/BillingSubscription";
import SystemHealth from "@/components/admin/SystemHealth";
import { isSessionExpired, clearAdminSession } from "@/utils/sessionPolicy";
import { Skeleton } from "@/components/ui";

// Presentational only: labels the sidebar groups the nav items into. Keys are
// the same section ids the switch below uses; it changes no ordering, no
// filtering and no access rule — `adminNavFor(role)` still decides membership.
const ADMIN_NAV_GROUPS = {
  overview: "Overview",
  "all-projects": "Delivery",
  "project-hub": "Delivery",
  board: "Delivery",
  views: "Delivery",
  sprints: "Delivery",
  "task-reviews": "Delivery",
  "developer-activity": "Insights",
  reports: "Insights",
  automation: "Insights",
  "add-developer": "People",
  "view-developers": "People",
  employees: "People",
  "team-stats": "People",
  organization: "Workspace",
  clients: "Workspace",
  billing: "Workspace",
  "system-health": "Workspace",
};

const withNavGroups = (items) =>
  items.map((item) => ({ ...item, group: ADMIN_NAV_GROUPS[item.id] || "Workspace" }));

// The chrome is already on screen while the first fetch runs, so the wait
// should look like the dashboard rather than a spinner on an empty page.
function DashboardBootSkeleton() {
  return (
    <div className="min-h-screen bg-background" aria-busy="true">
      <span className="sr-only">Loading dashboard…</span>
      <div className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-sidebar-border lg:bg-sidebar" />
      <div className="flex min-h-screen flex-col lg:pl-64">
        <div className="flex h-16 items-center gap-3 border-b border-border bg-card px-4 sm:px-6">
          <Skeleton className="h-5 w-40" />
          <div className="ml-auto flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-full" />
            <Skeleton className="h-9 w-9 rounded-full" />
          </div>
        </div>
        <div className="flex-1 space-y-6 px-4 py-6 sm:px-6 lg:px-8">
          <div className="space-y-2">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-72" />
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-36 w-full rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

// Authentication check function for admin
const checkAdminAuth = () => {
  if (typeof window === 'undefined') return false;
  
  const adminUser = sessionStorage.getItem("adminUser");
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
          clearAdminSession();
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
      return <DashboardBootSkeleton />;
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeSection = searchParams?.get("section") || "overview";

  useEffect(() => {
    const authUser = checkAdminAuth();
    if (!authUser) {
      router.push("/login");
      return;
    }

    setUser(authUser);
    fetchDashboardData();

    // Set up interval to check session every minute
    const sessionCheckInterval = setInterval(() => {
      const currentUser = checkAdminAuth();
      if (!currentUser) {
        handleLogout();
      }
    }, 60000); // Check every minute

    return () => {
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

      // Multi-tenant: scope all data to this admin's organization.
      const orgId = currentUser.organization_id || null;

      // Fetch developers (org-scoped)
      let developersQuery = supabase
        .from('developers')
        .select('*')
        .order('created_at', { ascending: false });
      if (orgId) developersQuery = developersQuery.eq('organization_id', orgId);
      const { data: developersData } = await developersQuery;
      setDevelopers(developersData || []);

      // Fetch projects (org-scoped)
      let projectsQuery = supabase
        .from('projects')
        .select('*')
        .order('created_at', { ascending: false });
      if (orgId) projectsQuery = projectsQuery.eq('organization_id', orgId);
      const { data: projectsData } = await projectsQuery;
      setProjects(projectsData || []);

    } catch (error) {
      // Silently handle error
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    try { supabase.auth.signOut(); } catch {}
    if (parentLogout) {
      parentLogout();
    } else {
      clearAdminSession();
      router.push("/login");
    }
  };

  const renderContent = () => {
    if (!user) return null;

    const contentProps = {
      user,
      developers,
      projects,
      onRefresh: fetchDashboardData,
      supabase,
      onLogout: handleLogout
    };

    // Per-role guard: a section the role can't access falls back to Overview
    // (defense-in-depth — blocks access via a hand-edited ?section= URL too).
    const role = user?.membership_role || "admin";
    if (!canAccessAdminSection(activeSection, role)) {
      return <DashboardOverview {...contentProps} />;
    }

    switch (activeSection) {
      case "all-projects":
        return <AllProjects {...contentProps} />;
      case "board":
        return <ProjectBoard />;
      case "sprints":
        return <AgileWorkspace />;
      case "views":
        return <ProjectViews />;
      case "project-hub":
        return <ProjectOverview />;
      case "reports":
        return <ReportsDashboard />;
      case "automation":
        return <AutomationRules />;
      case "add-developer":
        return <AddDeveloper {...contentProps} />;
      case "developer-activity":
        return <DeveloperActivity user={user} supabase={supabase} />;
      case "view-developers":
        return <ViewDevelopers {...contentProps} />;
      case "task-reviews":
        return <TaskReviewPanel currentAdmin={user} />;
      case "employees":
        return <EmployeeDirectory />;
      case "team-stats":
        return <TeamStats />;
      case "organization":
        return <OrganizationManagement />;
      case "clients":
        return <ClientManagement />;
      case "billing":
        return <BillingSubscription />;
      case "system-health":
        return <SystemHealth />;
      case "productivity":
        return <ProductivityDashboard currentAdmin={user} />;
      default:
        return <DashboardOverview {...contentProps} />;
    }
  };

  if (loading) {
    return <DashboardBootSkeleton />;
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <p className="text-sm font-medium text-muted-foreground">Redirecting to login…</p>
      </div>
    );
  }

  const handleNavigate = (sectionId) => {
    router.push(`/admin/dashboard?section=${sectionId}`);
  };

  const role = user?.membership_role || "admin";

  return (
    <AppShell
      role="admin"
      brandName="DevTrack"
      navItems={withNavGroups(adminNavFor(role))}
      activeSection={activeSection}
      onNavigate={handleNavigate}
      user={user}
      onLogout={handleLogout}
      title={sectionTitle(activeSection, "admin")}
      subtitle={user?.full_name ? `Signed in as ${user.full_name}` : undefined}
      notificationSlot={<NotificationDropdown user={user} />}
    >
      {renderContent()}
    </AppShell>
  );
}

// Wrap with auth HOC
export default withAdminAuth(AdminDashboardContent);