"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function DeveloperDashboard() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const developerUser = localStorage.getItem("developerUser");
    if (!developerUser) {
      router.push("/login");
      return;
    }

    setUser(JSON.parse(developerUser));
    setLoading(false);
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem("developerUser");
    router.push("/login");
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
              <h1 className="text-3xl font-bold text-gray-900">Developer Dashboard</h1>
              <p className="text-gray-600">Welcome back, {user?.name}</p>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-gray-700">{user?.company}</span>
              <span className="text-gray-500">|</span>
              <span className="text-gray-600">Role: Developer</span>
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
                Developer Dashboard Overview
              </h2>
              <p className="text-gray-600">
                Welcome to your developer dashboard. Here you can view your assigned projects and track your activity.
              </p>
              
              <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto">
                <div className="bg-white p-6 rounded-lg shadow">
                  <h3 className="text-lg font-semibold mb-2">Profile</h3>
                  <p className="text-gray-600">Name: {user?.name}</p>
                  <p className="text-gray-600">Email: {user?.email}</p>
                  <p className="text-gray-600">Company: {user?.company}</p>
                </div>
                
                <div className="bg-white p-6 rounded-lg shadow">
                  <h3 className="text-lg font-semibold mb-2">Quick Actions</h3>
                  <div className="space-y-2">
                    <button className="w-full bg-[#009578] text-white p-2 rounded hover:bg-[#0e7762]">
                      View My Projects
                    </button>
                    <button className="w-full bg-[#009578] text-white p-2 rounded hover:bg-[#0e7762]">
                      Submit Activity
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}