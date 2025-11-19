"use client";
import { useState, useEffect } from "react";

export default function Notifications({ notifications, onMarkAsRead, onMarkAllAsRead, unreadCount }) {
  const [localNotifications, setLocalNotifications] = useState([]);

  useEffect(() => {
    setLocalNotifications(notifications);
  }, [notifications]);

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleMarkAsRead = (notificationId) => {
    // Update local state
    setLocalNotifications(prev => 
      prev.map(notif => 
        notif.id === notificationId 
          ? { ...notif, read: true }
          : notif
      )
    );

    // Call parent function to update in database
    if (onMarkAsRead) {
      onMarkAsRead(notificationId);
    }
  };

  const handleMarkAllAsRead = () => {
    // Update local state
    setLocalNotifications(prev => 
      prev.map(notif => ({ ...notif, read: true }))
    );

    // Call parent function to update all in database
    if (onMarkAllAsRead) {
      onMarkAllAsRead();
    }
  };

  const unreadNotifications = localNotifications.filter(notif => !notif.read);
  const readNotifications = localNotifications.filter(notif => notif.read);

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Notifications</h2>
        {unreadNotifications.length > 0 && (
          <button
            onClick={handleMarkAllAsRead}
            className="bg-[#009578] text-white px-4 py-2 rounded-md hover:bg-[#0e7762] transition-colors text-sm"
          >
            Mark All as Read ({unreadNotifications.length})
          </button>
        )}
      </div>

      {/* Unread Notifications */}
      {unreadNotifications.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-700">
              New Notifications
            </h3>
            <span className="bg-red-500 text-white text-xs px-2 py-1 rounded-full">
              {unreadNotifications.length} unread
            </span>
          </div>
          <div className="space-y-4">
            {unreadNotifications.map(notification => (
              <div 
                key={notification.id} 
                className={`p-4 rounded-lg border-l-4 relative cursor-pointer hover:shadow-md transition-shadow ${
                  notification.type === 'success' ? 'border-green-500 bg-green-50' :
                  notification.type === 'warning' ? 'border-yellow-500 bg-yellow-50' :
                  'border-blue-500 bg-blue-50'
                }`}
                onClick={() => handleMarkAsRead(notification.id)}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <p className="text-gray-800 font-medium">{notification.message}</p>
                    <p className="text-sm text-gray-500 mt-1">
                      {formatDate(notification.created_at)}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMarkAsRead(notification.id);
                    }}
                    className="ml-2 text-xs bg-[#009578] text-white px-3 py-1 rounded hover:bg-[#0e7762] transition-colors"
                  >
                    Mark Read
                  </button>
                </div>
                <div className="absolute top-3 right-3 w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Read Notifications */}
      {readNotifications.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-500">
              Earlier Notifications
            </h3>
            <span className="bg-gray-400 text-white text-xs px-2 py-1 rounded-full">
              {readNotifications.length} read
            </span>
          </div>
          <div className="space-y-4">
            {readNotifications.map(notification => (
              <div 
                key={notification.id} 
                className={`p-4 rounded-lg border-l-4 opacity-80 ${
                  notification.type === 'success' ? 'border-green-300 bg-green-25' :
                  notification.type === 'warning' ? 'border-yellow-300 bg-yellow-25' :
                  'border-blue-300 bg-blue-25'
                }`}
              >
                <p className="text-gray-600">{notification.message}</p>
                <p className="text-sm text-gray-400 mt-1">
                  {formatDate(notification.created_at)}
                </p>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-xs text-green-600 bg-green-100 px-2 py-1 rounded">
                    ✓ Read
                  </span>
                  <button
                    onClick={() => handleMarkAsRead(notification.id)}
                    className="text-xs text-gray-500 hover:text-gray-700"
                    disabled
                  >
                    Already Read
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {localNotifications.length === 0 && (
        <div className="text-center py-12">
          <div className="text-gray-400 mb-4">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          </div>
          <p className="text-gray-500 text-lg">No notifications found</p>
          <p className="text-gray-400 text-sm mt-2">You're all caught up!</p>
        </div>
      )}
    </div>
  );
}