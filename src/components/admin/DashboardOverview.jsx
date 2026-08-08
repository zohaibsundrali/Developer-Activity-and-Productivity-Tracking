import { useState, useEffect } from "react";
import { Users, FolderKanban, Bell, RefreshCw, Mail, BadgeCheck, User } from "lucide-react";
import StatCard from "@/components/shell/StatCard";
import { getOrgId } from "@/utils/orgContext";
import { setVisibleInterval } from "@/hooks/useVisibleInterval";

export default function DashboardOverview({ user, onRefresh, supabase }) {
  const [realTimeStats, setRealTimeStats] = useState({
    myDevelopers: 0,
    myProjects: 0,
    activeDevelopers: 0,
    pendingNotifications: 0
  });
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Fetch real-time data from database
  const fetchRealTimeData = async () => {
    if (!supabase || !user) return;

    try {
      setLoading(true);

      const currentAdmin = JSON.parse(sessionStorage.getItem("adminUser")) || user;
      const adminId = currentAdmin?.id;
      const adminEmail = currentAdmin?.email;

      if (!adminId && !adminEmail) return;

      const orgId = getOrgId();

      // Fetch developers added by this admin
      const orFilters = [];
      if (adminId) {
        orFilters.push(`added_by.eq.${adminId}`);
      }
      if (adminEmail) {
        orFilters.push(`added_by_admin.ilike.%${adminEmail}%`);
      }

      // These three reads exist only to produce counters, and they run every
      // 30 seconds. Fetching whole rows to call .length shipped every developer,
      // project and unread notification row to the browser on each tick; the
      // notifications one carried message bodies for a number. `head: true`
      // returns the count and no rows at all.
      let devsQuery = supabase
        .from('developers')
        .select('*', { count: 'exact', head: true })
        .or(orFilters.join(','));
      if (orgId) devsQuery = devsQuery.eq('organization_id', orgId);
      const { count: myDevsCount } = await devsQuery;

      let activeDevsQuery = supabase
        .from('developers')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active')
        .or(orFilters.join(','));
      if (orgId) activeDevsQuery = activeDevsQuery.eq('organization_id', orgId);
      const { count: activeDevsCount } = await activeDevsQuery;

      // Fetch projects created/assigned by this admin
      const projectOrFilters = [];
      if (adminId) {
        projectOrFilters.push(`created_by.eq.${adminId}`);
        projectOrFilters.push(`added_by.eq.${adminId}`);
      }
      if (adminEmail) {
        projectOrFilters.push(`added_by_admin.ilike.%${adminEmail}%`);
      }

      let projectsQuery = supabase
        .from('projects')
        .select('*', { count: 'exact', head: true })
        .or(projectOrFilters.join(','));
      if (orgId) projectsQuery = projectsQuery.eq('organization_id', orgId);
      const { count: myProjectsCount } = await projectsQuery;

      // Fetch unread notifications
      let notificationsQuery = supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('read', false)
        .or(`admin_id.eq.${adminId},admin_email.ilike.%${adminEmail}%`);
      if (orgId) notificationsQuery = notificationsQuery.eq('organization_id', orgId);
      const { count: unreadCount } = await notificationsQuery;

      // Calculate statistics
      const myDevelopers = myDevsCount || 0;
      const myProjects = myProjectsCount || 0;
      const activeDevelopers = activeDevsCount || 0;
      const pendingNotifications = unreadCount || 0;

      setRealTimeStats({
        myDevelopers,
        myProjects,
        activeDevelopers,
        pendingNotifications
      });

      setLastUpdated(new Date());
    } catch (error) {
      // Silently handle error
    } finally {
      setLoading(false);
    }
  };

  // First read, then auto-refresh every 30 seconds
  useEffect(() => {
    if (supabase && user) {
      // The count queries are the only source of these tiles, so they have to
      // run once here — the interval alone would leave every tile on zero for
      // the first 30 seconds.
      fetchRealTimeData();
    }

    // Paused while the tab is hidden: this fired three org-wide count
    // queries every 30 seconds whether or not anyone was looking.
    return setVisibleInterval(() => {
      if (supabase && user) {
        fetchRealTimeData();
      }
    }, 30000);
  }, [supabase, user]);

  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">Dashboard Overview</h2>
          <p className="text-sm text-muted-foreground">
            {lastUpdated ? `Last updated ${formatTime(lastUpdated)}` : "Your workspace at a glance"}
          </p>
        </div>
        <button
          onClick={fetchRealTimeData}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-card transition-colors hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Refreshing…" : "Refresh Stats"}
        </button>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="My Developers"
          value={realTimeStats.myDevelopers}
          icon={Users}
          tone="primary"
          badge="Assigned to you"
          hint={
            <>
              <span className="text-muted-foreground">Active</span>
              <span className="font-semibold text-success">{realTimeStats.activeDevelopers}</span>
            </>
          }
        />
        <StatCard
          title="My Projects"
          value={realTimeStats.myProjects}
          icon={FolderKanban}
          tone="info"
          badge="Your projects"
        />
        <StatCard
          title="Pending Notifications"
          value={realTimeStats.pendingNotifications}
          icon={Bell}
          tone={realTimeStats.pendingNotifications > 0 ? "destructive" : "warning"}
          badge={realTimeStats.pendingNotifications > 0 ? `${realTimeStats.pendingNotifications} new` : undefined}
          badgeTone="destructive"
          hint={
            <>
              <span className="text-muted-foreground">Require action</span>
              <span className={`font-semibold ${realTimeStats.pendingNotifications > 0 ? "text-destructive" : "text-success"}`}>
                {realTimeStats.pendingNotifications > 0 ? "Yes" : "No"}
              </span>
            </>
          }
        />
      </div>

      {/* Profile Information */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-card">
        <h3 className="mb-4 text-base font-semibold text-foreground">Profile Information</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ProfileField icon={User} label="Full Name" value={user?.full_name || user?.name || "Not specified"} />
          <ProfileField icon={Mail} label="Email" value={user?.email || "Not specified"} />
          <ProfileField icon={BadgeCheck} label="Role" value={(user?.role || "Admin")} capitalize />
        </div>
      </div>
    </div>
  );
}

function ProfileField({ icon: Icon, label, value, capitalize }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {Icon && <Icon className="h-[18px] w-[18px]" />}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`truncate text-sm font-medium text-foreground ${capitalize ? "capitalize" : ""}`}>{value}</p>
      </div>
    </div>
  );
}