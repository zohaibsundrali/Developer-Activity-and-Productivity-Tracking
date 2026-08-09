import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { meta as termsMeta } from "@/content/legal/terms";

// Server-side admin signup — creates the admin_users row, the organization, the
// owner membership, and the Supabase Auth account, all with the service_role
// key (bypasses RLS so signup works even after RLS is enabled).

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Which version of the Terms this signup binds the new organization to.
//
// src/content/legal/terms.js carries no `version` field, so `lastUpdated` is
// the only identifier the document actually has — and it is the same value the
// rendered page shows the reader, which is what makes it usable as evidence.
// The `meta.version` fallback is first so that if a real version is added to
// that module later this picks it up without a change here.
//
// It is read on the SERVER, never taken from the request. A client that could
// name the version it accepted could claim to have accepted any of them.
const TERMS_DOCUMENT = "terms_of_service";
const TERMS_VERSION = termsMeta.version || termsMeta.lastUpdated;

// The address the acceptance arrived from, read off the request we already
// have — same two headers src/app/api/send-verification/route.js uses. No new
// request plumbing, and nothing else about the request is captured.
//
// The column is `inet`, so a malformed value would abort the insert. Anything
// that is not a syntactically valid address is therefore stored as NULL rather
// than as junk: a missing IP weakens the record slightly, a failed insert would
// lose it entirely.
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
  try {
    const body = await request.json();
    const { fullName, company, industry, companySize, country, email, password, timezone, termsAccepted } = body;
    if (!email || !password) {
      return NextResponse.json({ error: "email and password are required" }, { status: 400 });
    }

    // THE GATE. An unticked checkbox disables a button; it does not stop anyone
    // POSTing here directly, and a Terms nobody is recorded as accepting is
    // browsewrap — the weakest form of assent there is. This refusal is what
    // makes the acceptance real, and it deliberately runs BEFORE anything is
    // created, so a request without consent leaves no admin_users row, no
    // organization, no membership and no auth account behind.
    //
    // `!== true` rather than a truthiness test on purpose: "yes", 1 and {} are
    // all truthy, and none of them is a person ticking a box.
    if (termsAccepted !== true) {
      return NextResponse.json(
        { error: "You must accept the Terms of Service to create an account." },
        { status: 400 }
      );
    }

    // 1) admin_users row
    const { data: adminRows, error: adminErr } = await admin
      .from("admin_users")
      .insert([{
        full_name: fullName || null,
        company: company || null,
        email,
        password,               // kept for the legacy login fallback
        is_verified: true,
        role: "admin",
        created_at: new Date().toISOString(),
      }])
      .select()
      .single();

    if (adminErr) {
      if (adminErr.code === "23505") return NextResponse.json({ error: "This email is already registered." }, { status: 409 });
      return NextResponse.json({ error: adminErr.message }, { status: 400 });
    }
    const newAdmin = adminRows;

    // 2) organization
    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .insert([{
        name: (company || "").trim() || `${fullName || "My"}'s Organization`,
        owner_id: newAdmin.id,
        industry: industry || null,
        company_size: companySize || null,
        country: (country || "").trim() || null,
        timezone: timezone || "UTC",
      }])
      .select("id, name")
      .single();

    const orgId = org?.id || null;

    // If the organization could not be created, roll back the admin row so we
    // don't leave an orphaned admin with no org, and surface the real error.
    if (orgErr || !orgId) {
      await admin.from("admin_users").delete().eq("id", newAdmin.id);
      return NextResponse.json(
        { error: orgErr?.message || "Failed to create organization." },
        { status: 500 }
      );
    }

    // 3) link admin + owner membership
    await admin.from("admin_users").update({ organization_id: orgId }).eq("id", newAdmin.id);
    await admin.from("memberships").insert([{
      organization_id: orgId, user_id: newAdmin.id, user_type: "admin",
      email: newAdmin.email, role: "owner", status: "active",
    }]);

    // 3b) record the acceptance — see database/039_terms_acceptance.sql.
    //
    // The version, not a boolean: "terms_accepted: true" cannot answer "who
    // agreed to the version that contained clause 3.5", which is the only
    // question that matters once the document is revised. Written with the
    // service role, which is the only writer RLS permits.
    //
    // A failure here is logged and does not fail the signup. By this point the
    // admin, the organization, the membership and (next) the auth account all
    // exist; returning an error would hand the user a "registration failed"
    // message for an account that does in fact exist, and their retry would
    // collide on the unique email. The load-bearing half of this feature is the
    // refusal above, which happens before anything is created.
    const { error: termsErr } = await admin.from("terms_acceptances").insert([{
      organization_id: orgId,
      user_id: newAdmin.id,
      user_type: "admin",
      email: newAdmin.email,
      document: TERMS_DOCUMENT,
      document_version: TERMS_VERSION,
      entry_point: "signup",
      accepted_at: new Date().toISOString(),
      ip: acceptanceIp(request),
    }]);
    if (termsErr) {
      console.error("[signup] terms acceptance not recorded", newAdmin.id, termsErr.message);
    }

    // 4) Supabase Auth account (with org claim)
    let authUserId = null;
    const { data: au, error: auErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      app_metadata: { organization_id: orgId, role: "owner", user_type: "admin", app_user_id: newAdmin.id },
    });
    if (!auErr && au?.user?.id) {
      authUserId = au.user.id;
      await admin.from("admin_users").update({ auth_user_id: authUserId }).eq("id", newAdmin.id);
    }

    return NextResponse.json({
      success: true,
      admin: newAdmin,
      organizationId: orgId,
      organizationName: org?.name || null,
    });
  } catch (e) {
    return NextResponse.json({ error: "Signup failed" }, { status: 500 });
  }
}
