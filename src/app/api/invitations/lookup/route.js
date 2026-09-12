import { NextResponse } from "next/server";
import { serviceClient } from "@/utils/serverAuth";

export const dynamic = "force-dynamic";

const reply = (body, status = 200) => NextResponse.json(body, {
  status,
  headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
});

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
      return reply({ error: "token required" }, 400);
    }

    const svc = serviceClient();
    const { data: invite, error } = await svc
      .from("invitations")
      .select("email, role, status, expires_at, organization_id, project_id")
      .eq("token", token)
      .maybeSingle();

    if (error) return reply({ error: "lookup_unavailable" }, 503);
    if (!invite) return reply({ error: "not_found" }, 404);

    let orgName = null;
    if (invite.organization_id) {
      const { data: org, error: orgError } = await svc
        .from("organizations")
        .select("name")
        .eq("id", invite.organization_id)
        .maybeSingle();
      if (orgError) return reply({ error: "lookup_unavailable" }, 503);
      if (!org) return reply({ error: "not_found" }, 404);
      orgName = org.name || null;
    }

    const expiration = Date.parse(invite.expires_at);
    const expired = !invite.expires_at || !Number.isFinite(expiration) || expiration <= Date.now();

    return reply({
      email: invite.email,
      role: invite.role,
      status: invite.status,
      expired,
      orgName,
      hasProject: !!invite.project_id,
    });
  } catch (e) {
    return reply({ error: "lookup_unavailable" }, 503);
  }
}
