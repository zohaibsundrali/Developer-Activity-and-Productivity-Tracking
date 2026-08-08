"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/utils/supabaseClient";
import Link from "next/link";
import { useRouter } from "next/navigation";
import emailjs from "@emailjs/browser";
import { showInfo, showPre, showSuccess } from "@/utils/alerts";
import { SESSION_MAX_AGE_DAYS } from "@/utils/sessionPolicy";
import { authFetch } from "@/utils/authFetch";

import { ArrowLeft } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import AuthShell, { BrandLockup } from "@/components/auth/AuthShell";
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
  const [code, setCode] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");
  const [codeExpiry, setCodeExpiry] = useState(null);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
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

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_EMAILJS_PUBLIC_KEY) {
      emailjs.init(process.env.NEXT_PUBLIC_EMAILJS_PUBLIC_KEY);
    }
  }, []);

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

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const sendVerificationCode = async (userEmail) => {
    try {
      const code = Math.floor(1000 + Math.random() * 9000).toString();
      setGeneratedCode(code);
      setCodeExpiry(Date.now() + 10 * 60 * 1000);

      const response = await fetch('/api/send-verification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: userEmail,
          userName: formData.fullName,
          company: formData.company,
          code: code
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
      showPre(
        "Email service unavailable",
        `EMAIL SERVICE TEMPORARILY UNAVAILABLE\n\nUse this code for testing: ${generatedCode}\n\nThis would be sent to: ${formData.email}`,
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

    if (!validateForm()) {
      setLoading(false);
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
    e.preventDefault();
    setVerificationLoading(true);
    setErrors({});

    if (Date.now() > codeExpiry) {
      setErrors({ code: "Verification code has expired. Please request a new one." });
      setVerificationLoading(false);
      return;
    }

    if (code !== generatedCode) {
      setErrors({ code: "Incorrect verification code. Please try again." });
      setVerificationLoading(false);
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

  const pwVal = validatePassword(formData.password);

  return (
    <AuthShell panelTitle="Set up the workspace your team will actually use.">
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

                <SubmitButton loading={loading} loadingLabel="Processing…" disabled={loading}>
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

                <SubmitButton loading={joinLoading} loadingLabel="Joining…" disabled={joinLoading}>
                  Join organization
                </SubmitButton>
              </form>
            )}
          </>
        ) : (
          <form onSubmit={verifyCodeAndRegister} className="mt-6 space-y-5">
            <AuthNotice>
              Enter the 4-digit code we emailed to{" "}
              <span className="font-medium text-foreground">{formData.email}</span>. It expires in
              10 minutes.
            </AuthNotice>

            <Field label="Verification code" htmlFor="reg-code" error={errors.code} required>
              <Input
                id="reg-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="0000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                className="h-14 text-center font-mono text-2xl font-semibold tracking-[0.5em] rounded-lg"
                aria-invalid={errors.code ? true : undefined}
                required
                maxLength={4}
              />
            </Field>

            <SubmitButton
              loading={verificationLoading}
              loadingLabel="Verifying…"
              disabled={verificationLoading}
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

        <p className="mt-7 border-t border-border pt-5 text-center text-sm text-muted-foreground">
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
