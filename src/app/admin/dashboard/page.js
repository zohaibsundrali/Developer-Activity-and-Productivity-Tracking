"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/utils/supabaseClient";
import AppShell from "@/components/shell/AppShell";
import { adminNavFor, canAccessAdminSection, canEnterAdminArea, sectionTitle } from "@/components/shell/navConfig";
import NotificationDropdown from "@/components/admin/NotificationDropdown";
import DashboardOverview from "@/components/admin/DashboardOverview";
import AllProjects from "@/components/admin/AllProjects";
import ProjectRequests from "@/components/admin/ProjectRequests";
import ChangeRequests from "@/components/admin/ChangeRequests";
import BugQueue from "@/components/admin/BugQueue";
import DeveloperActivity from "@/components/admin/DeveloperActivity";
import TaskReviewPanel from "@/components/admin/TaskReviewPanel";
import ProductivityDashboard from "@/components/admin/ProductivityDashboard";
import OrganizationManagement from "@/components/admin/OrganizationManagement";
import ClientManagement from "@/components/admin/ClientManagement";
import EmployeeDirectory from "@/components/admin/EmployeeDirectory";
import ProjectHierarchy from "@/components/admin/ProjectHierarchy";
import TeamCapacity from "@/components/admin/TeamCapacity";
import TeamStats from "@/components/admin/TeamStats";
import ProjectBoard from "@/components/admin/ProjectBoard";
import AgileWorkspace from "@/components/admin/AgileWorkspace";
import ProjectViews from "@/components/admin/ProjectViews";
import ProjectOverview from "@/components/admin/ProjectOverview";
import ReportsDashboard from "@/components/admin/ReportsDashboard";
import AutomationRules from "@/components/admin/AutomationRules";
import BillingSubscription from "@/components/admin/BillingSubscription";
import SystemHealth from "@/components/admin/SystemHealth";
import PermissionsPanel from "@/components/admin/PermissionsPanel";
import AdminAccount from "@/components/admin/AdminAccount";
import { isSessionExpired, clearAdminSession, clearDeveloperSession } from "@/utils/sessionPolicy";
import { Skeleton } from "@/components/ui";
// The app's one dialog pattern (sweetalert2, wrapped). No second toast library.
import { showSuccess } from "@/utils/alerts";

// Written by src/app/admin/registration/page.js the moment an organization is
// created, and — verified across src/, tests/, e2e/ and middleware.ts — read
// by nothing else in the codebase. Its presence in sessionStorage therefore
// means exactly one thing: "this browser session began by completing signup",
// which is the signal the welcome needs. A plain login never writes it, so a
// returning admin never sees the message.
//
// It is deliberately NOT removed here. It is somebody else's key and it looks
// like an auth token; the once-only guard is our own separate marker below.
const SIGNUP_MARKER_KEY = "adminToken";
const WELCOME_SHOWN_KEY = "devtrack.orgWelcomeShown";

// Sections that have moved. "Add Developer" and "View Developers" were their
// own screens; both are Employees now. Bookmarks, an old notification's deep
// link and the button on Developer Activity all still point at the old ids,
// and a section id with nowhere to go falls through to Overview — which reads
// as "the button is broken" rather than "that screen moved".
const LEGACY_SECTIONS = {
  "add-developer": "employees",
  "view-developers": "employees",
};

const resolveSection = (id) => LEGACY_SECTIONS[id] || id || "overview";

// Presentational only: labels the sidebar groups the nav items into. Keys are
// the same section ids the switch below uses; it changes no ordering, no
// filtering and no access rule — `adminNavFor(role)` still decides membership.
const ADMIN_NAV_GROUPS = {
  overview: "Overview",
  "all-projects": "Delivery",
  requests: "Delivery",
  "change-requests": "Delivery",
  bugs: "Delivery",
  "project-hub": "Delivery",
  board: "Delivery",
  views: "Delivery",
  sprints: "Delivery",
  "task-reviews": "Delivery",
  "developer-activity": "Insights",
  reports: "Insights",
  automation: "Insights",
  employees: "People",
  hierarchy: "People",
  capacity: "People",
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

/**
 * Whose session may render this shell.
 *
 * IT USED TO READ `adminUser` AND NOTHING ELSE, and require `role === 'admin'`.
 *
 * That is correct for an owner or an admin, whose profile row is in
 * `admin_users`. It is wrong for everybody else the admin shell is built for:
 * `userTypeForRole` files a project manager, a team lead, an HR user, a QA and
 * a finance user in `developers`, so their session is stored under
 * `developerUser` with `role: "developer"`. All five were bounced straight back
 * to /login — and the old code called `clearAdminSession()` on the way, which
 * clears the shared server cookie, so the bounce logged them out of the staff
 * dashboard they were legitimately using.
 *
 * ADMITTING THEM HERE GRANTS NOTHING. This decides which shell paints. Which
 * SECTIONS it paints is `canAccessAdminSection(section, role)` further down;
 * which requests succeed is `getAuthedOrg` against a verified JWT; which rows
 * come back is RLS. This is the fourth of four gates and the only cosmetic one.
 */
const readAdminShellSession = () => {
  if (typeof window === 'undefined') return false;

  // Admin first: somebody holding both should be their higher self.
  const candidates = [
    ['adminUser', sessionStorage.getItem("adminUser")],
    ['developerUser', sessionStorage.getItem("developerUser")],
  ];

  for (const [key, raw] of candidates) {
    if (!raw) continue;
    let userData;
    try {
      userData = JSON.parse(raw);
    } catch {
      continue;
    }

    // An expired session is cleared wherever it was found. Note that only the
    // MATCHING store is cleared — wiping a developer session because an admin
    // one had gone stale is how somebody loses a dashboard they were using.
    if (isSessionExpired(userData)) {
      if (key === 'adminUser') clearAdminSession();
      else clearDeveloperSession();
      continue;
    }

    if (userData.role === 'admin' || canEnterAdminArea(userData.membership_role)) {
      return userData;
    }
  }

  return false;
};

// Higher Order Component for Admin Auth
const withAdminAuth = (WrappedComponent) => {
  return (props) => {
    const router = useRouter();
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      const authCheck = () => {
        const user = readAdminShellSession();
        if (!user) {
          // No clear() here. readAdminShellSession already cleared anything it
          // found expired; reaching this line means the stored session is
          // valid and simply not for this shell, and wiping it would sign the
          // person out of the dashboard they DO belong on.
          router.push("/login?redirect=" + encodeURIComponent(window.location.pathname));
        } else {
          setIsAuthenticated(true);
          setLoading(false);
        }
      };

      authCheck();

      // Listen for storage changes
      const handleStorageChange = (e) => {
        // Either store — a manager's session lives under `developerUser`, so
        // watching only `adminUser` would leave their tab open after a
        // sign-out in another one.
        if ((e.key === "adminUser" || e.key === "developerUser") && !e.newValue) {
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
  const sectionParam = resolveSection(searchParams?.get("section"));

  // The URL is still the source of truth — back/forward, a pasted ?section=
  // link and the notification centre's deep links all have to win — but the
  // sidebar reads this mirror, which the click sets on the same frame. Reading
  // `searchParams` directly meant the highlight, the topbar title and the
  // content all waited for the router round-trip before anything moved, which
  // is what made a section switch feel like a page load.
  const [activeSection, setActiveSection] = useState(sectionParam);
  const [isNavigating, startNavigation] = useTransition();

  useEffect(() => {
    setActiveSection(sectionParam);
  }, [sectionParam]);

  useEffect(() => {
    const authUser = readAdminShellSession();
    if (!authUser) {
      router.push("/login");
      return;
    }

    setUser(authUser);
    fetchDashboardData({ initial: true });

    // Set up interval to check session every minute
    const sessionCheckInterval = setInterval(() => {
      const currentUser = readAdminShellSession();
      if (!currentUser) {
        handleLogout();
      }
    }, 60000); // Check every minute

    return () => {
      clearInterval(sessionCheckInterval);
    };
  }, [router]);

  // "Organization created" confirmation, shown the first time the admin portal
  // is reached after signup and never again.
  //
  // Two guards, both required. The signup marker is sessionStorage-scoped and
  // only signup writes it, so a later login in a fresh tab cannot trigger this.
  // Our own WELCOME_SHOWN_KEY then makes it once *per* signup, so reloading
  // /admin/dashboard or switching sections does not re-fire it — sessionStorage
  // survives a reload, which `useEffect([])` alone would not.
  //
  // Presentation only: reads two flags, fetches nothing, decides nothing.
  useEffect(() => {
    if (!user) return;

    let firstArrival = false;
    try {
      firstArrival =
        sessionStorage.getItem(SIGNUP_MARKER_KEY) === "admin-authenticated" &&
        !sessionStorage.getItem(WELCOME_SHOWN_KEY);
      // Marked before showing, so a double-invoked effect (React StrictMode in
      // development) still produces exactly one dialog.
      if (firstArrival) sessionStorage.setItem(WELCOME_SHOWN_KEY, "1");
    } catch {
      return; /* storage unavailable — skip the welcome rather than guess */
    }
    if (!firstArrival) return;

    const orgName = user?.organization_name;
    showSuccess(
      "Organization created",
      orgName
        ? `${orgName} is ready. Your workspace is set up — add your team and projects whenever you like.`
        : "Your organization is ready. Add your team and projects whenever you like."
    );
  }, [user]);

  // `initial` is the *first* load, the only one that has nothing to show yet.
  // Every later call is a refresh triggered from inside a section (after adding
  // a developer, say), and those used to flip `loading` back on — which swapped
  // the whole shell out for the boot skeleton, tearing down the sidebar, the
  // topbar and the command palette and reading exactly like a page reload. The
  // queries below are unchanged; only the teardown is gone.
  const fetchDashboardData = async ({ initial = false } = {}) => {
    try {
      if (initial) setLoading(true);

      // Verify user is still authenticated
      const currentUser = readAdminShellSession();
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
      if (initial) setLoading(false);
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
      // Wrapped rather than passed raw: children call this from click handlers,
      // and a DOM event landing in the options argument must not be able to
      // look like `{ initial: true }`.
      onRefresh: () => fetchDashboardData(),
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
      case "requests":
        return <ProjectRequests />;
      case "change-requests":
        return <ChangeRequests />;
      case "bugs":
        return <BugQueue />;
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
      case "developer-activity":
        return <DeveloperActivity user={user} supabase={supabase} />;
      case "task-reviews":
        return <TaskReviewPanel currentAdmin={user} />;
      case "employees":
        return <EmployeeDirectory />;
      case "hierarchy":
        return <ProjectHierarchy />;
      case "capacity":
        return <TeamCapacity />;
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
      case "permissions":
        return <PermissionsPanel />;
      case "account":
        return <AdminAccount user={user} />;
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
    // Re-clicking the section you are already on would still cost a router
    // round-trip and a re-render for no visible change.
    if (sectionId === activeSection) return;
    // Paint first…
    setActiveSection(sectionId);
    // …then let the router catch the URL up. In a transition, so React keeps
    // the current screen on-screen and hands us `isNavigating` for the topbar
    // hairline instead of blanking the page.
    startNavigation(() => {
      router.push(`/admin/dashboard?section=${sectionId}`);
    });
  };

  const role = user?.membership_role || "admin";

  return (
    <AppShell
      role="admin"
      navItems={withNavGroups(adminNavFor(role))}
      activeSection={activeSection}
      onNavigate={handleNavigate}
      user={user}
      onLogout={handleLogout}
      // Still passed, no longer rendered: the Topbar no longer echoes the
      // section title, because the screen's own <h1> already says it and that
      // <h1> is the canonical one. The "Signed in as …" subtitle is gone
      // outright — the name and email are in the topbar account menu.
      title={sectionTitle(activeSection, "admin")}
      navPending={isNavigating}
      notificationSlot={<NotificationDropdown user={user} />}
    >
      {renderContent()}
    </AppShell>
  );
}

// Wrap with auth HOC
export default withAdminAuth(AdminDashboardContent);