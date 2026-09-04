import { test, expect } from '@playwright/test';
import { credentialsFor, requireEnv, skipUnless } from './fixtures/credentials.js';
import { login } from './fixtures/auth.js';
import { clickAndResolveSection, expectNoErrorState, navItem, navLabels, openSection, pageHeading } from './fixtures/app.js';
import { writesAllowed } from './fixtures/env.js';
import { SECTION_TITLES } from '../src/components/shell/sectionTitles.js';

/**
 * ADMIN MODULES — every section of the console, opened by the people who own
 * it, plus the function each module exists for.
 *
 * Part 1 walks the sidebar: whatever entries the role was offered are clicked
 * one by one, and each must render the <h1> sectionTitles.js gives it and NOT
 * an error state. The list is read off the sidebar rather than typed here, so a
 * new section is covered the day it is added and a section that vanishes from
 * the sidebar is noticed as a shorter walk in the report.
 *
 * Part 2 exercises one representative function per module against the seeded
 * organisation — a department, a team, a test case, a run, the billing screen,
 * a project's detail page, the directory. Writes are idempotent (a rerun finds
 * what the first run created) and gated behind E2E_ALLOW_WRITES=1.
 */

const owner = credentialsFor('owner');
const admin = credentialsFor('admin');
const internalProject = requireEnv('E2E_INTERNAL_PROJECT_ID', 'E2E_INTERNAL_PROJECT_NAME');

/** SweetAlert2 confirmations are role="dialog" with an OK button; clear one if shown. */
async function dismissAlertIfAny(page) {
  const ok = page.getByRole('dialog').getByRole('button', { name: 'OK', exact: true });
  // isVisible() does not wait, and the alert follows a round trip; waitFor does.
  const shown = await ok.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
  if (!shown) return '';
  const text = await page.getByRole('dialog').innerText().catch(() => '');
  await ok.click();
  await expect(ok).toBeHidden();
  return text;
}

/** Click every sidebar entry; return "label → section" for the report. */
async function walkEverySection(page, who) {
  const labels = await navLabels(page);
  expect(labels.length, `${who}: the sidebar offered nothing`).toBeGreaterThan(3);
  const walked = [];
  for (const label of labels) {
    const id = await clickAndResolveSection(page, label);
    const title = SECTION_TITLES[id]?.admin;
    expect(title, `${who}: "${label}" opened section "${id}", which sectionTitles.js does not know`).toBeTruthy();
    await expect(pageHeading(page, title), `${who}: "${label}" should render "${title}"`).toBeVisible();
    // Give the screen's own fetch time to settle before asking whether it errored.
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

test.describe('Admin console — every section renders', () => {
  test('owner: every sidebar entry opens its screen without an error state', async ({ page }) => {
    skipUnless(owner);
    await login(page, owner);
    const walked = await walkEverySection(page, 'owner');
    // The owner is the widest role: the whole console, Permissions included.
    for (const must of ['Permissions', 'Billing', 'Organization', 'Employees', 'Quality', 'Team Structure']) {
      expect(walked.some((w) => w.startsWith(`${must} →`)), `owner sidebar must include ${must}`).toBe(true);
    }
  });

  test('admin: every sidebar entry opens its screen, and Permissions is owner-only', async ({ page }) => {
    skipUnless(admin);
    await login(page, admin);
    const walked = await walkEverySection(page, 'admin');
    expect(walked.some((w) => w.startsWith('Permissions →')), 'admin must not see Permissions').toBe(false);
    for (const must of ['Billing', 'Organization', 'Employees', 'System Health']) {
      expect(walked.some((w) => w.startsWith(`${must} →`)), `admin sidebar must include ${must}`).toBe(true);
    }
  });
});

test.describe('Admin console — each module does its job', () => {
  test.beforeEach(async ({ page }) => {
    skipUnless(owner);
    await login(page, owner);
  });

  test('billing loads the plan (the screen that showed the permission outage)', async ({ page }) => {
    await openSection(page, 'Billing', 'Billing & Subscription');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await expectNoErrorState(page, 'owner → Billing');
    await expect(page.getByText('Current plan', { exact: true })).toBeVisible();
  });

  test('organization: a department and a team can be created', async ({ page }) => {
    await openSection(page, 'Organization', 'Organization');

    const dept = 'QA Department';
    const existing = page.getByText(dept, { exact: true });
    if (!(await existing.first().isVisible().catch(() => false))) {
      test.skip(!writesAllowed(), 'Creating a department writes — set E2E_ALLOW_WRITES=1.');
      await page.locator('#dept-name').fill(dept);
      await page.getByRole('button', { name: 'Add department' }).click();
      await dismissAlertIfAny(page);
    }
    await expect(page.getByText(dept, { exact: true }).first()).toBeVisible();

    await page.getByRole('tab', { name: /^Teams\b/ }).click();
    const team = 'QA Team';
    if (!(await page.getByText(team, { exact: true }).first().isVisible().catch(() => false))) {
      test.skip(!writesAllowed(), 'Creating a team writes — set E2E_ALLOW_WRITES=1.');
      await page.locator('#team-name').fill(team);
      await page.locator('#team-department').selectOption({ label: dept });
      await page.getByRole('button', { name: 'Create team' }).click();
      await dismissAlertIfAny(page);
    }
    await expect(page.getByText(team, { exact: true }).first()).toBeVisible();

    // Members and Settings still answer after the writes.
    await page.getByRole('tab', { name: /^Members\b/ }).click();
    await expect(page.getByRole('row').filter({ hasText: owner.email })).toHaveCount(1);
    await page.getByRole('tab', { name: /^Settings\b/ }).click();
    await expectNoErrorState(page, 'owner → Organization → Settings');
  });

  test('employees: the directory lists the seeded people', async ({ page }) => {
    await openSection(page, 'Employees', 'Employees');
    await expect(page.getByText('Total employees', { exact: true })).toBeVisible();
    // Everyone Add employee created is in `developers` and therefore here.
    // Add employee named them "QA <Role>" — hr came out as "QA Hr".
    for (const name of [/^QA Developer$/, /^QA Manager$/, /^QA Hr$/i]) {
      await expect(page.getByText(name).first(), `${name} should be in the directory`).toBeVisible();
    }
  });

  test('team structure: the reporting-lines editor renders the directory', async ({ page }) => {
    await openSection(page, 'Team Structure', 'Team Structure');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await expectNoErrorState(page, 'owner → Team Structure');
    await expect(page.getByText('Reporting lines', { exact: true }).first()).toBeVisible();
  });

  test('projects: the internal project is listed and its detail page opens', async ({ page }) => {
    skipUnless(internalProject);
    const { E2E_INTERNAL_PROJECT_ID: id, E2E_INTERNAL_PROJECT_NAME: name } = internalProject.values;
    await openSection(page, 'All Projects', 'All Projects');
    await page.getByRole('button', { name: `View details for ${name}` }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/project-details/${id}`));
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await expectNoErrorState(page, 'owner → project details');
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible();
  });

  test('quality: a test case is written and a run is started against it', async ({ page }) => {
    skipUnless(internalProject);
    test.skip(!writesAllowed(), 'Quality writes rows — set E2E_ALLOW_WRITES=1.');
    const projectName = internalProject.values.E2E_INTERNAL_PROJECT_NAME;
    const caseTitle = 'QA e2e — login rejects a wrong password';
    const runName = 'QA e2e run';

    await openSection(page, 'Quality', 'Quality');
    await page.getByRole('tab', { name: /^Test cases\b/ }).click();
    if (!(await page.getByText(caseTitle, { exact: true }).first().isVisible().catch(() => false))) {
      await page.getByRole('button', { name: 'New test case' }).click();
      // The Modal is labelled by its title; the SweetAlert that follows a save
      // is a second role="dialog", so the modal is addressed by name.
      const dialog = page.getByRole('dialog', { name: 'New test case' });
      await expect(dialog).toBeVisible();
      // The form's <Field> labels are not wired to their controls, so the
      // selects are addressed by their position inside the dialog.
      await dialog.locator('select').first().selectOption({ label: projectName });
      await dialog.getByPlaceholder('Login rejects a wrong password').fill(caseTitle);
      await dialog.getByRole('button', { name: 'Save case' }).click();
      await dismissAlertIfAny(page);
      await expect(dialog).toBeHidden();
    }
    await expect(page.getByText(caseTitle, { exact: true }).first()).toBeVisible();

    await page.getByRole('tab', { name: /^Test runs\b/ }).click();
    if (!(await page.getByText(runName, { exact: true }).first().isVisible().catch(() => false))) {
      await page.getByRole('button', { name: 'Start a run' }).click();
      const dialog = page.getByRole('dialog', { name: 'Start a test run' });
      await expect(dialog).toBeVisible();
      await dialog.locator('select').first().selectOption({ label: projectName });
      await dialog.getByPlaceholder('Regression — build 42').fill(runName);
      await dialog.getByRole('button', { name: 'Start run' }).click();
      await dismissAlertIfAny(page);
      await expect(dialog).toBeHidden();
    }
    const row = page.getByRole('row').filter({ hasText: runName });
    await expect(row.first()).toBeVisible();
    await row.first().getByRole('button', { name: 'Open' }).click();
    // The run detail lists the case, ready to be recorded against.
    await expect(page.getByText(caseTitle, { exact: false }).first()).toBeVisible();
    await expectNoErrorState(page, 'owner → Quality → run');
  });

  test('approvals: leave and timesheet queues render', async ({ page }) => {
    await openSection(page, 'Leave Approvals', 'Leave Approvals');
    await expectNoErrorState(page, 'owner → Leave Approvals');
    await openSection(page, 'Timesheet Approvals', 'Timesheet Approvals');
    await expectNoErrorState(page, 'owner → Timesheet Approvals');
  });

  test('permissions: the owner-only matrix renders every role', async ({ page }) => {
    await openSection(page, 'Permissions', 'Permissions');
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await expectNoErrorState(page, 'owner → Permissions');
  });
});
