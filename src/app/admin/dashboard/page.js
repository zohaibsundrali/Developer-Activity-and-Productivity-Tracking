"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from '@supabase/supabase-js';
import Header from "@/components/admin/Header";
import Navigation from "@/components/admin/Navigation";
import DashboardOverview from "@/components/admin/DashboardOverview";
import AllProjects from "@/components/admin/AllProjects";
import Notifications from "@/components/admin/Notifications";
import AddDeveloper from "@/components/admin/AddDeveloper";
import ViewDevelopers from "@/components/admin/ViewDevelopers";
import DeveloperActivity from "@/components/admin/DeveloperActivity";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function AdminDashboard() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState("overview");
  const [developers, setDevelopers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const router = useRouter();

  useEffect(() => {
    const adminUser = localStorage.getItem("adminUser");
    if (!adminUser) {
      router.push("/login");
      return;
    }

    const userData = JSON.parse(adminUser);
    setUser(userData);
    fetchDashboardData();
    
    // Set up real-time subscription for notifications
    const notificationsSubscription = supabase
      .channel('notifications-changes')
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'notifications' }, 
        () => {
          fetchNotifications(); // Refresh when notifications change
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(notificationsSubscription);
    };
  }, [router]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      
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
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchNotifications = async () => {
    try {
      const currentAdmin = JSON.parse(localStorage.getItem("adminUser"));
      
      if (!currentAdmin) {
        setNotifications([]);
        setUnreadCount(0);
        return;
      }

      // Fetch notifications for current admin only
      const { data: notificationsData, error } = await supabase
        .from('notifications')
        .select('*')
        .or(`admin_id.eq.${currentAdmin.id},admin_email.ilike.%${currentAdmin.email}%`)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setNotifications(notificationsData || []);
      
      // Calculate unread count for current admin
      const unread = notificationsData?.filter(notif => !notif.read).length || 0;
      setUnreadCount(unread);
      
      console.log("📊 Dashboard: Unread count updated to", unread);

    } catch (error) {
      console.error('Error fetching notifications:', error);
    }
  };

  const handleMarkAsRead = async (notificationId) => {
    try {
      console.log("📝 Marking notification as read:", notificationId);
      
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

      // Update unread count (decrease by 1)
      setUnreadCount(prev => Math.max(0, prev - 1));

      // Refresh to ensure sync
      setTimeout(fetchNotifications, 300);

    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("adminUser");
    router.push("/login");
  };

  const renderContent = () => {
    switch (activeSection) {
      case "all-projects":
        return <AllProjects 
          user={user} 
          developers={developers}
          projects={projects}
          notifications={notifications}
          onRefresh={fetchDashboardData}
          supabase={supabase}
        />;
      case "notifications":
        return (
          <Notifications 
            notifications={notifications}
            onMarkAsRead={handleMarkAsRead}
            unreadCount={unreadCount}
            supabase={supabase}
            user={user}
          />
        );
      case "add-developer":
        return <AddDeveloper 
          user={user}
          developers={developers}
          projects={projects}
          notifications={notifications}
          onRefresh={fetchDashboardData}
          supabase={supabase}
        />;
      case "developer-activity":
        return <DeveloperActivity />; // No props needed, it fetches internally
      case "view-developers":
        return <ViewDevelopers 
          developers={developers}
          onRefresh={fetchDashboardData}
          supabase={supabase}
          user={user}
        />;
      default:
        return <DashboardOverview 
          user={user}
          developers={developers}
          projects={projects}
          notifications={notifications}
          onRefresh={fetchDashboardData}
          supabase={supabase}
        />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#009578]">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <Header user={user} onLogout={handleLogout} />
      <Navigation 
        activeSection={activeSection} 
        onSectionChange={setActiveSection}
        notificationCount={unreadCount} // This should now work correctly
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