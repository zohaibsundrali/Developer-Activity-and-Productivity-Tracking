"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/utils/supabaseClient";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { showInfo, showPre, showSuccess } from "@/utils/alerts";
import { SESSION_MAX_AGE_DAYS } from "@/utils/sessionPolicy";
import { authFetch } from "@/utils/authFetch";
// One name rule for the whole product — the same module the Add Developer form
// validates against, so the two forms cannot disagree about what a name is.
import { validatePersonName } from "@/utils/nameValidation";

import { ArrowLeft } from "lucide-react";
import { BRAND_NAME } from "@/components/brand";
import { Button, Field, Input } from "@/components/ui";
import AuthShell, { BrandLockup, enterDelay } from "@/components/auth/AuthShell";
import {
  AUTH_INPUT,
  AuthCard,
  AuthError,
  AuthHeading,
  AuthNotice,
  PasswordChecklist,
  PasswordInput,
  SegmentedControl,
  SubmitButton,
} from "@/components/auth/AuthParts";

/**
 * Create-organization fields in the order they appear, paired with the element
 * the caret goes to. Used to send the user to the first thing they must fix —
 * including the terms box, which is the one problem that is easy to scroll
 * past without noticing.
 */
const CREATE_FIELD_ORDER = [
  ["fullName", "reg-name"],
  ["company", "reg-company"],
  ["email", "reg-email"],
  ["password", "reg-password"],
  ["confirmPassword", "reg-confirm"],
  ["terms", "reg-terms"],
];

// ── Verification code ────────────────────────────────────────────────

const OTP_LENGTH = 4;
/** Must match `CODE_TTL_MINUTES` in src/app/api/send-verification/route.js —
 *  that is the number the email states, this is the one the page counts down. */
const CODE_TTL_MINUTES = 10;
const CODE_TTL_MS = CODE_TTL_MINUTES * 60 * 1000;

const emptyDigits = () => Array(OTP_LENGTH).fill("");

/** m:ss, never negative. */
function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * One box per digit.
 *
 * Rendered as the single child of a `Field`, which clones it to inject `id`,
 * `aria-describedby`, `aria-invalid` and `aria-required` — so the error message
 * Field renders is announced on the boxes without repeating the wiring here.
 * The injected `id` lands on the FIRST box, which is what the visible label's
 * htmlFor points at; every box additionally carries its own accessible name,
 * because "Verification code" said four times tells a screen reader user
 * nothing about where they are.
 *
 * Keyboard behaviour is the boring, expected one: a digit advances, Backspace
 * clears the current box or steps back into the previous one, arrows move,
 * Home/End jump to the ends. A paste anywhere spreads its digits across the
 * boxes from that point on, so pasting "1234" into the first box fills all four
 * instead of putting "1234" in one box and dropping three characters.
 */
function OtpInput({
  id,
  digits,
  onChange,
  disabled = false,
  focusSignal = 0,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
  "aria-required": required,
}) {
  const boxes = useRef([]);
  const length = digits.length;

  const focusBox = (index) => {
    const el = boxes.current[Math.max(0, Math.min(length - 1, index))];
    if (!el) return;
    el.focus();
    if (typeof el.select === "function") el.select();
  };

  // Focus the first box when the group appears and again whenever the caller
  // bumps the signal (a resend, or a wrong code being cleared).
  useEffect(() => {
    if (disabled) return;
    focusBox(0);
    // focusBox is recreated each render; re-running on every render is not the
    // intent — the signal is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSignal, disabled]);

  /** Write `chars` from `index` onwards; returns the index after the last. */
  const writeFrom = (index, chars) => {
    const next = digits.slice();
    let cursor = index;
    for (const ch of chars) {
      if (cursor >= length) break;
      next[cursor] = ch;
      cursor += 1;
    }
    onChange(next);
    return cursor;
  };

  const handleChange = (index) => (event) => {
    let typed = event.target.value.replace(/\D/g, "");
    // A box that already held a digit can report "old+new" when the caret sat
    // after the old one; the new character is the one the user meant.
    if (typed.length > 1 && typed[0] === digits[index]) typed = typed.slice(1);
    if (!typed) {
      const next = digits.slice();
      next[index] = "";
      onChange(next);
      return;
    }
    const cursor = writeFrom(index, typed);
    focusBox(cursor);
  };

  const handleKeyDown = (index) => (event) => {
    if (event.key === "Backspace") {
      event.preventDefault();
      const next = digits.slice();
      if (next[index]) {
        next[index] = "";
        onChange(next);
      } else if (index > 0) {
        next[index - 1] = "";
        onChange(next);
        focusBox(index - 1);
      }
      return;
    }
    if (event.key === "Delete") {
      event.preventDefault();
      const next = digits.slice();
      next[index] = "";
      onChange(next);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusBox(index - 1);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      focusBox(index + 1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusBox(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusBox(length - 1);
    }
  };

  const handlePaste = (index) => (event) => {
    const pasted = (event.clipboardData?.getData("text") || "").replace(/\D/g, "");
    if (!pasted) return;
    event.preventDefault();
    const cursor = writeFrom(index, pasted.slice(0, length - index));
    focusBox(cursor);
  };

  return (
    // `justify-center`, and a bigger gap. The boxes used to sit flush left
    // under a left-aligned label, which on a 4-digit code left most of the card
    // empty to their right and read as an unfinished row rather than a code
    // entry. Centring is what every OTP screen does, and it is also what makes
    // the group look deliberate at both breakpoints.
    <div
      className="flex items-center justify-center gap-3 sm:gap-4"
      role="group"
      aria-label="Verification code"
    >
      {digits.map((digit, index) => (
        <input
          key={index}
          id={index === 0 ? id : `${id}-${index + 1}`}
          ref={(el) => {
            boxes.current[index] = el;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          maxLength={1}
          value={digit}
          disabled={disabled}
          aria-label={`Verification code, digit ${index + 1} of ${length}`}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          aria-required={required}
          onChange={handleChange(index)}
          onKeyDown={handleKeyDown(index)}
          onPaste={handlePaste(index)}
          onFocus={(event) => event.target.select()}
          className={`h-14 w-12 rounded-lg border bg-transparent text-center font-mono text-2xl font-semibold text-foreground outline-none transition-colors duration-150 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 sm:w-14 ${
            invalid ? "border-destructive" : "border-input"
          }`}
        />
      ))}
    </div>
  );
}

/**
 * Terms consent. Both registration paths on this page need it — creating a new
 * organization and joining an existing one with an invite code — and both
 * servers refuse without it (src/app/api/auth/signup/route.js and
 * src/app/api/invitations/accept/route.js).
 *
 * UNCHECKED BY DEFAULT, always. There is no `defaultChecked` and the caller's
 * state starts `false`: a pre-ticked box is not valid consent in the EU and is
 * weak everywhere else, so the user has to perform the act themselves.
 *
 * The error paragraph sits OUTSIDE Field on purpose. Field clones its single
 * child to inject the id, so a wrapper element placed inside it would swallow
 * that wiring; and Field's own `error` slot would be laid out as a third item
 * in this row. The id/aria wiring is therefore done explicitly on the input.
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
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export default function AdminRegistration() {
  const [formData, setFormData] = useState({
    fullName: "",
    company: "",
    industry: "",
    companySize: "",
    country: "",
    email: "",
    password: "",
    confirmPassword: ""
  });
  // One entry per box. Holding the digits positionally rather than as a single
  // string is what lets box 3 be cleared without box 4 sliding into its place.
  const [codeDigits, setCodeDigits] = useState(emptyDigits);
  const [generatedCode, setGeneratedCode] = useState("");
  const [codeExpiry, setCodeExpiry] = useState(null);
  // Ticks the countdown. Only runs while step 2 is on screen and the code is
  // still alive, and stops itself the moment it expires.
  const [nowTs, setNowTs] = useState(() => Date.now());
  // Bumped to put the caret back in the first box (resend, cleared attempt).
  const [otpFocusSignal, setOtpFocusSignal] = useState(0);
  // The code the auto-submit has already tried, so filling the last box fires
  // verification exactly once instead of on every re-render.
  const attemptedCode = useRef("");
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  // Terms acceptance, one flag per registration path. Both start FALSE and are
  // never pre-set. They are separate so that ticking the box on one form can
  // never carry over into the other — consent is given for the act in front of
  // you, not inherited from a form you abandoned.
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [joinTermsAccepted, setJoinTermsAccepted] = useState(false);
  const router = useRouter();

  // "create" = start a new organization (owner). "join" = accept an emailed
  // invite code and join an existing organization with the invited role.
  const [mode, setMode] = useState("create");
  const [joinData, setJoinData] = useState({
    token: "",
    fullName: "",
    password: "",
    confirmPassword: "",
  });
  const [joinLoading, setJoinLoading] = useState(false);

  // ── Derived verification state ──
  const code = codeDigits.join("");
  const codeComplete = codeDigits.every((digit) => digit !== "");
  const msLeft = codeExpiry ? Math.max(0, codeExpiry - nowTs) : 0;
  const codeExpired = step === 2 && Boolean(codeExpiry) && msLeft === 0;

  /**
   * What the code field says. Expiry outranks a wrong code: once the code is
   * dead, "that code isn't right" is the wrong advice — there is nothing to
   * correct, only a new code to ask for. The two messages are deliberately
   * different, and both reach the input through Field's `error` prop, which is
   * what puts them in aria-describedby.
   */
  const codeMessage = codeExpired
    ? "That code has expired. Ask for a new one and we'll email a fresh code."
    : errors.code;

  /** Clear the boxes and put the caret back in the first one. */
  const resetCodeBoxes = () => {
    setCodeDigits(emptyDigits());
    attemptedCode.current = "";
    setOtpFocusSignal((n) => n + 1);
  };

  const handleJoinChange = (field, value) => {
    const v = field === "token" ? value.trim() : sanitizeInput(value);
    setJoinData((prev) => ({ ...prev, [field]: v }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: "" }));
  };

  const switchMode = (next) => {
    setMode(next);
    setErrors({});
  };

  const handleJoin = async (e) => {
    e.preventDefault();
    setErrors({});

    const token = joinData.token.trim();
    if (!token) return setErrors({ token: "Invite code is required" });
    if (!joinData.fullName || !joinData.fullName.trim())
      return setErrors({ fullName: "Full name is required" });
    if (!validatePassword(joinData.password).isValid)
      return setErrors({ password: "Password does not meet requirements" });
    if (joinData.password !== joinData.confirmPassword)
      return setErrors({ confirmPassword: "Passwords do not match" });
    if (!joinTermsAccepted)
      return setErrors({ terms: "Please accept the Terms of Service to continue" });

    setJoinLoading(true);
    try {
      // Reuse the secure server-side accept endpoint: it validates the invite
      // token, creates the profile + membership + Supabase Auth account with the
      // role the admin assigned, and links the org. No open self-serve join.
      const res = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          fullName: joinData.fullName.trim(),
          password: joinData.password,
          termsAccepted: joinTermsAccepted,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Could not join. Please check your invite code.");
      }

      const roleWord = data.role
        ? data.role.charAt(0).toUpperCase() + data.role.slice(1)
        : "member";
      showSuccess(
        "You're in!",
        `Your ${roleWord} account is ready. Please sign in to continue.`
      );
      router.push("/login");
    } catch (err) {
      setErrors({ general: err.message });
    } finally {
      setJoinLoading(false);
    }
  };

  const handleGoToHome = () => {
    router.push("/");
  };

  // The EmailJS SDK used to be initialised here with NEXT_PUBLIC_EMAILJS_PUBLIC_KEY.
  // Nothing on this page — or anywhere in src/ — ever called emailjs.send(), so
  // the only effect was loading a third-party SDK into the signup bundle and
  // handing it a key. Verification codes go through /api/send-verification
  // (see src/utils/emailService.js). Removed rather than left for an auditor to
  // find; the @emailjs/browser dependency is still in package.json and should
  // be dropped too.

  const validateEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validatePassword = (password) => {
    const minLength = 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);

    return {
      isValid: password.length >= minLength && hasUpperCase && hasLowerCase && hasNumbers && hasSpecialChar,
      requirements: {
        minLength: password.length >= minLength,
        hasUpperCase,
        hasLowerCase,
        hasNumbers,
        hasSpecialChar
      }
    };
  };

  const sanitizeInput = (input) => {
    return input.replace(/[<>]/g, '');
  };

  const handleInputChange = (field, value) => {
    const sanitizedValue = sanitizeInput(value);
    setFormData(prev => ({
      ...prev,
      [field]: sanitizedValue
    }));

    // The name is checked on every keystroke, not only on submit: finding out
    // that "Ali 2" is not a name after filling in six more fields and waiting
    // for a round trip is the thing this avoids. An empty box is not an error
    // — `validatePersonName` returns "" for it — so nobody is scolded before
    // they have typed. The required case is caught by `validateForm` below.
    if (field === "fullName") {
      const message = validatePersonName(sanitizedValue);
      setErrors(prev => ({ ...prev, fullName: message }));
      return;
    }

    if (errors[field]) {
      setErrors(prev => ({
        ...prev,
        [field]: ""
      }));
    }
  };

  const validateForm = () => {
    const newErrors = {};

    if (!formData.fullName || formData.fullName.trim() === "") {
      newErrors.fullName = "Full name is required";
    } else {
      const nameProblem = validatePersonName(formData.fullName);
      if (nameProblem) newErrors.fullName = nameProblem;
    }

    if (!formData.company || formData.company.trim() === "") {
      newErrors.company = "Company is required";
    }

    if (!formData.email) {
      newErrors.email = "Email is required";
    } else if (!validateEmail(formData.email)) {
      newErrors.email = "Please enter a valid email address";
    }

    if (!formData.password) {
      newErrors.password = "Password is required";
    } else {
      const passwordValidation = validatePassword(formData.password);
      if (!passwordValidation.isValid) {
        newErrors.password = "Password does not meet requirements";
      }
    }

    if (!formData.confirmPassword) {
      newErrors.confirmPassword = "Please confirm your password";
    } else if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = "Passwords do not match";
    }

    // Checked at step 1, before the verification code is even sent: there is no
    // point emailing a code for an account the server will refuse to create.
    // The flag survives into step 2, which is where the signup POST happens.
    //
    // This is the CLIENT half only. /api/auth/signup refuses without the flag
    // and creates nothing when it does (400), and that check is the one that
    // counts — anyone can POST past this form. What this adds is that the
    // browser never gets that far: submitting with the box unticked stops
    // here, says why next to the box, and moves the caret to it.
    if (!termsAccepted) {
      newErrors.terms = "Please accept the Terms of Service to continue";
    }

    setErrors(newErrors);
    return newErrors;
  };

  /** Move the caret to the first field the user has to fix. */
  const focusFirstProblem = (problems) => {
    for (const [field, elementId] of CREATE_FIELD_ORDER) {
      if (problems[field]) {
        document.getElementById(elementId)?.focus();
        return;
      }
    }
  };

  const sendVerificationCode = async (userEmail) => {
    // A fresh code means a fresh deadline and empty boxes; leaving the old
    // digits sitting there after a resend is how people verify with the code
    // that has just been superseded.
    const nextCode = Math.floor(1000 + Math.random() * 9000).toString();
    setGeneratedCode(nextCode);
    setCodeExpiry(Date.now() + CODE_TTL_MS);
    setNowTs(Date.now());
    resetCodeBoxes();

    try {
      const response = await fetch('/api/send-verification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: userEmail,
          userName: formData.fullName,
          company: formData.company,
          code: nextCode
        }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        setStep(2);
        return { success: true };
      } else {
        throw new Error(result.error || 'Email service unavailable');
      }

    } catch (error) {
      // `generatedCode` here used to read the PREVIOUS code out of the closure
      // — state set two lines earlier is not visible until the next render —
      // so the fallback offered a code that no longer verified (and, on the
      // first send, an empty one). It has to be the local.
      showPre(
        "Email service unavailable",
        `EMAIL SERVICE TEMPORARILY UNAVAILABLE\n\nUse this code for testing: ${nextCode}\n\nThis would be sent to: ${formData.email}`,
        "warning"
      );

      setStep(2);
      return { success: true };
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrors({});

    const problems = validateForm();
    if (Object.keys(problems).length > 0) {
      setLoading(false);
      focusFirstProblem(problems);
      return;
    }

    try {
      const { data: existing, error: fetchError } = await supabase
        .from("admin_users")
        .select("*")
        .eq("email", formData.email);

      if (fetchError) throw fetchError;

      if (existing && existing.length > 0) {
        setErrors({ email: "Email already registered!" });
        setLoading(false);
        return;
      }

      await sendVerificationCode(formData.email);

    } catch (error) {
      setErrors({ general: error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    setLoading(true);
    setErrors({});
    try {
      await sendVerificationCode(formData.email);
      showInfo("Verification sent", "Verification code has been resent to your email.");
    } catch (error) {
      setErrors({ general: error.message });
    } finally {
      setLoading(false);
    }
  };

  const verifyCodeAndRegister = async (e) => {
    // Called both by the form's submit and, with no event, by the effect that
    // fires as soon as the fourth box is filled.
    if (e) e.preventDefault();
    setVerificationLoading(true);
    setErrors({});

    // Three outcomes, three messages. "Something went wrong" here would leave
    // the user retyping a code that can never work.
    if (!codeExpiry || Date.now() > codeExpiry) {
      setErrors({ code: "That code has expired. Ask for a new one and we'll email a fresh code." });
      setVerificationLoading(false);
      return;
    }

    if (!codeComplete) {
      setErrors({ code: `Enter all ${OTP_LENGTH} digits of the code.` });
      setVerificationLoading(false);
      return;
    }

    if (code !== generatedCode) {
      setErrors({
        code: "That code isn't right. Check the digits in the email, or ask for a new code.",
      });
      setVerificationLoading(false);
      // Clearing beats making them delete four boxes by hand, and it puts the
      // caret back where the next attempt starts.
      resetCodeBoxes();
      return;
    }

    try {
      const { error: testError } = await supabase
        .from('admin_users')
        .select('count')
        .limit(1);

      if (testError) {
        throw new Error(`Database connection failed: ${testError.message}`);
      }

      // Server-side signup (service_role): creates the admin, organization,
      // owner membership and Supabase Auth account. Bypasses RLS so signup works
      // once RLS is enabled.
      const signupRes = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: formData.fullName,
          company: formData.company,
          industry: formData.industry,
          companySize: formData.companySize,
          country: formData.country,
          email: formData.email,
          password: formData.password,
          timezone: (typeof Intl !== "undefined" && Intl.DateTimeFormat().resolvedOptions().timeZone) || "UTC",
          termsAccepted,
        }),
      });
      const signupData = await signupRes.json().catch(() => ({}));
      if (!signupRes.ok || !signupData.success) {
        throw new Error(signupData.error || "Registration failed. Please try again.");
      }

      const newAdmin = signupData.admin;
      const orgId = signupData.organizationId;
      const orgName = signupData.organizationName;

      const nowIso = new Date().toISOString();
      const adminSession = {
        ...newAdmin,
        organization_id: orgId || newAdmin.organization_id || null,
        organization_name: orgName,
        membership_role: "owner",
        role: 'admin',
        loginTime: nowIso,
        lastActivity: nowIso,
      };
      sessionStorage.setItem("adminUser", JSON.stringify(adminSession));
      localStorage.removeItem("adminUser");
      sessionStorage.setItem("adminToken", "admin-authenticated");

      try {
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + SESSION_MAX_AGE_DAYS);
        document.cookie = `admin_auth=true; expires=${expiryDate.toUTCString()}; path=/`;
        document.cookie = `admin_id=${adminSession.id}; expires=${expiryDate.toUTCString()}; path=/`;
      } catch {
      }

      // Issue the signed, HttpOnly session cookie the middleware validates.
      // Without it the new admin would be bounced straight back to /login.
      try {
        await authFetch("/api/auth/session", { method: "POST" });
      } catch {
      }

      showSuccess("Registration complete", "Registration successful. Redirecting to dashboard.");
      router.push("/admin/dashboard");

    } catch (error) {
      setErrors({
        general: error.message || "Registration failed! Please check console for details."
      });
    } finally {
      setVerificationLoading(false);
    }
  };

  /**
   * The countdown.
   *
   * It ticks once a second while step 2 is on screen and stops itself the
   * moment the deadline passes, so an abandoned tab is not re-rendering for
   * ever. Read the honest version of what it measures in the report and in
   * src/app/api/send-verification/route.js: the code is minted in this browser
   * and compared in this browser, so this deadline is enforced here and
   * nowhere else.
   */
  useEffect(() => {
    if (step !== 2 || !codeExpiry) return undefined;
    setNowTs(Date.now());
    if (Date.now() >= codeExpiry) return undefined;

    const timer = setInterval(() => {
      const now = Date.now();
      setNowTs(now);
      if (now >= codeExpiry) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [step, codeExpiry]);

  /**
   * Filling the last box IS the submit. `attemptedCode` makes that fire once
   * per distinct code rather than on every render that happens to see four
   * full boxes, and `resetCodeBoxes` clears it so a retry of the same digits
   * is still allowed to run.
   */
  useEffect(() => {
    if (step !== 2) return;
    if (!codeComplete || verificationLoading || codeExpired) return;
    if (attemptedCode.current === code) return;
    attemptedCode.current = code;
    verifyCodeAndRegister();
    // verifyCodeAndRegister is re-created on every render; listing it would run
    // this on every render. The trigger is the code being complete.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, code, codeComplete, codeExpired, verificationLoading]);

  const pwVal = validatePassword(formData.password);

  return (
    <AuthShell panelTitle="Set up the workspace your team will actually use.">
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
        {mode === "create" && (
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Step {step} of 2 — {step === 2 ? "verify your email" : "your details"}
          </p>
        )}

        <AuthHeading
          title={
            step === 2
              ? "Verify your email"
              : mode === "join"
              ? "Join an organization"
              : "Create your workspace"
          }
          description={
            step === 2
              ? "We sent a 4-digit verification code to your inbox."
              : mode === "join"
              ? "Enter the invite code your organization sent you."
              : "Set up admin access to the tracking dashboard for your company."
          }
        />

        {errors.general && <AuthError message={errors.general} className="mt-6" />}

        {step === 1 ? (
          <>
            <div className="mt-6">
              <SegmentedControl
                label="Registration type"
                value={mode}
                onChange={switchMode}
                options={[
                  { value: "create", label: "Create organization" },
                  { value: "join", label: "Join with code" },
                ]}
              />
            </div>

            {mode === "create" ? (
              <form onSubmit={handleRegister} className="mt-6 space-y-5">
                <Field label="Full name" htmlFor="reg-name" error={errors.fullName} required>
                  <Input
                    id="reg-name"
                    type="text"
                    placeholder="John Doe"
                    value={formData.fullName}
                    onChange={(e) => handleInputChange('fullName', e.target.value)}
                    className={AUTH_INPUT}
                    aria-invalid={errors.fullName ? true : undefined}
                    autoComplete="name"
                    required
                  />
                </Field>

                <Field
                  label="Company / organization"
                  htmlFor="reg-company"
                  error={errors.company}
                  hint="This becomes the name of your workspace."
                  required
                >
                  <Input
                    id="reg-company"
                    type="text"
                    placeholder="Tech Solutions Inc."
                    value={formData.company}
                    onChange={(e) => handleInputChange('company', e.target.value)}
                    className={AUTH_INPUT}
                    aria-invalid={errors.company ? true : undefined}
                    required
                  />
                </Field>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Industry" htmlFor="reg-industry" hint="Optional">
                    <select
                      id="reg-industry"
                      value={formData.industry}
                      onChange={(e) => handleInputChange('industry', e.target.value)}
                      className="h-11 w-full rounded-lg border border-input bg-transparent px-3 text-base text-foreground outline-none transition-colors duration-150 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:text-sm"
                    >
                      <option value="">Select industry</option>
                      {["Technology","Finance","Healthcare","Education","Retail","Manufacturing","Consulting","Marketing","Other"].map((i) => (
                        <option key={i} value={i}>{i}</option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Company size" htmlFor="reg-size" hint="Optional">
                    <select
                      id="reg-size"
                      value={formData.companySize}
                      onChange={(e) => handleInputChange('companySize', e.target.value)}
                      className="h-11 w-full rounded-lg border border-input bg-transparent px-3 text-base text-foreground outline-none transition-colors duration-150 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 sm:text-sm"
                    >
                      <option value="">Select size</option>
                      {["1-10","11-50","51-200","201-500","500+"].map((s) => (
                        <option key={s} value={s}>{s} employees</option>
                      ))}
                    </select>
                  </Field>
                </div>

                <Field label="Country" htmlFor="reg-country" hint="Optional">
                  <Input
                    id="reg-country"
                    type="text"
                    placeholder="Pakistan"
                    value={formData.country}
                    onChange={(e) => handleInputChange('country', e.target.value)}
                    className={AUTH_INPUT}
                  />
                </Field>

                <Field label="Email address" htmlFor="reg-email" error={errors.email} required>
                  <Input
                    id="reg-email"
                    type="email"
                    placeholder="john@example.com"
                    value={formData.email}
                    onChange={(e) => handleInputChange('email', e.target.value)}
                    className={AUTH_INPUT}
                    aria-invalid={errors.email ? true : undefined}
                    autoComplete="email"
                    required
                  />
                </Field>

                <div className="space-y-2">
                  <Field label="Password" htmlFor="reg-password" error={errors.password} required>
                    <PasswordInput
                      id="reg-password"
                      placeholder="Min. 8 characters"
                      value={formData.password}
                      onChange={(e) => handleInputChange('password', e.target.value)}
                      aria-invalid={errors.password ? true : undefined}
                      autoComplete="new-password"
                      required
                      visible={showPassword}
                      onToggle={() => setShowPassword(!showPassword)}
                    />
                  </Field>
                  {formData.password && <PasswordChecklist requirements={pwVal.requirements} />}
                </div>

                <Field
                  label="Confirm password"
                  htmlFor="reg-confirm"
                  error={errors.confirmPassword}
                  required
                >
                  <PasswordInput
                    id="reg-confirm"
                    placeholder="Repeat password"
                    value={formData.confirmPassword}
                    onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
                    aria-invalid={errors.confirmPassword ? true : undefined}
                    autoComplete="new-password"
                    required
                    visible={showConfirmPassword}
                    onToggle={() => setShowConfirmPassword(!showConfirmPassword)}
                  />
                </Field>

                <TermsConsent
                  id="reg-terms"
                  checked={termsAccepted}
                  onChange={(next) => {
                    setTermsAccepted(next);
                    if (errors.terms) setErrors((prev) => ({ ...prev, terms: "" }));
                  }}
                  error={errors.terms}
                  disabled={loading}
                />

                <SubmitButton
                  loading={loading}
                  loadingLabel="Processing…"
                  status={errors.general || errors.email ? "error" : "idle"}
                  disabled={loading}
                >
                  Create account
                </SubmitButton>
              </form>
            ) : (
              <form onSubmit={handleJoin} className="mt-6 space-y-5">
                <AuthNotice>
                  Paste the invite code from the email your organization sent you.
                </AuthNotice>

                <Field label="Invite code" htmlFor="join-token" error={errors.token} required>
                  <Input
                    id="join-token"
                    type="text"
                    placeholder="e.g. 3f9c2a10-…"
                    value={joinData.token}
                    onChange={(e) => handleJoinChange('token', e.target.value)}
                    className={`${AUTH_INPUT} font-mono`}
                    aria-invalid={errors.token ? true : undefined}
                    required
                  />
                </Field>

                <Field label="Full name" htmlFor="join-name" error={errors.fullName} required>
                  <Input
                    id="join-name"
                    type="text"
                    placeholder="John Doe"
                    value={joinData.fullName}
                    onChange={(e) => handleJoinChange('fullName', e.target.value)}
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
                      placeholder="Min. 8 characters"
                      value={joinData.password}
                      onChange={(e) => handleJoinChange('password', e.target.value)}
                      aria-invalid={errors.password ? true : undefined}
                      autoComplete="new-password"
                      required
                      visible={showPassword}
                      onToggle={() => setShowPassword(!showPassword)}
                    />
                  </Field>
                  {joinData.password && (
                    <PasswordChecklist
                      requirements={validatePassword(joinData.password).requirements}
                    />
                  )}
                </div>

                <Field
                  label="Confirm password"
                  htmlFor="join-confirm"
                  error={errors.confirmPassword}
                  required
                >
                  <PasswordInput
                    id="join-confirm"
                    placeholder="Repeat password"
                    value={joinData.confirmPassword}
                    onChange={(e) => handleJoinChange('confirmPassword', e.target.value)}
                    aria-invalid={errors.confirmPassword ? true : undefined}
                    autoComplete="new-password"
                    required
                    visible={showConfirmPassword}
                    onToggle={() => setShowConfirmPassword(!showConfirmPassword)}
                  />
                </Field>

                <TermsConsent
                  id="join-terms"
                  checked={joinTermsAccepted}
                  onChange={(next) => {
                    setJoinTermsAccepted(next);
                    if (errors.terms) setErrors((prev) => ({ ...prev, terms: "" }));
                  }}
                  error={errors.terms}
                  disabled={joinLoading}
                />

                <SubmitButton
                  loading={joinLoading}
                  loadingLabel="Joining…"
                  status={errors.general ? "error" : "idle"}
                  disabled={joinLoading}
                >
                  Join organization
                </SubmitButton>
              </form>
            )}
          </>
        ) : (
          <form onSubmit={verifyCodeAndRegister} className="mt-6 space-y-5">
            <AuthNotice>
              Enter the {OTP_LENGTH}-digit code we emailed to{" "}
              <span className="font-medium text-foreground">{formData.email}</span>. It expires{" "}
              {CODE_TTL_MINUTES} minutes after it was sent.
            </AuthNotice>

            {/* The whole step is centred on the boxes: `text-center` on the
                wrapper carries the error line, `justify-center` handles the
                label (Label is a flex row, so text-align does not move it). */}
            <Field
              label="Verification code"
              htmlFor="reg-code"
              error={codeMessage}
              required
              className="space-y-3 text-center"
              labelClassName="justify-center"
            >
              <OtpInput
                digits={codeDigits}
                onChange={setCodeDigits}
                disabled={verificationLoading || codeExpired}
                focusSignal={otpFocusSignal}
              />
            </Field>

            {/* The countdown. `role="timer"` with aria-live off on purpose: a
                screen reader reciting the seconds would drown out everything
                else on the step. The expiry itself is announced, once. */}
            {codeExpired ? (
              <p role="status" className="text-center text-sm font-medium text-destructive">
                Code expired — use the Resend code link below to get a new one.
              </p>
            ) : (
              <p className="text-center text-sm text-muted-foreground">
                Code expires in{" "}
                <span role="timer" aria-live="off" className="font-mono font-medium text-foreground">
                  {formatCountdown(msLeft)}
                </span>
              </p>
            )}

            <SubmitButton
              loading={verificationLoading}
              loadingLabel="Verifying…"
              status={codeMessage || errors.general ? "error" : "idle"}
              disabled={verificationLoading || codeExpired}
            >
              Verify &amp; complete
            </SubmitButton>

            <p className="text-center text-sm text-muted-foreground">
              Didn&apos;t get it?{" "}
              <button
                type="button"
                onClick={handleResendCode}
                disabled={loading}
                className="rounded font-medium text-primary underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
              >
                {loading ? "Sending…" : "Resend code"}
              </button>
            </p>
          </form>
        )}

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
