"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ArrowLeft, MailCheck } from "lucide-react";

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
/**
 * /forgot-password — request a reset link.
 *
 * THE TOKEN IS SUPABASE'S. THE EMAIL IS OURS.
 *  This form used to call `supabase.auth.resetPasswordForEmail()` directly from
 *  the browser, which also made Supabase SEND the message — its template, its
 *  sender name, its wording. The recipient got mail naming a service they have
 *  never heard of, about an account they hold with us.
 *
 *  It now posts to /api/auth/forgot-password, which mints the identical
 *  single-use recovery link with `auth.admin.generateLink()` and delivers it
 *  through the product's own branded template and From address. There is still
 *  no reset table, no code of our own invention and no second idea of what a
 *  valid link is — a hand-rolled reset scheme is one of the easiest things in
 *  web software to get quietly, catastrophically wrong. Only the envelope
 *  changed. /api/auth/signup and the change-password route are untouched.
 *
 * WE DO NOT SAY WHETHER THE ADDRESS EXISTS.
 *  The confirmation below is identical whether or not an account was found, and
 *  so is the route's response. Telling an anonymous visitor "no account with
 *  that email" turns this form into an account-enumeration oracle for anybody
 *  with a list of addresses. The only failures surfaced are the ones about the
 *  REQUEST — a malformed address, or the rate limit.
 *
 * THE REDIRECT TARGET NEVER LEAVES THE SERVER.
 *  The route builds it from NEXT_PUBLIC_APP_URL / its own origin and refuses to
 *  read one from this request body, so nobody can have a real reset link mailed
 *  to a victim pointing at a host they control.
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
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The address and nothing else. In particular NOT a redirect target:
        // the server builds that itself and ignores anything sent here.
        body: JSON.stringify({ email: address }),
      });

      const payload = await response.json().catch(() => ({}));

      // A non-2xx here is only ever a bad address or the rate limit — the route
      // answers 200 for "no such account" on purpose.
      if (!response.ok) {
        throw new Error(
          payload?.error || "We couldn't send the reset email. Please try again."
        );
      }

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
