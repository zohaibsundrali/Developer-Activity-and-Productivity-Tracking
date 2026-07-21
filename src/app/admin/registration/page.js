"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/utils/supabaseClient";
import Link from "next/link";
import { useRouter } from "next/navigation";
import emailjs from "@emailjs/browser";
import { showInfo, showPre, showSuccess } from "@/utils/alerts";
import { SESSION_MAX_AGE_DAYS } from "@/utils/sessionPolicy";

import "../../auth.css";

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

      const { data, error } = await supabase
        .from("admin_users")
        .insert([
          {
            full_name: formData.fullName,
            company: formData.company,
            email: formData.email,
            password: formData.password,
            is_verified: true,
            role: "admin",
            created_at: new Date().toISOString(),
          },
        ])
        .select();

      if (error) {
        if (error.code === '23505') {
          throw new Error("This email is already registered. Please use a different email.");
        } else if (error.code === '42501') {
          throw new Error("Database permission denied. Please contact administrator.");
        } else if (error.code === '42P01') {
          throw new Error("Database table not found. Please setup the database first.");
        } else {
          throw new Error(`Database error: ${error.message}`);
        }
      }

      if (!data || data.length === 0) {
        throw new Error("No data returned after registration. Please try again.");
      }

      const newAdmin = data[0];

      // Multi-tenant: create this admin's organization (workspace) and make
      // them its Owner. Best-effort — a failure here must not block signup.
      let orgId = null;
      let orgName = null;
      try {
        const { data: orgRows } = await supabase
          .from("organizations")
          .insert([
            {
              name: (formData.company || "").trim() || `${formData.fullName || "My"}'s Organization`,
              owner_id: newAdmin.id,
              industry: formData.industry || null,
              company_size: formData.companySize || null,
              country: (formData.country || "").trim() || null,
              timezone: (typeof Intl !== "undefined" && Intl.DateTimeFormat().resolvedOptions().timeZone) || "UTC",
            },
          ])
          .select("id, name")
          .single();

        if (orgRows?.id) {
          orgId = orgRows.id;
          orgName = orgRows.name;
          // Link the admin to the org + create the owner membership.
          await supabase.from("admin_users").update({ organization_id: orgId }).eq("id", newAdmin.id);
          await supabase.from("memberships").insert([
            {
              organization_id: orgId,
              user_id: newAdmin.id,
              user_type: "admin",
              email: newAdmin.email,
              role: "owner",
              status: "active",
            },
          ]);
        }
      } catch {
        // Org creation is non-fatal; the account still works.
      }

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
    <div className="auth-root">
      <div className="auth-orb auth-orb-1" />
      <div className="auth-orb auth-orb-2" />
      <div className="auth-orb auth-orb-3" />

      <div className="auth-card">
        <button onClick={handleGoToHome} className="auth-back-btn" title="Go to Home">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" style={{ width: 14, height: 14 }}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Back
        </button>

        <div className="auth-brand">
          <div className="auth-brand-icon">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.964-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
            </svg>
          </div>
          <h1>{step === 1 ? "Create Admin Access" : "Verify Email"}</h1>
          <p>{step === 1 ? "Set up your workspace access for the tracking dashboard." : "We sent a verification code to your inbox."}</p>
        </div>



        {errors.general && (
          <div className="auth-error-box">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <p>{errors.general}</p>
          </div>
        )}

        {step === 1 ? (
          <form onSubmit={handleRegister}>
            <div className="auth-field">
              <label className="auth-label">Full Name</label>
              <div className="auth-input-wrap">
                <span className="auth-input-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                  </svg>
                </span>
                <input
                  type="text"
                  placeholder="John Doe"
                  value={formData.fullName}
                  onChange={(e) => handleInputChange('fullName', e.target.value)}
                  className={`auth-input ${errors.fullName ? 'error' : ''}`}
                  required
                />
              </div>
              {errors.fullName && <div className="auth-field-error">{errors.fullName}</div>}
            </div>

            <div className="auth-field">
              <label className="auth-label">Company / Organization</label>
              <div className="auth-input-wrap">
                <span className="auth-input-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6.75h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
                  </svg>
                </span>
                <input
                  type="text"
                  placeholder="Tech Solutions Inc."
                  value={formData.company}
                  onChange={(e) => handleInputChange('company', e.target.value)}
                  className={`auth-input ${errors.company ? 'error' : ''}`}
                  required
                />
              </div>
              {errors.company && <div className="auth-field-error">{errors.company}</div>}
            </div>

            <div className="auth-field">
              <label className="auth-label">Industry</label>
              <div className="auth-input-wrap">
                <select
                  value={formData.industry}
                  onChange={(e) => handleInputChange('industry', e.target.value)}
                  className="auth-input"
                >
                  <option value="">— Select industry (optional) —</option>
                  {["Technology","Finance","Healthcare","Education","Retail","Manufacturing","Consulting","Marketing","Other"].map((i) => (
                    <option key={i} value={i}>{i}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="auth-field">
              <label className="auth-label">Company Size</label>
              <div className="auth-input-wrap">
                <select
                  value={formData.companySize}
                  onChange={(e) => handleInputChange('companySize', e.target.value)}
                  className="auth-input"
                >
                  <option value="">— Select size (optional) —</option>
                  {["1-10","11-50","51-200","201-500","500+"].map((s) => (
                    <option key={s} value={s}>{s} employees</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="auth-field">
              <label className="auth-label">Country</label>
              <div className="auth-input-wrap">
                <input
                  type="text"
                  placeholder="Pakistan (optional)"
                  value={formData.country}
                  onChange={(e) => handleInputChange('country', e.target.value)}
                  className="auth-input"
                />
              </div>
            </div>

            <div className="auth-field">
              <label className="auth-label">Email Address</label>
              <div className="auth-input-wrap">
                <span className="auth-input-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                  </svg>
                </span>
                <input
                  type="email"
                  placeholder="john@example.com"
                  value={formData.email}
                  onChange={(e) => handleInputChange('email', e.target.value)}
                  className={`auth-input ${errors.email ? 'error' : ''}`}
                  required
                />
              </div>
              {errors.email && <div className="auth-field-error">{errors.email}</div>}
            </div>

            <div className="auth-field">
              <label className="auth-label">Password</label>
              <div className="auth-input-wrap">
                <span className="auth-input-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                </span>
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Min. 8 characters"
                  value={formData.password}
                  onChange={(e) => handleInputChange('password', e.target.value)}
                  className={`auth-input ${errors.password ? 'error' : ''}`}
                  style={{ paddingRight: '2.75rem' }}
                  required
                />
                <button type="button" className="auth-eye-btn" onClick={() => setShowPassword(!showPassword)}>
                  {showPassword ? (
                    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
                  ) : (
                    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  )}
                </button>
              </div>
              {formData.password && (
                <div className="auth-pw-reqs">
                  <div className={`auth-pw-req ${pwVal.requirements.minLength ? 'met' : 'unmet'}`}><div className="auth-pw-req-dot" />8+ chars</div>
                  <div className={`auth-pw-req ${pwVal.requirements.hasUpperCase ? 'met' : 'unmet'}`}><div className="auth-pw-req-dot" />Uppercase</div>
                  <div className={`auth-pw-req ${pwVal.requirements.hasLowerCase ? 'met' : 'unmet'}`}><div className="auth-pw-req-dot" />Lowercase</div>
                  <div className={`auth-pw-req ${pwVal.requirements.hasNumbers ? 'met' : 'unmet'}`}><div className="auth-pw-req-dot" />Number</div>
                  <div className={`auth-pw-req ${pwVal.requirements.hasSpecialChar ? 'met' : 'unmet'}`}><div className="auth-pw-req-dot" />Special</div>
                </div>
              )}
            </div>

            <div className="auth-field">
              <label className="auth-label">Confirm Password</label>
              <div className="auth-input-wrap">
                <span className="auth-input-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                  </svg>
                </span>
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Repeat password"
                  value={formData.confirmPassword}
                  onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
                  className={`auth-input ${errors.confirmPassword ? 'error' : ''}`}
                  style={{ paddingRight: '2.75rem' }}
                  required
                />
                <button type="button" className="auth-eye-btn" onClick={() => setShowConfirmPassword(!showConfirmPassword)}>
                  {showConfirmPassword ? (
                    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
                  ) : (
                    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  )}
                </button>
              </div>
              {errors.confirmPassword && <div className="auth-field-error">{errors.confirmPassword}</div>}
            </div>

            <button type="submit" disabled={loading} className="auth-submit-btn">
              {loading ? <><span className="auth-spinner" />Processing...</> : "Register Account"}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyCodeAndRegister}>
            <div className="auth-info-box">
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <p className="">Enter the 4-digit verification code</p>
            </div>

            <div className="auth-field">
              <input
                type="text"
                placeholder="0000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                className={`auth-otp-input ${errors.code ? 'error' : ''}`}
                required
                maxLength={4}
              />
              {errors.code && <div className="auth-field-error" style={{ justifyContent: 'center' }}>{errors.code}</div>}
            </div>

            <button type="submit" disabled={verificationLoading} className="auth-submit-btn">
              {verificationLoading ? <><span className="auth-spinner" />Verifying...</> : "Verify & Complete"}
            </button>

            <div className="auth-footer" style={{ marginTop: '1.5rem' }}>
              <button type="button" onClick={handleResendCode} disabled={loading} className="auth-ghost-btn">
                {loading ? "Sending..." : "Resend code"}
              </button>
            </div>
          </form>
        )}

        <div className="auth-divider"><span>Already have an account?</span></div>
        <div className="auth-footer"><Link href="/login">Sign in here</Link></div>
      </div>
    </div>
  );
}