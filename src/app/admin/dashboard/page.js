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
  }, [router]);



  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      
      // Fetch developers
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
      const { data: notificationsData } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);
      setNotifications(notificationsData || []);

    } catch (error) {
      console.error('Error fetching data:', error);
      alert('Error loading data from database');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("adminUser");
    router.push("/admin/login");
  };

  const renderContent = () => {
    const contentProps = {
      user,
      developers,
      projects,
      notifications,
      onRefresh: fetchDashboardData,
      supabase
    };

    switch (activeSection) {
      case "all-projects":
        return <AllProjects {...contentProps} />;
      case "notifications":
        return <Notifications {...contentProps} />;
      case "add-developer":
        return <AddDeveloper {...contentProps} />;
      case "view-developers":
        return <ViewDevelopers {...contentProps} />;
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
      <Header user={user} onLogout={handleLogout} />
      <Navigation 
        activeSection={activeSection} 
        onSectionChange={setActiveSection}
        notificationCount={notifications.length}
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