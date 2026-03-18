"use client";
import NotificationDropdown from "./NotificationDropdown";

export default function Header({
  user,
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
        <div className="flex justify-between items-center py-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Developer Activity and Productivity Tracking
            </h1>
          </div>

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

            <span className="text-gray-700 font-medium">{user?.full_name}</span>
            <span className="text-gray-500">|</span>
            <span className="text-gray-600">{user?.company}</span>
            <button
              onClick={onLogout}
              className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}