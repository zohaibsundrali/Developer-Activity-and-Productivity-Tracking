import { test, expect } from '@playwright/test';
import { credentialsFor, requireEnv, skipUnless } from './fixtures/credentials.js';
import { apiRequest, login } from './fixtures/auth.js';
import { expectBouncedToLogin, expectTextAbsent } from './fixtures/app.js';

/**
 * ISOLATION — the spec that matters most.
 *
 * Every other spec checks that a role CAN do its job. This one checks the
 * opposite, which is the thing that ends up on the front page when it breaks:
 *
 *   1. Cross-organisation — a signed-in user of org A must not be able to reach
 *      org B's data by typing its id into a URL, or by finding it in search.
 *   2. Client vs internal — a client must not reach an internal task, the
 *      employee directory, or any internal dashboard.
 *
 * Two design rules make these tests worth trusting:
 *
 *   - Every negative has a POSITIVE CONTROL. "Org A cannot see project X" is
 *     worthless if X does not exist; the control test signs in as org B's owner
 *     and proves X is real and visible to its rightful owner first.
 *   - Both layers are probed. The UI hides things for many reasons; the API and
 *     RLS are what actually enforce the boundary, so the API is asked directly
 *     with the caller's own token.
 */

const ownerA = credentialsFor('owner');
const ownerB = credentialsFor('orgBOwner');
const developerA = credentialsFor('developer');
const clientA = credentialsFor('client');

// A project that belongs to organisation B and to nobody in organisation A.
const orgBProject = requireEnv('E2E_ORG_B_PROJECT_ID', 'E2E_ORG_B_PROJECT_NAME');

// An organisation A project the client is NOT linked to, and an internal task
// on it (client_visible = false).
const internalProject = requireEnv('E2E_INTERNAL_PROJECT_ID', 'E2E_INTERNAL_PROJECT_NAME');
const internalTask = requireEnv('E2E_INTERNAL_TASK_ID');

test.describe('Cross-organisation isolation', () => {
  test('control: organisation B\'s own owner CAN open organisation B\'s project', async ({ page }) => {
    skipUnless(ownerB, orgBProject);

    await login(page, ownerB);
    await page.goto(`/admin/project-details/${orgBProject.values.E2E_ORG_B_PROJECT_ID}`);

    // Without this control the negative tests below could pass simply because
    // the id is stale — proving nothing at all.
    await expect(
      page.getByText(orgBProject.values.E2E_ORG_B_PROJECT_NAME, { exact: false }).first()
    ).toBeVisible();
  });

  test('organisation A\'s owner cannot open organisation B\'s project by URL', async ({ page }) => {
    skipUnless(ownerA, orgBProject);

    await login(page, ownerA);
    await page.goto(`/admin/project-details/${orgBProject.values.E2E_ORG_B_PROJECT_ID}`);

    // RLS returns no row, so `.single()` fails and the page shows its error
    // state rather than another tenant's project.
    await expect(page.getByRole('alert').filter({ hasText: "Couldn't load this project" })).toBeVisible();
    await expectTextAbsent(
      page,
      orgBProject.values.E2E_ORG_B_PROJECT_NAME,
      'Org A owner opening an org B project detail'
    );
  });

  test('organisation A\'s owner gets nothing from organisation B\'s gantt chart URL', async ({ page }) => {
    skipUnless(ownerA, orgBProject);

    await login(page, ownerA);
    await page.goto(`/admin/gantt-chart/${orgBProject.values.E2E_ORG_B_PROJECT_ID}`);
    await page.waitForLoadState('networkidle');

    await expectTextAbsent(
      page,
      orgBProject.values.E2E_ORG_B_PROJECT_NAME,
      'Org A owner opening an org B gantt chart'
    );
  });

  test('organisation A staff cannot open organisation B\'s project', async ({ page }) => {
    skipUnless(developerA, orgBProject);

    await login(page, developerA);

    // The staff detail screen takes the project by query string.
    await page.goto(`/developer/project-details?id=${orgBProject.values.E2E_ORG_B_PROJECT_ID}`);
    await page.waitForLoadState('networkidle');

    await expectTextAbsent(
      page,
      orgBProject.values.E2E_ORG_B_PROJECT_NAME,
      'Org A developer opening an org B project'
    );
  });

  test('search never returns another organisation\'s project', async ({ page }) => {
    skipUnless(ownerA, orgBProject);

    await login(page, ownerA);

    const term = orgBProject.values.E2E_ORG_B_PROJECT_NAME;
    const res = await apiRequest(page, `/api/search?q=${encodeURIComponent(term)}&limit=20`);

    expect(res.status, 'search must answer the signed-in owner').toBeLessThan(500);

    // The route echoes the query string back (`"query": "…"`), so the whole
    // body always contains the term; only the RESULTS may not.
    const results = res.body?.results || res.body || {};
    const serialized = JSON.stringify(results).toLowerCase();
    expect(
      serialized.includes(term.toLowerCase()),
      `search as org A returned org B's project "${term}": ${serialized.slice(0, 300)}`
    ).toBe(false);
    expect(res.body?.totals?.project ?? 0, 'no project may match another tenant\'s name').toBe(0);
  });
});

test.describe('Client versus internal isolation', () => {
  test('a client is bounced from every internal dashboard', async ({ page }) => {
    skipUnless(clientA);

    await login(page, clientA);

    // The middleware matches on user_type, so an authenticated client is still
    // not an admin or a developer.
    await expectBouncedToLogin(page, '/admin/dashboard');
    await expectBouncedToLogin(page, '/developer/dashboard');
    await expectBouncedToLogin(page, '/admin/dashboard?section=employees');
  });

  test('a client cannot reach the employee directory', async ({ page }) => {
    skipUnless(clientA);

    await login(page, clientA);
    await page.goto('/admin/dashboard?section=employees');

    // Bounced, and nothing from the directory rendered on the way out.
    await expect(page).toHaveURL(/\/login(\?|$)/);
    await expect(page.getByRole('heading', { name: 'Employees' })).toHaveCount(0);
    await expect(page.getByPlaceholder('Search name, email, designation…')).toHaveCount(0);
  });

  test('a client cannot read an internal task through the API', async ({ page }) => {
    skipUnless(clientA, internalTask);

    await login(page, clientA);
    const res = await apiRequest(page, `/api/client/tasks/${internalTask.values.E2E_INTERNAL_TASK_ID}`);

    // The route answers 404 for "no such task", "internal task" and "someone
    // else's task" alike — telling them apart is what a probe is looking for.
    expect(
      [401, 403, 404],
      `internal task must not be readable by a client (got ${res.status})`
    ).toContain(res.status);
    expect(res.ok).toBe(false);
  });

  test('a client cannot read a project they are not linked to', async ({ page }) => {
    skipUnless(clientA, internalProject);

    await login(page, clientA);
    const res = await apiRequest(
      page,
      `/api/client/projects/${internalProject.values.E2E_INTERNAL_PROJECT_ID}`
    );

    expect(
      [401, 403, 404],
      `an unlinked project must not be readable by a client (got ${res.status})`
    ).toContain(res.status);

    const serialized = JSON.stringify(res.body || '').toLowerCase();
    expect(
      serialized.includes(internalProject.values.E2E_INTERNAL_PROJECT_NAME.toLowerCase()),
      'the refusal body leaked the project name'
    ).toBe(false);
  });

  test('the portal renders nothing for an internal project id in the URL', async ({ page }) => {
    skipUnless(clientA, internalProject);

    await login(page, clientA);
    await page.goto(
      `/client?section=projects&projectId=${internalProject.values.E2E_INTERNAL_PROJECT_ID}`
    );
    await page.waitForLoadState('networkidle');

    await expectTextAbsent(
      page,
      internalProject.values.E2E_INTERNAL_PROJECT_NAME,
      'Client opening an unlinked project by id'
    );
  });

  test('client search cannot reach the employee directory', async ({ page }) => {
    skipUnless(clientA);

    await login(page, clientA);
    const res = await apiRequest(page, '/api/search?q=a&limit=20');

    expect(res.status, 'search must answer the signed-in client').toBeLessThan(500);

    // CLIENT_TYPES in the search route excludes employees, teams and clients;
    // that list is the guard for the tables whose policies are still org-wide.
    const results = res.body?.results || {};
    for (const forbidden of ['employee', 'team', 'client']) {
      expect(
        results[forbidden] || [],
        `client search returned "${forbidden}" results`
      ).toHaveLength(0);
    }
  });

  test('internal staff cannot enter the client portal', async ({ page }) => {
    skipUnless(developerA);

    await login(page, developerA);
    await expectBouncedToLogin(page, '/client');
  });
});
