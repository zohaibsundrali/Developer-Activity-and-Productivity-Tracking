import { randomUUID } from "node:crypto";
import { validateInvitationScope } from "@/utils/invitationScope";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkSeatLimitForRole, checkFeatureAccess } from "@/utils/entitlements";
import { isRole, userTypeForRole } from "@/utils/roles";
import { meta as termsMeta } from "@/content/legal/terms";

// Server-side invite acceptance (service_role): validates the token, creates the
// user + membership + Supabase Auth account, and marks the invite accepted.
// Bypasses RLS so acceptance works once RLS is enabled (the invitee is not
// authenticated at this point).

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Same source and the same reasoning as src/app/api/auth/signup/route.js: the
// Terms module has no `version` field, so its last-updated date is the version,
// it is resolved on the server, and it is never taken from the request.
const TERMS_VERSION = termsMeta.version || termsMeta.lastUpdated;

// Reads the address off the request we already have; no new plumbing. Returns
// null for anything that is not a valid address, because the column is `inet`
// and a malformed value would abort the insert.
function acceptanceIp(request) {
  const raw =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "";
  const value = raw.trim();
  if (!value) return null;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (v4) return v4.slice(1).every((octet) => Number(octet) <= 255) ? value : null;
  const compressions = (value.match(/::/g) || []).length;
  if (compressions <= 1 && /^[0-9a-fA-F]{0,4}(:[0-9a-fA-F]{0,4}){2,7}$/.test(value)) return value;
  return null;
}

export async function POST(request) {
  let claim = null;
  try {
    const { token, fullName, password, termsAccepted } = await request.json();
    if (typeof token !== "string" || !token || typeof password !== "string" || password.length < 6 ||
        (fullName != null && (typeof fullName !== "string" || fullName.length > 120))) {
      return NextResponse.json({ error: "Invitation token and a password of at least 6 characters are required." }, { status: 400 });
    }
    if (termsAccepted !== true) return NextResponse.json({ error: "You must accept the Terms of Service to accept this invitation." }, { status: 400 });
    const { data: invite, error: lookupError } = await admin.from("invitations").select("*").eq("token", token).maybeSingle();
    if (lookupError) return NextResponse.json({ error: "Invitation lookup unavailable." }, { status: 503 });
    if (!invite) return NextResponse.json({ error: "Invitation not found." }, { status: 404 });
    if (invite.status === "accepted") return NextResponse.json({ error: "This invitation was already used. Please sign in." }, { status: 409 });
    if (invite.status !== "pending" || !invite.expires_at || !Number.isFinite(Date.parse(invite.expires_at)) || Date.parse(invite.expires_at) <= Date.now()) {
      return NextResponse.json({ error: "This invitation has expired or was revoked." }, { status: 410 });
    }
    if (!isRole(invite.role) || invite.role === "owner") return NextResponse.json({ error: "Invalid invitation role." }, { status: 400 });
    const userType = userTypeForRole(invite.role);
    const scopeError = await validateInvitationScope(admin, invite.organization_id, {
      teamId: invite.team_id, departmentId: invite.department_id, projectId: invite.project_id,
    });
    if (scopeError) return NextResponse.json(scopeError, { status: scopeError.status });
    const seatLimit = userType === "client"
      ? await checkFeatureAccess(admin, invite.organization_id, "client_portal", "Client portal")
      : await checkSeatLimitForRole(admin, invite.organization_id, invite.role);
    if (seatLimit) return NextResponse.json(seatLimit, { status: seatLimit.status });

    const claimId = randomUUID();
    const { data: reserved, error: claimError } = await admin.rpc("claim_invitation", { p_id: invite.id, p_claim: claimId });
    if (claimError || !reserved?.auth_user_id || !reserved?.profile_id) {
      return NextResponse.json({ error: "Invitation acceptance is in progress or unavailable. Please retry shortly." }, { status: claimError?.message?.startsWith("INVITATION_BUSY") ? 409 : 503 });
    }
    claim = { p_id: invite.id, p_claim: claimId };
    const metadata = { invitation_id: invite.id, organization_id: invite.organization_id, role: invite.role, user_type: userType, app_user_id: reserved.profile_id };
    // Both IDs were reserved BEFORE Auth creation. A process crash cannot lose
    // the account's identity, and a retry repairs this account rather than
    // creating another one or deleting an account whose transaction committed.
    const { data: prior, error: priorError } = await admin.auth.admin.getUserById(reserved.auth_user_id);
    if (priorError && priorError.status !== 404 && priorError.code !== "user_not_found") throw new Error("Auth lookup unavailable");
    let authResult;
    if (prior?.user) {
      const previous = prior.user;
      if (previous.app_metadata?.invitation_id !== invite.id || previous.app_metadata?.app_user_id !== reserved.profile_id ||
          previous.app_metadata?.organization_id !== invite.organization_id || previous.email?.toLowerCase() !== invite.email.toLowerCase()) {
        throw new Error("Reserved Auth account identity mismatch");
      }
      authResult = await admin.auth.admin.updateUserById(reserved.auth_user_id, { password, app_metadata: metadata });
    } else {
      authResult = await admin.auth.admin.createUser({ id: reserved.auth_user_id, email: invite.email, password, email_confirm: true, app_metadata: metadata });
    }
    if (authResult.error || authResult.data?.user?.id !== reserved.auth_user_id) {
      const duplicate = authResult.error?.status === 422 || /already|exist|registered/i.test(authResult.error?.message || "");
      return NextResponse.json({ error: duplicate ? "An account already exists for this email. Sign in or contact your administrator." : "Could not create your sign-in. Please retry." }, { status: duplicate ? 409 : 503 });
    }
    const { data: accepted, error: finishError } = await admin.rpc("finish_invitation", {
      ...claim, p_name: fullName?.trim() || invite.email, p_terms_version: TERMS_VERSION, p_ip: acceptanceIp(request),
    });
    if (finishError || !accepted?.success) {
      const billingFailure = /^(PLAN_LIMIT_REACHED|PLAN_FEATURE_REQUIRED|BILLING_LOCKED)/.test(finishError?.message || "");
      return NextResponse.json({ error: billingFailure ? "The organization’s plan cannot accept this member. Contact its owner." : "Acceptance could not be confirmed. Please retry or sign in if your account was created." }, { status: billingFailure ? 402 : 503 });
    }
    return NextResponse.json({ success: true, role: invite.role, userType });
  } catch (error) {
    return NextResponse.json({ error: error instanceof SyntaxError ? "Invalid JSON request" : "Invitation acceptance is temporarily unavailable. Please retry." }, { status: error instanceof SyntaxError ? 400 : 503 });
  } finally {
    if (claim) {
      try { await admin.rpc("release_invitation_claim", claim); }
      catch { /* The bounded lease makes an interrupted release recoverable. */ }
    }
  }
}
