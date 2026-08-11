"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { supabase } from "@/utils/supabaseClient";
import AppShell from "@/components/shell/AppShell";
import { CLIENT_NAV, sectionTitle } from "@/components/shell/navConfig";
import {
  getStoredClientSession,
  isSessionExpired,
  clearClientSession,
  touchClientSession,
} from "@/utils/sessionPolicy";

import ClientOverview from "@/components/client/ClientOverview";
import ClientProjects from "@/components/client/ClientProjects";
import ClientProposals from "@/components/client/ClientProposals";
import ClientProjectDetail from "@/components/client/ClientProjectDetail";
import ClientProjectComments from "@/components/client/ClientProjectComments";
import ClientTimeline from "@/components/client/ClientTimeline";
import ClientAnnouncements from "@/components/client/ClientAnnouncements";
import ClientApprovals from "@/components/client/ClientApprovals";
import ClientInvoices from "@/components/client/ClientInvoices";
import ClientSupport from "@/components/client/ClientSupport";
import ClientAccount from "@/components/client/ClientAccount";

// The one boot screen this route uses, defined once instead of twice. It is
// shown while the session is being read — before there is any content shape to
// stand in for — so it stays a labelled indicator rather than a skeleton.
function PortalBoot() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3" role="status" aria-live="polite">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary/30 border-t-primary motion-reduce:animate-none" />
        <p className="text-sm font-medium text-muted-foreground">Loading your portal…</p>
      </div>
    </div>
  );
}

// Authentication check — mirrors the developer dashboard, scoped to `clientUser`.
const checkAuth = () => {
  if (typeof window === "undefined") return false;

  const userData = getStoredClientSession();
  if (!userData) return false;

  try {
    // Sliding inactivity expiry check (7 days)
    if (isSessionExpired(userData)) {
      clearClientSession();
      return false;
    }
    return userData;
  } catch {
    clearClientSession();
    return false;
  }
};

// Auth guard HOC
const withAuth = (WrappedComponent) => {
  return (props) => {
    const router = useRouter();
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      const authCheck = () => {
        const user = checkAuth();
        if (!user) {
          clearClientSession();
          router.push("/login");
        } else {
          setIsAuthenticated(true);
          setLoading(false);
        }
      };

      authCheck();

      // Logout from another tab
      const handleStorageChange = (e) => {
        if (e.key === "clientUser" && !e.newValue) {
          router.push("/login");
        }
      };

      // Keep the session alive on navigation away
      const handleBeforeUnload = () => {
        const user = checkAuth();
        if (user) {
          touchClientSession(user);
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
      return <PortalBoot />;
    }

    if (!isAuthenticated) {
      return null; // Redirecting
    }

    return <WrappedComponent {...props} />;
  };
};

function ClientDashboardContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [user, setUser] = useState(null);
  const [activeSection, setActiveSection] = useState("overview");
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [isNavigating, startNavigation] = useTransition();

  // Initialize user + ensure cookies exist for middleware / API scoping.
  useEffect(() => {
    const authUser = checkAuth();
    if (!authUser) {
      router.push("/login");
      return;
    }
    setUser(authUser);
    try {
      touchClientSession(authUser);
    } catch {
      // ignore
    }
  }, [router]);

  // Drive active section (and the project it is scoped to) from the URL. The
  // URL stays authoritative — back/forward and pasted links have to win — but
  // both are mirrored into state so a click can move them on the same frame
  // rather than after the router has answered. They are mirrored *together*:
  // setting the section without the project id would render the picker for a
  // frame on the way into a project detail.
  useEffect(() => {
    setActiveSection(searchParams.get("section") || "overview");
    setActiveProjectId(searchParams.get("projectId"));
  }, [pathname, searchParams]);

  // Navigate to a section. The local state moves first so the sidebar and the
  // topbar title change on the click; the router then catches the URL up inside
  // a transition, which keeps the current screen visible (and gives us
  // `isNavigating` for the topbar hairline) instead of blanking it.
  //
  // The pushes below no longer pass `scroll: false`: a section is a new screen
  // and should open at the top. Back/forward still lands you where you were —
  // the router restores scroll on popstate on its own.
  const handleSectionChange = (section) => {
    if (section === activeSection && !activeProjectId) return;
    setActiveSection(section);
    setActiveProjectId(null);
    const params = new URLSearchParams();
    params.set("section", section);
    startNavigation(() => {
      router.push(`/client?${params.toString()}`);
    });
  };

  // Navigate into a project-scoped view. `section` selects which one, so the
  // activity feed and the project conversation are linkable on their own rather
  // than only reachable as a tab inside the detail screen.
  const handleViewProjectIn = (section) => (projectId) => {
    setActiveSection(section);
    setActiveProjectId(String(projectId));
    const params = new URLSearchParams();
    params.set("section", section);
    params.set("projectId", String(projectId));
    startNavigation(() => {
      router.push(`/client?${params.toString()}`);
    });
  };

  const handleViewProject = handleViewProjectIn("projects");

  const handleLogout = () => {
    try {
      supabase.auth.signOut();
    } catch {
      // ignore
    }
    clearClientSession();
    router.push("/login");
  };

  const projectId = activeProjectId;

  const renderContent = () => {
    switch (activeSection) {
      case "projects":
        if (projectId) {
          return (
            <ClientProjectDetail
              projectId={projectId}
              onBack={() => handleSectionChange("projects")}
            />
          );
        }
        return <ClientProjects onViewProject={handleViewProject} />;
      // Both project-scoped feeds need a project. Without one in the URL the
      // picker stands in, rather than rendering a view with nothing to fetch.
      case "timeline":
        if (projectId) {
          return <ClientTimeline projectId={projectId} showHeader />;
        }
        return <ClientProjects onViewProject={handleViewProjectIn("timeline")} />;
      case "comments":
        if (projectId) {
          return <ClientProjectComments projectId={projectId} showHeader />;
        }
        return <ClientProjects onViewProject={handleViewProjectIn("comments")} />;
      case "new-project":
        return <ClientProposals />;
      case "announcements":
        return <ClientAnnouncements />;
      case "approvals":
        return <ClientApprovals onViewProject={handleViewProject} />;
      case "invoices":
        return <ClientInvoices />;
      case "support":
        return <ClientSupport user={user} />;
      case "account":
        return <ClientAccount user={user} onLogout={handleLogout} />;
      case "overview":
      default:
        return (
          <ClientOverview
            user={user}
            onViewProject={handleViewProject}
            onSectionChange={handleSectionChange}
          />
        );
    }
  };

  if (!user) {
    return <PortalBoot />;
  }

  return (
    <AppShell
      role="client"
      brandName="Client Portal"
      navItems={CLIENT_NAV}
      activeSection={activeSection}
      onNavigate={handleSectionChange}
      user={user}
      onLogout={handleLogout}
      title={sectionTitle(activeSection, "client")}
      subtitle={user?.name ? `Welcome back, ${user.name}` : undefined}
      navPending={isNavigating}
    >
      {renderContent()}
    </AppShell>
  );
}

export default withAuth(ClientDashboardContent);
