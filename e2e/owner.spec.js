import { test, expect } from '@playwright/test';
import { credentialsFor, skipUnless } from './fixtures/credentials.js';
import { login, logout } from './fixtures/auth.js';
import { expectNav, navItem, openSection, pageHeading } from './fixtures/app.js';

/**
 * OWNER — the account that owns the tenant.
 *
 * Covers login, organisation administration, member/role management, projects
 * and reports. Every assertion is read-only: the suite runs against a shared
 * seeded organisation, so it proves the owner CAN reach each surface and that
 * the controls are there, without leaving rows behind.
 */

const owner = credentialsFor('owner');

test.describe('Owner', () => {
  test.beforeEach(async ({ page }) => {
    skipUnless(owner);
    await login(page, owner);
  });

  test('signs in and lands on the admin console with the owner navigation', async ({ page }) => {
    await expect(page).toHaveURL(/\/admin\/dashboard/);
    await expect(pageHeading(page, 'Dashboard Overview')).toBeVisible();

    // An owner sees every admin section (ADMIN_SECTION_ROLES in navConfig.js).
    await expectNav(page, {
      visible: [
        'Overview',
        'All Projects',
        'Task Reviews',
        'Reports',
        'Add Developer',
        'View Developers',
        'Employees',
        'Team Stats',
        'Organization',
        'Clients',
        'Billing',
        'System Health',
      ],
    });
  });

  test('organisation: departments, teams, members, invitations and settings', async ({ page }) => {
    await openSection(page, 'Organization', 'Organization');

    for (const tab of ['Departments', 'Teams', 'Members', 'Invitations', 'Settings']) {
      await expect(page.getByRole('button', { name: tab, exact: true })).toBeVisible();
    }

    // Departments is the default tab and offers the create form.
    await expect(page.getByRole('heading', { name: 'New department' })).toBeVisible();

    await page.getByRole('button', { name: 'Teams', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'New team' })).toBeVisible();
  });

  test('members: the roster lists the owner and ownership cannot be reassigned', async ({ page }) => {
    await openSection(page, 'Organization', 'Organization');
    await page.getByRole('button', { name: 'Members', exact: true }).click();

    for (const column of ['Member', 'Role', 'Team', 'Department', 'Type']) {
      await expect(page.getByRole('columnheader', { name: column, exact: true })).toBeVisible();
    }

    // The signed-in owner must appear in their own organisation's roster.
    const ownRow = page.getByRole('row').filter({ hasText: owner.email });
    await expect(ownRow).toHaveCount(1);

    // "owner" is not an assignable role — the owner's own role control is
    // disabled so ownership cannot be handed away from this dropdown.
    await expect(ownRow.getByRole('combobox').first()).toBeDisabled();
  });

  test('invitations: the invite form is available with role and team scoping', async ({ page }) => {
    await openSection(page, 'Organization', 'Organization');
    await page.getByRole('button', { name: 'Invitations', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Invite a member' })).toBeVisible();
    await expect(page.getByPlaceholder('teammate@company.com')).toBeVisible();
    await expect(page.getByRole('button', { name: /Send invitation/ })).toBeVisible();

    // Filling the form is safe; the test never submits it, so no invitation
    // email is sent and no row is written.
    await page.getByPlaceholder('teammate@company.com').fill('never-sent@example.invalid');
    await expect(page.getByPlaceholder('teammate@company.com')).toHaveValue('never-sent@example.invalid');
  });

  test('projects: the org project list and the add-project dialog', async ({ page }) => {
    await openSection(page, 'All Projects', 'All Projects');

    const addProject = page.getByRole('button', { name: /Add New Project/ });
    await expect(addProject).toBeVisible();

    // The control is disabled until the org has at least one developer to
    // assign work to — both states are legitimate for a seeded tenant.
    if (await addProject.isEnabled()) {
      await addProject.click();
      await expect(page.getByRole('heading', { name: 'Add New Project' })).toBeVisible();
      // Leave without creating anything.
      await page.keyboard.press('Escape');
    }
  });

  test('reports: every analytics tab renders its panel', async ({ page }) => {
    await openSection(page, 'Reports', 'Reports & Analytics');

    const tabs = [
      ['Overview', 'Activity trend'],
      ['Projects', 'Top projects by workload'],
      ['Team', 'Completed tasks per person'],
      ['Time', 'Time tracking'],
      ['Delays', 'Deadline delays'],
    ];

    for (const [tab, panelHeading] of tabs) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      await expect(page.getByRole('heading', { name: panelHeading })).toBeVisible();
    }
  });

  test('task reviews, clients, billing and system health are reachable', async ({ page }) => {
    await openSection(page, 'Task Reviews', 'Task Reviews');
    await openSection(page, 'Clients', 'Clients');
    await openSection(page, 'Billing', 'Billing & Subscription');
    await openSection(page, 'System Health', 'System Health');
  });

  test('logging out returns to the login screen and locks the console', async ({ page }) => {
    await logout(page);
    await expect(page).toHaveURL(/\/login/);

    // The signed cookie is gone, so the console is closed again.
    await page.goto('/admin/dashboard');
    await expect(page).toHaveURL(/\/login/);
    await expect(navItem(page, 'Organization')).toHaveCount(0);
  });
});
