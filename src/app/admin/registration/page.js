"use client";
import { useState } from "react";
import Link from "next/link";

export default function AdminRegistration() {
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleRegister = (e) => {
    e.preventDefault();

    // Basic field validation (frontend)
    if (!fullName || !company || !email || !password) {
      alert("Please fill all fields.");
      return;
    }

    // Email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      alert("Please enter a valid email address.");
      return;
    }

    // Password strength check
    if (password.length < 6) {
      alert("Password must be at least 6 characters long.");
      return;
    }

    console.log("Admin Registration Details:", {
      fullName,
      company,
      email,
      password,
    });

    // TODO: Add Firebase registration logic here (createUserWithEmailAndPassword)
    // Then store fullName, company, role="admin" in Firestore/Supabase

    alert("Registration successful. Please verify your email.");
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#009578] text-black">
      <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-lg">
        <h2 className="text-2xl font-bold text-center mb-6">Admin Registration</h2>

        <form onSubmit={handleRegister} className="space-y-4">
          <div>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Full Name"
              className="w-full p-3 rounded-lg bg-white text-black border border-gray-500"
              required
            />
          </div>

          <div>
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Company / Organization Name"
              className="w-full p-3 rounded-lg bg-white text-black border border-gray-500"
              required
            />
          </div>

          <div>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email Address"
              className="w-full p-3 rounded-lg bg-white text-black border border-gray-500"
              required
            />
          </div>

          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full p-3 rounded-lg bg-white text-black border border-gray-500"
              required
            />
          </div>

          <button
            type="submit"
            className="w-full bg-[#009578] hover:bg-[#0e7762] p-3 rounded-lg font-semibold transition duration-200 text-white"
          >
            Register as Admin
          </button>
        </form>

        <p className="text-center text-sm mt-4">
          Already have an account?{" "}
          <Link
            href="/login"
            className="text-[#009578] hover:text-[#0e7762] font-medium"
          >
            Login
          </Link>
        </p>
      </div>
    </div>
  );
}
