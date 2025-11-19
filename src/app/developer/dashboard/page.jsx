"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from '@supabase/supabase-js';
import Header from "@/components/developer/Header";
import Navigation from "@/components/developer/Navigation";
import DashboardOverview from "@/components/developer/DashboardOverview";
import MyProjects from "@/components/developer/MyProjects";
import Notifications from "@/components/developer/Notifications";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function DeveloperDashboard() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [assignedProjects, setAssignedProjects] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [activeSection, setActiveSection] = useState("overview");
  const [unreadCount, setUnreadCount] = useState(0);
  const router = useRouter();

  useEffect(() => {
    const developerUser = localStorage.getItem("developerUser");
    if (!developerUser) {
      router.push("/login");
      return;
    }

    const userData = JSON.parse(developerUser);
    setUser(userData);
    fetchDeveloperData(userData);
  }, [router]);

  const fetchDeveloperData = async (developerData) => {
    try {
      setLoading(true);
      
      // Fetch assigned projects
      const { data: projectsData, error: projectsError } = await supabase
        .from('projects')
        .select('*')
        .eq('assigned_developer_id', developerData.id)
        .order('created_at', { ascending: false });

      if (projectsError) throw projectsError;
      setAssignedProjects(projectsData || []);

      // Fetch notifications for this developer - FIXED QUERY
      await fetchNotifications(developerData);

    } catch (error) {
      console.error('Error fetching developer data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchNotifications = async (developerData) => {
    try {
      // Better query to get developer-specific notifications
      const { data: notificationsData, error: notificationsError } = await supabase
        .from('notifications')
        .select('*')
        .or(`assigned_developer_id.eq.${developerData.id},message.ilike.%${developerData.name}%`)
        .order('created_at', { ascending: false })
        .limit(20);

      if (notificationsError) throw notificationsError;
      
      setNotifications(notificationsData || []);
      
      // Calculate unread notifications
      const unread = notificationsData?.filter(notif => !notif.read).length || 0;
      setUnreadCount(unread);

      console.log('Developer Notifications:', notificationsData);
      console.log('Unread Count:', unread);

    } catch (error) {
      console.error('Error fetching notifications:', error);
    }
  };

  const handleMarkAsRead = async (notificationId) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', notificationId);

      if (error) throw error;

      // Update local state
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
      console.error('Error marking notification as read:', error);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      const unreadNotifications = notifications.filter(notif => !notif.read);
      
      if (unreadNotifications.length === 0) return;

      // Update all unread notifications in database
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .in('id', unreadNotifications.map(notif => notif.id));

      if (error) throw error;

      // Update local state
      setNotifications(prev => 
        prev.map(notif => ({ ...notif, read: true }))
      );

      // Reset unread count
      setUnreadCount(0);

    } catch (error) {
      console.error('Error marking all notifications as read:', error);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("developerUser");
    router.push("/login");
  };

  const renderContent = () => {
    const contentProps = {
      user,
      assignedProjects,
      notifications,
      unreadCount,
      onMarkAsRead: handleMarkAsRead,
      onMarkAllAsRead: handleMarkAllAsRead,
      onSectionChange: setActiveSection,
      supabase
    };

    switch (activeSection) {
      case "projects":
        return <MyProjects {...contentProps} />;
      case "notifications":
        return <Notifications {...contentProps} />;
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

  return (
    <div className="min-h-screen bg-gray-100">
      <Header 
        user={user} 
        assignedProjects={assignedProjects} 
        onLogout={handleLogout} 
      />
      
      <Navigation 
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        assignedProjectsCount={assignedProjects.length}
        unreadCount={unreadCount}
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