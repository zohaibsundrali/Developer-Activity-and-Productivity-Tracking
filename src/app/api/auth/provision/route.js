import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Server-only: create a Supabase Auth user with organization claims in
// app_metadata (so the JWT carries organization_id for RLS). Used by
// registration and invite-accept so every new user gets an auth account.
// Requires the service_role key (server-side only).

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function POST(request) {
  try {
    const { email, password, organizationId, role, userType, appUserId } = await request.json();
    if (!email || !password) {
      return NextResponse.json({ error: "email and password are required" }, { status: 400 });
    }

    const app_metadata = {
      organization_id: organizationId || null,
      role: role || (userType === "admin" ? "admin" : "developer"),
      user_type: userType || "developer",
      app_user_id: appUserId || null,
    };

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata,
    });

    if (error) {
      // Already-registered is not fatal for our flow.
      if (/already|exists|registered/i.test(error.message || "")) {
        return NextResponse.json({ success: true, alreadyExists: true });
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, userId: data?.user?.id || null });
  } catch (e) {
    return NextResponse.json({ error: "Failed to provision auth user" }, { status: 500 });
  }
}
