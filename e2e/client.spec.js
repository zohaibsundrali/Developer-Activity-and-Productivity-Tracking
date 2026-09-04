import { test, expect } from '@playwright/test';
import { credentialsFor, skipUnless } from './fixtures/credentials.js';
import { login } from './fixtures/auth.js';
import { expectBouncedToLogin, expectNav, openSection, pageHeading } from './fixtures/app.js';
import { writesAllowed } from './fixtures/env.js';

/**
 * CLIENT — an external customer in the client portal.
 *
 * Covers the portal shell, the projects they are linked to, invoices and the
 * two messaging channels (per-project Conversation and Support threads).
 * What a client must NOT see is the subject of isolation.spec.js.
 */

const client = credentialsFor('client');

/** Open the first linked project, or skip when the seed has none. */
async function openFirstProject(page) {
  await openSection(page, 'My Projects', 'My Projects');

  // Wait for the list to answer — cards or the empty state — before deciding;
  // a count taken during the fetch read "no empty state" as "has projects".
  const empty = page.getByText('No projects linked yet', { exact: true });
  await expect(page.getByRole('heading', { level: 3 }).first().or(empty)).toBeVisible();
  if (await empty.count()) {
    test.skip(true, 'No project is linked to the seeded client — link one to cover the project flows.');
  }

  // The whole project card is a button; its heading is the clickable target.
  await page.getByRole('heading', { level: 3 }).first().click();
  await expect(page).toHaveURL(/projectId=/);
}

test.describe('Client', () => {
  test.beforeEach(async ({ page }) => {
    skipUnless(client);
    await login(page, client);
  });

  test('lands in the client portal with the customer-facing navigation', async ({ page }) => {
    await expect(page).toHaveURL(/\/client/);
    // The overview greets the person by name rather than repeating "Overview".
    await expect(pageHeading(page, /^Welcome back/)).toBeVisible();

    await expectNav(page, {
      visible: [
        'Overview',
        'My Projects',
        'Announcements',
        'Approvals',
        'Invoices',
        'Support',
        'Account',
      ],
      // Internal surfaces have no place in the portal sidebar.
      hidden: ['Employees', 'Organization', 'Billing', 'Task Reviews', 'Team'],
    });
  });

  test('projects: linked projects are listed, or the portal says there are none', async ({ page }) => {
    await openSection(page, 'My Projects', 'My Projects');

    const cards = page.getByRole('heading', { level: 3 });
    // EmptyState renders its title as text, not as a heading.
    const empty = page.getByText('No projects linked yet', { exact: true });
    await expect(cards.first().or(empty)).toBeVisible();
  });

  test('projects: a project opens with its client-facing tabs', async ({ page }) => {
    await openFirstProject(page);

    for (const tab of ['Milestones', 'Tasks', 'Deliverables', 'Conversation']) {
      await expect(page.getByRole('tab', { name: tab, exact: true })).toBeVisible();
    }

    await page.getByRole('tab', { name: 'Tasks', exact: true }).click();
    // Only client_visible tasks reach this list (migration 032) — the isolation
    // spec proves an internal task cannot be pulled in by id.
  });

  test('invoices: billing history renders', async ({ page }) => {
    await openSection(page, 'Invoices', 'Invoices');

    const table = page.getByRole('columnheader', { name: 'Number', exact: true });
    const empty = page.getByText('No invoices yet', { exact: true });
    await expect(table.or(empty)).toBeVisible();
  });

  test('messaging: a support request can be composed', async ({ page }) => {
    await openSection(page, 'Support', 'Support');

    await page.getByRole('button', { name: 'New request', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'New support request' })).toBeVisible();
    await expect(page.getByPlaceholder('Brief summary')).toBeVisible();
    await expect(page.getByPlaceholder('Describe your request…')).toBeVisible();

    test.skip(!writesAllowed(), 'Sending a support request writes a thread — set E2E_ALLOW_WRITES=1 to run it.');

    await page.getByPlaceholder('Brief summary').fill(`E2E smoke ${Date.now()}`);
    await page.getByPlaceholder('Describe your request…').fill('Automated end-to-end check. Please ignore.');
    await page.getByRole('button', { name: /Send|Submit|Create/ }).first().click();
  });

  test('messaging: the per-project conversation is available', async ({ page }) => {
    await openFirstProject(page);

    await page.getByRole('tab', { name: 'Conversation', exact: true }).click();
    await expect(page.getByPlaceholder('Write a message to your team…')).toBeVisible();
  });

  test('account: the portal shows the signed-in client', async ({ page }) => {
    await openSection(page, 'Account', 'Account');
    await expect(page.getByText(client.email).first()).toBeVisible();
  });

  test('the internal dashboards are closed to a client', async ({ page }) => {
    await expectBouncedToLogin(page, '/admin/dashboard');
    await expectBouncedToLogin(page, '/developer/dashboard');
  });
});
