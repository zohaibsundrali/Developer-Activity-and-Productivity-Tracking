"use client";

export default function Navigation({
  activeSection,
  onSectionChange,
  assignedProjectsCount
}) {
  
  const navItems = [
    { id: "overview", label: "Dashboard", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" },
    { id: "projects", label: "My Projects", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" },
    { id: "account", label: "Account", icon: "M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0z" },
  ];

  const handleNavigation = (section) => {
    onSectionChange(section);
  };

  return (
    <nav className="bg-white shadow-sm mb-2.5">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between">
          <div className="-mx-4 px-4 sm:mx-0 sm:px-0 flex-1">
            <div className="flex gap-2 py-3 sm:py-4 sm:gap-4 lg:gap-6 overflow-x-auto whitespace-nowrap">
            {navItems.map((item) => {
              const isActive = activeSection === item.id;
              
              return (
                <button
                  key={item.id}
                  onClick={() => handleNavigation(item.id)}
                  className={`px-3 py-2 rounded-md text-sm font-medium relative whitespace-nowrap flex-shrink-0 flex items-center transition-colors ${
                    isActive
                      ? "bg-[#009578] text-white"
                      : "text-gray-600 hover:text-[#009578]"
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
                </button>
              );
            })}
            </div>
          </div>
          
          {/* Real-time indicator */}
          <div className="flex items-center">
            <div className="flex items-center space-x-2 text-sm text-gray-500">
              <div className="flex items-center">
                {/* <div className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></div> */}
                {/* <span>Live updates active</span> */}
              </div>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}