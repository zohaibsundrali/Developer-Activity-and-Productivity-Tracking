export default function Navigation({ activeSection, onSectionChange, notificationCount }) {
  const navItems = [
    { id: "overview", label: "Overview" },
    { id: "all-projects", label: "All Projects" },
    { id: "task-reviews", label: "Task Reviews" },
    { id: "productivity", label: "Productivity" },
    { id: "deadline-monitor", label: "Deadline Monitor" },
    { id: "notifications", label: "Notifications" },
    { id: "add-developer", label: "Add Developer" },
    { id: "developer-activity", label: "Developer Activity" },
    { id: "view-developers", label: "View Developers" }
  ];

  return (
    <nav className="bg-white shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex space-x-8 py-4">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => onSectionChange(item.id)}
              className={`px-3 py-2 rounded-md text-sm font-medium relative ${
                activeSection === item.id
                  ? "bg-[#009578] text-white"
                  : "text-gray-600 hover:text-[#009578]"
              }`}
            >
              {item.label}
              {item.id === "notifications" && notificationCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {notificationCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}