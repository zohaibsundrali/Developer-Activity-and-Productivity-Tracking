"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/utils/supabaseClient";
import { useRouter } from "next/navigation";
import { SESSION_MAX_AGE_DAYS } from "@/utils/sessionPolicy";
import { loadOrgContext, isMembershipActive } from "@/utils/orgContext";
import { authFetch } from "@/utils/authFetch";
import { dashboardHomeFor } from "@/utils/dashboardHome";

import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import AuthShell, { BrandLockup, enterDelay } from "@/components/auth/AuthShell";
import {
  AUTH_INPUT,
  AuthCard,
  AuthError,
  AuthHeading,
  PasswordInput,
  SegmentedControl,
  SubmitButton,
} from "@/components/auth/AuthParts";

// THE LEGACY PASSWORD FALLBACK USED TO LIVE HERE. IT IS GONE, AND WHY IT COULD
// GO WITHOUT LOCKING ANYONE OUT:
//
// It ran only after supabase.auth.signInWithPassword() had FAILED, and it then
// compared the submitted password against `profile.password` — the cleartext
// column on developers / admin_users / clients. A failed sign-in leaves the
// browser holding no JWT, so the profile SELECT above it ran as the `anon`
// PostgreSQL role.
//
// Every policy on those three tables is `TO authenticated`: org_isolation in
// 013 (developers, admin_users), clients_admin / clients_self_read in 014, and
// nothing in 018 or 040 adds an anon grant. The only two policies that named
// {public} — the hand-made "Users can view own data" / "Users can update own
// data" on admin_users — used `auth.uid() = id`, which is NULL for an anonymous
// caller and therefore never true; measured on the live table, 0 of 4 admin
// rows even have id = auth_user_id, so they matched nothing for anybody either.
// Migration 042 drops them.
//
// So the SELECT returned zero rows for exactly the callers the fallback existed
// to serve: `profile` was null, the comparison was never reached, and no
// account could sign in through it. Deleting it removes unreachable code, not a
// login path. Accounts with no Supabase Auth user at all (auth_user_id null)
// could not sign in before this change either — they need an administrator to
// provision sign-in, which is stage 3 of database/041_password_hardening.sql
// and is counted by GET /api/admin/legacy-auth-audit.
//
// Supabase Auth is now the only credential this page consults.

// NAVIGATION ON THIS SCREEN IS ENTIRELY CLIENT-SIDE.
//
// Every departure from this page goes through `next/link` or `router.push`:
// "Back to home", the post-sign-in hand-off to the three dashboards, "Forgot
// password?", "Join with an Invite" and "Create an Organization". There is no
// `window.location` assignment and no `<a href="/…">` anywhere in the file, so
// signing in never tears down the React tree and re-downloads the application
// to render the next screen.
//
// The two hard loads that DO remain in the codebase are both in
// src/contexts/AuthContext.jsx — logout and session expiry — and both are
// deliberate: there, throwing the document away is the point, because that is
// what destroys the stale in-memory session and the live Supabase realtime
// subscriptions hanging off it. They are commented as such at their sites.

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("developer");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [justReset, setJustReset] = useState(false);
  const router = useRouter();

  /**
   * `?reset=1`, set by /reset-password after a successful change, shows the
   * banner below and nothing else. It is a piece of COPY, not a claim: it
   * grants no access, is not read by any handler, and a stranger appending it
   * to the URL gets a sentence and still has to sign in.
   *
   * Read from `window.location` in an effect rather than with
   * `useSearchParams()` deliberately — that hook forces this page under a
   * Suspense boundary at build time, and a query string used only for a
   * confirmation line does not justify restructuring the sign-in screen.
   */
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get("reset") === "1") {
        setJustReset(true);
      }
    } catch {
      /* no URL to read — the banner simply does not appear */
    }
  }, []);

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

      // 1) Supabase Auth is the credential. A successful sign-in mints the JWT
      //    that every RLS policy on the profile tables is written against.
      const { data: authData } = await supabase.auth.signInWithPassword({ email, password });

      // 2) Load the profile row for the selected role/table. This read only
      //    returns anything once step 1 has succeeded — see the note above the
      //    component.
      const { data: profile } = await supabase
        .from(profileTable)
        .select('*')
        .eq('email', email)
        .maybeSingle();

      if (authData?.user && profile) {
        loggedInData = profile;                       // authenticated via Supabase Auth
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
        // NOT ALWAYS /developer/dashboard.
        //
        // This branch is "the profile row is in `developers`", which is where
        // userTypeForRole files a project manager, a team lead, an HR user, a
        // QA and a finance user as well as an actual developer. Sending all six
        // to the staff dashboard put four of them on a four-entry sidebar with
        // none of their work on it — All Projects, Employees, Task Reviews and
        // the rest are admin-shell sections, and ADMIN_SECTION_ROLES has always
        // said those roles may open them.
        //
        // dashboardHomeFor consults the membership role first for exactly this
        // reason. It cannot return null here: `developer` is a known user type.
        setTimeout(() => {
          router.push(dashboardHomeFor("developer", org.membershipRole) || "/developer/dashboard");
        }, 100);
      }
    } catch (error) {
      setError(error.message);
      setLoading(false);
    }
  };

  return (
    <AuthShell panelTitle="Sign in to the workspace your team already works in.">
      <div
        className="auth-enter mb-8 flex items-center justify-between gap-4"
        style={enterDelay(40)}
      >
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

        {justReset && (
          <div
            role="status"
            className="mt-6 flex items-start gap-3 rounded-lg border border-success/30 bg-success/10 p-3.5"
          >
            <CheckCircle2
              className="mt-0.5 h-4 w-4 shrink-0 text-success"
              aria-hidden="true"
            />
            {/* `text-foreground`, not a `success` shade: there is no
                `--success-on-tint` token (only warning and info have one), and
                inventing a colour here would mean picking a contrast ratio by
                eye in two themes. The tint is 10% opacity, so body ink reads
                cleanly on it in both. */}
            <p className="text-sm leading-relaxed text-foreground">
              Your password has been updated. Sign in with your new password to continue.
            </p>
          </div>
        )}

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

          {/* The reset entry point sits directly under the field it is about.
              A <Link>, so it navigates client-side: whatever has already been
              typed above survives, and the app is not re-downloaded to show a
              one-field form. The flow it opens uses Supabase's own
              resetPasswordForEmail / updateUser — see src/app/forgot-password
              and src/app/reset-password. */}
          <div className="-mt-2 flex justify-end">
            <Link
              href="/forgot-password"
              className="text-sm font-medium text-primary underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Forgot password?
            </Link>
          </div>

          {error && <AuthError message={error} />}

          <SubmitButton
            loading={loading}
            loadingLabel="Signing in…"
            status={error ? "error" : "idle"}
            disabled={loading}
          >
            {`Sign in as ${role === "developer" ? "Team Member" : role.charAt(0).toUpperCase() + role.slice(1)}`}
          </SubmitButton>
        </form>

        {/* THE TWO ENTRY PATHS, NOW ACTUALLY TWO.
            "Create one" was a single link to /admin/registration — the
            org-creation form with a mode toggle hidden inside it — so the only
            two ways to get an account were presented as one, under a label that
            said neither. They are different acts: joining a workspace someone
            else already set up (the invite decided your organization, your
            email and your role) versus creating one from nothing. Each now
            names itself and each has its own route: /join and
            /admin/registration. Both are <Link>s, so neither costs a page load. */}
        <div
          className="auth-enter mt-7 space-y-2 border-t border-border pt-5 text-center text-sm text-muted-foreground"
          style={enterDelay(220)}
        >
          <p>
            Been invited to a workspace?{" "}
            <Link
              href="/join"
              className="font-medium text-primary underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Join with an Invite
            </Link>
          </p>
          <p>
            Starting from scratch?{" "}
            <Link
              href="/admin/registration"
              className="font-medium text-primary underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Create an Organization
            </Link>
          </p>
        </div>
      </AuthCard>
    </AuthShell>
  );
}