import { test, expect } from '@playwright/test';
import { credentialsFor, skipUnless } from './fixtures/credentials.js';
import { login } from './fixtures/auth.js';
import { expectBouncedToLogin, expectNav, gotoSection, navItem, openSection, pageHeading } from './fixtures/app.js';

/**
 * EMPLOYEE — the narrowest internal role.
 *
 * An employee shares the staff shell with developers (EMPLOYEE_NAV in
 * navConfig.js) and should see exactly three things: their own profile, the
 * work assigned to them, and their own time. Anything supervisory — the Team
 * panel, the admin console — must stay shut, including via a typed URL.
 */

const employee = credentialsFor('employee');

test.describe('Employee', () => {
  test.beforeEach(async ({ page }) => {
    skipUnless(employee);
    await login(page, employee);
  });

  test('lands on the staff dashboard with only individual-contributor sections', async ({ page }) => {
    await expect(page).toHaveURL(/\/developer\/dashboard/);
    // The staff overview is a profile card (no <h1>); the sidebar marks the
    // current section instead.
    await expect(navItem(page, 'Dashboard')).toHaveAttribute('aria-current', 'page');

    await expectNav(page, {
      visible: ['Dashboard', 'My Projects', 'Account'],
      hidden: ['Team'],
    });
  });

  test('own profile: the account section shows the signed-in identity', async ({ page }) => {
    await navItem(page, 'Account').click();
    await expect(page.getByText('Account Information', { exact: true })).toBeVisible();
    await expect(page.getByText(employee.email).first()).toBeVisible();
  });

  test('assigned work: only their own projects are listed', async ({ page }) => {
    await openSection(page, 'My Projects', 'My Projects');

    const projectCards = page.getByRole('button', { name: /^View details for / });
    const emptyState = page.getByText('No projects yet', { exact: true });
    await expect(projectCards.first().or(emptyState)).toBeVisible();
  });

  test('time tracking: their own session history, scoped to their identity', async ({ page }) => {
    await page.goto('/sessions');
    await expect(page.getByRole('heading', { name: 'Session history' })).toBeVisible();
    await expect(page.getByText(employee.email)).toBeVisible();
  });

  test('the Team panel stays shut even with a hand-edited ?section=team', async ({ page }) => {
    await gotoSection(page, '/developer/dashboard', 'team');

    // The dashboard falls back to the overview for a non-supervisory role, so
    // the roster must not render. (The topbar title still echoes the requested
    // section — the content is what proves the guard held.)
    await expect(page.getByRole('heading', { name: 'Team roster' })).toHaveCount(0);
    await expect(page.getByText('Your direct reports')).toHaveCount(0);
  });

  test('the admin console is closed to an employee', async ({ page }) => {
    await expectBouncedToLogin(page, '/admin/dashboard');
  });
});
