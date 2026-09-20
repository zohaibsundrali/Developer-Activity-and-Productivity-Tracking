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

/** Expected destination after the app detects the verified account role. */
export const PORTALS = {
  admin: { landing: '/admin/dashboard' },
  team: { landing: '/developer/dashboard' },
  'team-admin': { landing: '/admin/dashboard' },
  client: { landing: '/client' },
};

/** Role -> environment prefix and expected destination; PORTAL is an assertion,
 * not an input to the login form or a way to override account permissions. */
export const ROLES = {
  owner: { prefix: 'E2E_OWNER', portal: 'admin' },
  manager: { prefix: 'E2E_MANAGER', portal: 'team-admin' },
  hr: { prefix: 'E2E_HR', portal: 'team-admin' },
  developer: { prefix: 'E2E_DEVELOPER', portal: 'team' },
  employee: { prefix: 'E2E_EMPLOYEE', portal: 'team' },
  client: { prefix: 'E2E_CLIENT', portal: 'client' },
  // The rest of the staff roles. All created by Add employee, so all live in
  // `developers`; the shell automatically routes
  // team_lead, qa and finance wherever their role may go. `admin` arrives by
  // invitation and lives in `admin_users`.
  team_lead: { prefix: 'E2E_TEAM_LEAD', portal: 'team-admin' },
  finance: { prefix: 'E2E_FINANCE', portal: 'team-admin' },
  qa: { prefix: 'E2E_QA', portal: 'team-admin' },
  designer: { prefix: 'E2E_DESIGNER', portal: 'team' },
  devops: { prefix: 'E2E_DEVOPS', portal: 'team' },
  admin: { prefix: 'E2E_ADMIN', portal: 'admin' },
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
    organizationId: envValue(`${spec.prefix}_ORGANIZATION_ID`) || envValue(role === 'orgBOwner' ? 'E2E_QA_ORG_B_ID' : 'E2E_QA_ORG_A_ID'),
    landing: portal.landing,
    // Which SHELL answers after login — what a spec's assertions actually
    // depend on. Two portals land on the admin console (`admin` and
    // `team-admin`), so a spec that branched on portalName === 'admin' read a
    // manager on the console as being on the staff dashboard.
    area: areaOf(portal.landing),
  };
}

/** admin console, staff dashboard or client portal, from where a portal lands. */
export function areaOf(landing) {
  if (landing.startsWith('/admin')) return 'admin';
  if (landing.startsWith('/client')) return 'client';
  return 'staff';
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
