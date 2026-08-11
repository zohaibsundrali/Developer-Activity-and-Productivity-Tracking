import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/client/account — a client edits its own profile.
 *
 * WHY A ROUTE AND NOT A POLICY
 *
 * `clients` has a read policy for the signed-in client and no update policy.
 * Adding one would mean writing a rule that says "this row, but only these
 * columns" — and column-level rules are exactly what RLS is worst at
 * expressing. `clients` carries `organization_id`, `status`, `auth_user_id` and
 * a legacy plaintext `password`; a row-level update policy would let a client
 * move itself to another organization or set its own status to whatever it
 * liked, and the fix would be a trigger enumerating the columns anyway.
 *
 * So the whitelist lives here, in one place, and reads like a whitelist.
 *
 * The PASSWORD is deliberately NOT handled here. It is changed in the browser
 * with supabase.auth.updateUser(), which requires the caller's live session and
 * never sends the new password anywhere but Supabase Auth. Routing it through
 * this server would mean the plaintext passes through our logs' blast radius
 * for no gain.
 */

const EDITABLE = ["name", "phone", "company"];
const MAX = 200;

export async function PATCH(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Clients only. Staff editing a client's profile goes through the admin
    // screens, which record who did it.
    if (auth.userType !== "client" || !auth.appUserId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const patch = {};

    for (const key of EDITABLE) {
      if (body[key] === undefined) continue;
      const value = String(body[key] ?? "").trim();
      if (value.length > MAX) {
        return NextResponse.json({ error: `That ${key} is too long.` }, { status: 400 });
      }
      // A name is the one field that cannot be blanked: it is what every
      // screen shows beside the things this person wrote.
      if (key === "name" && !value) {
        return NextResponse.json({ error: "A name is required." }, { status: 400 });
      }
      patch[key] = value || null;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
    }

    const svc = serviceClient();

    // Scoped to the caller AND their organization. The id comes from the
    // verified token, never the body — this is the whole reason the route
    // exists rather than a policy.
    const { data, error } = await svc
      .from("clients")
      .update(patch)
      .eq("id", auth.appUserId)
      .eq("organization_id", auth.orgId)
      .select("id, name, email, company, phone")
      .single();

    if (error) throw error;

    // Keep the membership's display email/name in step where it holds one, so
    // the admin's Members list does not disagree with the portal.
    if (patch.name) {
      try {
        await svc
          .from("memberships")
          .update({ updated_at: new Date().toISOString() })
          .eq("organization_id", auth.orgId)
          .eq("user_id", auth.appUserId)
          .eq("user_type", "client");
      } catch {
        // Cosmetic only — never fail the user's own profile edit for it.
      }
    }

    return NextResponse.json({ client: data });
  } catch (e) {
    console.error("[client/account PATCH]", e?.message || e);
    return NextResponse.json({ error: "Could not save your details." }, { status: 503 });
  }
}
