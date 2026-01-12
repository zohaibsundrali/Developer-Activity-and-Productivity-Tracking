"use client";

export default function Navigation({ 
  activeSection, 
  onSectionChange, 
  assignedProjectsCount,
  unreadCount 
}) {
  
  const navItems = [
    { id: "overview", label: "Dashboard", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
    { id: "projects", label: "My Projects", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
    { id: "notifications", label: "Notifications", icon: "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" },
  ];

  const handleNavigation = (section) => {
    onSectionChange(section);
  };

  const getBadgeCount = (section) => {
    if (section === "projects") return assignedProjectsCount;
    if (section === "notifications") return unreadCount;
    return null;
  };

  return (
    <nav className="bg-white shadow">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between">
          <div className="flex space-x-8">
            {navItems.map((item) => {
              const badgeCount = getBadgeCount(item.id);
              const isActive = activeSection === item.id;
              
              return (
                <button
                  key={item.id}
                  onClick={() => handleNavigation(item.id)}
                  className={`flex items-center px-1 py-4 text-sm font-medium border-b-2 transition-colors ${
                    isActive
                      ? 'border-[#009578] text-[#009578]'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <svg
                    className="w-5 h-5 mr-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={item.icon} />
                  </svg>
                  {item.label}
                  
                  {/* Badge for counts */}
                  {badgeCount > 0 && (
                    <span className={`ml-2 px-2 py-1 text-xs rounded-full font-bold ${
                      item.id === 'notifications' 
                        ? 'bg-red-500 text-white animate-pulse' 
                        : 'bg-[#009578] text-white'
                    }`}>
                      {badgeCount > 99 ? '99+' : badgeCount}
                    </span>
                  )}
                  
                  {/* Dot indicator for notifications */}
                  {item.id === 'notifications' && unreadCount > 0 && (
                    <span className="ml-1 w-2 h-2 bg-red-500 rounded-full animate-ping"></span>
                  )}
                </button>
              );
            })}
          </div>
          
          {/* Real-time indicator */}
          <div className="flex items-center">
            <div className="flex items-center space-x-2 text-sm text-gray-500">
              <div className="flex items-center">
                <div className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></div>
                <span>Live updates active</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}