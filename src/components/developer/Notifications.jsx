// components/developer/Notifications.js
"use client";
import { useState, useEffect } from "react";

export default function Notifications({ notifications, onMarkAsRead, onMarkAllAsRead, unreadCount }) {
  const [localNotifications, setLocalNotifications] = useState([]);
  const [isRealTimeActive, setIsRealTimeActive] = useState(true);

  useEffect(() => {
    setLocalNotifications(notifications);
  }, [notifications]);

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const getTimeAgo = (dateString) => {
    const now = new Date();
    const date = new Date(dateString);
    const seconds = Math.floor((now - date) / 1000);
    
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    return formatDate(dateString);
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

  // Filter notifications by type
  const projectNotifications = localNotifications.filter(notif => 
    notif.message.toLowerCase().includes('project') || 
    notif.type === 'project_assigned'
  );

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Notifications</h2>
          <p className="text-gray-600 text-sm mt-1">
            Real-time updates for projects and messages
          </p>
        </div>
        
        <div className="flex items-center space-x-4">
          {/* Real-time indicator */}
          <div className="flex items-center space-x-2">
            <div className="flex items-center">
              <div className={`w-3 h-3 rounded-full mr-2 ${isRealTimeActive ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></div>
              <span className="text-sm text-gray-600">
                {isRealTimeActive ? 'Live' : 'Offline'}
              </span>
            </div>
          </div>
          
          {/* Unread count badge */}
          <div className="bg-red-100 border border-red-200 text-red-800 px-4 py-2 rounded-lg">
            <div className="flex items-center space-x-2">
              <span className="font-bold text-lg">{unreadCount}</span>
              <span className="text-sm">unread</span>
            </div>
          </div>
          
          {unreadNotifications.length > 0 && (
            <button
              onClick={handleMarkAllAsRead}
              className="bg-[#009578] text-white px-4 py-2 rounded-md hover:bg-[#0e7762] 
                transition-colors text-sm font-medium"
            >
              Mark All as Read
            </button>
          )}
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-blue-600 font-medium">Total Notifications</p>
              <p className="text-2xl font-bold text-blue-900">{localNotifications.length}</p>
            </div>
            <div className="text-blue-500">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>
        
        <div className="bg-red-50 p-4 rounded-lg border border-red-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-red-600 font-medium">Unread</p>
              <p className="text-2xl font-bold text-red-900">{unreadNotifications.length}</p>
            </div>
            <div className="text-red-500 animate-pulse">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            </div>
          </div>
        </div>
        
        <div className="bg-green-50 p-4 rounded-lg border border-green-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-green-600 font-medium">Project Updates</p>
              <p className="text-2xl font-bold text-green-900">{projectNotifications.length}</p>
            </div>
            <div className="text-green-500">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Real-time Alert */}
      <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-l-4 border-blue-500 rounded">
        <div className="flex items-center">
          <div className="flex-shrink-0">
            <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div className="ml-3">
            <p className="text-sm text-blue-700">
              <span className="font-semibold">Real-time updates active!</span> You'll receive instant notifications when new projects are assigned or updates occur.
            </p>
          </div>
        </div>
      </div>

      {/* Unread Notifications */}
      {unreadNotifications.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <h3 className="text-lg font-semibold text-gray-900">
                New Notifications
              </h3>
              <span className="bg-red-500 text-white text-xs px-3 py-1 rounded-full font-bold animate-pulse">
                {unreadNotifications.length} NEW
              </span>
            </div>
            <span className="text-sm text-gray-500">
              Click on any notification to mark as read
            </span>
          </div>
          <div className="space-y-4">
            {unreadNotifications.map(notification => {
              const isProjectNotification = notification.message.toLowerCase().includes('project') || 
                                           notification.type === 'project_assigned';
              
              return (
                <div 
                  key={notification.id} 
                  className={`p-4 rounded-lg border-l-4 relative cursor-pointer hover:shadow-md transition-all 
                    transform hover:-translate-y-1 ${isProjectNotification ? 'border-green-500 bg-gradient-to-r from-green-50 to-white' :
                    notification.type === 'warning' ? 'border-yellow-500 bg-yellow-50' :
                    'border-blue-500 bg-blue-50'}`}
                  onClick={() => handleMarkAsRead(notification.id)}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-2">
                        {isProjectNotification && (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            🎯 Project
                          </span>
                        )}
                        <span className="text-xs text-gray-500">
                          {getTimeAgo(notification.created_at)}
                        </span>
                      </div>
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
                      className="ml-2 text-xs bg-[#009578] text-white px-3 py-1 rounded hover:bg-[#0e7762] 
                        transition-colors font-medium"
                    >
                      Mark Read
                    </button>
                  </div>
                  <div className="absolute top-3 right-3 flex items-center space-x-1">
                    <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                    <span className="text-xs text-red-500 font-medium">NEW</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Read Notifications */}
      {readNotifications.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-700">
              Earlier Notifications
            </h3>
            <span className="bg-gray-400 text-white text-xs px-2 py-1 rounded-full">
              {readNotifications.length} read
            </span>
          </div>
          <div className="space-y-4">
            {readNotifications.map(notification => {
              const isProjectNotification = notification.message.toLowerCase().includes('project') || 
                                           notification.type === 'project_assigned';
              
              return (
                <div 
                  key={notification.id} 
                  className={`p-4 rounded-lg border-l-4 opacity-90 hover:opacity-100 transition-opacity ${
                    isProjectNotification ? 'border-green-300 bg-green-25' :
                    notification.type === 'warning' ? 'border-yellow-300 bg-yellow-25' :
                    'border-blue-300 bg-blue-25'
                  }`}
                >
                  <div className="flex items-center space-x-2 mb-2">
                    {isProjectNotification && (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        🎯 Project
                      </span>
                    )}
                    <span className="text-xs text-gray-500">
                      {getTimeAgo(notification.created_at)}
                    </span>
                  </div>
                  <p className="text-gray-600">{notification.message}</p>
                  <p className="text-sm text-gray-400 mt-1">
                    {formatDate(notification.created_at)}
                  </p>
                  <div className="flex justify-between items-center mt-3">
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
              );
            })}
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
          <p className="text-gray-500 text-lg">No notifications yet</p>
          <p className="text-gray-400 text-sm mt-2">
            You'll receive notifications here when new projects are assigned or updates occur
          </p>
        </div>
      )}
    </div>
  );
}