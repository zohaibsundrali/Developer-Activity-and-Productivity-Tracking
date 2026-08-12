import { test, expect } from '@playwright/test';
import { credentialsFor, skipUnless } from './fixtures/credentials.js';
import { login } from './fixtures/auth.js';
import { expectNav, gotoSection, openSection } from './fixtures/app.js';

/**
 * HR — people operations.
 *
 * HR reaches the admin console but only the people-facing half of it
 * (ADMIN_SECTION_ROLES in navConfig.js): employees, team stats, organization.
 * Billing, Clients, All Projects and Task Reviews are
 * owner/admin territory and must not appear.
 *
 * Onboarding here means the Add Employee dialog — which used to be its own
 * "Add Developer" sidebar screen and now opens from Employees — plus the
 * invitation flow; offboarding means the activate/deactivate control on the
 * employee card, which writes
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
      visible: ['Overview', 'Employees', 'Team Stats', 'Organization'],
      // Add Developer and View Developers are both Employees now.
      hidden: ['Add Developer', 'View Developers', 'Billing', 'Clients', 'All Projects', 'Task Reviews', 'Automation', 'System Health'],
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

    // …and under them, one tile per role present, which is the answer to
    // "how many developers do we have".
    await expect(page.getByRole('heading', { name: 'By role' })).toBeVisible();
  });

  test('onboarding: the Add Employee form collects name, email, role and a password', async ({ page }) => {
    test.skip(hr.portalName !== 'admin', 'The employee directory lives on the admin console.');

    await openSection(page, 'Employees', 'Employees');
    await page.getByRole('button', { name: 'Add employee' }).click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByPlaceholder('Enter their full name')).toBeVisible();
    await expect(page.getByPlaceholder('Enter their email address')).toBeVisible();
    await expect(page.getByPlaceholder('Set their password')).toBeVisible();

    // The role picker is the reason this form is no longer "Add Developer".
    // HR outranks developer, designer, QA, team lead and finance, so all five
    // are on offer; HR itself is not, because the provision route refuses a
    // role at or above the caller's own.
    const role = page.getByRole('combobox', { name: 'Role' });
    await expect(role).toBeVisible();
    await expect(role.getByRole('option', { name: 'Designer' })).toBeAttached();
    await expect(role.getByRole('option', { name: 'HR' })).toHaveCount(0);
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

    // Located by the button rather than by the table row it used to sit in:
    // the directory shows cards by default now, and a row-scoped locator
    // silently found nothing and SKIPPED, which reads in the report exactly
    // like an organisation with no employees seeded.
    const toggles = page.getByRole('button', { name: /^(Deactivate|Activate)$/ });
    const count = await toggles.count();
    test.skip(count === 0, 'No employees are seeded in this organisation — seed one to cover offboarding.');

    // `manage_employees` is what puts the toggle on the card; HR holds it.
    const toggle = toggles.first();
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
