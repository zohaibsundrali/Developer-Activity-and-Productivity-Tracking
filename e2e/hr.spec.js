import { test, expect } from '@playwright/test';
import { credentialsFor, skipUnless } from './fixtures/credentials.js';
import { login } from './fixtures/auth.js';
import { expectNav, gotoSection, openSection } from './fixtures/app.js';

/**
 * HR — people operations.
 *
 * HR reaches the admin console but only the people-facing half of it
 * (ADMIN_SECTION_ROLES in navConfig.js): employees, team stats, organization,
 * add/view developers. Billing, Clients, All Projects and Task Reviews are
 * owner/admin territory and must not appear.
 *
 * Onboarding here means "Add Developer" plus the invitation flow; offboarding
 * means the activate/deactivate control on the employee row, which writes
 * `memberships.status` — the field that actually revokes a session on next
 * login (orgContext.isMembershipActive). The spec asserts the control exists
 * and is enabled for HR; flipping it is destructive, so it only runs with
 * E2E_ALLOW_WRITES=1.
 */

const hr = credentialsFor('hr');

test.describe('HR', () => {
  test.beforeEach(async ({ page }) => {
    skipUnless(hr);
    await login(page, hr);
  });

  test('sees the people sections and nothing owner-only', async ({ page }) => {
    test.skip(hr.portalName !== 'admin', 'Seeded HR user is not on the admin console (E2E_HR_PORTAL).');

    await expect(page).toHaveURL(/\/admin\/dashboard/);
    await expectNav(page, {
      visible: ['Overview', 'Add Developer', 'View Developers', 'Employees', 'Team Stats', 'Organization'],
      hidden: ['Billing', 'Clients', 'All Projects', 'Task Reviews', 'Automation', 'System Health'],
    });
  });

  test('employees: the directory lists people with searchable filters', async ({ page }) => {
    test.skip(hr.portalName !== 'admin', 'Employee directory lives on the admin console.');

    await openSection(page, 'Employees', 'Employees');
    await expect(page.getByRole('heading', { name: 'Employees' })).toBeVisible();

    // Directory controls, by accessible name rather than class.
    await expect(page.getByPlaceholder('Search name, email, designation…')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Filter by role' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Filter by department' })).toBeVisible();

    // Headcount tiles are the summary HR reads first.
    await expect(page.getByText('Total employees', { exact: true })).toBeVisible();
  });

  test('onboarding: the Add Developer form collects name, email and a password', async ({ page }) => {
    test.skip(hr.portalName !== 'admin', 'Add Developer lives on the admin console.');

    await openSection(page, 'Add Developer', 'Add Developer');

    await expect(page.getByPlaceholder("Enter developer's full name")).toBeVisible();
    await expect(page.getByPlaceholder("Enter developer's email")).toBeVisible();
    await expect(page.getByPlaceholder('Set developer password')).toBeVisible();
  });

  test('onboarding: HR can invite a member with a role', async ({ page }) => {
    test.skip(hr.portalName !== 'admin', 'Organization management lives on the admin console.');

    await openSection(page, 'Organization', 'Organization');
    await page.getByRole('button', { name: 'Invitations', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Invite a member' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Send invitation/ })).toBeVisible();
  });

  test('offboarding: each employee row offers a deactivate control', async ({ page }) => {
    test.skip(hr.portalName !== 'admin', 'Employee directory lives on the admin console.');

    await openSection(page, 'Employees', 'Employees');

    const rows = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Edit', exact: true }) });
    const count = await rows.count();
    test.skip(count === 0, 'No employees are seeded in this organisation — seed one to cover offboarding.');

    // `manage_employees` is what puts the toggle on the row; HR holds it.
    const toggle = rows.first().getByRole('button', { name: /^(Deactivate|Activate)$/ });
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeEnabled();
  });

  test('profiles: an employee profile opens for editing', async ({ page }) => {
    test.skip(hr.portalName !== 'admin', 'Employee directory lives on the admin console.');

    await openSection(page, 'Employees', 'Employees');

    const edit = page.getByRole('button', { name: 'Edit', exact: true });
    const count = await edit.count();
    test.skip(count === 0, 'No employees are seeded in this organisation — seed one to cover profiles.');

    await edit.first().click();
    // The editor carries the HR fields: designation, contact, skills, bio.
    await expect(page.getByPlaceholder('e.g. Senior Engineer')).toBeVisible();
    await expect(page.getByPlaceholder('Type a skill and press Enter or comma')).toBeVisible();

    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByPlaceholder('e.g. Senior Engineer')).toHaveCount(0);
  });

  test('a hand-edited ?section=billing falls back instead of opening billing', async ({ page }) => {
    test.skip(hr.portalName !== 'admin', 'Admin section guard only applies on the admin console.');

    // canAccessAdminSection() must reject this and render Overview instead.
    // The topbar <h1> still echoes the requested section, so the proof is in
    // the CONTENT heading (<h2>) that each panel renders.
    await gotoSection(page, '/admin/dashboard', 'billing');
    await expect(page.getByRole('heading', { level: 2, name: 'Dashboard Overview' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Billing & Subscription' })).toHaveCount(0);
    await expect(page.getByText('Current plan', { exact: true })).toHaveCount(0);
  });
});
