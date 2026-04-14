"use client";

import { useRouter, useSearchParams } from "next/navigation";

export default function Navigation({ notificationCount }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const activeSection = searchParams?.get("section") || "overview";

  const navItems = [
    { id: "overview", label: "Overview" },
    { id: "all-projects", label: "All Projects" },
    { id: "task-reviews", label: "Task Reviews" },
    { id: "productivity", label: "Productivity" },
    { id: "add-developer", label: "Add Developer" },
    { id: "developer-activity", label: "Developer Activity" },
    { id: "view-developers", label: "View Developers" }
  ];

  const handleSectionChange = (sectionId) => {
    const params = new URLSearchParams(searchParams?.toString() || "");
    params.set("section", sectionId);

    router.push(`/admin/dashboard?${params.toString()}`);
  };

  return (
    <nav className="bg-white shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex space-x-8 py-4">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => handleSectionChange(item.id)}
              className={`px-3 py-2 rounded-md text-sm font-medium relative ${
                activeSection === item.id
                  ? "bg-[#009578] text-white"
                  : "text-gray-600 hover:text-[#009578]"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}