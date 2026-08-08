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
  Award,
  Activity
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
      className="flex w-full items-center rounded-lg px-4 py-2.5 text-left text-sm text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <LayoutDashboard className="mr-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
      Dashboard
    </button>
  );

  // Render auth buttons based on login state
  const renderAuthButtons = () => {
    if (isLoading) {
      return (
        <div className="flex items-center space-x-4">
          <div className="h-9 w-24 animate-pulse rounded-lg bg-muted"></div>
        </div>
      );
    }

    if (isLoggedIn && user) {
      return (
        <div className="relative" ref={profileMenuRef}>
          <button
            onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
            className="group flex items-center gap-2.5 rounded-lg px-1.5 py-1 transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label="User profile menu"
            aria-haspopup="menu"
            aria-expanded={isProfileMenuOpen}
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
              {getUserInitials()}
            </span>

            <span className="hidden flex-col items-start lg:flex">
              <span className="text-sm font-medium leading-tight text-foreground">
                {getUserDisplayName()}
              </span>
              <span className="flex items-center gap-1 text-xs leading-tight text-muted-foreground">
                <Award className="h-3 w-3" aria-hidden="true" />
                {getUserRoleText()}
              </span>
            </span>

            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform duration-150 ${isProfileMenuOpen ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </button>

          {/* Profile Dropdown Menu */}
          {isProfileMenuOpen && (
            <div className="animate-fade-in absolute right-0 z-50 mt-3 w-64 rounded-xl border border-border bg-card py-1 shadow-popover">
              <div className="border-b border-border px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                    {getUserInitials()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{getUserDisplayName()}</p>
                    <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                      <Mail className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">{getUserEmail()}</span>
                    </p>
                  </div>
                </div>
                <div className="mt-3">
                  <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${
                    userRole === USER_TYPES.ADMIN
                      ? 'bg-info/10 text-info'
                      : 'bg-primary/10 text-primary'
                  }`}>
                    <Shield className="h-3 w-3" aria-hidden="true" />
                    {getUserRoleText()}
                  </span>
                </div>
              </div>

              <div className="p-1">
                <DashboardButton />

                <button
                  onClick={() => {
                    setIsProfileMenuOpen(false);
                    // Navigate to settings
                  }}
                  className="flex w-full items-center rounded-lg px-4 py-2.5 text-left text-sm text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <Settings className="mr-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  Settings
                </button>

                <button
                  onClick={() => {
                    setIsProfileMenuOpen(false);
                    // Navigate to help
                  }}
                  className="flex w-full items-center rounded-lg px-4 py-2.5 text-left text-sm text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <HelpCircle className="mr-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  Help &amp; Support
                </button>
              </div>

              <div className="border-t border-border p-1">
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center rounded-lg px-4 py-2.5 text-left text-sm text-destructive transition-colors duration-150 hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <LogOut className="mr-3 h-4 w-4" aria-hidden="true" />
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
            className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Sign in
          </a>
          <a
            href="/admin/registration"
            className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors duration-150 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Get started
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
      <div
        id="mobile-nav"
        className="animate-fade-in max-h-[calc(100vh-4rem)] overflow-y-auto overscroll-contain border-t border-border bg-background px-4 py-3 md:hidden"
      >
        <div className="space-y-1">
          {currentNavItems.map((item) => (
            <button
              key={item.name}
              onClick={(e) => {
                handleNavItemClick(item.href, e);
                setIsMenuOpen(false);
              }}
              className="block min-h-[44px] w-full rounded-lg px-3 py-3 text-left text-sm font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              {item.name}
            </button>
          ))}

          <div className="mt-3 space-y-2 border-t border-border pt-3">
            {!(isLoggedIn && user) ? (
              <>
                <a
                  href="/login"
                  className="flex min-h-[44px] items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  onClick={() => setIsMenuOpen(false)}
                >
                  Sign in
                </a>
                <a
                  href="/admin/registration"
                  className="flex min-h-[44px] items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors duration-150 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  onClick={() => setIsMenuOpen(false)}
                >
                  Get started
                </a>
              </>
            ) : (
              <>
                <div className="mb-2 flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                    {getUserInitials()}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{getUserDisplayName()}</p>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Award className="h-3 w-3" aria-hidden="true" />
                      {getUserRoleText()}
                    </p>
                  </div>
                </div>

                <button
                  onClick={(e) => {
                    navigateToDashboard(e);
                    setIsMenuOpen(false);
                  }}
                  className="flex min-h-[44px] w-full items-center rounded-lg px-3 text-left text-sm font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <LayoutDashboard className="mr-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  Dashboard
                </button>

                <button
                  onClick={() => {
                    setIsMenuOpen(false);
                    // Navigate to settings
                  }}
                  className="flex min-h-[44px] w-full items-center rounded-lg px-3 text-left text-sm font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <Settings className="mr-3 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  Settings
                </button>

                <button
                  onClick={handleLogout}
                  className="flex min-h-[44px] w-full items-center rounded-lg px-3 text-left text-sm font-medium text-destructive transition-colors duration-150 hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <LogOut className="mr-3 h-4 w-4" aria-hidden="true" />
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
      <nav className="fixed left-0 right-0 top-0 z-50 border-b border-border bg-background">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 animate-pulse rounded-lg bg-muted"></div>
            <div className="h-4 w-24 animate-pulse rounded bg-muted"></div>
          </div>
          <div className="h-9 w-24 animate-pulse rounded-lg bg-muted"></div>
        </div>
      </nav>
    );
  }

  return (
    <nav className="fixed left-0 right-0 top-0 z-50 border-b border-border bg-background text-foreground">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4">

          {/* Logo/Brand */}
          <a
            href="/"
            className="inline-flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Activity className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="text-base font-semibold tracking-tight text-foreground">DevTrack</span>
          </a>

          {/* Desktop Navigation */}
          <div className="hidden items-center gap-8 md:flex">
            <div className="flex items-center gap-1">
              {(isLoggedIn && user ? getUserNavItems() : navItems).map((item) => (
                <button
                  key={item.name}
                  onClick={(e) => handleNavItemClick(item.href, e)}
                  className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {item.name}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              {renderAuthButtons()}
            </div>
          </div>

          {/* Mobile Menu Toggle */}
          <button
            className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-lg text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:hidden"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={isMenuOpen}
            aria-controls="mobile-nav"
          >
            {isMenuOpen ? (
              <X className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Menu className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      <MobileMenu />
    </nav>
  );
}