import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { requirePermission } from "@/utils/serverPermissions";
import { LEGACY_HASH_PREFIX } from "@/app/api/developer/change-password/legacyPassword";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/legacy-auth-audit — how big is the legacy-password problem?
 *
 * READ ONLY. This route counts rows. It writes nothing, changes nothing and
 * returns no password material of any kind — only counts.
 *
 * WHY IT EXISTS
 *  Three tables (developers, admin_users, clients) carry a `password` column
 *  left over from the pre-Supabase-Auth login, and a `auth_user_id` link to the
 *  real credential. Two questions have to be answerable with a number before
 *  the column can ever be dropped, and today both are guesses:
 *
 *   1. HOW MANY ACCOUNTS HAVE NO SUPABASE AUTH USER (auth_user_id is null)?
 *      These are the accounts that cannot sign in through Supabase Auth at all.
 *      They are also the accounts that CANNOT be repaired by the user: they
 *      have no credential to reset. Every one of them needs an administrator to
 *      provision sign-in. This is the number the staged migration is blocked on.
 *
 *   2. HOW MANY ROWS STILL HOLD A CLEARTEXT PASSWORD?
 *      /api/developer/change-password now stores a PBKDF2 hash instead of
 *      cleartext, but five other writers still insert cleartext and no existing
 *      row has been rewritten. This count is the drain rate: it must reach zero
 *      before the cleartext branch of the login fallback can be deleted.
 *
 * SCOPE
 *  Counts are constrained to the organization on the caller's VERIFIED JWT,
 *  never an id from the request — the same rule as /api/admin/health. Reads run
 *  on the service role because a plain admin token cannot count clients rows it
 *  has no policy for. A PLATFORM-WIDE total spans tenants and is deliberately
 *  not exposed to a tenant here; the SQL for it is in the verification section
 *  of database/041_password_hardening.sql, to be run by the project owner.
 *
 * WHO MAY READ IT
 *  owner and admin only. The counts describe the security posture of every
 *  colleague's account, so a developer, manager or client has no business
 *  reading them.
 */


// The three tables that carry a legacy password column and an auth link.
const AUDITED_TABLES = ["developers", "admin_users", "clients"];

/** count(*) for one filtered query, or null if the query could not run. */
async function countRows(build) {
  const { count, error } = await build();
  if (error) return { count: null, error: error.message };
  return { count: count || 0, error: null };
}

async function auditTable(svc, table, orgId) {
  const base = () => svc.from(table).select("id", { count: "exact", head: true }).eq("organization_id", orgId);

  const [total, legacyOnly, linked, cleartext, hashed, noPassword] = await Promise.all([
    countRows(() => base()),
    // 1. No Supabase Auth user: cannot sign in through the real credential.
    countRows(() => base().is("auth_user_id", null)),
    countRows(() => base().not("auth_user_id", "is", null)),
    // 2. Password column still holds something that is not one of our hashes.
    countRows(() =>
      base().not("password", "is", null).not("password", "like", `${LEGACY_HASH_PREFIX}%`)
    ),
    countRows(() => base().like("password", `${LEGACY_HASH_PREFIX}%`)),
    countRows(() => base().is("password", null)),
  ]);

  const errors = [total, legacyOnly, linked, cleartext, hashed, noPassword]
    .map((r) => r.error)
    .filter(Boolean);

  return {
    table,
    readable: errors.length === 0,
    error: errors[0] || null,
    total: total.count,
    // The headline number: accounts with no linked Supabase Auth user.
    legacyOnly: legacyOnly.count,
    linkedToAuth: linked.count,
    passwords: {
      cleartext: cleartext.count,
      hashed: hashed.count,
      empty: noPassword.count,
    },
  };
}

function sumOrNull(values) {
  if (values.some((v) => v === null || v === undefined)) return null;
  return values.reduce((a, b) => a + b, 0);
}

export async function GET(request) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // Permission, not a role list. See utils/permissionCatalogue.js — the
    // hand-typed array this replaces was one of fifteen, and roles added to the
    // product reached some of them and not others.
    const denied = requirePermission(auth, "system.audit");
    if (denied) return denied;

    const svc = serviceClient();
    const orgId = auth.orgId;

    const results = await Promise.all(
      AUDITED_TABLES.map((table) => auditTable(svc, table, orgId))
    );

    const tables = {};
    for (const result of results) tables[result.table] = result;

    const totals = {
      accounts: sumOrNull(results.map((r) => r.total)),
      legacyOnly: sumOrNull(results.map((r) => r.legacyOnly)),
      linkedToAuth: sumOrNull(results.map((r) => r.linkedToAuth)),
      cleartextPasswords: sumOrNull(results.map((r) => r.passwords.cleartext)),
      hashedPasswords: sumOrNull(results.map((r) => r.passwords.hashed)),
    };

    return NextResponse.json({
      success: true,
      checkedAt: new Date().toISOString(),
      scope: "organization",
      organizationId: orgId,
      totals,
      tables,
      notes: [
        "legacyOnly = rows with auth_user_id null. Those accounts have no Supabase Auth credential; they cannot sign in through Supabase Auth and cannot reset their own password. Each one needs an administrator to provision sign-in before the legacy column can be dropped.",
        "cleartextPasswords = rows whose password column is neither null nor a PBKDF2 hash. Any authenticated member of this organization can read those values through PostgREST.",
        "Counts cover this organization only. The platform-wide figures are in the verification section of database/041_password_hardening.sql.",
      ],
    });
  } catch (err) {
    console.error("[admin/legacy-auth-audit] Failed to build the audit:", err);
    return NextResponse.json(
      { success: false, error: "Could not build the legacy authentication audit." },
      { status: 500 }
    );
  }
}
