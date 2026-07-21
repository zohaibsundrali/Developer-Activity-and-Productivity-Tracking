'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  isSessionExpired,
  clearAdminSession,
  clearDeveloperSession,
  getStoredAdminSession,
  getStoredDeveloperSession,
  touchAdminSession,
  touchDeveloperSession
} from '@/utils/sessionPolicy';

// Storage keys
const STORAGE_KEYS = {
  ADMIN: 'adminUser',
  DEVELOPER: 'developerUser',
  TOKEN: 'auth_token',
  USER: 'user_data'
};

// Create context
const AuthContext = createContext({
  isLoggedIn: false,
  user: null,
  isLoading: true,
  login: () => {},
  logout: () => {},
  checkAuth: () => {}
});

// Custom hook for using auth context
export const useAuth = () => useContext(AuthContext);

// Provider component
export function AuthProvider({ children }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const lastTouchMsRef = useRef(0);

  const maybeTouch = useCallback((role, sessionObj) => {
    const nowMs = Date.now();
    // Throttle to avoid excessive localStorage writes (mousemove/scroll, etc.)
    if (nowMs - lastTouchMsRef.current < 60_000) return null;
    lastTouchMsRef.current = nowMs;

    if (role === 'admin') return touchAdminSession(sessionObj);
    if (role === 'developer') return touchDeveloperSession(sessionObj);
    return null;
  }, []);

  // Centralized authentication check
  const checkAuth = useCallback(() => {
    try {
      // Primary auth keys used by the app (per-tab session storage)
      const adminData = getStoredAdminSession();
      if (adminData && typeof adminData === 'object') {
        if (isSessionExpired(adminData)) {
          clearAdminSession();
        } else {
          const touched = maybeTouch('admin', adminData) || adminData;
          setIsLoggedIn(true);
          setUser(touched);
          return true;
        }
      }

      const developerData = getStoredDeveloperSession();
      if (developerData && typeof developerData === 'object') {
        if (isSessionExpired(developerData)) {
          clearDeveloperSession();
        } else {
          const touched = maybeTouch('developer', developerData) || developerData;
          setIsLoggedIn(true);
          setUser(touched);
          return true;
        }
      }

      // Backwards-compatibility: legacy token/user_data keys
      const token = sessionStorage.getItem(STORAGE_KEYS.TOKEN);
      const userDataStr = sessionStorage.getItem(STORAGE_KEYS.USER);
      
      if (token && userDataStr) {
        try {
          const userData = JSON.parse(userDataStr);
          if (userData && typeof userData === 'object') {
            // Prevent legacy keys from bypassing the 7-day policy.
            if (!isSessionExpired(userData)) {
              setIsLoggedIn(true);
              setUser(userData);
              return true;
            }

            sessionStorage.removeItem(STORAGE_KEYS.TOKEN);
            sessionStorage.removeItem(STORAGE_KEYS.USER);
          }
        } catch (parseError) {
          // Invalid user data
          sessionStorage.removeItem(STORAGE_KEYS.TOKEN);
          sessionStorage.removeItem(STORAGE_KEYS.USER);
        }
      }
      
      // No valid auth data found
      setIsLoggedIn(false);
      setUser(null);
      return false;
    } catch (error) {
      // Auth check failed
      setIsLoggedIn(false);
      setUser(null);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Login function
  const login = useCallback((token, userData) => {
    sessionStorage.setItem(STORAGE_KEYS.TOKEN, token);
    sessionStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(userData));
    setIsLoggedIn(true);
    setUser(userData);
    
    // Dispatch event for all components to update
    window.dispatchEvent(new Event('auth-state-changed'));
  }, []);

  // Logout function
  const logout = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEYS.TOKEN);
    sessionStorage.removeItem(STORAGE_KEYS.USER);
    clearAdminSession();
    clearDeveloperSession();
    setIsLoggedIn(false);
    setUser(null);
    
    // Dispatch event for all components to update
    window.dispatchEvent(new Event('auth-state-changed'));
    
    // Redirect to home page
    window.location.href = '/';
  }, []);

  // Initial auth check and event listeners
  useEffect(() => {
    checkAuth();
    
    // Listen for auth state changes
    const handleAuthStateChange = () => {
      checkAuth();
    };
    
    // Add event listeners
    window.addEventListener('auth-state-changed', handleAuthStateChange);
    
    return () => {
      window.removeEventListener('auth-state-changed', handleAuthStateChange);
    };
  }, [checkAuth]);

  // Global activity tracking: keeps session alive via sliding 7-day inactivity window.
  useEffect(() => {
    if (!isLoggedIn || !user) return;

    const role = user.role === 'admin' ? 'admin' : (user.role === 'developer' ? 'developer' : null);
    if (!role) return;

    const touch = () => {
      const updated = maybeTouch(role, user);
      if (updated) setUser(updated);
    };

    const checkExpired = () => {
      if (isSessionExpired(user)) {
        clearAdminSession();
        clearDeveloperSession();
        setIsLoggedIn(false);
        setUser(null);
        window.dispatchEvent(new Event('auth-state-changed'));

        try {
          const path = window.location?.pathname || '';
          if (path.startsWith('/admin') || path.startsWith('/developer')) {
            window.location.href = '/login';
          }
        } catch {
          // ignore
        }
      }
    };

    const events = ['click', 'keydown', 'scroll', 'mousemove', 'touchstart'];
    for (const evt of events) window.addEventListener(evt, touch, { passive: true });
    const handleVisibilityChange = () => {
      if (!document.hidden) touch();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Ensure a page that stays open also expires after prolonged inactivity.
    const intervalId = window.setInterval(checkExpired, 5 * 60 * 1000);

    return () => {
      for (const evt of events) window.removeEventListener(evt, touch);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, [isLoggedIn, user, maybeTouch]);

  // Context value
  const contextValue = {
    isLoggedIn,
    user,
    isLoading,
    login,
    logout,
    checkAuth
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}