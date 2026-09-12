import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { meta as termsMeta } from "@/content/legal/terms";
import { normalizeEmail } from "@/utils/verificationCodes";

const TERMS_VERSION = termsMeta.version || termsMeta.lastUpdated;
const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);

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


// The database reservation owns IDs, initial plan and consent evidence. Auth
// creation is the only external step; its outcome can be recovered without
// deleting or relinking any existing user's identity.
export async function POST(request) {
  let claim = null;
  try {
    const body = await request.json();
    const email = normalizeEmail(body?.email);
    if (!body || typeof body.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
        typeof body.password !== "string" || body.password.length < 6 || body.password.length > 1024 ||
        typeof body.fullName !== "string" || !body.fullName.trim() || body.fullName.length > 120 ||
        typeof body.company !== "string" || !body.company.trim() || body.company.length > 200) {
      return NextResponse.json({ error: "A valid email, name, company and password of at least 6 characters are required." }, { status: 400 });
    }
    if (body.termsAccepted !== true) return NextResponse.json({ error: "You must accept the Terms of Service to create an account." }, { status: 400 });
    if (typeof body.verificationGrant !== "string" || !/^[a-f0-9]{64}$/.test(body.verificationGrant)) {
      return NextResponse.json({ error: "Please verify your email again before creating your workspace.", code: "email_not_verified" }, { status: 403 });
    }
    const claimId = randomUUID();
    const { data: attempt, error: reserveError } = await admin.rpc("claim_signup", {
      p_email: email, p_claim: claimId,
      p_details: { fullName: body.fullName.trim(), company: body.company.trim(),
        industry: typeof body.industry === "string" ? body.industry : null,
        companySize: typeof body.companySize === "string" ? body.companySize : null,
        country: typeof body.country === "string" ? body.country : null,
        timezone: typeof body.timezone === "string" ? body.timezone : "UTC" },
      p_plan: typeof body.planCode === "string" ? body.planCode : "free",
      p_terms: TERMS_VERSION, p_grant_hash: createHash("sha256").update(body.verificationGrant).digest("hex"), p_ip: acceptanceIp(request),
    });
    if (reserveError || !attempt?.id || !attempt.auth_user_id || !attempt.profile_id || !attempt.organization_id) {
      const reason = reserveError?.message || "";
      if (reason.startsWith("SIGNUP_EMAIL_NOT_VERIFIED")) return NextResponse.json({ error: "Please verify your email again, then retry. Any reserved setup will be resumed.", code: "email_not_verified" }, { status: 403 });
      if (reason.startsWith("SIGNUP_BUSY")) return NextResponse.json({ error: "Account setup is already in progress. Please retry shortly.", code: "signup_busy" }, { status: 409 });
      if (reason.startsWith("SIGNUP_ACCOUNT_EXISTS")) return NextResponse.json({ error: "This email is already registered. Sign in or use Forgot password.", code: "account_exists" }, { status: 409 });
      throw new Error("Signup reservation unavailable");
    }
    claim = { p_id: attempt.id, p_claim: claimId };
    const metadata = { signup_id: attempt.id, app_user_id: attempt.profile_id, organization_id: attempt.organization_id, role: "owner", user_type: "admin" };
    const { data: prior, error: priorError } = await admin.auth.admin.getUserById(attempt.auth_user_id);
    if (priorError && priorError.status !== 404 && priorError.code !== "user_not_found") throw new Error("Auth lookup unavailable");
    if (!priorError && !prior?.user) throw new Error("Auth lookup unconfirmed");
    if (prior?.user) {
      const user = prior.user;
      if (user.id !== attempt.auth_user_id || normalizeEmail(user.email) !== email ||
          Object.entries(metadata).some(([key, value]) => user.app_metadata?.[key] !== value)) {
        return NextResponse.json({ error: "Reserved account identity needs administrator reconciliation.", code: "signup_identity_conflict" }, { status: 409 });
      }
      const verifier = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
      let verified;
      try { verified = await verifier.auth.signInWithPassword({ email, password: body.password }); }
      finally { try { await verifier.auth.signOut({ scope: "local" }); } catch { /* No verification tokens are persisted or returned. */ } }
      if (verified?.error || verified?.data?.user?.id !== attempt.auth_user_id) {
        const wrongPassword = verified?.error?.code === "invalid_credentials";
        return NextResponse.json({ error: wrongPassword
          ? "Use the password from your first signup attempt, or use Forgot password before retrying."
          : "Existing sign-in could not be verified. Please retry shortly.", code: "signup_verification_required" }, { status: wrongPassword ? 409 : 503 });
      }
    } else {
      const { data, error } = await admin.auth.admin.createUser({ id: attempt.auth_user_id, email, password: body.password, email_confirm: true, app_metadata: metadata });
      if (error || data?.user?.id !== attempt.auth_user_id) throw new Error("Auth creation unconfirmed");
    }
    const { data: completed, error: finishError } = await admin.rpc("finish_signup", claim);
    if (finishError || !completed?.success) throw new Error("Signup finalization unconfirmed");
    return NextResponse.json(completed);
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid JSON request" }, { status: 400 });
    return NextResponse.json({ error: "Account setup is pending confirmation. Try signing in shortly; if setup remains pending, verify your email again and retry with the same password.", code: "signup_setup_unconfirmed" }, { status: 503 });
  } finally {
    if (claim) { try { await admin.rpc("release_signup_claim", claim); } catch { /* The bounded lease permits background recovery. */ } }
  }
}
