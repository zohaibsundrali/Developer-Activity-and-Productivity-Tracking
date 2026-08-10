"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { supabase } from "@/utils/supabaseClient";
import { showError, showSuccess } from "@/utils/alerts";
import { Field } from "@/components/ui";
import AuthShell, { BrandLockup, enterDelay } from "@/components/auth/AuthShell";
import {
  AuthCard,
  AuthError,
  AuthHeading,
  AuthNotice,
  PasswordChecklist,
  PasswordInput,
  SubmitButton,
} from "@/components/auth/AuthParts";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import { evaluatePassword } from "@/components/auth/passwordRules";

/**
 * /reset-password — set a new password.
 *
 * THE THING TO UNDERSTAND ABOUT THIS PAGE
 *  A Supabase recovery link SIGNS THE USER IN. Clicking it lands here with
 *  `#access_token=…&type=recovery` in the fragment, the browser client consumes
 *  it (detectSessionInUrl is on by default), and from that moment the visitor
 *  holds a real, if short-lived, Supabase session. That is what makes
 *  `supabase.auth.updateUser({ password })` work without asking for the old
 *  password: the session IS the proof.
 *
 *  Which means this page must never render its form to someone who does not
 *  hold that session. Not because the form would work for them — it would not,
 *  `updateUser` is authenticated and the server rejects an anonymous caller —
 *  but because a "choose a new password" screen offered to a stranger is an
 *  invitation to believe something is being changed.
 *
 * WHAT STOPS IT BEING REACHED WITHOUT A SESSION
 *  Three layers, only the last of which is a security boundary:
 *   1. The ProtectedRoute wrapper below. Its `check` asks Supabase for a live
 *      session. It fails CLOSED — an error, a URL that carries an auth error
 *      (an expired or already-used link), or no session inside the grace window
 *      all resolve to "denied", which shows the branded screen and then routes
 *      to /forgot-password so the visitor can request a fresh link.
 *   2. The bounded wait. `detectSessionInUrl` parses the fragment
 *      asynchronously, so a naive getSession() on mount races it and would deny
 *      a legitimate arrival. We subscribe to onAuthStateChange and wait a few
 *      seconds before giving up — never indefinitely, or a stranger would just
 *      sit on the loading screen forever.
 *   3. Supabase itself. `updateUser` requires the access token. Delete the
 *      guard entirely and this page still could not change anybody's password.
 *
 * NO INVENTED TOKEN SCHEME. There is no reset table, no code of our own and no
 * new API route. /api/auth/signup and the change-password route are untouched.
 */

const SESSION_GRACE_MS = 6000;

/** True when the URL fragment/query carries an auth error rather than a token. */
function urlCarriesAuthError() {
  if (typeof window === "undefined") return false;
  const hash = window.location.hash?.replace(/^#/, "") || "";
  const params = new URLSearchParams(hash);
  const search = new URLSearchParams(window.location.search || "");
  return Boolean(params.get("error") || params.get("error_code") || search.get("error"));
}

/** True when the URL looks like it is carrying a recovery token at all. */
function urlCarriesRecoveryToken() {
  if (typeof window === "undefined") return false;
  const hash = window.location.hash?.replace(/^#/, "") || "";
  if (!hash) return false;
  const params = new URLSearchParams(hash);
  return Boolean(params.get("access_token") || params.get("type"));
}

/**
 * Resolve once supabase-js has finished consuming the recovery fragment.
 * Resolves false on timeout, so the guard can never hang.
 */
function waitForSession(ms) {
  return new Promise((resolve) => {
    // Declared before `finish` so the listener firing synchronously cannot hit
    // a temporal-dead-zone reference to either of them.
    let settled = false;
    let timer = null;
    let subscription = null;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer !== null) window.clearTimeout(timer);
      try {
        subscription?.unsubscribe();
      } catch {
        // the listener is already gone; nothing to do
      }
      resolve(value);
    };

    const listener = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) finish(true);
    });
    subscription = listener?.data?.subscription || null;
    if (settled) {
      // The listener resolved us before we could hold its handle — release it
      // here instead, and do not arm a timer nobody will clear.
      try {
        subscription?.unsubscribe();
      } catch {
        // already gone
      }
      return;
    }

    timer = window.setTimeout(() => finish(false), ms);
  });
}

function ResetPasswordForm() {
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const pwVal = evaluatePassword(password);

  const handleSubmit = async (e) => {
    e.preventDefault();

    const next = {};
    if (!pwVal.isValid) next.password = "Password does not meet the requirements";
    if (password !== confirmPassword) next.confirmPassword = "Passwords do not match";

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSaving(true);
    try {
      // Supabase's own primitive, against the recovery session the link
      // established. Nothing else changes a credential in this product.
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw new Error(updateError.message);

      setDone(true);

      // End the recovery session deliberately. It was minted by an emailed link
      // and is not the session the app runs on: signing in through /login is
      // what resolves the organization context, checks the membership is still
      // active and mints the signed session cookie. Leaving the recovery
      // session in place would let someone skip all three.
      //
      // Done BEFORE the confirmation dialog, so the session is gone whether or
      // not the person ever dismisses it.
      try {
        await supabase.auth.signOut();
      } catch {
        // Already gone — the redirect below is what matters.
      }

      // Awaited, unlike before. Firing the dialog and navigating in the same
      // tick raced them: the router swapped the tree out from under an open
      // modal, and which one the user actually saw came down to timing. Now the
      // sign-in screen is what appears when they click OK.
      await showSuccess(
        "Password updated",
        "Your new password is active. Sign in with it to continue."
      );

      // `?reset=1` is read by /login purely to show a one-line confirmation
      // banner. It grants nothing and is not trusted for anything — see the
      // note at its reader in src/app/login/page.js.
      router.push("/login?reset=1");
    } catch (err) {
      const message =
        err?.message || "We couldn't update your password. Please try again.";
      setErrors({ general: message });
      showError("Couldn't update your password", message);
      setSaving(false);
    }
  };

  return (
    <AuthShell panelTitle="Pick a new password and you're back in.">
      <div
        className="auth-enter mb-8 flex items-center justify-between gap-4"
        style={enterDelay(40)}
      >
        <BrandLockup className="lg:invisible" />
      </div>

      <AuthCard>
        <AuthHeading
          title="Set a new password"
          description="Choose something you haven't used here before. You'll sign in with it straight after."
        />

        {errors.general && <AuthError message={errors.general} className="mt-6" />}

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div className="space-y-2">
            <Field
              label="New password"
              htmlFor="reset-password"
              error={errors.password}
              required
            >
              <PasswordInput
                id="reset-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (errors.password) setErrors((prev) => ({ ...prev, password: "" }));
                }}
                placeholder="Create a password"
                aria-invalid={errors.password ? true : undefined}
                autoComplete="new-password"
                autoFocus
                required
                visible={showPassword}
                onToggle={() => setShowPassword((v) => !v)}
              />
            </Field>
            {password && <PasswordChecklist requirements={pwVal.requirements} />}
          </div>

          <Field
            label="Confirm new password"
            htmlFor="reset-confirm"
            error={errors.confirmPassword}
            required
          >
            <PasswordInput
              id="reset-confirm"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (errors.confirmPassword)
                  setErrors((prev) => ({ ...prev, confirmPassword: "" }));
              }}
              placeholder="Repeat password"
              aria-invalid={errors.confirmPassword ? true : undefined}
              autoComplete="new-password"
              required
              visible={showConfirm}
              onToggle={() => setShowConfirm((v) => !v)}
            />
          </Field>

          <AuthNotice>
            Setting a new password signs this device out of the reset link. You&apos;ll be
            taken to the sign-in screen to use it.
          </AuthNotice>

          <SubmitButton
            loading={saving}
            loadingLabel="Updating your password…"
            status={errors.general ? "error" : done ? "success" : "idle"}
            successLabel="Password updated"
            disabled={saving || done}
          >
            Update password
          </SubmitButton>
        </form>

        <p
          className="auth-enter mt-7 border-t border-border pt-5 text-center text-sm text-muted-foreground"
          style={enterDelay(220)}
        >
          Changed your mind?{" "}
          <Link
            href="/login"
            className="font-medium text-primary underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Back to sign in
          </Link>
        </p>
      </AuthCard>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  /**
   * The gate. Stable identity (useCallback with no deps) because ProtectedRoute
   * re-runs the check whenever the function changes.
   */
  const hasRecoverySession = useCallback(async () => {
    // An expired or already-used link comes back as an error in the URL, not a
    // token. Deny immediately rather than sitting through the grace window.
    if (urlCarriesAuthError()) return false;

    const { data, error } = await supabase.auth.getSession();
    if (error) return false;
    if (data?.session) return true;

    // No session yet. If the URL is not even carrying a recovery token there is
    // nothing to wait for — this is a direct visit, so bounce now.
    if (!urlCarriesRecoveryToken()) return false;

    // It is carrying one; give detectSessionInUrl its moment to consume it.
    return waitForSession(SESSION_GRACE_MS);
  }, []);

  return (
    <ProtectedRoute
      check={hasRecoverySession}
      redirectTo="/forgot-password"
      preserveRedirect={false}
      loadingMessage="Verifying your reset link…"
      deniedMessage="That link isn't valid any more — taking you back…"
    >
      <ResetPasswordForm />
    </ProtectedRoute>
  );
}
