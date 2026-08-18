import { getOrgContext } from "@/utils/orgContext";
import { ROLE_RANK as SHARED_ROLE_RANK } from "@/utils/roles";
import { LEGACY_KEYS } from "@/utils/permissionCatalogue";
import { roleCan } from "@/utils/permissionEngine";

/**
 * Lightweight role-based access control for the multi-tenant SaaS.
 *
 * ELEVEN ROLES, highest → lowest:
 *   owner, admin, manager, hr, finance, team_lead, qa, developer, designer,
 *   employee, client
 *
 * A ROLE IS NOT A JOB TITLE. Job titles live in
 * `employee_profiles.designation`, which is free text and can say anything —
 * "Scrum Master", "Solutions Architect", "Intern". A role exists only to say
 * what someone may DO, so two roles with identical permissions are one role
 * with two names, and every extra name is another list to keep in sync across
 * this file, navConfig.js, the API routes and the RLS policies.
 *
 * That is why the set stops here rather than mirroring an org chart:
 *
 *   finance   real difference — billing and invoices WITHOUT the monitoring
 *             surface. Before it existed an accountant had to be made `admin`
 *             to read an invoice, which also handed them every employee's
 *             screen captures.
 *   qa        real difference — a developer who may also review other people's
 *             submissions.
 *   designer  NO difference. Identical to `developer` today. It is here
 *             because designers were wanted as a first-class role rather than
 *             a job title, and because having the value in the enum is what
 *             lets the permissions diverge later without a data migration.
 *             Deliberate, not an oversight — see database/058.
 *
 * WHERE THE RULES LIVE NOW: utils/permissionCatalogue.js. This file keeps the
 * role RANKING (which is about seniority, not capability — who may grant whom a
 * role) and the session lookup. The DB `role_permissions` table still holds a
 * matrix nothing reads; repairing and wiring it is the next phase, and the
 * catalogue is the shape it will be repaired against.
 */
// Imported, not redeclared — see src/utils/roles.js for why there is only
// one copy of this now.
const ROLE_RANK = SHARED_ROLE_RANK;

export function getRole() {
  return getOrgContext()?.role || null;
}

export function hasRole(...roles) {
  const r = getRole();
  return r ? roles.includes(r) : false;
}

/**
 * Is the signed-in role at or above `role` in the ranking?
 *
 * Both unknown-value defaults are sentinels, NOT numbers on the same scale as
 * ROLE_RANK, and that is load-bearing. This used to read `|| 99` for the
 * target, which worked only because the highest real rank was 8 — widening the
 * scale to make room for `finance` and `qa` silently pushed `owner` to 100 and
 * turned `atLeast("superadmin")` from false into TRUE. A guard whose
 * correctness depends on a magic number staying larger than every other magic
 * number in the file is a guard that will break again the next time somebody
 * renumbers. Infinity and -Infinity cannot be overtaken.
 */
export function atLeast(role) {
  const r = getRole();
  if (!r) return false;
  const have = Object.prototype.hasOwnProperty.call(ROLE_RANK, r)
    ? ROLE_RANK[r]
    : Number.NEGATIVE_INFINITY; // unknown current role reaches nothing
  const need = Object.prototype.hasOwnProperty.call(ROLE_RANK, role)
    ? ROLE_RANK[role]
    : Number.POSITIVE_INFINITY; // unknown target is unreachable
  return have >= need;
}

/**
 * Coarse capability check, now a thin shim over the shared resolver.
 *
 * WHAT THIS USED TO BE: a 23-case switch that was one of four independent
 * copies of the access rules. The role lists moved to
 * utils/permissionCatalogue.js — beside every other permission in the product —
 * and utils/permissionEngine.js decides. This function survives only so its
 * five call sites keep working; new code should call `usePermission` or the
 * resolver directly with a `resource.action` key.
 *
 * TWO THINGS CHANGED, both deliberate and both recorded in
 * tests/permissionParity.test.js, which compares this against a frozen
 * transcript of the old switch for all twelve roles:
 *
 *   1. AN UNKNOWN ACTION IS NOW REFUSED. The switch ended `default: return
 *      true`, so every action it did not name — including every typo — answered
 *      yes for anybody signed in. `can("manage_setting")` was true for a
 *      developer. Turning that around is only safe because a test now asserts
 *      that every `can(...)` in the source names a real key, so there is no
 *      call site left for the old default to have been carrying.
 *   2. Two keys where the old switch contradicted the server or the screen were
 *      settled in favour of whichever one actually runs. See
 *      DELIBERATE_DIVERGENCES in that test file for the argument.
 */
export function can(action) {
  const key = LEGACY_KEYS[action] || action;
  return roleCan(getRole(), key);
}

/**
 * The preferred form: ask by permission key.
 *
 * `can()` takes the old `manage_teams`-style names; this takes the catalogue's
 * `team.manage`. Both end at the same resolver, so they can never disagree.
 */
export function allowed(key, scope) {
  return roleCan(getRole(), key, scope);
}
