"use client";
import { useState } from "react";
import Link from "next/link";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("developer"); // default role

  const handleLogin = (e) => {
    e.preventDefault();
    console.log("Login details:", { email, password, role });
    // TODO: Firebase login logic based on selected role
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#009578] text-black">
      <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-lg">
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
              className="w-full p-3 rounded-lg bg-white text-black border border-gray-500 "
              required
            />
          </div>

          <div>
        
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter Your Password"
              className="w-full p-3 rounded-lg bg-white text-black border border-gray-500 "
              required
            />
          </div>

          <button
            type="submit"
            className="w-full bg-[#009578] hover:bg-[#0e7762] p-3 rounded-lg font-semibold transition duration-200 text-white"
          >
            Login as {role === "developer" ? "Developer" : "Admin"}
          </button>
        </form>

        {/* Signup link */}
        <p className="text-center text-sm mt-4">
          Don’t have an account?{" "}{" "}{" "}
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
