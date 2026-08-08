/**
 * Credential loading and the skip contract.
 *
 * Every spec asks for the credentials it needs up front. When a variable is
 * missing the suite SKIPS with a message naming the exact variables, instead of
 * failing somewhere inside a login form with an unreadable timeout. A machine
 * with no seeded tenants should report "skipped, set E2E_OWNER_EMAIL,
 * E2E_OWNER_PASSWORD" — not a wall of red.
 */

import { test } from '@playwright/test';
import { envValue } from './env.js';

/**
 * Which sign-in surface each role uses.
 *
 * The login screen has three role tabs and each drops the user in a different
 * area (see src/app/login/page.js). Staff — developer, manager, team lead,
 * employee — all share the "Team Member" tab and the /developer surface;
 * owner/admin/HR use the Admin tab when they exist in `admin_users`.
 */
export const PORTALS = {
  admin: { tab: 'Admin', landing: '/admin/dashboard' },
  team: { tab: 'Team Member', landing: '/developer/dashboard' },
  client: { tab: 'Client', landing: '/client' },
};

/**
 * Role -> env prefix and default portal.
 *
 * The portal is overridable per role with `E2E_<PREFIX>_PORTAL=admin|team|client`
 * because HR (and sometimes manager) can legitimately be seeded either in
 * `admin_users` (admin console, sees Employees/Organization) or in `developers`
 * (staff dashboard, sees the Team panel). The suite should follow the seed, not
 * dictate it.
 */
export const ROLES = {
  owner: { prefix: 'E2E_OWNER', portal: 'admin' },
  manager: { prefix: 'E2E_MANAGER', portal: 'team' },
  hr: { prefix: 'E2E_HR', portal: 'admin' },
  developer: { prefix: 'E2E_DEVELOPER', portal: 'team' },
  employee: { prefix: 'E2E_EMPLOYEE', portal: 'team' },
  client: { prefix: 'E2E_CLIENT', portal: 'client' },
  // Organisation B — only the isolation spec needs it.
  orgBOwner: { prefix: 'E2E_ORG_B_OWNER', portal: 'admin' },
};

/**
 * Resolve one role's credentials.
 *
 * Always returns an object; `ok` says whether the spec can run and `reason`
 * carries the skip message. Nothing here throws, so a spec file can call this
 * at module scope.
 */
export function credentialsFor(role) {
  const spec = ROLES[role];
  if (!spec) throw new Error(`Unknown E2E role "${role}". Known roles: ${Object.keys(ROLES).join(', ')}`);

  const emailVar = `${spec.prefix}_EMAIL`;
  const passwordVar = `${spec.prefix}_PASSWORD`;
  const portalVar = `${spec.prefix}_PORTAL`;

  const email = envValue(emailVar);
  const password = envValue(passwordVar);

  const portalName = (envValue(portalVar) || spec.portal).toLowerCase();
  const portal = PORTALS[portalName];
  if (!portal) {
    return {
      role,
      ok: false,
      reason: `${portalVar}="${portalName}" is not a valid portal. Use one of: ${Object.keys(PORTALS).join(', ')}.`,
    };
  }

  const missing = [];
  if (!email) missing.push(emailVar);
  if (!password) missing.push(passwordVar);

  if (missing.length) {
    return {
      role,
      ok: false,
      reason: `No ${role} credentials — set ${missing.join(' and ')} (see docs/e2e-testing.md).`,
    };
  }

  return {
    role,
    ok: true,
    reason: null,
    email,
    password,
    portalName,
    tab: portal.tab,
    landing: portal.landing,
  };
}

/**
 * Read an extra, non-credential variable (a seeded project id, for instance).
 * Same shape as credentialsFor so specs can treat them uniformly.
 */
export function requireEnv(...names) {
  const missing = names.filter((name) => !envValue(name));
  if (missing.length) {
    return {
      ok: false,
      reason: `Missing ${missing.join(', ')} — see docs/e2e-testing.md for how to seed and export it.`,
      values: {},
    };
  }
  const values = {};
  for (const name of names) values[name] = envValue(name);
  return { ok: true, reason: null, values };
}

/**
 * Skip the current test when any requirement is unmet.
 *
 * Call from inside a test or a beforeEach hook. Accepts any number of results
 * from credentialsFor()/requireEnv() and reports the first unmet one.
 */
export function skipUnless(...requirements) {
  for (const requirement of requirements) {
    if (!requirement || !requirement.ok) {
      test.skip(true, requirement?.reason || 'Required E2E configuration is missing.');
      return;
    }
  }
}
