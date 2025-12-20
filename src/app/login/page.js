"use client";
import { useState } from "react";
import Link from "next/link";
import { createClient } from '@supabase/supabase-js';
import { useRouter } from "next/navigation";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("developer");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [verificationStep, setVerificationStep] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [userData, setUserData] = useState(null);
  const router = useRouter();

  // New function to go back to home/starting page
  const handleGoToHome = () => {
    router.push("/");
  };

  const generateVerificationCode = () => {
    return Math.floor(1000 + Math.random() * 9000).toString(); // 4-digit code
  };

  const sendVerificationEmail = async (email, code, userName, role, company = "") => {
    try {
      const response = await fetch('/api/send-verification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: email,
          userName: userName,
          company: company || "Developer Activity Tracking System",
          code: code,
          type: "login", // Add type to distinguish between registration and login
          role: role
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send verification email');
      }

      // Store verification data in localStorage
      const verificationData = {
        email,
        code,
        timestamp: new Date().getTime(),
        role,
        userName
      };
      
      localStorage.setItem(`verification_${email}`, JSON.stringify(verificationData));
      
      console.log('✅ Verification code sent successfully to:', email);
      return true;
    } catch (error) {
      console.error('❌ Email sending failed:', error);
      
      // Fallback: Store in localStorage and show code to user
      const verificationData = {
        email,
        code,
        timestamp: new Date().getTime(),
        role,
        userName
      };
      
      localStorage.setItem(`verification_${email}`, JSON.stringify(verificationData));
      
      alert(`Email service temporarily unavailable. Your verification code is: ${code}\n\nThis code will expire in 10 minutes.`);
      
      return true;
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      if (role === "admin") {
        // Admin login logic
        const { data: adminData, error: adminError } = await supabase
          .from('admin_users')
          .select('*')
          .eq('email', email)
          .eq('password', password)
          .single();

        if (adminError || !adminData) {
          throw new Error('Invalid admin credentials');
        }

        // Generate and send verification code
        const verificationCode = generateVerificationCode();
        const emailSent = await sendVerificationEmail(
          email, 
          verificationCode, 
          adminData.full_name, 
          'admin',
          adminData.company
        );
        
        if (emailSent) {
          setUserData(adminData);
          setVerificationStep(true);
        }

      } else {
        // Developer login logic
        const { data: developerData, error: developerError } = await supabase
          .from('developers')
          .select('*')
          .eq('email', email)
          .eq('password', password)
          .single();

        if (developerError || !developerData) {
          throw new Error('Invalid developer credentials');
        }

        // Generate and send verification code
        const verificationCode = generateVerificationCode();
        const emailSent = await sendVerificationEmail(
          email, 
          verificationCode, 
          developerData.name, 
          'developer',
          developerData.company
        );
        
        if (emailSent) {
          setUserData(developerData);
          setVerificationStep(true);
        }
      }
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerification = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const storedVerification = localStorage.getItem(`verification_${email}`);
      if (!storedVerification) {
        throw new Error('Verification session expired. Please login again.');
      }

      const verificationData = JSON.parse(storedVerification);
      
      // Check if code is expired (10 minutes)
      const isExpired = (new Date().getTime() - verificationData.timestamp) > 10 * 60 * 1000;
      if (isExpired) {
        localStorage.removeItem(`verification_${email}`);
        throw new Error('Verification code expired. Please login again.');
      }

      // Check if code matches
      if (verificationData.code !== verificationCode) {
        throw new Error('Invalid verification code');
      }

      // Verification successful - store user data
      const userSession = {
        ...userData,
        role: role,
        loginTime: new Date().toISOString(),
        lastActivity: new Date().toISOString() // Add last activity timestamp
      };

      // After successful admin verification
      if (role === "admin") {
        localStorage.setItem("adminUser", JSON.stringify(userSession));
        
        // Set cookie for middleware (30 days expiry)
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 30);
        document.cookie = `admin_auth=true; expires=${expiryDate.toUTCString()}; path=/`;
        
        // Set additional security cookie
        document.cookie = `admin_id=${userData.id}; expires=${expiryDate.toUTCString()}; path=/; HttpOnly; Secure`;
        
        router.push("/admin/dashboard");
      }
      else {
        localStorage.setItem("developerUser", JSON.stringify(userSession));
        // Set cookie for middleware
        document.cookie = "developer_auth=true; path=/";
        router.push("/developer/dashboard");
      }

      // Clean up verification data
      localStorage.removeItem(`verification_${email}`);

    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    setLoading(true);
    setError("");

    try {
      const newCode = generateVerificationCode();
      const userName = role === "admin" ? userData.full_name : userData.name;
      const company = role === "admin" ? userData.company : userData.company;
      
      await sendVerificationEmail(email, newCode, userName, role, company);
    } catch (error) {
      setError('Failed to resend code: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleBackToLogin = () => {
    setVerificationStep(false);
    setVerificationCode("");
    setError("");
  };

  if (verificationStep) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#009578] text-black">
        <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-lg relative">
          {/* Back Arrow to Home */}
          <button
            onClick={handleGoToHome}
            className="absolute top-4 left-4 text-gray-600 hover:text-gray-800 transition duration-200"
            title="Go to Home"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          
          {/* Heading */}
          <h2 className="text-2xl font-bold text-center mb-6">Verify Your Email</h2>
          
          {/* Instructions */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <p className="text-sm text-blue-800 text-center">
              We've sent a 4-digit verification code to <strong>{email}</strong>
            </p>
            <p className="text-xs text-blue-600 text-center mt-2">
              Check your inbox and spam folder
            </p>
          </div>

          {/* Verification Form */}
          <form onSubmit={handleVerification} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Enter 4-Digit Verification Code
              </label>
              <input
                type="text"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="1234"
                className="w-full p-3 rounded-lg bg-white text-black border border-gray-500 text-center text-xl tracking-widest"
                required
                maxLength={4}
                pattern="\d{4}"
              />
              <p className="text-xs text-gray-500 mt-2 text-center">
                Enter the 4-digit code sent to your email
              </p>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-800 text-center">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || verificationCode.length !== 4}
              className={`w-full p-3 rounded-lg font-semibold transition duration-200 text-white ${
                loading || verificationCode.length !== 4
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-[#009578] hover:bg-[#0e7762]'
              }`}
            >
              {loading ? 'Verifying...' : 'Verify & Login'}
            </button>

            <div className="flex justify-between mt-4">
              <button
                type="button"
                onClick={handleBackToLogin}
                className="text-sm text-gray-600 hover:text-gray-800"
              >
                ← Back to Login
              </button>
              
              <button
                type="button"
                onClick={handleResendCode}
                disabled={loading}
                className="text-sm text-[#009578] hover:text-[#0e7762] font-medium"
              >
                {loading ? 'Sending...' : 'Resend Code'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#009578] text-black">
      <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-lg relative">
        {/* Back Arrow to Home */}
        <button
          onClick={handleGoToHome}
          className="absolute top-4 left-4 text-gray-600 hover:text-gray-800 transition duration-200"
          title="Go to Home"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </button>
        
        {/* Heading */}
        <h2 className="text-2xl font-bold text-center mb-6">Login</h2>

        {/* Role Switch */}
        <div className="flex justify-center mb-6">
          <button
            type="button"
            onClick={() => setRole("developer")}
            className={`px-4 py-2 rounded-l-lg font-medium transition duration-200 ${
              role === "developer"
                ? "bg-[#009578] text-white"
                : "bg-gray-700 text-white hover:bg-gray-600"
            }`}
          >
            Developer
          </button>
          <button
            type="button"
            onClick={() => setRole("admin")}
            className={`px-4 py-2 rounded-r-lg font-medium transition duration-200 ${
              role === "admin"
                ? "bg-[#009578] text-white"
                : "bg-gray-700 text-white hover:bg-gray-600"
            }`}
          >
            Admin
          </button>
        </div>

        {/* Login Form */}
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter Your Email"
              className="w-full p-3 rounded-lg bg-white text-black border border-gray-500"
              required
            />
          </div>

          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter Your Password"
              className="w-full p-3 rounded-lg bg-white text-black border border-gray-500"
              required
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-800 text-center">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className={`w-full p-3 rounded-lg font-semibold transition duration-200 text-white ${
              loading
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-[#009578] hover:bg-[#0e7762]'
            }`}
          >
            {loading ? 'Logging in...' : `Login as ${role === "developer" ? "Developer" : "Admin"}`}
          </button>
        </form>

        {/* Signup link */}
        <p className="text-center text-sm mt-4">
          Don't have an account?{" "}
          <Link
            href="/admin/registration"
            className="text-[#009578] hover:text-[#0e7762] font-medium"
          >
            Signup Now
          </Link>
        </p>
      </div>
    </div>
  );
}