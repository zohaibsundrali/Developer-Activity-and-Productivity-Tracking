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
        <div className="flex flex-col gap-4 py-4 md:flex-row md:items-center md:justify-between">

          {/* Left side - Welcome message */}
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-gray-900 sm:text-2xl break-words">
              Welcome, {user?.name || 'Developer'}!
            </h1>
            <p className="text-gray-600">
              {assignedProjects?.length || 0} Assigned Projects
            </p>
          </div>

          {/* Right side - User info + Notifications */}
          <div className="flex flex-wrap items-center gap-3 md:justify-end">

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
            <div className="flex items-center gap-3">
              <div className="text-right hidden md:block min-w-0">
                <p className="text-sm font-medium text-gray-900">{user?.name}</p>
                <p className="text-xs text-gray-500 truncate max-w-[18rem]">{user?.email}</p>
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
                  transition-colors text-sm font-medium whitespace-nowrap"
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