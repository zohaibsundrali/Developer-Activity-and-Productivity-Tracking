import { useState, useEffect } from "react";
import { Users, FolderKanban, Bell, RefreshCw, Mail, BadgeCheck, User } from "lucide-react";
import StatCard from "@/components/shell/StatCard";

export default function DashboardOverview({ user, developers, projects, notifications, onRefresh, supabase }) {
  const [realTimeStats, setRealTimeStats] = useState({
    myDevelopers: 0,
    myProjects: 0,
    activeDevelopers: 0,
    pendingNotifications: 0
  });
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    if (user && developers && projects && notifications) {
      calculateRealTimeStats();
    }
  }, [user, developers, projects, notifications]);

  const calculateRealTimeStats = () => {
    try {
      // Get current admin from localStorage (more reliable)
      const currentAdmin = JSON.parse(sessionStorage.getItem("adminUser")) || user;
      const adminId = currentAdmin?.id;
      const adminEmail = currentAdmin?.email;

      if (!adminId && !adminEmail) return;

      // 1. Count developers added by this admin
      const myDevelopers = developers.filter(dev => {
        const addedByIdMatch = adminId && dev.added_by === adminId;
        const addedByEmailMatch = adminEmail && dev.added_by_admin && dev.added_by_admin.toLowerCase() === adminEmail.toLowerCase();
        return addedByIdMatch || addedByEmailMatch;
      }).length;

      // 2. Count projects created/assigned by this admin
      //    Based on projects table schema: created_by, added_by, added_by_admin
      const myProjects = projects.filter(project => {
        const createdByMatch = adminId && project.created_by === adminId;
        const addedByIdMatch = adminId && project.added_by === adminId;
        const addedByEmailMatch = adminEmail && project.added_by_admin && project.added_by_admin.toLowerCase() === adminEmail.toLowerCase();
        return createdByMatch || addedByIdMatch || addedByEmailMatch;
      }).length;

      // 3. Count active developers added by this admin
      const activeDevelopers = developers.filter(dev => {
        const addedByIdMatch = adminId && dev.added_by === adminId;
        const addedByEmailMatch = adminEmail && dev.added_by_admin && dev.added_by_admin.toLowerCase() === adminEmail.toLowerCase();
        const isMyDeveloper = addedByIdMatch || addedByEmailMatch;
        return isMyDeveloper && dev.status === 'active';
      }).length;

      // 4. Count unread notifications for this admin
      const pendingNotifications = notifications.filter(notif => {
        return !notif.read &&
          (notif.admin_id === adminId ||
            notif.admin_email === adminEmail);
      }).length;

      setRealTimeStats({
        myDevelopers,
        myProjects,
        activeDevelopers,
        pendingNotifications
      });

      setLastUpdated(new Date());
    } catch (error) {
      // Silently handle error
    }
  };

  // Fetch real-time data from database
  const fetchRealTimeData = async () => {
    if (!supabase || !user) return;

    try {
      setLoading(true);

      const currentAdmin = JSON.parse(sessionStorage.getItem("adminUser")) || user;
      const adminId = currentAdmin?.id;
      const adminEmail = currentAdmin?.email;

      if (!adminId && !adminEmail) return;

      // Fetch developers added by this admin
      const orFilters = [];
      if (adminId) {
        orFilters.push(`added_by.eq.${adminId}`);
      }
      if (adminEmail) {
        orFilters.push(`added_by_admin.ilike.%${adminEmail}%`);
      }

      const { data: myDevsData } = await supabase
        .from('developers')
        .select('*')
        .or(orFilters.join(','));

      // Fetch projects created/assigned by this admin
      const projectOrFilters = [];
      if (adminId) {
        projectOrFilters.push(`created_by.eq.${adminId}`);
        projectOrFilters.push(`added_by.eq.${adminId}`);
      }
      if (adminEmail) {
        projectOrFilters.push(`added_by_admin.ilike.%${adminEmail}%`);
      }

      const { data: myProjectsData } = await supabase
        .from('projects')
        .select('*')
        .or(projectOrFilters.join(','));

      // Fetch unread notifications
      const { data: unreadNotifications } = await supabase
        .from('notifications')
        .select('*')
        .eq('read', false)
        .or(`admin_id.eq.${adminId},admin_email.ilike.%${adminEmail}%`);

      // Calculate statistics
      const myDevelopers = myDevsData?.length || 0;
      const myProjects = myProjectsData?.length || 0;
      const activeDevelopers = myDevsData?.filter(dev => dev.status === 'active').length || 0;
      const pendingNotifications = unreadNotifications?.length || 0;

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

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (supabase && user) {
        fetchRealTimeData();
      }
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
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