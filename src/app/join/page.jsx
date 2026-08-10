"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { ArrowLeft, Ban, BadgeCheck, Building2, Clock3, SearchX } from "lucide-react";

import { BRAND_NAME } from "@/components/brand";
import { showError, showSuccess } from "@/utils/alerts";
import { Button, Field, Input, Skeleton } from "@/components/ui";
import AuthShell, { BrandLockup, enterDelay } from "@/components/auth/AuthShell";
import {
  AUTH_INPUT,
  AuthCard,
  AuthError,
  AuthHeading,
  AuthNotice,
  PasswordChecklist,
  PasswordInput,
  SubmitButton,
} from "@/components/auth/AuthParts";
import { evaluatePassword } from "@/components/auth/passwordRules";

/**
 * /join — "Join with an invite".
 *
 * WHY THIS ROUTE EXISTS AT ALL
 *  "Join with an invite" and "Create an organization" used to be the same
 *  destination: /admin/registration, which is the org-creation form with a
 *  segmented toggle bolted onto it. Two things were wrong with that. The URL
 *  lied — someone joining a workspace is not registering an admin, and the path
 *  said /admin/registration. And the two acts have almost nothing in common:
 *  creating an organization asks for a company, an industry, a size, a country
 *  and an email verification round-trip; joining one asks for a code and a
 *  password, because the organization, the email and the ROLE were all decided
 *  by whoever sent the invitation. Sharing a form meant the join path inherited
 *  a mode toggle, a heading and a mental model built for the other job.
 *
 *  So the invite path gets its own route, its own copy and its own form. The
 *  org-creation form is untouched and still lives at /admin/registration.
 *
 * THE CODE FLOW, END TO END
 *  1. An admin creates an invitation (admin console). A row lands in
 *     `invitations` carrying the email, the role, an expiry and a random token.
 *     The token IS the secret — the same trust model as a magic link.
 *  2. The invitee arrives here, either by pasting the code or by following a
 *     link that carries ?token= (which we prefill from, so they never retype a
 *     UUID).
 *  3. This page GETs /api/invitations/lookup?token=… — a PUBLIC route BY
 *     DESIGN. `invitations` has RLS restricted to authenticated org members, and
 *     the invitee is by definition not one yet, so the browser's anon client
 *     would read zero rows and every valid code would look invalid. The route
 *     therefore uses the service role and returns only the minimal fields this
 *     screen needs — email, role, status, expiry, organization name — for a
 *     caller who already holds the secret. We call it purely to CONFIRM the
 *     code and show the invitee which workspace and which role they are about
 *     to accept, before they type a password. It grants nothing.
 *  4. On submit the page POSTs /api/invitations/accept with the token, the
 *     name, the password and the Terms acceptance. That route is where
 *     everything real happens, all of it server-side under the service role:
 *     it re-validates the token (not found / already used / revoked / expired),
 *     re-checks the plan's seat limit at the moment the seat is actually
 *     consumed, inserts the profile row into admin_users / clients / developers
 *     according to the INVITED role, inserts the membership, records the Terms
 *     acceptance, and only then creates the Supabase Auth account with
 *     `app_metadata` carrying the organization and role that every RLS policy
 *     and JWT check reads. Finally it marks the invitation accepted so the
 *     token cannot be replayed.
 *  5. The user is sent to /login (client-side) and signs in normally. This page
 *     never signs anyone in, never mints a session cookie and never decides a
 *     role — it collects three fields and reports what the server said.
 *
 *  NEITHER API ROUTE WAS CHANGED. This screen is built against them exactly as
 *  they are; the validation below is a courtesy so the user hears about an
 *  expired code before typing a password, never a substitute for the server's.
 */

const GUARD_ICONS = {
  "not-found": SearchX,
  revoked: Ban,
  accepted: BadgeCheck,
  expired: Clock3,
};

const GUARD_COPY = {
  "not-found": {
    title: "We couldn't find that invite",
    text: "Check the code against the email you were sent — it's easy to miss a character. If it still doesn't work, ask whoever invited you to send a fresh one.",
  },
  revoked: {
    title: "This invite was revoked",
    text: "An administrator cancelled this invitation, so it can no longer be used. Ask them to send you a new one.",
  },
  accepted: {
    title: "This invite has already been used",
    text: "An account was already created from this code. Sign in with it, or ask for a new invite if that wasn't you.",
  },
  expired: {
    title: "This invite has expired",
    text: "Invitations don't stay valid forever. Ask an administrator to send you a new one — it only takes them a moment.",
  },
};

/** Terms consent — unticked by default, always. See the note below. */
function TermsConsent({ id, checked, onChange, error, disabled }) {
  return (
    <div className="space-y-1.5">
      <Field
        htmlFor={id}
        className="flex flex-row-reverse items-start justify-end gap-x-2.5 space-y-0"
        labelClassName="flex-1 items-start text-sm font-normal leading-relaxed text-muted-foreground"
        label={
          <>
            I have read and agree to the{" "}
            <Link
              href="/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Terms of Service
            </Link>
            , including the responsibility to lawfully notify the people {BRAND_NAME} monitors
            before any tracking is switched on.
          </>
        }
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          aria-required="true"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
      </Field>
      {error && (
        <p id={`${id}-error`} className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** What the lookup told us, shown back before a password is typed. */
function InviteSummary({ invite }) {
  const roleLabel = invite.role
    ? invite.role.charAt(0).toUpperCase() + invite.role.slice(1)
    : "member";

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3.5">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-primary">
        <Building2 className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium text-foreground">
          {invite.orgName || "Your workspace"}
        </p>
        <p className="truncate text-sm text-muted-foreground">
          Joining as <span className="font-medium text-foreground">{roleLabel}</span>
          {invite.email ? (
            <>
              {" · "}
              <span className="font-medium text-foreground">{invite.email}</span>
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
}

function JoinForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // A link of the form /join?token=… prefills the field. The admin console also
  // hands out /invite/<token>, which is a different screen for the same accept
  // route; this one is for people who were emailed a bare code.
  const tokenFromUrl = searchParams?.get("token") || searchParams?.get("code") || "";

  const [token, setToken] = useState(tokenFromUrl);
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  // Starts false and is never pre-set: the user performs the act themselves.
  const [termsAccepted, setTermsAccepted] = useState(false);

  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const [checking, setChecking] = useState(false);
  const [invite, setInvite] = useState(null);
  const [guard, setGuard] = useState(null);

  const pwVal = evaluatePassword(password);
  const lastCheckedRef = useRef("");

  /**
   * Confirm the code against the public lookup route. Read-only and grants
   * nothing — /api/invitations/accept re-validates everything server-side.
   */
  const verifyToken = useCallback(async (raw) => {
    const value = String(raw || "").trim();
    if (!value || value === lastCheckedRef.current) return;
    lastCheckedRef.current = value;

    setChecking(true);
    setInvite(null);
    setGuard(null);

    try {
      const res = await fetch(
        `/api/invitations/lookup?token=${encodeURIComponent(value)}`
      );
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data || data.error) {
        setGuard("not-found");
        return;
      }
      if (data.status === "revoked") return setGuard("revoked");
      if (data.status === "accepted") return setGuard("accepted");
      if (data.status === "expired" || data.expired) return setGuard("expired");

      setInvite(data);
    } catch (err) {
      // Previously this class of failure would have been console-only. Route it
      // through the shared sweetalert2 helpers like every other surface.
      showError(
        "Couldn't check that invite code",
        "We couldn't reach the server to confirm your code. Check your connection and try again."
      );
      lastCheckedRef.current = "";
    } finally {
      setChecking(false);
    }
  }, []);

  // Prefilled codes are confirmed on arrival so the summary is already on
  // screen — the user should not have to poke a field they did not fill in.
  useEffect(() => {
    if (tokenFromUrl) verifyToken(tokenFromUrl);
  }, [tokenFromUrl, verifyToken]);

  const handleTokenChange = (value) => {
    setToken(value.trim());
    if (errors.token) setErrors((prev) => ({ ...prev, token: "" }));
    if (guard) setGuard(null);
    if (invite) setInvite(null);
    lastCheckedRef.current = "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const value = token.trim();
    const next = {};
    if (!value) next.token = "Invite code is required";
    if (!fullName.trim()) next.fullName = "Full name is required";
    if (!pwVal.isValid) next.password = "Password does not meet the requirements";
    if (password !== confirmPassword) next.confirmPassword = "Passwords do not match";
    if (!termsAccepted) next.terms = "Please accept the Terms of Service to continue";

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    try {
      // The one request that matters. Everything — token validity, seat limits,
      // which table the profile lands in, the role on the membership and the
      // Supabase Auth account itself — is decided by this route, server-side,
      // under the service role. See the flow note at the top of the file.
      const res = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: value,
          fullName: fullName.trim(),
          password,
          termsAccepted,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(
          data.error || "We couldn't complete your sign-up. Please try again."
        );
      }

      const roleWord = data.role
        ? data.role.charAt(0).toUpperCase() + data.role.slice(1)
        : "member";
      showSuccess(
        "You're in!",
        `Your ${roleWord} account is ready. Sign in to get started.`
      );

      // Client-side. The account exists but this page holds no session — the
      // user signs in normally, which is what mints the org context and the
      // signed session cookie.
      router.push("/login");
    } catch (err) {
      setErrors({ general: err.message });
      setSubmitting(false);
    }
  };

  const GuardIcon = guard ? GUARD_ICONS[guard] : null;

  return (
    <AuthShell panelTitle="Someone's already set up your workspace. Let's get you into it.">
      <div
        className="auth-enter mb-8 flex items-center justify-between gap-4"
        style={enterDelay(40)}
      >
        <BrandLockup className="lg:invisible" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => router.push("/")}
          className="h-9 gap-1.5 px-2.5 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to home
        </Button>
      </div>

      <AuthCard>
        <AuthHeading
          title="Join with an invite"
          description={`Your organization is already on ${BRAND_NAME}. Enter the code from your invitation email and pick a password — everything else was set up for you.`}
        />

        {errors.general && <AuthError message={errors.general} className="mt-6" />}

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <Field
            label="Invite code"
            htmlFor="join-token"
            error={errors.token}
            hint="Copy it from your invitation email."
            required
          >
            <Input
              id="join-token"
              type="text"
              value={token}
              onChange={(e) => handleTokenChange(e.target.value)}
              onBlur={(e) => verifyToken(e.target.value)}
              placeholder="e.g. 3f9c2a10-…"
              className={`${AUTH_INPUT} font-mono`}
              aria-invalid={errors.token || guard ? true : undefined}
              autoComplete="off"
              spellCheck="false"
              required
            />
          </Field>

          {/* Four states for the lookup, per the UI contract: checking, found,
              a named failure, and nothing typed yet. */}
          {checking ? (
            <div aria-busy="true" aria-live="polite">
              <span className="sr-only">Checking your invite code</span>
              <Skeleton className="h-[68px] w-full rounded-lg" />
            </div>
          ) : guard ? (
            <div
              role="status"
              className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3.5"
            >
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
                <GuardIcon className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium text-foreground">
                  {GUARD_COPY[guard].title}
                </p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {GUARD_COPY[guard].text}
                </p>
              </div>
            </div>
          ) : invite ? (
            <InviteSummary invite={invite} />
          ) : (
            <AuthNotice>
              Don&apos;t have a code? Only an administrator of an existing workspace can
              issue one. If you meant to start a new organization instead,{" "}
              <Link
                href="/admin/registration"
                className="font-medium text-primary underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                create one here
              </Link>
              .
            </AuthNotice>
          )}

          <Field label="Full name" htmlFor="join-name" error={errors.fullName} required>
            <Input
              id="join-name"
              type="text"
              value={fullName}
              onChange={(e) => {
                setFullName(e.target.value.replace(/[<>]/g, ""));
                if (errors.fullName) setErrors((prev) => ({ ...prev, fullName: "" }));
              }}
              placeholder="John Doe"
              className={AUTH_INPUT}
              aria-invalid={errors.fullName ? true : undefined}
              autoComplete="name"
              required
            />
          </Field>

          <div className="space-y-2">
            <Field label="Password" htmlFor="join-password" error={errors.password} required>
              <PasswordInput
                id="join-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (errors.password) setErrors((prev) => ({ ...prev, password: "" }));
                }}
                placeholder="Create a password"
                aria-invalid={errors.password ? true : undefined}
                autoComplete="new-password"
                required
                visible={showPassword}
                onToggle={() => setShowPassword((v) => !v)}
              />
            </Field>
            {password && <PasswordChecklist requirements={pwVal.requirements} />}
          </div>

          <Field
            label="Confirm password"
            htmlFor="join-confirm"
            error={errors.confirmPassword}
            required
          >
            <PasswordInput
              id="join-confirm"
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

          <TermsConsent
            id="join-terms"
            checked={termsAccepted}
            onChange={(nextValue) => {
              setTermsAccepted(nextValue);
              if (errors.terms) setErrors((prev) => ({ ...prev, terms: "" }));
            }}
            error={errors.terms}
            disabled={submitting}
          />

          <SubmitButton
            loading={submitting}
            loadingLabel="Creating your account…"
            status={errors.general ? "error" : "idle"}
            disabled={submitting}
          >
            Join the workspace
          </SubmitButton>
        </form>

        <p
          className="auth-enter mt-7 border-t border-border pt-5 text-center text-sm text-muted-foreground"
          style={enterDelay(220)}
        >
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-primary underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Sign in
          </Link>
        </p>
      </AuthCard>
    </AuthShell>
  );
}

/**
 * useSearchParams needs a Suspense boundary in the App Router, otherwise the
 * whole route opts out of static rendering with a build-time warning.
 */
export default function JoinPage() {
  return (
    <Suspense
      fallback={
        <AuthShell panelTitle="Someone's already set up your workspace. Let's get you into it.">
          <div className="mb-8">
            <BrandLockup className="lg:invisible" />
          </div>
          <AuthCard>
            <div aria-busy="true">
              <span className="sr-only">Loading</span>
              <Skeleton className="h-7 w-2/3" />
              <Skeleton className="mt-3 h-4 w-full" />
              <div className="mt-8 space-y-5" aria-hidden="true">
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-11 w-full" />
              </div>
            </div>
          </AuthCard>
        </AuthShell>
      }
    >
      <JoinForm />
    </Suspense>
  );
}
