'use client';

import { useState, useEffect, useRef } from 'react';
import { isSessionExpired, clearAdminSession, clearDeveloperSession } from '@/utils/sessionPolicy';
import {
  Menu,
  X,
  LogOut,
  LayoutDashboard,
  ChevronDown,
  Settings,
  HelpCircle,
  Shield,
  Mail,
  Award
} from 'lucide-react';

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
  ADMIN: 'adminUser',
  DEVELOPER: 'developerUser'
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
      const adminDataStr = sessionStorage.getItem(STORAGE_KEYS.ADMIN);
      const developerDataStr = sessionStorage.getItem(STORAGE_KEYS.DEVELOPER);
      
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
    checkAuthStatus();
    
    const handleAuthChange = () => {
      checkAuthStatus();
    };

    window.addEventListener('auth-change', handleAuthChange);
    
    const handleClickOutside = (event) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
        setIsProfileMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    
    return () => {
      window.removeEventListener('auth-change', handleAuthChange);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Clear auth data
  const clearAuthData = () => {
    clearAdminSession();
    clearDeveloperSession();
    
    setIsLoggedIn(false);
    setUser(null);
    setUserRole(null);
  };

  // Handle logout
  const handleLogout = () => {
    clearAuthData();
    setIsProfileMenuOpen(false);
    setIsMenuOpen(false);
    
    window.dispatchEvent(new Event('auth-change'));
    
    window.location.href = '/';
  };

  // Dynamic Dashboard Navigation
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

  // Get user-specific navigation items with dynamic dashboard
  const getUserNavItems = () => {
    const baseItems = [...navItems];
    
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

  // Navigation item click handler
  const handleNavItemClick = (href, e) => {
    if (href === '/admin/dashboard' || href === '/dashboard' || href === '/developer/dashboard') {
      e.preventDefault();
      navigateToDashboard(e);
    } else {
      window.location.href = href;
    }
  };

  // Dynamic Dashboard button for profile dropdown
  const DashboardButton = () => (
    <button
      onClick={(e) => navigateToDashboard(e)}
      className="flex items-center w-full text-left px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors rounded-lg"
    >
      <LayoutDashboard className="w-4 h-4 mr-3 text-muted-foreground" />
      Dashboard
    </button>
  );

  // Render auth buttons based on login state
  const renderAuthButtons = () => {
    if (isLoading) {
      return (
        <div className="flex items-center space-x-4">
          <div className="w-24 h-10 bg-primary-foreground/20 animate-pulse rounded-lg"></div>
        </div>
      );
    }

    if (isLoggedIn && user) {
      return (
        <div className="relative" ref={profileMenuRef}>
          <button
            onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
            className="flex items-center space-x-3 focus:outline-none hover:opacity-90 transition-opacity group"
            aria-label="User profile menu"
          >
            <div className="w-10 h-10 rounded-full bg-primary-foreground/20 flex items-center justify-center text-primary-foreground font-bold shadow-md ring-2 ring-primary-foreground/20 group-hover:ring-primary-foreground/40 transition-all">
              {getUserInitials()}
            </div>

            <div className="hidden lg:flex flex-col items-start">
             <span className="text-sm font-semibold text-primary-foreground">
                {getUserDisplayName()}
              </span>
              <div className="flex items-center gap-1">
                <Award className="w-3 h-3 text-primary-foreground/80" />
                <span className="text-xs text-primary-foreground/80">
                  {getUserRoleText()}
                </span>
              </div>
            </div>

            <ChevronDown className={`w-4 h-4 text-primary-foreground/80 transition-transform duration-200 ${isProfileMenuOpen ? 'rotate-180' : ''}`} />
          </button>

          {/* Profile Dropdown Menu */}
          {isProfileMenuOpen && (
            <div className="absolute right-0 mt-3 w-64 bg-card rounded-xl shadow-popover border border-border py-1 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="px-4 py-3 border-b border-border">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold text-lg shadow-md">
                    {getUserInitials()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{getUserDisplayName()}</p>
                    <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                      <Mail className="w-3 h-3" />
                      {getUserEmail()}
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Shield className="w-3 h-3 text-primary" />
                  <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                    userRole === USER_TYPES.ADMIN
                      ? 'bg-info/10 text-info'
                      : 'bg-primary/10 text-primary'
                  }`}>
                    {getUserRoleText()}
                  </span>
                </div>
              </div>
              
              <div className="py-1">
                <DashboardButton />
                
                <button
                  onClick={() => {
                    setIsProfileMenuOpen(false);
                    // Navigate to settings
                  }}
                  className="flex items-center w-full text-left px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors rounded-lg"
                >
                  <Settings className="w-4 h-4 mr-3 text-muted-foreground" />
                  Settings
                </button>
                
                <button
                  onClick={() => {
                    setIsProfileMenuOpen(false);
                    // Navigate to help
                  }}
                  className="flex items-center w-full text-left px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors rounded-lg"
                >
                  <HelpCircle className="w-4 h-4 mr-3 text-muted-foreground" />
                  Help & Support
                </button>
              </div>
              
              <div className="border-t border-border py-1">
                <button
                  onClick={handleLogout}
                  className="flex items-center w-full text-left px-4 py-2.5 text-sm text-destructive hover:bg-destructive/10 transition-colors rounded-lg"
                >
                  <LogOut className="w-4 h-4 mr-3 text-destructive" />
                  Logout
                </button>
              </div>
            </div>
          )}
        </div>
      );
    } else {
      return (
        <>
          <a
            href="/login"
            className="px-5 py-2 text-primary-foreground border border-primary-foreground/30 rounded-lg hover:bg-primary-foreground/10 hover:border-primary-foreground transition-all duration-200 text-sm font-medium"
          >
            Sign In
          </a>
          <a
            href="/admin/registration"
           className="px-5 py-2 bg-primary-foreground text-primary font-semibold rounded-lg hover:bg-primary-foreground/90 hover:scale-[1.02] transition-all duration-200 text-sm shadow-md"
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
      <div className="md:hidden bg-primary border-t border-primary-foreground/10 mt-4">
        <div className="py-3 space-y-1">
          {currentNavItems.map((item) => (
            <button
              key={item.name}
              onClick={(e) => {
                handleNavItemClick(item.href, e);
                setIsMenuOpen(false);
              }}
              className="block w-full text-left px-4 py-3 text-primary-foreground hover:bg-primary-foreground/10 text-sm font-medium rounded-lg transition-all"
            >
              {item.name}
            </button>
          ))}

          <div className="border-t border-primary-foreground/10 pt-2 mt-2 px-4">
            {!(isLoggedIn && user) ? (
              <>
                <a
                  href="/login"
                  className="block py-3 text-primary-foreground text-sm font-medium hover:bg-primary-foreground/10 px-4 rounded-lg transition-all"
                  onClick={() => setIsMenuOpen(false)}
                >
                  Sign In
                </a>
                <a
                  href="/admin/registration"
                  className="block py-3 bg-primary-foreground text-primary text-center rounded-lg text-sm font-semibold mt-2 hover:bg-primary-foreground/90 transition-all"
                  onClick={() => setIsMenuOpen(false)}
                >
                  Sign Up
                </a>
              </>
            ) : (
              <>
                <div className="flex items-center space-x-3 mb-4 p-2 bg-primary-foreground/10 rounded-lg">
                  <div className="w-12 h-12 rounded-full bg-primary-foreground/20 flex items-center justify-center text-primary-foreground font-bold text-lg shadow-md">
                    {getUserInitials()}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-primary-foreground">{getUserDisplayName()}</p>
                    <p className="text-xs text-primary-foreground/80 flex items-center gap-1">
                      <Award className="w-3 h-3" />
                      {getUserRoleText()}
                    </p>
                  </div>
                </div>

                <button
                  onClick={(e) => {
                    navigateToDashboard(e);
                    setIsMenuOpen(false);
                  }}
                  className="flex items-center w-full text-left px-4 py-3 text-primary-foreground hover:bg-primary-foreground/10 text-sm font-medium rounded-lg transition-colors"
                >
                  <LayoutDashboard className="w-4 h-4 mr-3 text-primary-foreground/70" />
                  Dashboard
                </button>

                <button
                  onClick={() => {
                    setIsMenuOpen(false);
                    // Navigate to settings
                  }}
                  className="flex items-center w-full text-left px-4 py-3 text-primary-foreground hover:bg-primary-foreground/10 text-sm font-medium rounded-lg transition-colors"
                >
                  <Settings className="w-4 h-4 mr-3 text-primary-foreground/70" />
                  Settings
                </button>

                <button
                  onClick={handleLogout}
                  className="w-full text-left flex items-center px-4 py-3 text-primary-foreground hover:bg-primary-foreground/10 text-sm font-medium rounded-lg transition-colors mt-2"
                >
                  <LogOut className="w-4 h-4 mr-3 text-primary-foreground/70" />
                  Logout
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Show loading state
  if (isLoading) {
    return (
      <nav className="fixed top-0 left-0 right-0 z-50 bg-primary backdrop-blur-md border-b border-primary/20 shadow-elevated">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-primary-foreground/20 rounded-lg animate-pulse"></div>
              <div className="h-6 w-48 bg-primary-foreground/20 rounded animate-pulse"></div>
            </div>
            <div className="h-10 w-24 bg-primary-foreground/20 rounded animate-pulse"></div>
          </div>
        </div>
      </nav>
    );
  }

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-primary text-primary-foreground backdrop-blur-sm border-b border-primary/20 shadow-card">
      <div className="container mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          
          {/* Logo/Brand */}
          <div className="flex items-center space-x-3">
            <div>
              <p className="text-lg font-bold text-primary-foreground">
  DevTrack
</p>
            </div>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-12">
            <div className="flex items-center space-x-8">
              {(isLoggedIn && user ? getUserNavItems() : navItems).map((item) => (
                <button
                  key={item.name}
                  onClick={(e) => handleNavItemClick(item.href, e)}
                  className="text-primary-foreground hover:text-primary-foreground/80 font-medium transition-all duration-200 text-sm"
                >
                  {item.name}
                </button>
              ))}
            </div>

            <div className="flex items-center space-x-4">
              {renderAuthButtons()}
            </div>
          </div>

          {/* Mobile Menu Toggle */}
          <button
            className="md:hidden p-2 rounded-lg text-primary-foreground hover:bg-primary-foreground/10 transition-all"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            aria-label="Toggle menu"
          >
            {isMenuOpen ? (
              <X className="w-6 h-6" />
            ) : (
              <Menu className="w-6 h-6" />
            )}
          </button>
        </div>

        <MobileMenu />
      </div>
    </nav>
  );
}