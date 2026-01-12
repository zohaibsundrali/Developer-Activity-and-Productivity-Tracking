// components/developer/Header.js
"use client";

export default function Header({ user, assignedProjects, onLogout, unreadCount }) {
  const navigateToNotifications = () => {
    if (typeof window !== 'undefined') {
      window.location.href = '/developer/notifications';
    }
  };

  return (
    <header className="bg-white shadow">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center py-4">
          
          {/* Left side - Welcome message */}
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Welcome, {user?.name || 'Developer'}!
            </h1>
            <p className="text-gray-600">
              {assignedProjects?.length || 0} Assigned Projects
            </p>
          </div>

          {/* Right side - User info + Notifications */}
          <div className="flex items-center space-x-4">
            
            {/* Notification Bell with Real-time Count */}
            <div className="relative group">
              <button
                onClick={navigateToNotifications}
                className="p-2 text-gray-600 hover:text-gray-900 relative hover:bg-gray-100 rounded-full transition-colors"
                title="Notifications"
              >
                <svg 
                  className="w-6 h-6" 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                    strokeWidth="2" 
                    d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" 
                  />
                </svg>
                
                {/* Live Unread Count Badge */}
                {unreadCount > 0 && (
                  <>
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs 
                      rounded-full h-5 w-5 flex items-center justify-center animate-pulse font-bold">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                    
                    {/* Pulsing effect */}
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs 
                      rounded-full h-5 w-5 flex items-center justify-center animate-ping opacity-75">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  </>
                )}
              </button>
              
              {/* Tooltip */}
              {unreadCount > 0 && (
                <div className="absolute right-0 mt-2 w-56 bg-white shadow-lg rounded-lg 
                  p-3 hidden group-hover:block z-50 border border-gray-200">
                  <div className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                    <p className="text-sm font-medium text-gray-900">
                      {unreadCount} unread notification{unreadCount > 1 ? 's' : ''}
                    </p>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Click to view all notifications
                  </p>
                </div>
              )}
              
              {/* Tooltip when no notifications */}
              {unreadCount === 0 && (
                <div className="absolute right-0 mt-2 w-48 bg-white shadow-lg rounded-lg 
                  p-2 hidden group-hover:block z-50">
                  <p className="text-sm text-gray-600">
                    No new notifications
                  </p>
                </div>
              )}
            </div>

            {/* User dropdown */}
            <div className="flex items-center space-x-3">
              <div className="text-right hidden md:block">
                <p className="text-sm font-medium text-gray-900">{user?.name}</p>
                <p className="text-xs text-gray-500">{user?.email}</p>
              </div>
              
              <div className="relative">
                <div className="w-10 h-10 bg-[#009578] rounded-full flex items-center 
                  justify-center text-white font-bold text-lg">
                  {user?.name?.charAt(0)?.toUpperCase() || 'D'}
                </div>
              </div>

              <button
                onClick={onLogout}
                className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-md 
                  transition-colors text-sm font-medium"
              >
                Logout
              </button>
            </div>
            
          </div>
        </div>
      </div>
    </header>
  );
}