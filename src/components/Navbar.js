'use client';

import { useState, useEffect, useRef } from 'react';
import { isSessionExpired, clearAdminSession, clearDeveloperSession } from '@/utils/sessionPolicy';

const navItems = [
  { name: 'Overview', href: '/' }
];

// User types
const USER_TYPES = {
  DEVELOPER: 'developer',
  ADMIN: 'admin'
};

// Storage keys - MATCHING YOUR LOGIN PAGE
const STORAGE_KEYS = {
  ADMIN: 'adminUser',        // Your login page uses this
  DEVELOPER: 'developerUser' // Your login page uses this
};

export default function Navbar() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [userRole, setUserRole] = useState(null);
  const profileMenuRef = useRef(null);

  // FIXED: Enhanced authentication check with better debugging
  const checkAuthStatus = () => {
    try {
      const adminDataStr = localStorage.getItem(STORAGE_KEYS.ADMIN);
      const developerDataStr = localStorage.getItem(STORAGE_KEYS.DEVELOPER);
      
      if (adminDataStr) {
        try {
          const adminData = JSON.parse(adminDataStr);
          
          if (adminData && typeof adminData === 'object') {
            if (isSessionExpired(adminData)) {
              clearAdminSession();
              setIsLoggedIn(false);
              setUser(null);
              setUserRole(null);
              return;
            }
            setIsLoggedIn(true);
            setUser(adminData);
            setUserRole(USER_TYPES.ADMIN);
          } else {
            clearAuthData();
          }
        } catch (parseError) {
          clearAuthData();
        }
      } 
      else if (developerDataStr) {
        try {
          const developerData = JSON.parse(developerDataStr);
          
          if (developerData && typeof developerData === 'object') {
            if (isSessionExpired(developerData)) {
              clearDeveloperSession();
              setIsLoggedIn(false);
              setUser(null);
              setUserRole(null);
              return;
            }
            setIsLoggedIn(true);
            setUser(developerData);
            setUserRole(USER_TYPES.DEVELOPER);
          } else {
            clearAuthData();
          }
        } catch (parseError) {
          clearAuthData();
        }
      } 
      else {
        setIsLoggedIn(false);
        setUser(null);
        setUserRole(null);
      }
    } catch (error) {
      clearAuthData();
    } finally {
      setIsLoading(false);
    }
  };

  // Use effect for initial check and event listeners
  useEffect(() => {
    // Initial check
    checkAuthStatus();
    
    // Listen for custom auth events
    const handleAuthChange = () => {
      checkAuthStatus();
    };

    const handleStorageChange = (e) => {
      if (e.key === STORAGE_KEYS.ADMIN || e.key === STORAGE_KEYS.DEVELOPER) {
        checkAuthStatus();
      }
    };

    // Add event listeners
    window.addEventListener('auth-change', handleAuthChange);
    window.addEventListener('storage', handleStorageChange);
    
    // Close profile menu when clicking outside
    const handleClickOutside = (event) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
        setIsProfileMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    
    return () => {
      window.removeEventListener('auth-change', handleAuthChange);
      window.removeEventListener('storage', handleStorageChange);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Debug function to manually check auth
  const debugAuth = () => {
    // Debug helper - no-op in production
  };

  // Clear auth data
  const clearAuthData = () => {
    localStorage.removeItem(STORAGE_KEYS.ADMIN);
    localStorage.removeItem(STORAGE_KEYS.DEVELOPER);
    
    // Clear cookies
    document.cookie = "admin_auth=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    document.cookie = "developer_auth=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    document.cookie = "admin_id=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    document.cookie = "developer_id=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    
    setIsLoggedIn(false);
    setUser(null);
    setUserRole(null);
  };

  // Handle logout
  const handleLogout = () => {
    clearAuthData();
    setIsProfileMenuOpen(false);
    setIsMenuOpen(false);
    
    // Dispatch auth change event for other components
    window.dispatchEvent(new Event('auth-change'));
    
    window.location.href = '/';
  };

  // ✅ FIXED: Dynamic Dashboard Navigation
  const navigateToDashboard = (e) => {
    if (e) {
      e.preventDefault();
    }
    
    if (userRole === USER_TYPES.ADMIN) {
      window.location.href = '/admin/dashboard';
    } else if (userRole === USER_TYPES.DEVELOPER) {
      window.location.href = '/developer/dashboard';
    } else {
      window.location.href = '/login';
    }
  };

  // Get user initials for avatar
  const getUserInitials = () => {
    if (!user) return 'U';
    
    if (userRole === USER_TYPES.ADMIN && user.full_name) {
      const nameParts = user.full_name.trim().split(' ');
      if (nameParts.length > 1) {
        return `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}`.toUpperCase();
      }
      return user.full_name[0].toUpperCase();
    }
    
    if (user.name) {
      const nameParts = user.name.trim().split(' ');
      if (nameParts.length > 1) {
        return `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}`.toUpperCase();
      }
      return user.name[0].toUpperCase();
    }
    
    if (user.email) {
      return user.email[0].toUpperCase();
    }
    
    return 'U';
  };

  // Get user display name
  const getUserDisplayName = () => {
    if (!user) return 'User';
    
    if (userRole === USER_TYPES.ADMIN && user.full_name) {
      return user.full_name;
    }
    
    if (user.name) return user.name;
    if (user.username) return user.username;
    if (user.email) return user.email.split('@')[0];
    
    return 'User';
  };

  // Get user email
  const getUserEmail = () => {
    if (!user) return 'user@example.com';
    
    if (user.email) return user.email;
    if (userRole === USER_TYPES.ADMIN) return 'admin@example.com';
    return 'developer@example.com';
  };

  // Get user role display text
  const getUserRoleText = () => {
    if (!userRole) return 'Guest';
    
    if (userRole === USER_TYPES.ADMIN) return 'Administrator';
    if (userRole === USER_TYPES.DEVELOPER) return 'Developer';
    
    return 'User';
  };

  // ✅ FIXED: Get user-specific navigation items with dynamic dashboard
  const getUserNavItems = () => {
    const baseItems = [...navItems];
    
    // Add Dashboard link with proper href based on user role
    if (userRole === USER_TYPES.ADMIN) {
      baseItems.push(
        { name: 'Dashboard', href: '/admin/dashboard' },
       
      );
    } else if (userRole === USER_TYPES.DEVELOPER) {
      baseItems.push(
        { name: 'Dashboard', href: '/developer/dashboard' }
      );
    }
    
    return baseItems;
  };

  // ✅ FIXED: Navigation item click handler
  const handleNavItemClick = (href, e) => {
    if (href === '/admin/dashboard' || href === '/dashboard' || href === '/developer/dashboard') {
      e.preventDefault();
      navigateToDashboard(e);
    } else {
      window.location.href = href;
    }
  };

  // ✅ FIXED: Dynamic Dashboard button for profile dropdown
  const DashboardButton = () => (
    <button
      onClick={(e) => navigateToDashboard(e)}
      className="flex items-center w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
    >
      <svg className="w-4 h-4 mr-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
      Dashboard
    </button>
  );

  // Render auth buttons based on login state
  const renderAuthButtons = () => {
    if (isLoading) {
      return (
        <div className="flex items-center space-x-4">
          <div className="w-24 h-10 bg-gray-200 animate-pulse rounded"></div>
        </div>
      );
    }

    if (isLoggedIn && user) {
      // User is logged in - show user profile dropdown
      return (
        <div className="relative" ref={profileMenuRef}>
          <button
            onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
            className="flex items-center space-x-3 focus:outline-none hover:opacity-90 transition-opacity"
            aria-label="User profile menu"
          >
            {/* User Avatar */}
            <div className="w-10 h-10 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold shadow-sm">
              {getUserInitials()}
            </div>
            
            {/* User Info */}
            <div className="hidden lg:flex flex-col items-start">
              <span className="text-sm font-medium text-gray-700">
                {getUserDisplayName()}
              </span>
              <span className="text-xs text-gray-500">
                {getUserRoleText()}
              </span>
            </div>
            
            {/* Dropdown Chevron */}
            <svg 
              className={`w-4 h-4 text-gray-500 transition-transform ${isProfileMenuOpen ? 'rotate-180' : ''}`}
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Profile Dropdown Menu */}
          {isProfileMenuOpen && (
            <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-medium text-gray-700 truncate">{getUserDisplayName()}</p>
                <p className="text-xs text-gray-500 truncate">{getUserEmail()}</p>
                <div className="flex items-center mt-1">
                  <span className={`text-xs font-medium px-2 py-1 rounded ${
                    userRole === USER_TYPES.ADMIN 
                      ? 'bg-purple-100 text-purple-800' 
                      : 'bg-blue-100 text-blue-800'
                  }`}>
                    {getUserRoleText()}
                  </span>
                </div>
              </div>
              
              {/* ✅ FIXED: Dynamic Dashboard Button */}
              <DashboardButton />
              
              <button
                onClick={handleLogout}
                className="flex items-center w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-gray-50"
              >
                <svg className="w-4 h-4 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Logout
              </button>
            </div>
          )}
        </div>
      );
    } else {
      return (
        <>
          <a
            href="/login"
            className="px-5 py-2 text-gray-700 hover:text-blue-600 font-medium transition-colors text-sm border border-gray-300 rounded-lg hover:border-blue-500"
          >
            Sign In
          </a>
          <a
            href="/admin/registration"
            className="px-5 py-2 bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors text-sm rounded-lg shadow-sm"
          >
            Sign Up
          </a>
        </>
      );
    }
  };

  // Mobile Menu Component
  const MobileMenu = () => {
    if (!isMenuOpen) return null;

    const currentNavItems = isLoggedIn && user ? getUserNavItems() : navItems;

    return (
      <div className="md:hidden bg-white border-t border-gray-100 mt-4">
        <div className="py-3 space-y-1">
          {currentNavItems.map((item) => (
            <button
              key={item.name}
              onClick={(e) => handleNavItemClick(item.href, e)}
              className="block w-full text-left px-4 py-2 text-gray-700 hover:text-blue-600 hover:bg-gray-50 text-sm font-medium"
            >
              {item.name}
            </button>
          ))}
          
          <div className="border-t border-gray-100 pt-2 mt-2 px-4">
            {!(isLoggedIn && user) ? (
              <>
                <a
                  href="/login"
                  className="block py-2 text-gray-700 hover:text-blue-600 text-sm font-medium"
                  onClick={() => setIsMenuOpen(false)}
                >
                  Sign In
                </a>
                <a
                  href="/admin/registration"
                  className="block py-2 bg-blue-600 text-white text-center rounded-lg text-sm font-medium mt-2 hover:bg-blue-700"
                  onClick={() => setIsMenuOpen(false)}
                >
                  Sign Up
                </a>
              </>
            ) : (
              <>
                <div className="flex items-center space-x-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold">
                    {getUserInitials()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-700">{getUserDisplayName()}</p>
                    <p className="text-xs text-gray-500">{getUserRoleText()}</p>
                  </div>
                </div>
                
                {/* ✅ FIXED: Mobile Dashboard Button */}
                <button
                  onClick={(e) => {
                    navigateToDashboard(e);
                    setIsMenuOpen(false);
                  }}
                  className="flex items-center w-full text-left px-4 py-2 text-gray-700 hover:text-blue-600 hover:bg-gray-50 text-sm font-medium"
                >
                  <svg className="w-4 h-4 mr-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  Dashboard
                </button>
                
                <button
                  onClick={handleLogout}
                  className="w-full text-left flex items-center px-4 py-2 text-red-600 hover:text-red-700 text-sm font-medium mt-2"
                >
                  <svg className="w-4 h-4 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Logout
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Show loading state briefly
  if (isLoading) {
    return (
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-100 shadow-sm">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="text-lg text-gray-700 font-bold">
              Loading...
            </div>
          </div>
        </div>
      </nav>
    );
  }

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-100 shadow-sm">
      <div className="container mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          
          <div className="flex items-center space-x-3">
            <div>
              <p className="text-lg text-gray-700 font-bold">
                Developer Activity & Productivity Tracking
              </p>
            </div>
          </div>

          <div className="hidden md:flex items-center space-x-12">
            <div className="flex items-center space-x-8">
              {(isLoggedIn && user ? getUserNavItems() : navItems).map((item) => (
                <button
                  key={item.name}
                  onClick={(e) => handleNavItemClick(item.href, e)}
                  className="text-gray-700 hover:text-blue-600 font-bold transition-colors duration-200 text-sm tracking-wide"
                >
                  {item.name}
                </button>
              ))}
            </div>

            <div className="flex items-center space-x-4">
              {renderAuthButtons()}
            </div>
          </div>

          <button
            className="md:hidden p-2 rounded-md text-gray-700 hover:text-blue-600"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            aria-label="Toggle menu"
          >
            {isMenuOpen ? (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>

        <MobileMenu />
      </div>
    </nav>
  );
}