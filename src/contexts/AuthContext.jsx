'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  isSessionExpired,
  clearAdminSession,
  clearClientSession,
  clearDeveloperSession,
  getStoredAdminSession,
  getStoredClientSession,
  getStoredDeveloperSession,
  touchAdminSession,
  touchDeveloperSession
} from '@/utils/sessionPolicy';
import { dashboardHomeFor } from '@/utils/dashboardHome';

// Storage keys
const STORAGE_KEYS = {
  ADMIN: 'adminUser',
  DEVELOPER: 'developerUser',
  CLIENT: 'clientUser',
  TOKEN: 'auth_token',
  USER: 'user_data'
};

// Create context
const AuthContext = createContext({
  isLoggedIn: false,
  user: null,
  isLoading: true,
  // 'pending' | 'authenticated' | 'unauthenticated' — derived, see below.
  authStatus: 'pending',
  // Dashboard route for the signed-in user, or null. Derived, see below.
  home: null,
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

      // CLIENTS WERE MISSING FROM THIS FUNCTION ENTIRELY.
      //
      // Login writes `clientUser` exactly as it writes the other two, and
      // sessionPolicy has always exported the reader for it — but nothing here
      // ever called it, so as far as this context was concerned a signed-in
      // client was an anonymous visitor. Nothing broke loudly, because the one
      // guard that consults `isLoggedIn` (ProtectedRoute's default check) is
      // not used on any client screen; the middleware and the API layer are
      // what actually keep a client out of somewhere they do not belong.
      //
      // It became visible the moment anything on a PUBLIC page asked "is
      // somebody signed in" — the marketing header offered a client "Sign in"
      // while they were, in fact, signed in.
      //
      // Checked last, after admin and developer, so an admin who also holds a
      // stale client session is still an admin.
      const clientData = getStoredClientSession();
      if (clientData && typeof clientData === 'object') {
        if (isSessionExpired(clientData)) {
          clearClientSession();
        } else {
          // No touch() for clients: touchClientSession exists, but the sliding
          // activity window below is wired for the two staff surfaces only.
          // Reading a session must not be the thing that extends it.
          setIsLoggedIn(true);
          setUser(clientData);
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

    // DELIBERATE HARD NAVIGATION — DO NOT CONVERT THIS TO router.push.
    //
    // Everywhere else in the app a `window.location.href` assignment is a bug:
    // it throws away the React tree and re-downloads the bundle to render a
    // route the client router could have rendered in place. Here that is
    // precisely the intent. Clearing sessionStorage does not clear what the
    // running document is still holding: component state that closed over the
    // signed-in user, in-flight fetches, timers, and — the one that actually
    // matters — the live Supabase realtime channels this session opened, which
    // stay subscribed with the old JWT until the document dies.
    //
    // A client-side push would leave every one of those alive on the landing
    // page. Destroying the document is what makes "log out" mean it.
    window.location.href = '/';
  }, []);

  // Initial auth check and event listeners
  useEffect(() => {
    checkAuth();
    
    // Listen for auth state changes
    const handleAuthStateChange = () => {
      checkAuth();
    };
    
    // TWO EVENT NAMES, ONE EVENT.
    //
    // This context dispatches `auth-state-changed`; the login page dispatches
    // `auth-change` after it writes the session. Nothing listened for the
    // second one, so signing in and then moving around the app CLIENT-SIDE
    // left this context still believing nobody was signed in — until something
    // remounted the provider or a full page load re-ran checkAuth. That is the
    // other half of the "I signed in, then the header still offered me Sign
    // in" report: a hard load looked fine, an in-app link did not.
    //
    // Both are honoured rather than renaming one, because a rename fixes it
    // only for the callers you remember to grep for.
    window.addEventListener('auth-state-changed', handleAuthStateChange);
    window.addEventListener('auth-change', handleAuthStateChange);

    return () => {
      window.removeEventListener('auth-state-changed', handleAuthStateChange);
      window.removeEventListener('auth-change', handleAuthStateChange);
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
            // DELIBERATE HARD NAVIGATION — DO NOT CONVERT THIS TO router.push.
            //
            // Same reasoning as logout() above, and it applies with more force
            // here. This branch fires on a page that has been sitting open past
            // the inactivity window: it is exactly the case where the document
            // has accumulated the most live state — polling intervals, open
            // Supabase realtime subscriptions, cached rows fetched under a JWT
            // that is now stale. A client-side push would swap the view for the
            // login form while leaving every one of those subscriptions running
            // underneath it.
            //
            // Reloading the document is the cheap, total way to guarantee the
            // expired session leaves no residue. The cost — one full page load,
            // for a user who has been idle for days — is not a cost.
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
  //
  // `authStatus` is a derived read of the two flags already here — no new
  // decision about who is signed in, and nothing above it changed. It exists so
  // a guard (src/components/auth/ProtectedRoute.jsx) can distinguish "still
  // checking" from "checked, and no" without re-deriving the same boolean pair
  // in every consumer, which is how one screen ends up bouncing a user the
  // others let through.
  //
  // `home` is the same kind of derived read: the dashboard this user belongs
  // to, or null when there is nobody signed in / the session predates the role
  // field. `user.role` is written by the login page as exactly one of admin,
  // client, developer — the three profile tables — which is what
  // dashboardHomeFor is keyed by. A membership role (manager, qa, team_lead…)
  // never appears here; it decides what the /developer surface SHOWS, not
  // which surface it is.
  const home = isLoggedIn ? dashboardHomeFor(user?.role) : null;

  const contextValue = {
    isLoggedIn,
    user,
    isLoading,
    authStatus: isLoading ? 'pending' : isLoggedIn ? 'authenticated' : 'unauthenticated',
    home,
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