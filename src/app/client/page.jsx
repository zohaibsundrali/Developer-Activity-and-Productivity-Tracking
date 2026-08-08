"use client";

import { useEffect, useState } from "react";
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
import ClientProjectDetail from "@/components/client/ClientProjectDetail";
import ClientProjectComments from "@/components/client/ClientProjectComments";
import ClientTimeline from "@/components/client/ClientTimeline";
import ClientAnnouncements from "@/components/client/ClientAnnouncements";
import ClientApprovals from "@/components/client/ClientApprovals";
import ClientInvoices from "@/components/client/ClientInvoices";
import ClientSupport from "@/components/client/ClientSupport";
import ClientAccount from "@/components/client/ClientAccount";

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
      return (
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary/30 border-t-primary" />
            <div className="text-sm font-medium text-muted-foreground">Loading…</div>
          </div>
        </div>
      );
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

  // Drive active section from ?section=
  useEffect(() => {
    const sectionParam = searchParams.get("section");
    setActiveSection(sectionParam || "overview");
  }, [pathname, searchParams]);

  // Navigate to a section (updates the URL without a reload)
  const handleSectionChange = (section) => {
    setActiveSection(section);
    const params = new URLSearchParams();
    params.set("section", section);
    router.push(`/client?${params.toString()}`, { scroll: false });
  };

  // Navigate into a project-scoped view. `section` selects which one, so the
  // activity feed and the project conversation are linkable on their own rather
  // than only reachable as a tab inside the detail screen.
  const handleViewProjectIn = (section) => (projectId) => {
    const params = new URLSearchParams();
    params.set("section", section);
    params.set("projectId", String(projectId));
    router.push(`/client?${params.toString()}`, { scroll: false });
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

  const projectId = searchParams.get("projectId");

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
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary/30 border-t-primary" />
          <div className="text-sm font-medium text-muted-foreground">Loading…</div>
        </div>
      </div>
    );
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
    >
      {renderContent()}
    </AppShell>
  );
}

export default withAuth(ClientDashboardContent);
