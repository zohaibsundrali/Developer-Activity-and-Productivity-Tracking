import { NextResponse } from "next/server";
import { getAuthedOrg, serviceClient } from "@/utils/serverAuth";
import { requirePermission } from "@/utils/serverPermissions";
import { LEGACY_HASH_PREFIX } from "@/app/api/developer/change-password/legacyPassword";

export const dynamic = "force-dynamic";

/**
 * Organization-scoped, read-only counts for callers with system.audit.
 * Null auth_user_id means the profile is unlinked; it does not prove an Auth
 * account is absent. Operators must reconcile existing identities before
 * provisioning anything. Password counts expose no credential material and
 * help verify removal of legacy copies; they do not describe current grants.
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
        "legacyOnly = profiles with auth_user_id null. An Auth account may already exist but be unlinked. These profiles cannot authorize application access until an operator verifies and repairs the existing identity link, or provisions a new account when none exists. Do not infer account absence or recreate accounts from this count.",
        "cleartextPasswords = rows whose legacy password column is neither null nor a recognized PBKDF2 hash. The audit returns counts only; remaining legacy credential copies require removal.",
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
