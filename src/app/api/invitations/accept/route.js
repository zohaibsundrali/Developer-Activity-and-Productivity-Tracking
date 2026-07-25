import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Server-side invite acceptance (service_role): validates the token, creates the
// user + membership + Supabase Auth account, and marks the invite accepted.
// Bypasses RLS so acceptance works once RLS is enabled (the invitee is not
// authenticated at this point).

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function POST(request) {
  try {
    const { token, fullName, password } = await request.json();
    if (!token || !password) {
      return NextResponse.json({ error: "token and password are required" }, { status: 400 });
    }

    // 1) validate the invitation
    const { data: invite } = await admin
      .from("invitations")
      .select("*")
      .eq("token", token)
      .maybeSingle();

    if (!invite) return NextResponse.json({ error: "Invitation not found." }, { status: 404 });
    if (invite.status === "accepted") return NextResponse.json({ error: "This invitation was already used." }, { status: 409 });
    if (invite.status === "revoked") return NextResponse.json({ error: "This invitation was revoked." }, { status: 410 });
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return NextResponse.json({ error: "This invitation has expired." }, { status: 410 });
    }

    const email = invite.email;
    // Owner + Admin share the admin_users profile table. Owner-ness lives in the
    // membership role + JWT (mirroring signup, where the owner's admin_users.role
    // is stored as "admin"), so an invited owner still gets full admin access.
    const isAdminLike = invite.role === "owner" || invite.role === "admin";
    const isClient = invite.role === "client";
    // Clients get their own user_type + `clients` profile row (NO developers row,
    // so they never appear in staff lists or inherit developer data access).
    // Manager / Employee / Developer are internal staff → developers table with
    // user_type "developer"; their real role is preserved on the membership row
    // and JWT app_metadata.role, which drives the role-aware staff dashboard.
    const userType = isAdminLike ? "admin" : isClient ? "client" : "developer";
    const profileTable = isAdminLike ? "admin_users" : isClient ? "clients" : "developers";

    // 2) create the profile row
    let newUser = null;
    if (isAdminLike) {
      const { data, error } = await admin.from("admin_users").insert([{
        full_name: fullName || null, email, password, company: null,
        role: "admin", is_verified: true, organization_id: invite.organization_id,
        created_at: new Date().toISOString(),
      }]).select().single();
      if (error) {
        if (error.code === "23505") return NextResponse.json({ error: "An account already exists for this email." }, { status: 409 });
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      newUser = data;
    } else if (isClient) {
      const { data, error } = await admin.from("clients").insert([{
        name: fullName || null, email, password, status: "active",
        organization_id: invite.organization_id, created_at: new Date().toISOString(),
      }]).select().single();
      if (error) {
        if (error.code === "23505") return NextResponse.json({ error: "An account already exists for this email." }, { status: 409 });
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      newUser = data;

      // Link the client to the invited project (if any).
      if (invite.project_id) {
        await admin.from("project_clients").insert([{
          organization_id: invite.organization_id,
          project_id: invite.project_id,
          client_id: newUser.id,
        }]);
      }
    } else {
      const { data, error } = await admin.from("developers").insert([{
        name: fullName || null, email, password, status: "active",
        organization_id: invite.organization_id, created_at: new Date().toISOString(),
      }]).select().single();
      if (error) {
        if (error.code === "23505") return NextResponse.json({ error: "An account already exists for this email." }, { status: 409 });
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      newUser = data;
    }

    // 3) membership
    await admin.from("memberships").insert([{
      organization_id: invite.organization_id, user_id: newUser.id, user_type: userType,
      email, role: invite.role, team_id: invite.team_id || null,
      department_id: invite.department_id || null, status: "active",
    }]);

    // 4) Supabase Auth account (with org claim)
    const { data: au } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      app_metadata: { organization_id: invite.organization_id, role: invite.role, user_type: userType, app_user_id: newUser.id },
    });
    if (au?.user?.id) {
      await admin.from(profileTable).update({ auth_user_id: au.user.id }).eq("id", newUser.id);
    }

    // 5) mark accepted
    await admin.from("invitations").update({ status: "accepted" }).eq("id", invite.id);

    return NextResponse.json({ success: true, role: invite.role, userType });
  } catch (e) {
    return NextResponse.json({ error: "Failed to accept invitation" }, { status: 500 });
  }
}
