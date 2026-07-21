import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Server-side admin signup — creates the admin_users row, the organization, the
// owner membership, and the Supabase Auth account, all with the service_role
// key (bypasses RLS so signup works even after RLS is enabled).

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function POST(request) {
  try {
    const body = await request.json();
    const { fullName, company, industry, companySize, country, email, password, timezone } = body;
    if (!email || !password) {
      return NextResponse.json({ error: "email and password are required" }, { status: 400 });
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
    const { data: org } = await admin
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

    // 3) link admin + owner membership
    if (orgId) {
      await admin.from("admin_users").update({ organization_id: orgId }).eq("id", newAdmin.id);
      await admin.from("memberships").insert([{
        organization_id: orgId, user_id: newAdmin.id, user_type: "admin",
        email: newAdmin.email, role: "owner", status: "active",
      }]);
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
