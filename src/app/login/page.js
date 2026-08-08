"use client";
import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/utils/supabaseClient";
import { useRouter } from "next/navigation";
import { SESSION_MAX_AGE_DAYS } from "@/utils/sessionPolicy";
import { loadOrgContext, isMembershipActive } from "@/utils/orgContext";
import { authFetch } from "@/utils/authFetch";

import { ArrowLeft } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import AuthShell, { BrandLockup } from "@/components/auth/AuthShell";
import {
  AUTH_INPUT,
  AuthCard,
  AuthError,
  AuthHeading,
  PasswordInput,
  SegmentedControl,
  SubmitButton,
} from "@/components/auth/AuthParts";

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
    <AuthShell panelTitle="Sign in to the workspace your team already works in.">
      <div className="mb-8 flex items-center justify-between gap-4">
        <BrandLockup className="lg:invisible" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleGoToHome}
          className="h-9 gap-1.5 px-2.5 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to home
        </Button>
      </div>

      <AuthCard>
        <AuthHeading
          title="Welcome back"
          description="Use your workspace credentials to continue to the dashboard."
        />

        <div className="mt-7 space-y-2">
          <p className="text-sm font-medium text-foreground">I&apos;m signing in as</p>
          <SegmentedControl
            label="Account type"
            value={role}
            onChange={setRole}
            options={[
              {
                value: "developer",
                label: "Team Member",
                title: "Developers, Managers and Employees sign in here",
              },
              { value: "admin", label: "Admin" },
              { value: "client", label: "Client" },
            ]}
          />
        </div>

        <form onSubmit={handleLogin} className="mt-6 space-y-5">
          <Field label="Email address" htmlFor="login-email" required>
            <Input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={AUTH_INPUT}
              required
              autoComplete="email"
              aria-invalid={error ? true : undefined}
            />
          </Field>

          <Field label="Password" htmlFor="login-password" required>
            <PasswordInput
              id="login-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
              autoComplete="current-password"
              aria-invalid={error ? true : undefined}
              visible={showPassword}
              onToggle={() => setShowPassword(v => !v)}
            />
          </Field>

          {error && <AuthError message={error} />}

          <SubmitButton loading={loading} loadingLabel="Signing in…" disabled={loading}>
            {`Sign in as ${role === "developer" ? "Team Member" : role.charAt(0).toUpperCase() + role.slice(1)}`}
          </SubmitButton>
        </form>

        <p className="mt-7 border-t border-border pt-5 text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link
            href="/admin/registration"
            className="font-medium text-primary underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Create one
          </Link>
        </p>
      </AuthCard>
    </AuthShell>
  );
}