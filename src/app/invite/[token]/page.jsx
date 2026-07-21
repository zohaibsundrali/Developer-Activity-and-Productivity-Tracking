"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/utils/supabaseClient";

import "../../auth.css";

export default function AcceptInvitePage() {
  const params = useParams();
  const router = useRouter();
  const token = params?.token;

  const [loading, setLoading] = useState(true);
  const [invitation, setInvitation] = useState(null);
  const [orgName, setOrgName] = useState("");
  const [guard, setGuard] = useState(null); // 'not-found' | 'revoked' | 'accepted' | 'expired'

  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const loadInvite = async () => {
      if (!token) {
        if (active) {
          setGuard("not-found");
          setLoading(false);
        }
        return;
      }

      try {
        const { data: invite, error: inviteError } = await supabase
          .from("invitations")
          .select("*")
          .eq("token", token)
          .maybeSingle();

        if (!active) return;

        if (inviteError || !invite) {
          setGuard("not-found");
          setLoading(false);
          return;
        }

        setInvitation(invite);

        // Guard states
        if (invite.status === "revoked") {
          setGuard("revoked");
          setLoading(false);
          return;
        }
        if (invite.status === "accepted") {
          setGuard("accepted");
          setLoading(false);
          return;
        }
        if (
          invite.status === "expired" ||
          (invite.expires_at && new Date(invite.expires_at) < new Date())
        ) {
          setGuard("expired");
          setLoading(false);
          return;
        }

        // Resolve organization name
        const { data: org } = await supabase
          .from("organizations")
          .select("name")
          .eq("id", invite.organization_id)
          .maybeSingle();

        if (!active) return;
        if (org && org.name) setOrgName(org.name);

        setLoading(false);
      } catch (err) {
        if (!active) return;
        setGuard("not-found");
        setLoading(false);
      }
    };

    loadInvite();
    return () => {
      active = false;
    };
  }, [token]);

  const handleAccept = async (e) => {
    e.preventDefault();
    if (!invitation) return;

    setSubmitting(true);
    setError("");

    try {
      const email = invitation.email;
      const isAdmin = invitation.role === "admin";
      const userType = isAdmin ? "admin" : "developer";

      let newUser = null;

      if (isAdmin) {
        // ── Admin account ──────────────────────────────
        const { data: existingAdmin } = await supabase
          .from("admin_users")
          .select("id")
          .eq("email", email)
          .maybeSingle();

        if (existingAdmin) {
          throw new Error("An account already exists for this email.");
        }

        const { data: adminData, error: adminError } = await supabase
          .from("admin_users")
          .insert({
            full_name: fullName,
            email,
            password,
            company: orgName,
            role: "admin",
            is_verified: true,
            organization_id: invitation.organization_id,
          })
          .select("*")
          .single();

        if (adminError) {
          if (
            (adminError.code && adminError.code === "23505") ||
            /duplicate|unique/i.test(adminError.message || "")
          ) {
            throw new Error("An account already exists for this email.");
          }
          throw new Error(adminError.message || "Failed to create account.");
        }
        newUser = adminData;
      } else {
        // ── Developer account (manager/developer/employee/client) ──
        const { data: existingDev } = await supabase
          .from("developers")
          .select("id")
          .eq("email", email)
          .maybeSingle();

        if (existingDev) {
          throw new Error("An account already exists for this email.");
        }

        const { data: devData, error: devError } = await supabase
          .from("developers")
          .insert({
            name: fullName,
            email,
            password,
            organization_id: invitation.organization_id,
            status: "active",
          })
          .select("*")
          .single();

        if (devError) {
          if (
            (devError.code && devError.code === "23505") ||
            /duplicate|unique/i.test(devError.message || "")
          ) {
            throw new Error("An account already exists for this email.");
          }
          throw new Error(devError.message || "Failed to create account.");
        }
        newUser = devData;
      }

      // ── Membership row ───────────────────────────────
      const { error: membershipError } = await supabase.from("memberships").insert({
        organization_id: invitation.organization_id,
        user_id: newUser.id,
        user_type: userType,
        email,
        role: invitation.role,
        team_id: invitation.team_id || null,
        department_id: invitation.department_id || null,
        status: "active",
      });

      if (membershipError) {
        throw new Error(membershipError.message || "Failed to create membership.");
      }

      // Provision a Supabase Auth account (with org claim) so the new member
      // can authenticate via Supabase Auth and be covered by RLS. Best-effort.
      try {
        await fetch("/api/auth/provision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            organizationId: invitation.organization_id,
            role: invitation.role,
            userType,
            appUserId: newUser.id,
          }),
        });
      } catch {
        // non-fatal — legacy login fallback still works
      }

      // ── Mark invitation accepted ─────────────────────
      await supabase
        .from("invitations")
        .update({ status: "accepted" })
        .eq("id", invitation.id);

      router.push("/login");
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  const guardMessages = {
    "not-found": {
      title: "Invitation not found",
      text: "We couldn't find this invitation. The link may be incorrect or no longer exist.",
    },
    revoked: {
      title: "Invitation revoked",
      text: "This invitation has been revoked by an administrator and can no longer be used.",
    },
    accepted: {
      title: "Already accepted",
      text: "This invitation has already been accepted. You can sign in with your account.",
    },
    expired: {
      title: "Invitation expired",
      text: "This invitation has expired. Please ask an administrator to send you a new one.",
    },
  };

  const roleLabel = invitation
    ? invitation.role.charAt(0).toUpperCase() + invitation.role.slice(1)
    : "";

  return (
    <div className="auth-root">
      <div className="auth-orb auth-orb-1" />
      <div className="auth-orb auth-orb-2" />
      <div className="auth-orb auth-orb-3" />

      <div className="auth-card">
        {loading ? (
          <div className="auth-brand">
            <h1>Loading invitation…</h1>
            <p>Please wait while we verify your invite.</p>
          </div>
        ) : guard ? (
          <>
            <div className="auth-brand">
              <h1>{guardMessages[guard].title}</h1>
              <p>{guardMessages[guard].text}</p>
            </div>
            <div className="auth-footer">
              <a href="/login">Go to sign in →</a>
            </div>
          </>
        ) : (
          <>
            <div className="auth-brand">
              <h1>Accept your invitation</h1>
              <p>
                You've been invited to join
                {orgName ? <strong> {orgName}</strong> : " the workspace"} as a{" "}
                <strong>{roleLabel}</strong>. Set up your account to continue.
              </p>
            </div>

            <form onSubmit={handleAccept}>
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
                    value={invitation?.email || ""}
                    className="auth-input"
                    readOnly
                    autoComplete="email"
                  />
                </div>
              </div>

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
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Your full name"
                    className="auth-input"
                    required
                    autoComplete="name"
                  />
                </div>
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
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Create a password"
                    className="auth-input"
                    required
                    autoComplete="new-password"
                    style={{ paddingRight: "2.75rem" }}
                  />
                  <button
                    type="button"
                    className="auth-eye-btn"
                    onClick={() => setShowPassword((v) => !v)}
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <div className="auth-error-box">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                  <p>{error}</p>
                </div>
              )}

              <button type="submit" disabled={submitting} className="auth-submit-btn">
                {submitting ? (
                  <>
                    <span className="auth-spinner" />
                    Creating account…
                  </>
                ) : (
                  "Accept & Create Account"
                )}
              </button>
            </form>

            <div className="auth-divider">
              <span>Already have an account?</span>
            </div>
            <div className="auth-footer">
              <a href="/login">Sign in instead →</a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
