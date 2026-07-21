"use client";
import { useState, useEffect, useRef } from "react";
import { Bell, FolderKanban, User, AlertTriangle, Info, ChevronDown, Loader2 } from "lucide-react";

export default function NotificationDropdown({
  notifications,
  unreadCount,
  onMarkAllAsRead,
  onOpen,
  onLoadMore,
  hasMore = false,
  isLoadingMore = false
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Format time ago
  const getTimeAgo = (dateString) => {
    const now = new Date();
    const date = new Date(dateString);
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 120) return '1 minute ago';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 7200) return '1 hour ago';
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    if (seconds < 172800) return '1 day ago';
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  };

  // Handle dropdown open
  const handleToggleDropdown = () => {
    const newIsOpen = !isOpen;
    setIsOpen(newIsOpen);

    // Mark all as read when opening if there are unread notifications
    if (newIsOpen && unreadCount > 0 && onMarkAllAsRead) {
      onMarkAllAsRead();
    }

    // Call onOpen callback if provided
    if (newIsOpen && onOpen) {
      onOpen();
    }
  };

  // Get notification icon based on type
  const getNotificationIcon = (notification) => {
    const message = notification.message.toLowerCase();

    if (message.includes('project') || notification.type === 'project_assigned') {
      return (
        <div className="flex-shrink-0 w-10 h-10 bg-success/10 rounded-full flex items-center justify-center">
          <FolderKanban className="w-5 h-5 text-success" />
        </div>
      );
    }

    if (message.includes('developer') || notification.type === 'developer_added') {
      return (
        <div className="flex-shrink-0 w-10 h-10 bg-info/10 rounded-full flex items-center justify-center">
          <User className="w-5 h-5 text-info" />
        </div>
      );
    }

    if (notification.type === 'warning') {
      return (
        <div className="flex-shrink-0 w-10 h-10 bg-warning/10 rounded-full flex items-center justify-center">
          <AlertTriangle className="w-5 h-5 text-warning" />
        </div>
      );
    }

    return (
      <div className="flex-shrink-0 w-10 h-10 bg-muted rounded-full flex items-center justify-center">
        <Info className="w-5 h-5 text-muted-foreground" />
      </div>
    );
  };

  // Show all loaded notifications (no client-side slicing)
  const displayedNotifications = notifications;

  // Handle Load More
  const handleLoadMore = () => {
    if (onLoadMore && !isLoadingMore) {
      onLoadMore();
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Notification Bell Button */}
      <button
        onClick={handleToggleDropdown}
        className="relative rounded-lg border border-border bg-card p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="Notifications"
      >
        <Bell className="w-5 h-5" />

        {/* Unread Count Badge - Only show if count > 0 */}
        {unreadCount > 0 && (
          <>
            <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-xs
              rounded-full h-5 w-5 flex items-center justify-center animate-pulse font-bold">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>

            {/* Pulsing ring effect */}
            <span className="absolute -top-1 -right-1 bg-destructive
              rounded-full h-5 w-5 animate-ping opacity-75"></span>
          </>
        )}
      </button>

      {/* Dropdown Modal */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-[min(24rem,calc(100vw-2rem))] bg-popover shadow-popover rounded-xl
          border border-border z-50 max-h-[70vh] flex flex-col"
          style={{ animation: 'slideDown 0.2s ease-out' }}
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-border bg-muted/50 rounded-t-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-foreground">Notifications</h3>
              {notifications.length > 0 && (
                <span className="text-sm text-muted-foreground">
                  {notifications.length} total
                </span>
              )}
            </div>
          </div>

          {/* Notifications List */}
          <div className="overflow-y-auto flex-1">
            {displayedNotifications.length === 0 ? (
              // Empty State
              <div className="flex flex-col items-center justify-center py-12 px-4">
                <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-3">
                  <Bell className="w-8 h-8 text-muted-foreground" />
                </div>
                <p className="text-foreground font-medium">No notifications</p>
                <p className="text-muted-foreground text-sm mt-1 text-center">
                  You're all caught up! Check back later for updates.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {displayedNotifications.map((notification) => {
                  const isUnread = !notification.read;

                  return (
                    <div
                      key={notification.id}
                      className={`px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer ${
                        isUnread ? 'bg-primary/5' : ''
                      }`}
                    >
                      <div className="flex items-start space-x-3">
                        {/* Icon */}
                        {getNotificationIcon(notification)}

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm ${isUnread ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                            {notification.message}
                          </p>
                          <p className="text-xs text-primary mt-1 font-medium">
                            {getTimeAgo(notification.created_at)}
                          </p>
                        </div>

                        {/* Unread Indicator */}
                        {isUnread && (
                          <div className="flex-shrink-0">
                            <div className="w-2 h-2 bg-primary rounded-full"></div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer - Show only if there are notifications */}
          {notifications.length > 0 && (
            <div className="px-4 py-3 border-t border-border bg-muted/50 rounded-b-xl">
              {/* Load More Button */}
              {hasMore && (
                <button
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                  className="w-full flex items-center justify-center space-x-2 text-sm font-medium
                    text-primary hover:text-primary/80 transition-colors py-2 mb-2
                    disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoadingMore ? (
                    <>
                      <Loader2 className="animate-spin h-4 w-4 text-primary" />
                      <span>Loading...</span>
                    </>
                  ) : (
                    <>
                      <span>Load More</span>
                      <ChevronDown className="w-4 h-4" />
                    </>
                  )}
                </button>
              )}

              {/* Showing count */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Showing {notifications.length} notification{notifications.length !== 1 ? 's' : ''}
                </span>
                {!hasMore && notifications.length > 0 && (
                  <span className="text-muted-foreground text-xs">
                    All loaded
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* CSS Animation */}
      <style jsx>{`
        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
