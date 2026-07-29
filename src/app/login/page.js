"use client";
import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/utils/supabaseClient";
import { useRouter } from "next/navigation";
import { SESSION_MAX_AGE_DAYS } from "@/utils/sessionPolicy";
import { loadOrgContext, isMembershipActive } from "@/utils/orgContext";
import { authFetch } from "@/utils/authFetch";

import "../auth.css";

const verifyPassword = (inputPassword, storedPassword) => {
  if (typeof storedPassword !== "string") return false;
  return storedPassword === inputPassword;
};

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("developer");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();

  const handleGoToHome = () => {
    router.push("/");
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      let loggedInData = null;
      const profileTable =
        role === "admin" ? "admin_users" : role === "client" ? "clients" : "developers";

      // 1) Try Supabase Auth first — migrated users get a real JWT session
      //    (required for DB-level RLS). Falls back to the legacy plaintext
      //    check so no one is locked out during the transition.
      const { data: authData } = await supabase.auth.signInWithPassword({ email, password });

      // 2) Load the profile row for the selected role/table.
      const { data: profile } = await supabase
        .from(profileTable)
        .select('*')
        .eq('email', email)
        .maybeSingle();

      if (authData?.user && profile) {
        loggedInData = profile;                       // authenticated via Supabase Auth
      } else if (profile && verifyPassword(password, profile.password)) {
        loggedInData = profile;                       // legacy plaintext fallback
      } else {
        if (authData?.user) { try { await supabase.auth.signOut(); } catch {} }
        throw new Error(`Invalid ${role} credentials`);
      }

      // Multi-tenant: resolve the user's organization context (id/name/role)
      // and carry it in the session so all data queries can scope by org.
      const org = await loadOrgContext(
        loggedInData.id,
        role === "admin" ? "admin" : role === "client" ? "client" : "developer",
        loggedInData.organization_id || null
      );

      // Deactivated / offboarded members must not get a session. Previously
      // memberships.status was written but never read, so suspending someone
      // had no effect on their access (audit finding C10).
      if (!isMembershipActive(org.membershipStatus)) {
        try { await supabase.auth.signOut(); } catch {}
        throw new Error(
          "Your account has been deactivated. Please contact your administrator."
        );
      }

      const userSession = {
        ...loggedInData,
        role: role,
        organization_id: org.organizationId,
        organization_name: org.organizationName,
        organization_logo: org.organizationLogo,
        organization_timezone: org.organizationTimezone,
        membership_role: org.membershipRole,
        loginTime: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      };

      // Exchange the verified Supabase JWT for a signed, HttpOnly session
      // cookie. The middleware validates that signature — the legacy
      // `*_auth=true` cookies below are no longer trusted for authorization
      // (audit finding C5), they remain only for existing client-side reads.
      const sessionRes = await authFetch("/api/auth/session", { method: "POST" });
      if (!sessionRes.ok) {
        try { await supabase.auth.signOut(); } catch {}
        throw new Error(
          "Could not establish a secure session. Please try again."
        );
      }

      if (role === "admin") {
        sessionStorage.setItem("adminUser", JSON.stringify(userSession));
        localStorage.removeItem("adminUser");
        window.dispatchEvent(new Event('auth-change'));
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + SESSION_MAX_AGE_DAYS);
        document.cookie = `admin_auth=true; expires=${expiryDate.toUTCString()}; path=/`;
        document.cookie = `admin_id=${loggedInData.id}; expires=${expiryDate.toUTCString()}; path=/; HttpOnly; Secure`;
        setTimeout(() => { router.push("/admin/dashboard"); }, 100);
      } else if (role === "client") {
        sessionStorage.setItem("clientUser", JSON.stringify(userSession));
        localStorage.removeItem("clientUser");
        window.dispatchEvent(new Event('auth-change'));
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + SESSION_MAX_AGE_DAYS);
        document.cookie = `client_auth=true; expires=${expiryDate.toUTCString()}; path=/`;
        document.cookie = `client_id=${loggedInData.id}; expires=${expiryDate.toUTCString()}; path=/`;
        setTimeout(() => { router.push("/client"); }, 100);
      } else {
        sessionStorage.setItem("developerUser", JSON.stringify(userSession));
        localStorage.removeItem("developerUser");
        window.dispatchEvent(new Event('auth-change'));
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + SESSION_MAX_AGE_DAYS);
        document.cookie = `developer_auth=true; expires=${expiryDate.toUTCString()}; path=/`;
        document.cookie = `developer_id=${loggedInData.id}; expires=${expiryDate.toUTCString()}; path=/`;
        setTimeout(() => { router.push("/developer/dashboard"); }, 100);
      }
    } catch (error) {
      setError(error.message);
      setLoading(false);
    }
  };

  return (
    <div className="auth-root">
      <div className="auth-orb auth-orb-1" />
      <div className="auth-orb auth-orb-2" />
      <div className="auth-orb auth-orb-3" />

      <div className="auth-card">
        <button onClick={handleGoToHome} className="auth-back-btn" title="Go to Home">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" style={{ width: 14, height: 14 }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Back
        </button>

        <div className="auth-brand">
          <h1>Welcome back</h1>
          <p>Use your workspace credentials to continue to the dashboard.</p>
        </div>

        <div className="auth-role-wrap">
          <button
            type="button"
            onClick={() => setRole("developer")}
            className={`auth-role-btn ${role === "developer" ? "active" : "inactive"}`}
            title="Developers, Managers and Employees sign in here"
          >
            Team Member
          </button>
          <button
            type="button"
            onClick={() => setRole("admin")}
            className={`auth-role-btn ${role === "admin" ? "active" : "inactive"}`}
          >
            Admin
          </button>
          <button
            type="button"
            onClick={() => setRole("client")}
            className={`auth-role-btn ${role === "client" ? "active" : "inactive"}`}
          >
            Client
          </button>
        </div>

        <form onSubmit={handleLogin}>
          <div className="auth-field">
            <label className="auth-label">Email Address</label>
            <div className="auth-input-wrap">
              <span className="auth-input-icon">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="auth-input"
                required
                autoComplete="email"
              />
            </div>
          </div>

          <div className="auth-field">
            <label className="auth-label">Password</label>
            <div className="auth-input-wrap">
              <span className="auth-input-icon">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
              </span>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="auth-input"
                required
                autoComplete="current-password"
                style={{ paddingRight: '2.75rem' }}
              />
              <button
                type="button"
                className="auth-eye-btn"
                onClick={() => setShowPassword(v => !v)}
                tabIndex={-1}
              >
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="auth-error-box">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <p>{error}</p>
            </div>
          )}

          <button type="submit" disabled={loading} className="auth-submit-btn">
            {loading ? <><span className="auth-spinner" />Signing in...</> : `Sign in as ${role === "developer" ? "Team Member" : role.charAt(0).toUpperCase() + role.slice(1)}`}
          </button>
        </form>

        <div className="auth-divider"><span>Don&apos;t have an account?</span></div>
        <div className="auth-footer"><Link href="/admin/registration">Create an account →</Link></div>
      </div>
    </div>
  );
}