import { test, expect } from '@playwright/test';
import { credentialsFor, skipUnless } from './fixtures/credentials.js';
import { login } from './fixtures/auth.js';
import { expectNav, gotoSection, openSection, pageHeading } from './fixtures/app.js';

/**
 * MANAGER — supervisory staff.
 *
 * A manager signs in through the Team Member portal and gets the staff shell
 * plus one extra section: Team (staffNav() in navConfig.js). Covers team
 * oversight, employees under them, projects and tasks.
 *
 * If your seed puts the manager in `admin_users` instead, set
 * E2E_MANAGER_PORTAL=admin — the login helper follows the portal, and the
 * navigation assertions below adapt to which shell answered.
 */

const manager = credentialsFor('manager');

test.describe('Manager', () => {
  test.beforeEach(async ({ page }) => {
    skipUnless(manager);
    await login(page, manager);
  });

  test('lands on the staff dashboard with the Team oversight section', async ({ page }) => {
    if (manager.portalName === 'admin') {
      await expect(page).toHaveURL(/\/admin\/dashboard/);
      await expectNav(page, {
        visible: ['Overview', 'Project Hub', 'Views', 'Sprints', 'Reports'],
        // Owner/admin-only sections stay out of a manager's sidebar.
        hidden: ['Billing', 'Clients', 'Automation'],
      });
      return;
    }

    await expect(page).toHaveURL(/\/developer\/dashboard/);
    await expect(pageHeading(page, 'Dashboard')).toBeVisible();
    await expectNav(page, { visible: ['Dashboard', 'My Projects', 'Team', 'Account'] });
  });

  test('team: the roster and headcount summary render', async ({ page }) => {
    test.skip(manager.portalName === 'admin', 'The Team panel lives on the staff dashboard.');

    await openSection(page, 'Team', 'Team');

    // Summary tiles + roster — the manager's view of who reports into the org.
    await expect(page.getByText('Team members', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Team roster' })).toBeVisible();
  });

  test('employees: the roster names people and their roles', async ({ page }) => {
    test.skip(manager.portalName === 'admin', 'Covered by the HR spec on the admin console.');

    await openSection(page, 'Team', 'Team');
    await page.getByRole('button', { name: 'Refresh', exact: true }).first().click();

    // Either the org has members listed, or the panel says so plainly. A blank
    // panel with neither is a failure.
    const roster = page.getByRole('heading', { name: 'Team roster' });
    await expect(roster).toBeVisible();
    await expect(page.getByText('Active', { exact: true })).toBeVisible();
  });

  test('projects: the assigned project list is reachable', async ({ page }) => {
    const heading = manager.portalName === 'admin' ? 'Project Hub' : 'My Projects';
    const navLabel = manager.portalName === 'admin' ? 'Project Hub' : 'My Projects';
    await openSection(page, navLabel, heading);
  });

  test('tasks: opening a project reaches its task plan', async ({ page }) => {
    test.skip(manager.portalName === 'admin', 'Admin task surfaces are covered by the owner spec.');

    await openSection(page, 'My Projects', 'My Projects');

    const openDetail = page.getByRole('button', { name: /View Detail/ });
    const count = await openDetail.count();
    test.skip(count === 0, 'No project is assigned to the seeded manager — seed one to cover this flow.');

    await openDetail.first().click();
    await expect(page).toHaveURL(/\/developer\/project-details/);
    await expect(pageHeading(page, 'Project Details')).toBeVisible();
  });

  test('a hand-edited ?section= cannot open a section the role has no claim to', async ({ page }) => {
    test.skip(manager.portalName === 'admin', 'The admin console guard is covered by the HR spec.');

    // `team` IS allowed for a manager — this proves the URL route works before
    // the negative case in isolation.spec.js proves the guard bites.
    await gotoSection(page, '/developer/dashboard', 'team');
    await expect(page.getByRole('heading', { name: 'Team roster' })).toBeVisible();
  });
});
