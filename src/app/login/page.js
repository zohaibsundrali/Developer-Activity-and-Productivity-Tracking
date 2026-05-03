"use client";
import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/utils/supabaseClient";
import { useRouter } from "next/navigation";
import { SESSION_MAX_AGE_DAYS } from "@/utils/sessionPolicy";

const verifyPassword = (inputPassword, storedPassword) => {
  if (typeof storedPassword !== "string") return false;
  return storedPassword === inputPassword;
};

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("developer");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  // New function to go back to home/starting page
  const handleGoToHome = () => {
    router.push("/");
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      let loggedInData = null;
      if (role === "admin") {
        // Admin login logic
        const { data: adminData, error: adminError } = await supabase
          .from('admin_users')
          .select('*')
          .eq('email', email)
          .maybeSingle();

        if (adminError || !adminData || !verifyPassword(password, adminData.password)) {
          throw new Error('Invalid admin credentials');
        }
        loggedInData = adminData;
      } else {
        // Developer login logic
        const { data: developerData, error: developerError } = await supabase
          .from('developers')
          .select('*')
          .eq('email', email)
          .maybeSingle();

        if (developerError || !developerData || !verifyPassword(password, developerData.password)) {
          throw new Error('Invalid developer credentials');
        }
        loggedInData = developerData;
      }

      // User session details
      const userSession = {
        ...loggedInData,
        role: role,
        loginTime: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      };

      if (role === "admin") {
        sessionStorage.setItem("adminUser", JSON.stringify(userSession));
        localStorage.removeItem("adminUser");
        
        window.dispatchEvent(new Event('auth-change'));
        
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + SESSION_MAX_AGE_DAYS);
        document.cookie = `admin_auth=true; expires=${expiryDate.toUTCString()}; path=/`;
        document.cookie = `admin_id=${loggedInData.id}; expires=${expiryDate.toUTCString()}; path=/; HttpOnly; Secure`;
        
        setTimeout(() => {
          router.push("/admin/dashboard");
        }, 100);
      } else {
        sessionStorage.setItem("developerUser", JSON.stringify(userSession));
        localStorage.removeItem("developerUser");
        
        window.dispatchEvent(new Event('auth-change'));
        
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + SESSION_MAX_AGE_DAYS);
        document.cookie = `developer_auth=true; expires=${expiryDate.toUTCString()}; path=/`;
        document.cookie = `developer_id=${loggedInData.id}; expires=${expiryDate.toUTCString()}; path=/`;
        
        setTimeout(() => {
          router.push("/developer/dashboard");
        }, 100);
      }
    } catch (error) {
      setError(error.message);
      setLoading(false);
    }
  };

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
          Don&apos;t have an account?{" "}
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