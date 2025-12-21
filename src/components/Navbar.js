'use client';

import { useState, useEffect, useRef } from 'react';

const navItems = [
  { name: 'Overview', href: '/' },
  { name: 'Product Tour', href: '/product-tour' },
  { name: 'Desktop', href: '/time-tracking-desktop-application' },
  { name: 'Help', href: '#help' },
];

// User types
const USER_TYPES = {
  DEVELOPER: 'developer',
  ADMIN: 'admin'
};

// Storage keys
const STORAGE_KEYS = {
  TOKEN: 'auth_token',
  USER: 'user_data'
};

export default function Navbar() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const profileMenuRef = useRef(null);

  // Improved user authentication check
  useEffect(() => {
    const checkAuthStatus = () => {
      try {
        setIsLoading(true);
        console.log('Checking auth status...');
        
        const token = localStorage.getItem(STORAGE_KEYS.TOKEN);
        const userDataStr = localStorage.getItem(STORAGE_KEYS.USER);
        
        console.log('Token exists:', !!token);
        console.log('User data exists:', !!userDataStr);
        
        if (token && userDataStr) {
          try {
            const userData = JSON.parse(userDataStr);
            console.log('Parsed user data:', userData);
            
            if (userData && typeof userData === 'object') {
              setIsLoggedIn(true);
              setUser(userData);
              console.log('User logged in:', userData.email || userData.name);
            } else {
              console.log('Invalid user data format');
              clearAuthData();
            }
          } catch (parseError) {
            console.error('Error parsing user data:', parseError);
            clearAuthData();
          }
        } else {
          console.log('No auth data found');
          setIsLoggedIn(false);
          setUser(null);
        }
      } catch (error) {
        console.error('Auth check error:', error);
        clearAuthData();
      } finally {
        setIsLoading(false);
      }
    };

    // Initial check
    checkAuthStatus();
    
    // Listen for custom auth events (trigger this from your login component)
    const handleAuthChange = () => {
      console.log('Auth change event received');
      checkAuthStatus();
    };

    // Listen for storage changes
    const handleStorageChange = (e) => {
      if (e.key === STORAGE_KEYS.TOKEN || e.key === STORAGE_KEYS.USER) {
        console.log('Storage changed for key:', e.key);
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
    
    // Polling for auth changes (optional, for debugging)
    const intervalId = setInterval(checkAuthStatus, 5000);
    
    return () => {
      window.removeEventListener('auth-change', handleAuthChange);
      window.removeEventListener('storage', handleStorageChange);
      document.removeEventListener('mousedown', handleClickOutside);
      clearInterval(intervalId);
    };
  }, []);

  // Clear auth data
  const clearAuthData = () => {
    localStorage.removeItem(STORAGE_KEYS.TOKEN);
    localStorage.removeItem(STORAGE_KEYS.USER);
    setIsLoggedIn(false);
    setUser(null);
  };

  // Handle logout
  const handleLogout = () => {
    console.log('Logging out...');
    clearAuthData();
    setIsProfileMenuOpen(false);
    setIsMenuOpen(false);
    
    // Dispatch auth change event
    window.dispatchEvent(new Event('auth-change'));
    
    // Redirect to home page
    window.location.href = '/';
  };

  // Get user initials for avatar
  const getUserInitials = () => {
    if (!user) return 'U';
    
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
    
    if (user.username) {
      return user.username[0].toUpperCase();
    }
    
    return 'U';
  };

  // Get user display name
  const getUserDisplayName = () => {
    if (!user) return 'User';
    
    if (user.name) return user.name;
    if (user.username) return user.username;
    if (user.email) return user.email.split('@')[0];
    
    return 'User';
  };

  // Get user role display text
  const getUserRoleText = () => {
    if (!user) return '';
    
    if (user.role === USER_TYPES.ADMIN) return 'Administrator';
    if (user.role === USER_TYPES.DEVELOPER) return 'Developer';
    if (user.role) return user.role.charAt(0).toUpperCase() + user.role.slice(1);
    
    return 'User';
  };

  // Get user-specific navigation items
  const getUserNavItems = () => {
    const baseItems = [...navItems];
    
    if (user?.role === USER_TYPES.ADMIN) {
      // Add admin-specific items
      baseItems.push(
        { name: 'Admin Panel', href: '/admin/dashboard' },
        { name: 'Users', href: '/admin/users' }
      );
    } else if (user?.role === USER_TYPES.DEVELOPER) {
      // Add developer-specific items
      baseItems.push(
        { name: 'My Dashboard', href: '/dashboard' },
        { name: 'Reports', href: '/reports' }
      );
    }
    
    return baseItems;
  };

  // Debug function to check localStorage
  const debugAuth = () => {
    console.log('=== DEBUG AUTH ===');
    console.log('Token:', localStorage.getItem(STORAGE_KEYS.TOKEN));
    console.log('User Data:', localStorage.getItem(STORAGE_KEYS.USER));
    console.log('State - isLoggedIn:', isLoggedIn);
    console.log('State - user:', user);
    console.log('==================');
  };

  // Mobile Menu Component
  const MobileMenu = () => {
    if (!isMenuOpen) return null;

    const currentNavItems = isLoggedIn ? getUserNavItems() : navItems;

    return (
      <div className="md:hidden bg-white border-t border-gray-100 mt-4">
        <div className="py-3 space-y-1">
          
          {/* Navigation Items */}
          {currentNavItems.map((item) => (
            <a
              key={item.name}
              href={item.href}
              className="block px-4 py-2 text-gray-700 hover:text-blue-600 hover:bg-gray-50 text-sm font-medium"
              onClick={() => setIsMenuOpen(false)}
            >
              {item.name}
            </a>
          ))}
          
          {/* Separator */}
          <div className="border-t border-gray-100 pt-2 mt-2 px-4">
            {!isLoggedIn ? (
              // Show Sign In/Sign Up for logged out users
              <>
                <a
                  href="/login"
                  className="block py-2 text-gray-700 hover:text-blue-600 text-sm font-medium"
                  onClick={() => setIsMenuOpen(false)}
                >
                  Sign In
                </a>
                
                <a
                  href="/register"
                  className="block py-2 bg-blue-600 text-white text-center rounded-lg text-sm font-medium mt-2 hover:bg-blue-700"
                  onClick={() => setIsMenuOpen(false)}
                >
                  Sign Up
                </a>
              </>
            ) : (
              // Show user info and logout for logged in users
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
                
                <a
                  href="/dashboard"
                  className="flex items-center px-4 py-2 text-gray-700 hover:text-blue-600 hover:bg-gray-50 text-sm font-medium"
                  onClick={() => setIsMenuOpen(false)}
                >
                  <svg className="w-4 h-4 mr-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  Dashboard
                </a>
                
                <a
                  href="/profile"
                  className="block py-2 text-gray-700 hover:text-blue-600 text-sm font-medium"
                  onClick={() => setIsMenuOpen(false)}
                >
                  My Profile
                </a>
                
                <a
                  href="/settings"
                  className="block py-2 text-gray-700 hover:text-blue-600 text-sm font-medium"
                  onClick={() => setIsMenuOpen(false)}
                >
                  Settings
                </a>
                
                {user?.role === USER_TYPES.ADMIN && (
                  <a
                    href="/admin/dashboard"
                    className="block py-2 text-gray-700 hover:text-blue-600 text-sm font-medium"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Admin Dashboard
                  </a>
                )}
                
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
      {/* Debug button (remove in production) */}
      <button 
        onClick={debugAuth}
        className="fixed bottom-4 right-4 bg-gray-800 text-white p-2 rounded text-xs z-50"
        style={{ display: 'none' }} // Hide in production
      >
        Debug Auth
      </button>
      
      <div className="container mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          
          {/* Left Side: Brand Name */}
          <div className="flex items-center space-x-3">
            <div>
              <p className="text-lg text-gray-700 font-bold">
                Developer Activity & Productivity Tracking
              </p>
            </div>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-12">
            
            {/* Navigation Menu */}
            <div className="flex items-center space-x-8">
              {getUserNavItems().map((item) => (
                <a
                  key={item.name}
                  href={item.href}
                  className="text-gray-700 hover:text-blue-600 font-bold transition-colors duration-200 text-sm tracking-wide"
                >
                  {item.name}
                </a>
              ))}
            </div>

            {/* Right Side: Auth Buttons or User Profile */}
            <div className="flex items-center space-x-4">
              {!isLoggedIn ? (
                // Show Sign In & Sign Up when not logged in
                <>
                  <a
                    href="/login"
                    className="px-5 py-2 text-gray-700 hover:text-blue-600 font-medium transition-colors text-sm border border-gray-300 rounded-lg hover:border-blue-500"
                  >
                    Sign In
                  </a>
                  <a
                    href="/register"
                    className="px-5 py-2 bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors text-sm rounded-lg shadow-sm"
                  >
                    Sign Up
                  </a>
                </>
              ) : (
                // Show User Profile when logged in
                <div className="relative" ref={profileMenuRef}>
                  <button
                    onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
                    className="flex items-center space-x-3 focus:outline-none hover:opacity-90 transition-opacity"
                    aria-label="User profile menu"
                  >
                    {/* User Avatar with Initials */}
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
                      {/* User Info Section */}
                      <div className="px-4 py-3 border-b border-gray-100">
                        <p className="text-sm font-medium text-gray-700 truncate">{getUserDisplayName()}</p>
                        <p className="text-xs text-gray-500 truncate">
                          {user?.email || user?.username || 'user@example.com'}
                        </p>
                        <div className="flex items-center mt-1">
                          <span className={`text-xs font-medium px-2 py-1 rounded ${
                            user?.role === USER_TYPES.ADMIN 
                              ? 'bg-purple-100 text-purple-800' 
                              : 'bg-blue-100 text-blue-800'
                          }`}>
                            {getUserRoleText()}
                          </span>
                        </div>
                      </div>
                      
                      {/* Menu Links */}
                      <a
                        href="/dashboard"
                        className="flex items-center px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                        onClick={() => setIsProfileMenuOpen(false)}
                      >
                        <svg className="w-4 h-4 mr-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                        </svg>
                        Dashboard
                      </a>
                      
                      <a
                        href="/profile"
                        className="flex items-center px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                        onClick={() => setIsProfileMenuOpen(false)}
                      >
                        <svg className="w-4 h-4 mr-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        My Profile
                      </a>
                      
                      <a
                        href="/settings"
                        className="flex items-center px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                        onClick={() => setIsProfileMenuOpen(false)}
                      >
                        <svg className="w-4 h-4 mr-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        Settings
                      </a>

                      {/* Admin-specific links */}
                      {user?.role === USER_TYPES.ADMIN && (
                        <>
                          <div className="border-t border-gray-100 my-1"></div>
                          <a
                            href="/admin/dashboard"
                            className="flex items-center px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                            onClick={() => setIsProfileMenuOpen(false)}
                          >
                            <svg className="w-4 h-4 mr-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                            </svg>
                            Admin Dashboard
                          </a>
                        </>
                      )}

                      <div className="border-t border-gray-100 my-1"></div>
                      {/* Logout Button */}
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
              )}
            </div>
          </div>

          {/* Mobile Menu Button */}
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

        {/* Render Mobile Menu */}
        <MobileMenu />
      </div>
    </nav>
  );
}