import { test, expect } from '@playwright/test';
import { credentialsFor, requireEnv, skipUnless } from './fixtures/credentials.js';
import { apiRequest, login } from './fixtures/auth.js';

/**
 * API PROBE — every role, every readable route, never a server error.
 *
 * The UI specs prove a screen renders. This one proves the layer under it
 * answers: each route is called with the signed-in role's own token and the
 * only thing asserted is the STATUS CLASS. 200, 400, 403 and 404 are all fine
 * answers to a probe — "not yours", "not found", "say which project" — but a
 * 5xx is a defect no matter who asked.
 *
 * It exists because of a real one. From migration 069 (which gave
 * user_permissions a second foreign key to memberships) until the fix in
 * src/utils/permissionOverrides.js, EVERY route behind requirePermission
 * answered 503 "Permissions are temporarily unavailable" for EVERY role: the
 * PostgREST embed was ambiguous, the override loader threw, and the layer
 * failed closed. Nothing in the unit suite could see it — the client was
 * mocked — and the UI showed it as "Couldn't load billing". This spec asks the
 * question directly, for every role, so it cannot come back unnoticed.
 */

// The GET routes that take no path parameter. Ones that need an id are added
// below when the seed provides one.
const ROUTES = [
  '/api/me/permissions',
  '/api/billing/access',
  '/api/billing/plans',
  '/api/billing/subscription',
  '/api/admin/permissions',
  '/api/admin/health',
  '/api/admin-review',
  '/api/assets',
  '/api/attendance',
  '/api/capacity',
  '/api/change-requests',
  '/api/contracts',
  '/api/developer-gantt',
  '/api/invitations',
  '/api/invoicing',
  '/api/keyboard-stats',
  '/api/leave',
  '/api/performance',
  '/api/productivity',
  '/api/proposals',
  '/api/quality',
  '/api/recruitment',
  '/api/search?q=qa&limit=5',
  '/api/signals',
  '/api/task-submission',
  '/api/timesheets',
  '/api/client/announcements',
  '/api/client/approvals',
  '/api/client/invoices',
  '/api/client/projects',
  '/api/client/support',
];

const ROLES = [
  'owner', 'admin', 'manager', 'team_lead', 'hr', 'finance', 'qa',
  'developer', 'designer', 'devops', 'employee', 'client',
];

// Roles the catalogue puts on `billing.view` (BILLING in permissionCatalogue.js).
// For them the billing screen is not optional, so its route must answer 200 —
// the exact call that was 503 for two dozen migrations.
const BILLING_ROLES = ['owner', 'admin', 'finance'];

const internalProject = requireEnv('E2E_INTERNAL_PROJECT_ID');

test.describe('API probe', () => {
  for (const role of ROLES) {
    test(`${role}: no readable route answers with a server error`, async ({ page }) => {
      const creds = credentialsFor(role);
      skipUnless(creds);
      await login(page, creds);

      const routes = [...ROUTES];
      if (internalProject.ok) {
        const id = internalProject.values.E2E_INTERNAL_PROJECT_ID;
        routes.push(`/api/projects/${id}/members`, `/api/projects/${id}/closure`, `/api/client/projects/${id}`);
      }

      const failures = [];
      const answers = [];
      for (const path of routes) {
        const res = await apiRequest(page, path);
        answers.push(`${res.status} ${path}`);
        if (res.status >= 500) {
          failures.push(`${path} → ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
        }
      }
      // The full answer sheet travels with the report so a reviewer can read
      // which routes refused this role, not only that none crashed.
      test.info().attachments.push({
        name: `${role}-api-answers.txt`,
        contentType: 'text/plain',
        body: Buffer.from(answers.join('\n')),
      });
      expect(failures, `${role}: routes answering 5xx`).toEqual([]);

      // The permission layer itself. A 503 here is the outage this spec was
      // written for; a 401/403 would mean the session never carried a token.
      const me = await apiRequest(page, '/api/me/permissions');
      expect(me.status, `${role}: /api/me/permissions must answer, got ${JSON.stringify(me.body).slice(0, 200)}`).toBe(200);

      if (BILLING_ROLES.includes(role)) {
        const billing = await apiRequest(page, '/api/billing/subscription');
        expect(billing.status, `${role}: billing must load — ${JSON.stringify(billing.body).slice(0, 200)}`).toBe(200);
      }
    });
  }
});
