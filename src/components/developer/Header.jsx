// components/developer/Header.js
"use client";
import NotificationDropdown from "./NotificationDropdown";

export default function Header({
  user,
  assignedProjects,
  onLogout,
  unreadCount,
  notifications,
  onMarkAllAsRead,
  onLoadMoreNotifications,
  hasMoreNotifications,
  isLoadingMoreNotifications
}) {
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

            {/* Notification Dropdown */}
            <NotificationDropdown
              notifications={notifications || []}
              unreadCount={unreadCount}
              onMarkAllAsRead={onMarkAllAsRead}
              onLoadMore={onLoadMoreNotifications}
              hasMore={hasMoreNotifications}
              isLoadingMore={isLoadingMoreNotifications}
            />

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