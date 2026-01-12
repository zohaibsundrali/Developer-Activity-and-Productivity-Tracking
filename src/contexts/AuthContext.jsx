'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';

// Storage keys
const STORAGE_KEYS = {
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

  // Centralized authentication check
  const checkAuth = useCallback(() => {
    try {
      const token = localStorage.getItem(STORAGE_KEYS.TOKEN);
      const userDataStr = localStorage.getItem(STORAGE_KEYS.USER);
      
      if (token && userDataStr) {
        try {
          const userData = JSON.parse(userDataStr);
          if (userData && typeof userData === 'object') {
            setIsLoggedIn(true);
            setUser(userData);
            return true;
          }
        } catch (parseError) {
          console.error('Error parsing user data:', parseError);
        }
      }
      
      // No valid auth data found
      setIsLoggedIn(false);
      setUser(null);
      return false;
    } catch (error) {
      console.error('Auth check error:', error);
      setIsLoggedIn(false);
      setUser(null);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Login function
  const login = useCallback((token, userData) => {
    localStorage.setItem(STORAGE_KEYS.TOKEN, token);
    localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(userData));
    setIsLoggedIn(true);
    setUser(userData);
    
    // Dispatch event for all components to update
    window.dispatchEvent(new Event('auth-state-changed'));
  }, []);

  // Logout function
  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEYS.TOKEN);
    localStorage.removeItem(STORAGE_KEYS.USER);
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
      console.log('Auth state changed, checking again...');
      checkAuth();
    };
    
    // Listen for storage changes (from other tabs/windows)
    const handleStorageChange = (e) => {
      if (e.key === STORAGE_KEYS.TOKEN || e.key === STORAGE_KEYS.USER) {
        handleAuthStateChange();
      }
    };
    
    // Add event listeners
    window.addEventListener('auth-state-changed', handleAuthStateChange);
    window.addEventListener('storage', handleStorageChange);
    
    return () => {
      window.removeEventListener('auth-state-changed', handleAuthStateChange);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [checkAuth]);

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