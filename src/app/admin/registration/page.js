"use client";
import { useState } from "react";
import { supabase } from "@/utils/supabaseClient";
import Link from "next/link";
import { useRouter } from "next/navigation";
import emailjs from "emailjs-com";

export default function AdminRegistration() {
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");
  const [step, setStep] = useState(1); // step 1=form, step 2=code verification
  const [loading, setLoading] = useState(false);
  const router = useRouter();

const sendVerificationCode = async (email) => {
  try {
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    setGeneratedCode(code);

    const result = await emailjs.send(
      "service_n0ob5nu", // replace with your service ID
      "template_xyz456", // replace with your template ID
      { to_email: email, message: `Your verification code is ${code}` },
      "zXy12345AbC" // replace with your public key
    );

    console.log("Email sent:", result.text);
    alert(`Verification code sent to ${email}`);
    setStep(2);
  } catch (error) {
    console.error("Email send error:", error);
    alert("Failed to send verification email. Check console for details.");
  }
};



  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);

    // ✅ Basic Validation
    if (!fullName || !company || !email || !password) {
      alert("All fields are required!");
      setLoading(false);
      return;
    }

    // ✅ Check existing email
    const { data: existing, error: fetchError } = await supabase
      .from("admin_users")
      .select("*")
      .eq("email", email);

    if (existing && existing.length > 0) {
      alert("Email already registered!");
      setLoading(false);
      return;
    }

    // ✅ Password Strength Check
    if (password.length < 6) {
      alert("Password must be at least 6 characters long!");
      setLoading(false);
      return;
    }

    // ✅ Send Verification Code
    await sendVerificationCode(email);
    setLoading(false);
  };

  const verifyCodeAndRegister = async (e) => {
    e.preventDefault();
    if (code !== generatedCode) {
      alert("Incorrect code. Try again!");
      return;
    }

    // ✅ Insert user into Supabase
    const { data, error } = await supabase.from("admin_users").insert([
      {
        full_name: fullName,
        company,
        email,
        password,
        is_verified: true,
        role: "admin",
      },
    ]);

    if (error) {
      alert("Registration failed!");
      console.error(error);
      return;
    }

    alert("Registration successful! Redirecting...");
    router.push("/admin/dashboard");
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#009578] text-black">
      <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-lg">
        <h2 className="text-2xl font-bold text-center mb-6">
          {step === 1 ? "Admin Registration" : "Verify Email"}
        </h2>

        {step === 1 ? (
          <form onSubmit={handleRegister} className="space-y-4">
            <input
              type="text"
              placeholder="Full Name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full p-3 border rounded-lg"
              required
            />
            <input
              type="text"
              placeholder="Company / Organization"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              className="w-full p-3 border rounded-lg"
              required
            />
            <input
              type="email"
              placeholder="Email Address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full p-3 border rounded-lg"
              required
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-3 border rounded-lg"
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#009578] text-white p-3 rounded-lg font-semibold hover:bg-[#0e7762]"
            >
              {loading ? "Processing..." : "Register"}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyCodeAndRegister} className="space-y-4">
            <input
              type="text"
              placeholder="Enter 4-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full p-3 border rounded-lg"
              required
            />
            <button
              type="submit"
              className="w-full bg-[#009578] text-white p-3 rounded-lg font-semibold hover:bg-[#0e7762]"
            >
              Verify & Complete Registration
            </button>
          </form>
        )}

        <p className="text-center text-sm mt-4">
          Already have an account?{" "}
          <Link href="/login" className="text-[#009578] hover:text-[#0e7762] font-medium">
            Login
          </Link>
        </p>
      </div>
    </div>
  );
}
