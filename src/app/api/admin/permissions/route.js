import { NextResponse } from "next/server";

import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { requirePermission } from "@/utils/serverPermissions";
import { isPermissionKey, permissionsForRole } from "@/utils/permissionCatalogue";
import { requireUnlocked } from "@/utils/entitlements";

/**
 * Read and write per-person permission overrides.
 *
 * GET  → every active member of the organization, the permissions their ROLE
 *        gives them, and the overrides written against them.
 * POST → set one override, or clear it.
 *
 * OWNER ONLY, on both. `permissions.manage` is the one key in the catalogue
 * that does not extend to admin, because whoever can write here can write
 * themselves anything — this is the endpoint that hands out every other
 * endpoint. The RLS write policy on `user_permissions` (migration 069) says
 * the same thing independently; neither is trusting the other.
 *
 * WHY THE CATALOGUE IS NOT RETURNED HERE. The list of permissions and their
 * role defaults is application code, identical in every deployment, and the
 * screen imports it directly. Serialising it through an API would create a
 * second copy that can lag behind a deploy — the exact failure this whole phase
 * exists to end.
 */

export const dynamic = "force-dynamic";

/** Members, their role, and the overrides against them. */
export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    const denied = requirePermission(auth, "permissions.manage");
    if (denied) return denied;

    const svc = serviceClient();

    const { data: members, error: membersError } = await svc
      .from("memberships")
      .select("id, user_id, user_type, email, role, status")
      .eq("organization_id", auth.orgId)
      .order("role", { ascending: true });

    if (membersError) {
      return NextResponse.json({ error: "Could not read members." }, { status: 500 });
    }

    const ids = (members || []).map((m) => m.id);
    let overrides = [];
    if (ids.length) {
      const { data, error } = await svc
        .from("user_permissions")
        .select("id, membership_id, permission_key, allowed, note, created_at")
        .in("membership_id", ids);

      if (error) {
        // The table is absent until migration 069 runs. Say so plainly rather
        // than failing: the screen can still show role defaults, which is most
        // of what it is for, and a 500 here would read as a broken page.
        if (error.code === "PGRST205") {
          return NextResponse.json({
            members: shape(members),
            overrides: [],
            storeReady: false,
          });
        }
        return NextResponse.json({ error: "Could not read overrides." }, { status: 500 });
      }
      overrides = data || [];
    }

    return NextResponse.json({ members: shape(members), overrides, storeReady: true });
  } catch {
    return NextResponse.json({ error: "Could not load permissions." }, { status: 500 });
  }
}

function shape(members) {
  return (members || []).map((m) => ({
    id: m.id,
    email: m.email,
    role: m.role,
    status: m.status,
    userType: m.user_type,
    // Sent so the screen never has to re-derive who holds what by role. It is
    // the same catalogue the screen imports; sending it costs nothing and
    // removes a second place to get the derivation wrong.
    roleGrants: permissionsForRole(m.role),
  }));
}

/**
 * Set or clear one override.
 *
 * Body: { membershipId, permissionKey, allowed }  — `allowed: null` clears it.
 */
export async function POST(request) {
  try {
    const auth = await getAuthedOrg(request);
    const denied = requirePermission(auth, "permissions.manage");
    if (denied) return denied;

    const billingBlocked = await requireUnlocked(serviceClient(), auth.orgId);
    if (billingBlocked) {
      return NextResponse.json(billingBlocked, { status: billingBlocked.status });
    }

    const body = await request.json().catch(() => ({}));
    const { membershipId, permissionKey, allowed, note } = body || {};

    if (!membershipId || !permissionKey) {
      return NextResponse.json(
        { error: "membershipId and permissionKey are required." },
        { status: 400 }
      );
    }
    if (!isPermissionKey(permissionKey)) {
      // A key that is not in the catalogue can never match anything, so storing
      // it would be a row that looks like a decision and is not one.
      return NextResponse.json({ error: "Unknown permission." }, { status: 400 });
    }
    if (allowed !== true && allowed !== false && allowed !== null) {
      return NextResponse.json(
        { error: "allowed must be true, false, or null to clear." },
        { status: 400 }
      );
    }

    const svc = serviceClient();

    // THE TARGET MUST BE IN THE CALLER'S ORGANIZATION. membershipId arrives
    // from the browser, and the service role below bypasses RLS — so this is
    // the check that stops an owner of one tenant writing an override against
    // somebody else's staff. Same omission that let the developer-delete
    // preview read across tenants.
    const { data: target, error: targetError } = await svc
      .from("memberships")
      .select("id, organization_id, role, email")
      .eq("id", membershipId)
      .maybeSingle();

    if (targetError) {
      return NextResponse.json({ error: "Could not read the member." }, { status: 500 });
    }
    if (!target || target.organization_id !== auth.orgId) {
      // Same 404 for "not yours" as for "does not exist": telling a stranger
      // which memberships exist elsewhere is most of the disclosure.
      return NextResponse.json({ error: "Member not found." }, { status: 404 });
    }

    if (allowed === null) {
      const { error } = await svc
        .from("user_permissions")
        .delete()
        .eq("membership_id", membershipId)
        .eq("permission_key", permissionKey);
      if (error) {
        return NextResponse.json({ error: "Could not clear the override." }, { status: 500 });
      }
      return NextResponse.json({ ok: true, cleared: true });
    }

    // Who did this. An exception with no author is one nobody can question
    // later, and these are exactly the rows an auditor asks about.
    const { data: actor } = await svc
      .from("memberships")
      .select("id")
      .eq("organization_id", auth.orgId)
      .eq("user_id", auth.appUserId)
      .eq("user_type", auth.userType)
      .maybeSingle();

    const { error } = await svc.from("user_permissions").upsert(
      {
        membership_id: membershipId,
        permission_key: permissionKey,
        allowed,
        granted_by: actor?.id || null,
        note: typeof note === "string" && note.trim() ? note.trim().slice(0, 500) : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "membership_id,permission_key" }
    );

    if (error) {
      if (error.code === "PGRST205") {
        return NextResponse.json(
          { error: "Overrides are not available yet — migration 069 has not been applied." },
          { status: 503 }
        );
      }
      return NextResponse.json({ error: "Could not save the override." }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not save the override." }, { status: 500 });
  }
}
