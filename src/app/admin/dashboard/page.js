"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminDashboard() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    // Check if user is logged in
    const adminUser = localStorage.getItem("adminUser");
    if (!adminUser) {
      router.push("/admin/login");
      return;
    }

    setUser(JSON.parse(adminUser));
    setLoading(false);
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem("adminUser");
    router.push("/admin/login");
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
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
              <p className="text-gray-600">Welcome back, {user?.full_name}</p>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-gray-700">{user?.company}</span>
              <button
                onClick={handleLogout}
                className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="border-4 border-dashed border-gray-200 rounded-lg h-96 p-8">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-gray-700 mb-4">
                Dashboard Overview
              </h2>
              <p className="text-gray-600">
                Welcome to your admin dashboard. Here you can manage your organization's settings and users.
              </p>
              
              <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-lg shadow">
                  <h3 className="text-lg font-semibold mb-2">Profile</h3>
                  <p className="text-gray-600">Name: {user?.full_name}</p>
                  <p className="text-gray-600">Email: {user?.email}</p>
                  <p className="text-gray-600">Company: {user?.company}</p>
                </div>
                
                <div className="bg-white p-6 rounded-lg shadow">
                  <h3 className="text-lg font-semibold mb-2">Quick Actions</h3>
                  <div className="space-y-2">
                    <button className="w-full bg-[#009578] text-white p-2 rounded hover:bg-[#0e7762]">
                      Manage Users
                    </button>
                    <button className="w-full bg-[#009578] text-white p-2 rounded hover:bg-[#0e7762]">
                      Settings
                    </button>
                  </div>
                </div>
                
                <div className="bg-white p-6 rounded-lg shadow">
                  <h3 className="text-lg font-semibold mb-2">Status</h3>
                  <p className="text-green-600">✓ Account Verified</p>
                  <p className="text-green-600">✓ Active</p>
                  <p className="text-gray-600">Role: {user?.role}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}