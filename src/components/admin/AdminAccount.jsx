"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Info, Lock, ShieldCheck, User } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Field,
  Input,
  PageHeader,
  Section,
  Skeleton,
  ErrorState,
} from "@/components/ui";
import { PasswordChecklist, PasswordInput, SubmitButton } from "@/components/auth/AuthParts";
import { supabase } from "@/utils/supabaseClient";
import { authFetch } from "@/utils/authFetch";
import { getStoredAdminSession, setStoredAdminSession } from "@/utils/sessionPolicy";

/**
 * AdminAccount — the signed-in admin's OWN account settings.
 *
 * The admin portal had no Account screen at all: the sidebar had no entry, the
 * dashboard switch had no case, and POST /api/developer/change-password looked
 * its caller up in `developers` unconditionally, so an admin could not change
 * their password anywhere in the product. That route now resolves the profile
 * table from the caller's verified token; this screen is the surface for it.
 *
 * WHY EMAIL IS READ-ONLY HERE
 *  The address in `admin_users.email` is a display copy. The credential is the
 *  address held by Supabase Auth — it is what src/app/login/page.js signs in
 *  with, and it is a uniqueness key across the auth schema. Writing the profile
 *  column alone would produce an account whose displayed address and login
 *  address differ, and the owner would discover it by being locked out.
 *
 *  Doing it properly is auth.admin.updateUserById({ email }) plus a
 *  confirmation round-trip to the NEW address before the old one stops working,
 *  plus the collision case (the address already belongs to another auth user),
 *  plus the profile row and the memberships row that also carry the address.
 *  That is a feature, not a field, so this version shows the address and says
 *  plainly how to change it. A half-done email change is not a recoverable bug.
 */

export const MIN_PASSWORD_LENGTH = 8;

const normalize = (value) => (typeof value === "string" ? value.trim() : "");

/**
 * Requirement checks for the indicator. Only `minLength` is enforced — it is
 * what the server enforces too — the rest are advice, shown as an explicit
 * met/not-met list rather than a bare colour.
 */
export function passwordRequirements(password = "") {
  return {
    minLength: password.length >= MIN_PASSWORD_LENGTH,
    hasUpperCase: /[A-Z]/.test(password),
    hasLowerCase: /[a-z]/.test(password),
    hasNumbers: /\d/.test(password),
    hasSpecialChar: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password),
  };
}

const STRENGTH_LABELS = ["Too short", "Weak", "Fair", "Good", "Strong"];

/** 0–4. Reported as a word as well as a bar count, so the meter is never colour alone. */
export function passwordStrength(password = "") {
  if (!password) return { score: 0, label: "Empty" };
  const met = Object.values(passwordRequirements(password)).filter(Boolean).length;
  if (password.length < MIN_PASSWORD_LENGTH) return { score: 0, label: STRENGTH_LABELS[0] };
  const score = Math.max(1, Math.min(4, met - 1));
  return { score, label: STRENGTH_LABELS[score] };
}

/**
 * The whole client-side rule set for the password form, as a pure function so
 * it can be tested without a DOM. Returns a map of field -> message; empty means
 * the form may be submitted.
 *
 * The confirmation check lives here, which means it runs on every keystroke and
 * on submit — the mismatch is reported while the user is still typing, not after
 * a round-trip that would have told them the same thing a second later.
 */
export function validatePasswordChange({
  currentPassword = "",
  newPassword = "",
  confirmNewPassword = "",
} = {}) {
  const errors = {};

  if (!currentPassword) errors.currentPassword = "Enter your current password.";

  if (!newPassword) {
    errors.newPassword = "Enter a new password.";
  } else if (newPassword.length < MIN_PASSWORD_LENGTH) {
    errors.newPassword = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  } else if (currentPassword && newPassword === currentPassword) {
    errors.newPassword = "Your new password must be different from your current one.";
  }

  if (!confirmNewPassword) {
    errors.confirmNewPassword = "Re-enter your new password.";
  } else if (newPassword && confirmNewPassword !== newPassword) {
    errors.confirmNewPassword = "This does not match your new password.";
  }

  return errors;
}

function AccountSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <span className="sr-only">Loading your account…</span>
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-card">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-10 w-full max-w-md" />
      </div>
      <div className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-card">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-10 w-full max-w-md" />
      </div>
    </div>
  );
}

export default function AdminAccount({ user }) {
  const adminId = user?.id ?? null;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [account, setAccount] = useState(null);

  // ── Profile (name) ──────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState("");
  const [nameSaved, setNameSaved] = useState(false);

  // ── Password ────────────────────────────────────────────────────────
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [touched, setTouched] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordChanged, setPasswordChanged] = useState(false);

  const load = useCallback(async () => {
    if (!adminId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase
        .from("admin_users")
        .select("id, full_name, email, role")
        .eq("id", adminId)
        .maybeSingle();
      if (error) throw error;
      // Fall back to the session copy if the row can't be read — the screen is
      // still useful, and the password form does not depend on this read.
      const row = data || {
        id: adminId,
        full_name: user?.full_name || user?.name || "",
        email: user?.email || "",
        role: user?.role || null,
      };
      setAccount(row);
      setName(row.full_name || "");
    } catch (err) {
      setLoadError(err?.message || "Could not load your account details.");
    } finally {
      setLoading(false);
    }
  }, [adminId, user?.full_name, user?.name, user?.email, user?.role]);

  useEffect(() => {
    load();
  }, [load]);

  const email = useMemo(() => normalize(account?.email) || normalize(user?.email), [account, user]);
  const membershipRole = normalize(user?.membership_role) || normalize(account?.role) || "admin";

  const trimmedName = normalize(name);
  const nameDirty = trimmedName !== normalize(account?.full_name);

  const saveName = async (e) => {
    e.preventDefault();
    setNameSaved(false);
    setNameError("");

    if (!trimmedName) {
      setNameError("Enter your name.");
      return;
    }
    if (!nameDirty) return;

    setSavingName(true);
    try {
      const { data, error } = await supabase
        .from("admin_users")
        .update({ full_name: trimmedName })
        .eq("id", adminId)
        .select("id, full_name, email, role")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Your account row could not be updated.");

      setAccount(data);
      setName(data.full_name || "");
      // Keep the stored session in step so the shell's "Signed in as …" and the
      // avatar stop showing the old name without a re-login.
      const stored = getStoredAdminSession();
      if (stored) setStoredAdminSession({ ...stored, full_name: data.full_name });
      setNameSaved(true);
    } catch (err) {
      setNameError(err?.message || "Could not save your name.");
    } finally {
      setSavingName(false);
    }
  };

  // Live: every keystroke is re-checked, so a confirmation mismatch shows while
  // the user is still in the field.
  const fieldErrors = validatePasswordChange({ currentPassword, newPassword, confirmNewPassword });
  const shown = (key) => (touched[key] ? fieldErrors[key] : undefined);
  const markTouched = (key) => setTouched((t) => ({ ...t, [key]: true }));

  const requirements = passwordRequirements(newPassword);
  const strength = passwordStrength(newPassword);

  // Typing again means a new attempt: the previous outcome stops being true the
  // moment the form is edited, so it stops being shown.
  const clearOutcome = () => {
    if (passwordChanged) setPasswordChanged(false);
    if (passwordError) setPasswordError("");
  };

  const submitPassword = async (e) => {
    e.preventDefault();
    setPasswordChanged(false);
    setPasswordError("");

    // Blocked here, client-side: nothing is sent while the confirmation does not
    // match, or a field is empty, or the new password repeats the old one.
    setTouched({ currentPassword: true, newPassword: true, confirmNewPassword: true });
    if (Object.keys(fieldErrors).length > 0) return;

    setSubmitting(true);
    try {
      const res = await authFetch("/api/developer/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmNewPassword }),
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok || !payload?.success) {
        // Surfaced exactly as the route wrote it. Its 409s (unconfirmed email,
        // no linked auth user) and its 429 (rate limited) each tell the reader
        // something different and something actionable; flattening them into
        // "something went wrong" would send someone off to reset a password
        // that is perfectly fine.
        setPasswordError(payload?.error || "Your password could not be changed. Please try again.");
        return;
      }

      setPasswordChanged(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setTouched({});
    } catch {
      setPasswordError("Your password could not be changed — the request did not reach the server.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <AccountSkeleton />;

  if (!adminId) {
    return (
      <ErrorState
        title="No account context"
        description="We couldn't tell which account you are signed in as. Please sign in again."
      />
    );
  }

  if (loadError) {
    return <ErrorState title="Couldn't load your account" description={loadError} onRetry={load} />;
  }

  return (
    <div>
      <PageHeader
        title="Account"
        description="Your personal details and sign-in password."
        actions={<Badge variant="secondary" size="md">{membershipRole}</Badge>}
      />

      <div className="space-y-8">
        {/* ── Profile ─────────────────────────────────────────────── */}
        <Section
          title="Profile"
          description="How your name appears to everyone in this workspace."
        >
          <form
            onSubmit={saveName}
            noValidate
            className="space-y-5 rounded-xl border border-border bg-card p-4 shadow-card sm:p-5"
          >
            <div className="grid gap-5 md:grid-cols-2">
              <Field
                label="Name"
                htmlFor="admin-account-name"
                error={nameError || undefined}
                required
              >
                <Input
                  id="admin-account-name"
                  className="h-11"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameError("");
                    setNameSaved(false);
                  }}
                  autoComplete="name"
                  disabled={savingName}
                />
              </Field>

              <Field
                label="Email"
                htmlFor="admin-account-email"
                hint="This is your sign-in address, so it can't be changed here. Contact support to move your account to a different address."
              >
                <Input
                  id="admin-account-email"
                  value={email || "—"}
                  readOnly
                  aria-readonly="true"
                  className="h-11 bg-muted/50 text-muted-foreground"
                />
              </Field>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={savingName || !nameDirty}>
                <User className="h-4 w-4" aria-hidden="true" />
                {savingName ? "Saving…" : "Save name"}
              </Button>
              <p aria-live="polite" className="text-sm text-muted-foreground">
                {nameSaved ? (
                  <span className="inline-flex items-center gap-1.5 text-success">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    Name saved.
                  </span>
                ) : null}
              </p>
            </div>
          </form>
        </Section>

        {/* ── Password ────────────────────────────────────────────── */}
        <Section
          title="Password"
          description="Change the password you sign in with."
        >
          <form
            onSubmit={submitPassword}
            noValidate
            className="space-y-5 rounded-xl border border-border bg-card p-4 shadow-card sm:p-5"
          >
            {/* Both carry role="alert" from the primitive, so each is announced
                as it appears without an always-mounted live region adding a gap
                to the form when there is nothing to say. */}
            {passwordChanged && (
              <Alert className="border-success/30 bg-success/10">
                <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
                <AlertTitle className="text-success">Your password has been changed</AlertTitle>
                <AlertDescription className="text-success">
                  Use your new password the next time you sign in. This session stays signed in.
                </AlertDescription>
              </Alert>
            )}

            {passwordError && (
              <Alert variant="destructive">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                <AlertTitle>Password not changed</AlertTitle>
                <AlertDescription>{passwordError}</AlertDescription>
              </Alert>
            )}

            <div className="grid gap-5 md:max-w-md">
              <Field
                label="Current password"
                htmlFor="admin-current-password"
                error={shown("currentPassword")}
                required
              >
                <PasswordInput
                  id="admin-current-password"
                  value={currentPassword}
                  visible={showCurrent}
                  onToggle={() => setShowCurrent((v) => !v)}
                  onChange={(e) => {
                    setCurrentPassword(e.target.value);
                    clearOutcome();
                  }}
                  onBlur={() => markTouched("currentPassword")}
                  autoComplete="current-password"
                  disabled={submitting}
                />
              </Field>

              <Field
                label="New password"
                htmlFor="admin-new-password"
                error={shown("newPassword")}
                required
              >
                <PasswordInput
                  id="admin-new-password"
                  value={newPassword}
                  visible={showNew}
                  onToggle={() => setShowNew((v) => !v)}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    markTouched("newPassword");
                    clearOutcome();
                  }}
                  onBlur={() => markTouched("newPassword")}
                  autoComplete="new-password"
                  disabled={submitting}
                />
              </Field>

              {/* Strength + requirements. The bar count and the word carry the
                  meaning; the list marks each rule met or not met in text. */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-muted-foreground">Password strength</span>
                  <span className="text-xs font-semibold text-foreground">{strength.label}</span>
                </div>
                <div className="flex gap-1.5" aria-hidden="true">
                  {[1, 2, 3, 4].map((step) => (
                    <span
                      key={step}
                      className={`h-1.5 flex-1 rounded-full ${
                        step <= strength.score ? "bg-primary" : "bg-muted"
                      }`}
                    />
                  ))}
                </div>
                <p className="sr-only" aria-live="polite">
                  Password strength: {strength.label}
                </p>
                <PasswordChecklist requirements={requirements} id="admin-password-requirements" />
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  At least {MIN_PASSWORD_LENGTH} characters is required. The rest is advice — a
                  longer password with a mix of characters is much harder to guess.
                </p>
              </div>

              <Field
                label="Confirm new password"
                htmlFor="admin-confirm-password"
                error={shown("confirmNewPassword")}
                required
              >
                <PasswordInput
                  id="admin-confirm-password"
                  value={confirmNewPassword}
                  visible={showConfirm}
                  onToggle={() => setShowConfirm((v) => !v)}
                  onChange={(e) => {
                    setConfirmNewPassword(e.target.value);
                    markTouched("confirmNewPassword");
                    clearOutcome();
                  }}
                  onBlur={() => markTouched("confirmNewPassword")}
                  autoComplete="new-password"
                  disabled={submitting}
                />
              </Field>

              {/* Width is fixed by the widest state, so the button does not
                  resize as it moves from idle to "Changing…". */}
              <SubmitButton
                loading={submitting}
                loadingLabel="Changing…"
                disabled={submitting}
                className="sm:w-64"
              >
                <Lock className="h-4 w-4" aria-hidden="true" />
                Change password
              </SubmitButton>
            </div>
          </form>
        </Section>
      </div>
    </div>
  );
}
