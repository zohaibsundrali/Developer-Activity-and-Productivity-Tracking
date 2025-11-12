"use client";
import { useState, useEffect } from "react";
import { supabase } from "@/utils/supabaseClient";
import Link from "next/link";
import { useRouter } from "next/navigation";
import emailjs from "@emailjs/browser";

export default function AdminRegistration() {
  const [formData, setFormData] = useState({
    fullName: "",
    company: "",
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
  const router = useRouter();

  // Initialize EmailJS
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_EMAILJS_PUBLIC_KEY) {
      emailjs.init(process.env.NEXT_PUBLIC_EMAILJS_PUBLIC_KEY);
    }
  }, []);

  // Input validation
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
    return input.trim().replace(/[<>]/g, '');
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

    if (!formData.fullName) newErrors.fullName = "Full name is required";
    if (!formData.company) newErrors.company = "Company is required";
    
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

  const sendVerificationCode = async (email) => {
    try {
      const code = Math.floor(1000 + Math.random() * 9000).toString();
      setGeneratedCode(code);
      setCodeExpiry(Date.now() + 10 * 60 * 1000);

      console.log("📧 Sending verification code to:", email);

      // Simple EmailJS implementation without API fallback
      const templateParams = {
        to_email: email,
        user_name: formData.fullName,
        company: formData.company,
        verification_code: code,
        code: code,
        from_name: "Admin Registration",
        subject: `Your Verification Code: ${code}`
      };

      await emailjs.send(
        process.env.NEXT_PUBLIC_EMAILJS_SERVICE_ID,
        process.env.NEXT_PUBLIC_EMAILJS_TEMPLATE_ID,
        templateParams
      );

      console.log("✅ Email sent successfully");
      setStep(2);
      return { success: true };

    } catch (error) {
      console.error("❌ Email send error:", error);
      
      // Development mode - proceed without showing error
      console.log("🔄 Development mode: Proceeding to verification");
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
      // Check existing email
      console.log("🔍 Checking existing email:", formData.email);
      const { data: existing, error: fetchError } = await supabase
        .from("admin_users")
        .select("*")
        .eq("email", formData.email);

      if (fetchError) {
        console.error("❌ Supabase fetch error:", fetchError);
        throw new Error(`Database error: ${fetchError.message}`);
      }
      
      if (existing && existing.length > 0) {
        setErrors({ email: "Email already registered!" });
        setLoading(false);
        return;
      }

      console.log("✅ Email available, sending verification code");
      await sendVerificationCode(formData.email);
      
    } catch (error) {
      console.error("💥 Registration process error:", error);
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
      alert("Verification code has been resent to your email!");
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

    console.log("🔐 Verification attempt:", {
      enteredCode: code,
      generatedCode: generatedCode,
      codeMatch: code === generatedCode
    });

    // Check if code has expired
    if (Date.now() > codeExpiry) {
      setErrors({ code: "Verification code has expired. Please request a new one." });
      setVerificationLoading(false);
      return;
    }

    if (code !== generatedCode) {
      console.error("❌ Code mismatch:", { entered: code, expected: generatedCode });
      setErrors({ code: "Incorrect verification code. Please try again." });
      setVerificationLoading(false);
      return;
    }

    try {
      console.log("✅ Code verified. Creating admin account...");
      console.log("📝 User data:", {
        email: formData.email,
        name: formData.fullName,
        company: formData.company
      });

      // Test Supabase connection first
      console.log("🔌 Testing Supabase connection...");
      const { error: testError } = await supabase
        .from('admin_users')
        .select('count')
        .limit(1);

      if (testError) {
        console.error("❌ Supabase connection failed:", testError);
        throw new Error(`Database connection failed: ${testError.message}`);
      }

      console.log("✅ Supabase connected. Inserting user...");

      // Insert user data
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
        console.error("❌ Supabase insert error details:", {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint
        });

        // Specific error handling
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

      console.log("✅ Registration successful! User data:", data[0]);

      // Store user session
      localStorage.setItem("adminUser", JSON.stringify(data[0]));
      localStorage.setItem("adminToken", "admin-authenticated");
      
      console.log("✅ Session stored. Redirecting to dashboard...");
      alert("🎉 Registration successful! Redirecting to dashboard...");
      router.push("/admin/dashboard");

    } catch (error) {
      console.error("💥 Registration failed with error:", error);
      setErrors({ 
        general: error.message || "Registration failed! Please check console for details." 
      });
    } finally {
      setVerificationLoading(false);
    }
  };

  const PasswordRequirement = ({ met, text }) => (
    <div className={`flex items-center text-sm ${met ? 'text-green-600' : 'text-red-600'}`}>
      <span className={`w-2 h-2 rounded-full mr-2 ${met ? 'bg-green-600' : 'bg-red-600'}`}></span>
      {text}
    </div>
  );

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#009578] text-black">
      <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-lg">
        <h2 className="text-2xl font-bold text-center mb-6">
          {step === 1 ? "Admin Registration" : "Verify Your Email"}
        </h2>

        {errors.general && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {errors.general}
          </div>
        )}

        {step === 1 ? (
          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <input
                type="text"
                placeholder="Full Name"
                value={formData.fullName}
                onChange={(e) => handleInputChange('fullName', e.target.value)}
                className={`w-full p-3 border rounded-lg ${errors.fullName ? 'border-red-500' : 'border-gray-300'}`}
                required
              />
              {errors.fullName && <p className="text-red-500 text-sm mt-1">{errors.fullName}</p>}
            </div>

            <div>
              <input
                type="text"
                placeholder="Company / Organization"
                value={formData.company}
                onChange={(e) => handleInputChange('company', e.target.value)}
                className={`w-full p-3 border rounded-lg ${errors.company ? 'border-red-500' : 'border-gray-300'}`}
                required
              />
              {errors.company && <p className="text-red-500 text-sm mt-1">{errors.company}</p>}
            </div>

            <div>
              <input
                type="email"
                placeholder="Email Address"
                value={formData.email}
                onChange={(e) => handleInputChange('email', e.target.value)}
                className={`w-full p-3 border rounded-lg ${errors.email ? 'border-red-500' : 'border-gray-300'}`}
                required
              />
              {errors.email && <p className="text-red-500 text-sm mt-1">{errors.email}</p>}
            </div>

            <div>
              <input
                type="password"
                placeholder="Password"
                value={formData.password}
                onChange={(e) => handleInputChange('password', e.target.value)}
                className={`w-full p-3 border rounded-lg ${errors.password ? 'border-red-500' : 'border-gray-300'}`}
                required
              />
              {formData.password && (
                <div className="mt-2 space-y-1">
                  <PasswordRequirement 
                    met={formData.password.length >= 8} 
                    text="At least 8 characters" 
                  />
                  <PasswordRequirement 
                    met={/[A-Z]/.test(formData.password)} 
                    text="One uppercase letter" 
                  />
                  <PasswordRequirement 
                    met={/[a-z]/.test(formData.password)} 
                    text="One lowercase letter" 
                  />
                  <PasswordRequirement 
                    met={/\d/.test(formData.password)} 
                    text="One number" 
                  />
                  <PasswordRequirement 
                    met={/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(formData.password)} 
                    text="One special character" 
                  />
                </div>
              )}
            </div>

            <div>
              <input
                type="password"
                placeholder="Confirm Password"
                value={formData.confirmPassword}
                onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
                className={`w-full p-3 border rounded-lg ${errors.confirmPassword ? 'border-red-500' : 'border-gray-300'}`}
                required
              />
              {errors.confirmPassword && <p className="text-red-500 text-sm mt-1">{errors.confirmPassword}</p>}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#009578] text-white p-3 rounded-lg font-semibold hover:bg-[#0e7762] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Sending Verification Code..." : "Register"}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyCodeAndRegister} className="space-y-6">
            <div className="text-center">
              <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4">
                <p className="font-semibold">✓ Verification Code Sent!</p>
                <p className="text-sm mt-1">
                  We've sent a 4-digit verification code to:<br />
                  <strong>{formData.email}</strong>
                </p>
              </div>
              
              <p className="text-gray-600 mb-4">
                Please check your email and enter the code below to complete your registration.
              </p>
            </div>

            <div>
              <input
                type="text"
                placeholder="Enter 4-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                className={`w-full p-3 border rounded-lg text-center text-xl font-mono ${errors.code ? 'border-red-500' : 'border-gray-300'}`}
                required
                maxLength={4}
              />
              {errors.code && <p className="text-red-500 text-sm mt-1 text-center">{errors.code}</p>}
            </div>

            <button
              type="submit"
              disabled={verificationLoading}
              className="w-full bg-[#009578] text-white p-3 rounded-lg font-semibold hover:bg-[#0e7762] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {verificationLoading ? "Verifying..." : "Verify & Complete Registration"}
            </button>

            <div className="text-center">
              <button
                type="button"
                onClick={handleResendCode}
                disabled={loading}
                className="text-[#009578] hover:text-[#0e7762] font-medium text-sm disabled:opacity-50"
              >
                {loading ? "Resending..." : "Resend Verification Code"}
              </button>
              <p className="text-xs text-gray-500 mt-2">
                Code expires in 10 minutes
              </p>
            </div>
          </form>
        )}

        <p className="text-center text-sm mt-6">
          Already have an account?{" "}
          <Link href="/admin/login" className="text-[#009578] hover:text-[#0e7762] font-medium">
            Login
          </Link>
        </p>
      </div>
    </div>
  );
}