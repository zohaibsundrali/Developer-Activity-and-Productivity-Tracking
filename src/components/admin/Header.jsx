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
        <div className="flex flex-col gap-4 py-4 sm:py-6 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-gray-900 sm:text-2xl lg:text-3xl break-words">
              Developer Activity and Productivity Tracking
            </h1>
          </div>

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

            <span className="text-gray-700 font-medium truncate max-w-[16rem] sm:max-w-[20rem]">
              {user?.full_name}
            </span>
            <span className="text-gray-500 hidden sm:inline">|</span>
            <span className="text-gray-600 truncate max-w-[16rem] hidden sm:inline">
              {user?.company}
            </span>
            <button
              onClick={onLogout}
              className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors whitespace-nowrap"
            >
              Logout
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}