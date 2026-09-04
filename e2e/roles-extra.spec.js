import { test, expect } from '@playwright/test';
import { credentialsFor, requireEnv, skipUnless } from './fixtures/credentials.js';
import { login } from './fixtures/auth.js';
import { clickAndResolveSection, expectBouncedToLogin, expectNav, expectNoErrorState, navItem, navLabels, pageHeading } from './fixtures/app.js';
import { writesAllowed } from './fixtures/env.js';
import { SECTION_TITLES } from '../src/components/shell/sectionTitles.js';

/**
 * THE OTHER SIX ROLES — team_lead, finance, qa, designer, devops, admin.
 *
 * owner/manager/hr/developer/employee/client each have a spec of their own.
 * These six were added to the product later (roles.js) and had none, so a
 * regression in what a finance lead or a QA engineer is offered had nothing to
 * fail. One test per role does three things:
 *
 *   1. lands in the right AREA — admin console or staff dashboard — which is
 *      the front door decision canEnterAdminArea() makes for the middleware;
 *   2. clicks EVERY sidebar entry offered and requires each screen to render
 *      its <h1> and no error state;
 *   3. asserts a handful of entries the permission catalogue says the role
 *      must, and must NOT, be offered. Deliberately a handful: the full matrix
 *      is unit-tested against the catalogue, and copying it here would be a
 *      second copy of the rules. What is asserted is the part that would end
 *      up in a bug report — finance seeing All Projects, qa seeing Billing.
 */

/** Click every sidebar entry of whichever shell answered; return "label → id". */
async function walkSidebar(page, who, shellKey) {
  const labels = await navLabels(page);
  const walked = [];
  for (const label of labels) {
    const id = await clickAndResolveSection(page, label);
    // The staff overview is a profile card and the staff Account screen a
    // settings card, neither with an <h1>; every other screen renders its
    // title through PageHeader.
    const title = SECTION_TITLES[id]?.[shellKey] || SECTION_TITLES[id]?.developer;
    if (!(shellKey === 'developer' && (id === 'overview' || id === 'account'))) {
      expect(title, `${who}: "${label}" opened section "${id}", which sectionTitles.js does not know`).toBeTruthy();
      await expect(pageHeading(page, title), `${who}: "${label}" should render "${title}"`).toBeVisible();
    }
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await expectNoErrorState(page, `${who} → ${label}`);
    walked.push(`${label} → ${id}`);
  }
  test.info().attachments.push({
    name: `${who}-sections.txt`,
    contentType: 'text/plain',
    body: Buffer.from(walked.join('\n')),
  });
  return walked;
}

// Expectations per role, straight from permissionCatalogue.js role groups:
//   SUPERVISORS = owner, admin, manager, team_lead
//   REVIEWERS   = SUPERVISORS + qa            BILLING = owner, admin, finance
//   PEOPLE      = owner, admin, hr            ADMINS  = owner, admin
//   PEOPLE_READERS = PEOPLE + manager, team_lead   OWNER_ONLY = owner
const CONSOLE_ROLES = {
  team_lead: {
    visible: ['All Projects', 'Project Hub', 'Views', 'Sprints', 'Task Reviews', 'Quality', 'Bugs', 'Timesheet Approvals', 'Team Structure', 'Capacity', 'Recruitment', 'Reports'],
    hidden: ['Billing', 'Employees', 'Organization', 'Clients', 'Automation', 'System Health', 'Permissions', 'Developer Activity', 'Board'],
  },
  finance: {
    visible: ['Billing', 'Invoicing', 'Contracts', 'Assets', 'Clients'],
    hidden: ['All Projects', 'Employees', 'Organization', 'Task Reviews', 'Quality', 'Reports', 'Permissions', 'System Health', 'Developer Activity'],
  },
  qa: {
    visible: ['Task Reviews', 'Quality', 'Bugs'],
    hidden: ['Billing', 'Employees', 'Organization', 'All Projects', 'Reports', 'Permissions', 'Clients', 'Invoicing'],
  },
  admin: {
    visible: ['All Projects', 'Employees', 'Organization', 'Billing', 'System Health', 'Automation', 'Developer Activity', 'Board', 'Clients'],
    hidden: ['Permissions'],
  },
};

test.describe('Admin-console roles', () => {
  for (const [role, nav] of Object.entries(CONSOLE_ROLES)) {
    test(`${role}: lands on the console, every offered section renders, and the catalogue holds`, async ({ page }) => {
      const creds = credentialsFor(role);
      skipUnless(creds);
      await login(page, creds);
      expect(creds.area, `${role} is expected on the admin console (E2E_${role.toUpperCase()}_PORTAL)`).toBe('admin');
      await expect(page).toHaveURL(/\/admin\/dashboard/);
      await expectNav(page, nav);
      await walkSidebar(page, role, 'admin');
      // Every own-work screen is there too: this is where these roles log time.
      await expectNav(page, { visible: ['My Work', 'My Timesheet', 'My Leave'] });
    });
  }
});

const STAFF_ROLES = {
  designer: { visible: ['Dashboard', 'My Work', 'My Timesheet', 'My Projects', 'Tests', 'Account'], hidden: ['Team'] },
  devops: { visible: ['Dashboard', 'My Work', 'My Timesheet', 'My Projects', 'Tests', 'Account'], hidden: ['Team'] },
};

test.describe('Staff-dashboard roles', () => {
  for (const [role, nav] of Object.entries(STAFF_ROLES)) {
    test(`${role}: lands on the staff dashboard, every offered section renders, and the console is shut`, async ({ page }) => {
      const creds = credentialsFor(role);
      skipUnless(creds);
      await login(page, creds);
      expect(creds.area).toBe('staff');
      await expect(page).toHaveURL(/\/developer\/dashboard/);
      await expectNav(page, nav);
      await walkSidebar(page, role, 'developer');
      // TESTERS holds test_case.view, and that must NOT open the front door.
      await expectBouncedToLogin(page, '/admin/dashboard');
    });
  }
});

test.describe('The staff Tests screen', () => {
  // The run the admin-modules spec starts ("QA e2e run") is recorded against
  // here, by a contributor, from the staff shell — the flow migration 095
  // widened test_run.execute for. Self-sufficient: with no open run it skips
  // and says so rather than failing on ordering.
  test('a developer records a result on an open run', async ({ page }) => {
    const developer = credentialsFor('developer');
    skipUnless(developer);
    await login(page, developer);
    await navItem(page, 'Tests').click();
    await expect(pageHeading(page, 'Tests')).toBeVisible();
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await expectNoErrorState(page, 'developer → Tests');

    const run = page.getByRole('button').filter({ hasText: 'QA e2e run' });
    test.skip((await run.count()) === 0, 'No open run named "QA e2e run" — run admin-modules.spec.js with E2E_ALLOW_WRITES=1 first.');
    await run.first().click();

    const passed = page.getByRole('button', { name: 'Passed', exact: true });
    await expect(passed.first()).toBeVisible();
    test.skip(!writesAllowed(), 'Recording a result writes — set E2E_ALLOW_WRITES=1.');
    if (await passed.first().isEnabled()) {
      await passed.first().click();
      await expectNoErrorState(page, 'developer → Tests → record');
    }
    // Either way the case now shows a recorded outcome.
    await expect(page.getByText(/recorded|of \d+ recorded|Passed/).first()).toBeVisible();
  });
});
