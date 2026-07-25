import { NextResponse } from "next/server";
import { serviceClient } from "@/utils/serverAuth";

export const dynamic = "force-dynamic";

// GET /api/invitations/lookup?token=...
// Public token-based lookup for the /invite/[token] page. The invitee is NOT
// authenticated, and `invitations` has RLS that only allows authenticated org
// members — so the browser (anon) client can't read the row. This route uses
// the service role to return the minimal, non-sensitive fields the accept page
// needs. The token itself is the secret (same trust model as accepting).
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");
    if (!token) {
      return NextResponse.json({ error: "token required" }, { status: 400 });
    }

    const svc = serviceClient();
    const { data: invite, error } = await svc
      .from("invitations")
      .select("email, role, status, expires_at, organization_id, project_id")
      .eq("token", token)
      .maybeSingle();

    if (error || !invite) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    let orgName = null;
    if (invite.organization_id) {
      const { data: org } = await svc
        .from("organizations")
        .select("name")
        .eq("id", invite.organization_id)
        .maybeSingle();
      orgName = org?.name || null;
    }

    const expired = !!(invite.expires_at && new Date(invite.expires_at) < new Date());

    return NextResponse.json({
      email: invite.email,
      role: invite.role,
      status: invite.status,
      expired,
      orgName,
      hasProject: !!invite.project_id,
    });
  } catch (e) {
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
}
