import { test, expect } from '@playwright/test';
import { credentialsFor, skipUnless } from './fixtures/credentials.js';
import { apiRequest, login } from './fixtures/auth.js';

/**
 * PERMISSION MATRIX — the deny side, which api-probe.spec.js does not assert.
 *
 * api-probe proves no role gets a 5xx and that the routes a role SHOULD reach
 * answer 200. It says nothing about the routes a role should NOT reach: a route
 * that wrongly answered 200 to a role with no claim to it would sail through,
 * and that is the exact shape of the audit's root finding — "RLS has an
 * organization dimension but no role dimension, so the UI is the only gate".
 *
 * These routes are each gated by requirePermission(<key>), which answers a hard
 * 403 the moment the role lacks the permission — BEFORE any parameter parsing,
 * so a denied role gets 403, never 400. The allowed set for each key is the
 * catalogue's grant (src/utils/permissionCatalogue.js), resolved to concrete
 * roles here because a Playwright test cannot import the '@/' engine.
 *
 *   invoice.view    BILLING            owner admin finance
 *   test_case.view  REVIEWERS∪CONTRIB  owner admin manager team_lead qa developer designer devops employee
 *   contract.view   DECIDERS + finance owner admin manager finance
 *   proposal.view   SUPERVISORS        owner admin manager team_lead
 *   capacity.view   PEOPLE_READERS     owner admin hr manager team_lead
 *   review.view_own STAFF              everyone except client
 *
 * If the catalogue's grants change, this list is meant to be edited with it —
 * that is the point of writing the expectation down twice.
 */

const ROLES = [
  'owner', 'admin', 'manager', 'team_lead', 'hr', 'finance', 'qa',
  'developer', 'designer', 'devops', 'employee', 'client',
];

const STAFF = ROLES.filter((r) => r !== 'client');

const MATRIX = [
  { path: '/api/invoicing', key: 'invoice.view', allow: ['owner', 'admin', 'finance'] },
  {
    path: '/api/quality',
    key: 'test_case.view',
    allow: ['owner', 'admin', 'manager', 'team_lead', 'qa', 'developer', 'designer', 'devops', 'employee'],
  },
  { path: '/api/contracts', key: 'contract.view', allow: ['owner', 'admin', 'manager', 'finance'] },
  // Dual-audience GET: staff need proposal.view to read the org's pipeline; a
  // client reads its OWN proposals (scoped to client_id, budget stripped), so
  // it is allowed too — the requirePermission gate sits on the staff branch only.
  { path: '/api/proposals', key: 'proposal.view', allow: ['owner', 'admin', 'manager', 'team_lead', 'client'] },
  { path: '/api/capacity', key: 'capacity.view', allow: ['owner', 'admin', 'hr', 'manager', 'team_lead'] },
  // The bare GET is the "cycles" oversight view; review.view_own lives on the
  // ?view=mine branch — everybody-but-client may read their own shared review.
  { path: '/api/performance?view=mine', key: 'review.view_own', allow: STAFF },
];

test.describe('permission matrix — role-gated routes deny the roles they must', () => {
  for (const role of ROLES) {
    test(`${role}: allowed routes answer (not 403), denied routes answer 403`, async ({ page }) => {
      const creds = credentialsFor(role);
      skipUnless(creds);
      await login(page, creds);

      const wrong = [];
      const sheet = [];
      for (const { path, key, allow } of MATRIX) {
        const res = await apiRequest(page, path);
        const allowed = allow.includes(role);
        sheet.push(`${allowed ? 'ALLOW' : 'DENY '} ${res.status} ${path} (${key})`);

        if (allowed) {
          // A grant may still answer 400/404 (needs a param, nothing seeded) —
          // all fine. What it must never do is refuse the role outright or crash.
          if (res.status === 401 || res.status === 403 || res.status >= 500) {
            wrong.push(`${path} (${key}): ${role} HOLDS this permission but got ${res.status}`);
          }
        } else if (res.status !== 403) {
          // The load-bearing assertion: a role with no claim to the route must
          // be turned away at the permission layer, not handed data.
          wrong.push(`${path} (${key}): ${role} must be DENIED 403 but got ${res.status}`);
        }
      }

      test.info().attachments.push({
        name: `${role}-permission-matrix.txt`,
        contentType: 'text/plain',
        body: Buffer.from(sheet.join('\n')),
      });
      expect(wrong, `${role} authorization mismatches:\n${wrong.join('\n')}`).toEqual([]);
    });
  }
});
