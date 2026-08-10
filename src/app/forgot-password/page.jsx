"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ArrowLeft, MailCheck } from "lucide-react";

import { supabase } from "@/utils/supabaseClient";
import { showError } from "@/utils/alerts";
import { Button, Field, Input } from "@/components/ui";
import AuthShell, { BrandLockup, enterDelay } from "@/components/auth/AuthShell";
import {
  AUTH_INPUT,
  AuthCard,
  AuthError,
  AuthHeading,
  AuthNotice,
  SubmitButton,
} from "@/components/auth/AuthParts";
import { currentResetRedirectUrl } from "@/components/auth/resetRedirect";

/**
 * /forgot-password — request a reset link.
 *
 * IT USES SUPABASE'S OWN PRIMITIVE, AND ONLY THAT.
 *  `supabase.auth.resetPasswordForEmail()` mints a single-use recovery token,
 *  emails it, and expires it. There is deliberately no token table, no
 *  `reset_tokens` column, no nonce of our own invention and no new API route:
 *  a hand-rolled reset scheme is one of the easiest things in web software to
 *  get quietly, catastrophically wrong, and Supabase Auth is already the only
 *  credential this product authenticates against. /api/auth/signup and the
 *  change-password route are not involved and were not touched.
 *
 * WE DO NOT SAY WHETHER THE ADDRESS EXISTS.
 *  The confirmation below is identical whether or not an account was found.
 *  Telling an anonymous visitor "no account with that email" turns this form
 *  into an account-enumeration oracle for anybody with a list of addresses.
 *  Supabase's own response is deliberately uninformative for the same reason,
 *  so the only failures we surface are the ones about the REQUEST — a
 *  malformed address, or its rate limit.
 *
 * THE REDIRECT TARGET IS NEVER HARDCODED.
 *  It comes from NEXT_PUBLIC_APP_URL, falling back to the origin the visitor is
 *  actually standing on. See src/components/auth/resetRedirect.js.
 */
export default function ForgotPasswordPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();

    const address = email.trim();
    if (!address) {
      setError("Enter the email address you sign in with.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const redirectTo = currentResetRedirectUrl();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        address,
        { redirectTo }
      );

      if (resetError) throw new Error(resetError.message);

      // Same screen either way — see the enumeration note above.
      setSent(true);
    } catch (err) {
      const message =
        err?.message || "We couldn't send the reset email. Please try again.";
      setError(message);
      // The shared sweetalert2 helper, not a bare alert() and not a
      // console-only failure.
      showError("Couldn't send the reset link", message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell panelTitle="Locked out? A reset link is a click away.">
      <div
        className="auth-enter mb-8 flex items-center justify-between gap-4"
        style={enterDelay(40)}
      >
        <BrandLockup className="lg:invisible" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => router.push("/login")}
          className="h-9 gap-1.5 px-2.5 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to sign in
        </Button>
      </div>

      <AuthCard>
        {sent ? (
          <div className="py-2 text-center">
            <span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted text-primary">
              <MailCheck className="h-5 w-5" aria-hidden="true" />
            </span>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Check your inbox
            </h1>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
              If an account exists for{" "}
              <span className="font-medium text-foreground">{email.trim()}</span>, we&apos;ve
              sent it a link to set a new password. The link is single-use and expires,
              so open it soon.
            </p>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Nothing after a few minutes? Check your spam folder, then try again.
            </p>

            <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Button type="button" variant="outline" onClick={() => setSent(false)}>
                Use a different address
              </Button>
              <Link
                href="/login"
                className="inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-medium text-primary underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Back to sign in
              </Link>
            </div>
          </div>
        ) : (
          <>
            <AuthHeading
              title="Reset your password"
              description="Enter the email address you sign in with and we'll send you a link to set a new password."
            />

            <form onSubmit={handleSubmit} className="mt-7 space-y-5">
              <Field label="Email address" htmlFor="forgot-email" required>
                <Input
                  id="forgot-email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (error) setError("");
                  }}
                  placeholder="you@example.com"
                  className={AUTH_INPUT}
                  required
                  autoComplete="email"
                  autoFocus
                  aria-invalid={error ? true : undefined}
                />
              </Field>

              <AuthNotice>
                The link signs you straight into a page where you choose a new password.
                It works once, and only for a short time.
              </AuthNotice>

              {error && <AuthError message={error} />}

              <SubmitButton
                loading={loading}
                loadingLabel="Sending the link…"
                status={error ? "error" : "idle"}
                disabled={loading}
              >
                Email me a reset link
              </SubmitButton>
            </form>

            <p
              className="auth-enter mt-7 border-t border-border pt-5 text-center text-sm text-muted-foreground"
              style={enterDelay(220)}
            >
              Remembered it?{" "}
              <Link
                href="/login"
                className="font-medium text-primary underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </AuthCard>
    </AuthShell>
  );
}
