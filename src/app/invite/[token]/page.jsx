"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

import { ArrowRight, BadgeCheck, Ban, Clock3, SearchX } from "lucide-react";
import { BRAND_NAME } from "@/components/brand";
import { Field, Input, Skeleton } from "@/components/ui";
import AuthShell, { BrandLockup } from "@/components/auth/AuthShell";
import {
  AUTH_INPUT,
  AuthCard,
  AuthError,
  AuthHeading,
  PasswordInput,
  SubmitButton,
} from "@/components/auth/AuthParts";

// Presentational only: which icon fronts each guard state.
const GUARD_ICONS = {
  "not-found": SearchX,
  revoked: Ban,
  accepted: BadgeCheck,
  expired: Clock3,
};

/**
 * Terms consent for the invitation path. Someone invited into an organization
 * is bound by exactly the same Terms as the person who created it, and until
 * now was equally unrecorded.
 *
 * UNCHECKED BY DEFAULT: no `defaultChecked`, and the state below starts false.
 * A pre-ticked box is not valid consent in the EU and is weak everywhere else.
 * /api/invitations/accept refuses without it regardless of what this renders.
 *
 * The error paragraph sits outside Field deliberately — Field clones its single
 * child to inject the id, so the aria wiring is done explicitly on the input.
 */
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

export default function AcceptInvitePage() {
  const params = useParams();
  const router = useRouter();
  const token = params?.token;

  const [loading, setLoading] = useState(true);
  const [invitation, setInvitation] = useState(null);
  const [orgName, setOrgName] = useState("");
  const [guard, setGuard] = useState(null); // 'not-found' | 'revoked' | 'accepted' | 'expired'

  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // Starts false and is never pre-set: the user has to tick it themselves.
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsError, setTermsError] = useState("");

  useEffect(() => {
    let active = true;

    const loadInvite = async () => {
      if (!token) {
        if (active) {
          setGuard("not-found");
          setLoading(false);
        }
        return;
      }

      try {
        // The invitee is NOT authenticated and `invitations` has RLS, so we
        // must resolve the token through a service-role server route (the
        // anon browser client would get 0 rows and show "not found").
        const res = await fetch(`/api/invitations/lookup?token=${encodeURIComponent(token)}`);
        const invite = await res.json().catch(() => ({}));

        if (!active) return;

        if (!res.ok || !invite || invite.error) {
          setGuard("not-found");
          setLoading(false);
          return;
        }

        setInvitation(invite);

        // Guard states
        if (invite.status === "revoked") {
          setGuard("revoked");
          setLoading(false);
          return;
        }
        if (invite.status === "accepted") {
          setGuard("accepted");
          setLoading(false);
          return;
        }
        if (invite.status === "expired" || invite.expired) {
          setGuard("expired");
          setLoading(false);
          return;
        }

        if (invite.orgName) setOrgName(invite.orgName);

        setLoading(false);
      } catch (err) {
        if (!active) return;
        setGuard("not-found");
        setLoading(false);
      }
    };

    loadInvite();
    return () => {
      active = false;
    };
  }, [token]);

  const handleAccept = async (e) => {
    e.preventDefault();
    if (!invitation) return;

    if (!termsAccepted) {
      setTermsError("Please accept the Terms of Service to continue");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      // Server-side acceptance (service_role): creates the user + membership +
      // Supabase Auth account and marks the invite accepted. Bypasses RLS.
      const res = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, fullName, password, termsAccepted }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to accept invitation.");
      }

      router.push("/login");
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  const guardMessages = {
    "not-found": {
      title: "Invitation not found",
      text: "We couldn't find this invitation. The link may be incorrect or no longer exist.",
    },
    revoked: {
      title: "Invitation revoked",
      text: "This invitation has been revoked by an administrator and can no longer be used.",
    },
    accepted: {
      title: "Already accepted",
      text: "This invitation has already been accepted. You can sign in with your account.",
    },
    expired: {
      title: "Invitation expired",
      text: "This invitation has expired. Please ask an administrator to send you a new one.",
    },
  };

  const roleLabel = invitation
    ? invitation.role.charAt(0).toUpperCase() + invitation.role.slice(1)
    : "";

  return (
    <AuthShell panelTitle="You've been invited. Let's get your account set up.">
      <div className="mb-8 flex items-center justify-between gap-4">
        <BrandLockup className="lg:invisible" />
      </div>

      <AuthCard>
        {loading ? (
          <div aria-busy="true" aria-live="polite">
            <span className="sr-only">Loading invitation</span>
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="mt-3 h-4 w-full" />
            <Skeleton className="mt-2 h-4 w-4/5" />
            <div className="mt-8 space-y-5" aria-hidden="true">
              <div className="space-y-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-11 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-11 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-11 w-full" />
              </div>
              <Skeleton className="h-11 w-full" />
            </div>
          </div>
        ) : guard ? (
          <div className="py-2 text-center">
            {(() => {
              const GuardIcon = GUARD_ICONS[guard];
              return (
                <span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground">
                  <GuardIcon className="h-5 w-5" aria-hidden="true" />
                </span>
              );
            })()}
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              {guardMessages[guard].title}
            </h1>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
              {guardMessages[guard].text}
            </p>
            <Link
              href="/login"
              className="mt-6 inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-5 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Go to sign in
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        ) : (
          <>
            <AuthHeading
              title="Accept your invitation"
              description={
                <>
                  You&apos;ve been invited to join
                  {orgName ? <strong className="font-medium text-foreground"> {orgName}</strong> : " the workspace"} as a{" "}
                  <strong className="font-medium text-foreground">{roleLabel}</strong>. Set up your
                  account to continue.
                </>
              }
            />

            <form onSubmit={handleAccept} className="mt-7 space-y-5">
              <Field
                label="Email address"
                htmlFor="invite-email"
                hint="Taken from your invitation and can't be changed."
              >
                <Input
                  id="invite-email"
                  type="email"
                  value={invitation?.email || ""}
                  className={`${AUTH_INPUT} bg-muted/50 text-muted-foreground`}
                  readOnly
                  autoComplete="email"
                />
              </Field>

              <Field label="Full name" htmlFor="invite-name" required>
                <Input
                  id="invite-name"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your full name"
                  className={AUTH_INPUT}
                  required
                  autoComplete="name"
                />
              </Field>

              <Field label="Password" htmlFor="invite-password" required>
                <PasswordInput
                  id="invite-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a password"
                  required
                  autoComplete="new-password"
                  aria-invalid={error ? true : undefined}
                  visible={showPassword}
                  onToggle={() => setShowPassword((v) => !v)}
                />
              </Field>

              <TermsConsent
                id="invite-terms"
                checked={termsAccepted}
                onChange={(next) => {
                  setTermsAccepted(next);
                  if (termsError) setTermsError("");
                }}
                error={termsError}
                disabled={submitting}
              />

              {error && <AuthError message={error} />}

              <SubmitButton
                loading={submitting}
                loadingLabel="Creating account…"
                disabled={submitting}
              >
                Accept &amp; create account
              </SubmitButton>
            </form>

            <p className="mt-7 border-t border-border pt-5 text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link
                href="/login"
                className="font-medium text-primary underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Sign in instead
              </Link>
            </p>
          </>
        )}
      </AuthCard>
    </AuthShell>
  );
}
