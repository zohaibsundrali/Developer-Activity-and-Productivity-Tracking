import { test, expect } from '@playwright/test';
import { appendFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { requireEnv, credentialsFor } from './fixtures/credentials.js';
import { apiRequest, login } from './fixtures/auth.js';
import { openSection } from './fixtures/app.js';

/**
 * SEED the QA tenants — through the product's own screens, never the database.
 *
 * Runs only with E2E_SEED=1, because it creates people and projects. It expects
 * two freshly signed-up organizations whose owners are already in .env.e2e
 * (E2E_OWNER_* and E2E_ORG_B_OWNER_*), and it appends every account and id it
 * creates to that same file, so the role specs can run straight afterwards.
 *
 * Every step here IS a test of the screen it drives: Add employee, Create
 * client account, Send invitation, the /invite/<token> accept page, and Add
 * New Project. If one of those breaks, this is where it shows up first.
 *
 * Why the screens and not the API: the point of the exercise is to prove the
 * product works the way a person uses it. A seed that bypassed the forms would
 * prove nothing about the forms.
 */

const SEEDING = process.env.E2E_SEED === '1';
const ENV_FILE = path.resolve(process.cwd(), '.env.e2e');

/** Every role Add employee can create: user_type "developer", ranked below owner. */
const STAFF = ['manager', 'team_lead', 'hr', 'finance', 'qa', 'developer', 'designer', 'devops', 'employee'];

const label = (role) => role.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const emailFor = (role, org) => `verisade-qa-${role.replace(/_/g, '-')}-${org}@example.com`;
const prefixFor = (role) => `E2E_${role.toUpperCase()}`;
const newPassword = () => 'Qa!' + randomBytes(12).toString('base64url');
const isoDate = (daysFromNow) => new Date(Date.now() + daysFromNow * 864e5).toISOString().slice(0, 10);
const remember = (lines) => appendFileSync(ENV_FILE, lines.join('\n') + '\n');
/** What .env.e2e already holds, so a rerun after a partial failure skips what exists. */
const already = (key) => {
  try { return new RegExp(`^${key}=`, 'm').test(readFileSync(ENV_FILE, 'utf8')); } catch { return false; }
};

/**
 * showSuccess()/showError() open a modal of their own with an OK button, on top
 * of whatever form triggered them. Dismiss it if it appears, and hand back its
 * text so a refusal is reported as the sentence the product showed.
 */
async function dismissAlert(page) {
  const ok = page.getByRole('button', { name: 'OK', exact: true });
  try { await ok.waitFor({ state: 'visible', timeout: 45_000 }); } catch { return null; }
  const text = await ok.locator('xpath=ancestor::*[@role="dialog"][1]').textContent().catch(() => '');
  await ok.click();
  await expect(ok).toBeHidden();
  return (text || '').trim();
}

test.describe.configure({ mode: 'serial' });
test.skip(!SEEDING, 'Seeding runs only with E2E_SEED=1 — it creates people and projects.');

async function addEmployee(page, { name, email, role, password }) {
  await page.getByRole('button', { name: 'Add employee' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('Enter their full name').fill(name);
  await dialog.getByPlaceholder('Enter their email address').fill(email);
  await dialog.locator('#employee-role').selectOption(role);
  await dialog.getByPlaceholder('Set their password').fill(password);
  await dialog.getByRole('button', { name: 'Add employee' }).click();
  const said = await dismissAlert(page);
  expect(said, `Add employee for ${role}`).toMatch(/Added/);
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
}

async function addProject(page, { name, description, developerName }) {
  await openSection(page, 'All Projects', 'All Projects');
  await page.getByRole('button', { name: /Add New Project/ }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#project-name').fill(name);
  await dialog.locator('#project-deadline').fill(isoDate(30));
  await dialog.locator('#project-description').fill(description);
  const picker = dialog.locator('#project-developer');
  const value = await picker.locator('option').filter({ hasText: developerName }).first().getAttribute('value');
  expect(value, `${developerName} is offered as an assignee`).toBeTruthy();
  await picker.selectOption(value);
  await dialog.getByRole('button', { name: 'Add Project', exact: true }).click();
  await dismissAlert(page);
  await expect(dialog).toBeHidden({ timeout: 45_000 });
  // Newest first in the list, so `.first()` is the row this dialog just made
  // even when an earlier, interrupted run left a same-named project behind.
  await page.getByRole('button', { name: `View details for ${name}` }).first().click();
  await page.waitForURL(/\/admin\/project-details\//, { timeout: 45_000 });
  return page.url().split('/admin/project-details/')[1].split(/[?#]/)[0];
}

test.describe('Seed organisation A', () => {
  test('owner adds one person per staff role', async ({ page }) => {
    await login(page, credentialsFor('owner'));
    await openSection(page, 'Employees', 'Employees');
    for (const role of STAFF) {
      if (already(`${prefixFor(role)}_EMAIL`)) continue;
      const password = newPassword();
      const email = emailFor(role, 'a');
      await addEmployee(page, { name: `QA ${label(role)}`, email, role, password });
      remember([`${prefixFor(role)}_EMAIL=${email}`, `${prefixFor(role)}_PASSWORD=${password}`]);
    }
    const lines = [];
    // Created from this screen, everyone above lives in `developers` and signs
    // in on the Team Member tab. The roles that enter the admin area land on
    // the console from there — the `team-admin` portal in fixtures/credentials.js.
    for (const role of ['manager', 'team_lead', 'hr', 'finance', 'qa']) {
      lines.push(`${prefixFor(role)}_PORTAL=team-admin`);
    }
    remember(lines);
  });

  test('owner creates a client account', async ({ page }) => {
    test.skip(already('E2E_CLIENT_EMAIL'), 'client already seeded');
    await login(page, credentialsFor('owner'));
    await openSection(page, 'Clients', 'Clients');
    const password = newPassword();
    const email = emailFor('client', 'a');
    await page.getByPlaceholder('Ayesha Khan').fill('QA Client');
    await page.getByPlaceholder('ayesha@company.com').fill(email);
    await page.getByPlaceholder('Acme Ltd').fill('QA Client Co');
    await page.getByPlaceholder('Set an initial password').fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await dismissAlert(page);
    await expect(page.getByText('QA Client', { exact: true }).first()).toBeVisible({ timeout: 45_000 });
    remember([`E2E_CLIENT_EMAIL=${email}`, `E2E_CLIENT_PASSWORD=${password}`]);
  });

  test('owner invites an admin, and the invitation is accepted', async ({ page, browser }) => {
    test.skip(already('E2E_ADMIN_EMAIL'), 'admin already seeded');
    // The Invitations tab copies the live link to the clipboard. Capture what
    // it would have copied instead of granting a headless browser clipboard
    // rights it does not have.
    await page.addInitScript(() => {
      window.__copied = [];
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } },
      });
    });
    await login(page, credentialsFor('owner'));
    await openSection(page, 'Organization', 'Organization');
    await page.getByRole('tab', { name: /^Invitations\b/ }).click();
    const email = emailFor('admin', 'a');
    // The copy control's label carries the address, so it is the anchor for
    // "this invitation exists" — and a rerun after a partial failure copies
    // the pending invitation instead of sending a second one.
    const copy = page.getByRole('button', { name: `Copy invite link for ${email}` });
    // The list is fetched after the tab renders, so "not visible yet" and "not
    // there" look the same for a moment. Wait for it before deciding to send;
    // an `isVisible()` snapshot taken during that fetch sent a duplicate and
    // got "already has a pending invitation" back.
    const pending = await copy
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!pending) {
      await page.locator('#invite-email').fill(email);
      await page.locator('#invite-role').selectOption('admin');
      await page.getByRole('button', { name: /Send invitation/ }).click();
      const said = await dismissAlert(page);
      expect(said, 'Send invitation').toMatch(/Invitation sent|already has a pending invitation/);
    }
    await expect(copy).toBeVisible({ timeout: 45_000 });
    await copy.click();
    const link = await page.evaluate(() => window.__copied[0]);
    expect(link).toMatch(/\/invite\/[A-Za-z0-9._~-]+$/);

    // Accept in a fresh, signed-out context, exactly as the invitee would.
    const context = await browser.newContext();
    const invitee = await context.newPage();
    const password = newPassword();
    await invitee.goto(link);
    await invitee.locator('#invite-name').fill('QA Admin');
    await invitee.locator('#invite-password').fill(password);
    await invitee.locator('#invite-terms').check();
    await invitee.getByRole('button', { name: /Accept & create account/ }).click();
    await invitee.waitForURL((u) => u.pathname === '/login', { timeout: 45_000 });
    await context.close();
    remember([`E2E_ADMIN_EMAIL=${email}`, `E2E_ADMIN_PASSWORD=${password}`]);
  });

  test('owner creates the internal project, assigned to the QA developer', async ({ page }) => {
    test.skip(already('E2E_INTERNAL_PROJECT_ID'), 'internal project already seeded');
    await login(page, credentialsFor('owner'));
    const name = 'QA Internal Project A';
    const id = await addProject(page, {
      name,
      description: 'Seeded by e2e/seed.spec.js. Internal: no client is linked to it.',
      developerName: 'QA Developer',
    });
    remember([`E2E_INTERNAL_PROJECT_ID=${id}`, `E2E_INTERNAL_PROJECT_NAME=${name}`]);
  });
});

test.describe('Seed the client project', () => {
  test('leftover copies of the client project from interrupted runs are removed', async ({ page }) => {
    // Earlier runs of the step below failed between "created" and "linked",
    // and each rerun created the project again. Keep one; the link is by id.
    await login(page, credentialsFor('owner'));
    await openSection(page, 'All Projects', 'All Projects');
    const name = 'QA Client Project A';
    const list = page.getByRole('button', { name: /^View details for / }).first().or(page.getByText(/No projects/i));
    await expect(list).toBeVisible();
    const deletes = page.getByRole('button', { name: `Delete project ${name}` });
    let extra = (await deletes.count()) - 1;
    while (extra > 0) {
      await deletes.first().click();
      const modal = page.getByRole('dialog', { name: 'Delete Project' });
      await modal.getByRole('button', { name: 'Yes, Delete Project' }).click();
      await expect(modal).toBeHidden();
      await dismissAlert(page).catch(() => {});
      await expect(deletes).toHaveCount(extra);
      extra -= 1;
    }
    await expect(deletes).toHaveCount(await deletes.count() > 0 ? 1 : 0);
  });

  test('owner creates a project for the client and links it in the portal', async ({ page }) => {
    test.skip(already('E2E_CLIENT_PROJECT_ID'), 'client project already seeded');
    test.skip(!already('E2E_CLIENT_EMAIL'), 'seed the client first');
    await login(page, credentialsFor('owner'));
    const name = 'QA Client Project A';
    // Idempotent: a rerun after a partial failure finds the project by name.
    await openSection(page, 'All Projects', 'All Projects');
    // Wait for the list to answer before deciding whether the project exists:
    // an isVisible() taken during the fetch said "no" and created a duplicate.
    await expect(
      page.getByRole('button', { name: /^View details for / }).first().or(page.getByText(/No projects/i))
    ).toBeVisible();
    // `.first()`: a rerun after a failure between "created" and "linked" may
    // find the project twice; any copy serves, the link is by id.
    const existing = page.getByRole('button', { name: `View details for ${name}` }).first();
    let id;
    if (await existing.isVisible()) {
      await existing.click();
      await page.waitForURL(/\/admin\/project-details\//);
      id = page.url().split('/admin/project-details/')[1].split(/[?#]/)[0];
    } else {
      id = await addProject(page, {
        name,
        description: 'Seeded by e2e/seed.spec.js. Linked to QA Client so the portal has a project to show.',
        developerName: 'QA Developer',
      });
    }

    // Clients → Project links: the form that decides what a client can see.
    // addProject leaves us on the standalone project-details page (no
    // sidebar), so the section is opened by URL.
    await page.goto('/admin/dashboard?section=clients');
    await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible();
    await page.getByRole('tab', { name: /^Project links\b/ }).click();
    const linked = page.getByRole('button', { name: `Unlink QA Client from ${name}` });
    if (!(await linked.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false))) {
      await page.locator('#link-client').selectOption({ label: 'QA Client' });
      await page.locator('#link-project').selectOption({ label: name });
      await page.getByRole('button', { name: 'Add link' }).click();
      const said = await dismissAlert(page);
      expect(said, 'Add link').toMatch(/Linked/);
    }
    await expect(linked).toBeVisible();
    remember([`E2E_CLIENT_PROJECT_ID=${id}`, `E2E_CLIENT_PROJECT_NAME=${name}`]);
  });
});

test.describe('Seed the internal task', () => {
  test('the QA developer files a task plan on the internal project', async ({ page }) => {
    test.skip(already('E2E_INTERNAL_TASK_ID'), 'internal task already seeded');
    const project = requireEnv('E2E_INTERNAL_PROJECT_ID', 'E2E_INTERNAL_PROJECT_NAME');
    test.skip(!project.ok, project.reason);

    const projectId = project.values.E2E_INTERNAL_PROJECT_ID;
    const projectName = project.values.E2E_INTERNAL_PROJECT_NAME;

    await login(page, credentialsFor('developer'));
    await openSection(page, 'My Projects', 'My Projects');
    await page.getByRole('button', { name: `View details for ${projectName}` }).click();
    await expect(page).toHaveURL(/\/developer\/project-details/);

    // A project with no plan yet offers either "Add First Task" (empty) or a
    // template plan with "Add Next Task" after each row. Once the plan has been
    // saved the page says so and the buttons are gone; then there is nothing
    // to write and the id is simply read back.
    const submitted = page.getByText(/Tasks submitted successfully|Task Plan (Submitted|Approved)/);
    const first = page.getByRole('button', { name: /Add First Task/ });
    const next = page.getByRole('button', { name: /Add Next Task/ });
    await expect(first.or(next.first()).or(submitted.first())).toBeVisible({ timeout: 45_000 });
    const add = (await first.isVisible().catch(() => false)) ? first : next.last();
    if (!(await submitted.first().isVisible().catch(() => false))) {
      await add.click();
      const dialog = page.getByRole('dialog');
      await dialog.getByPlaceholder('Enter task title').fill('QA internal task — the client must never see this');
      await dialog
        .getByPlaceholder('Enter task description')
        .fill('Seeded by e2e/seed.spec.js. developer_tasks.client_visible defaults to false (migration 032).');
      // The footer button reads "Add task" until a title is typed, then
      // "Update task" (project-details page.jsx); either commits the row.
      await dialog.getByRole('button', { name: /^(Add|Update) task$/ }).click();
      await expect(dialog).toBeHidden();
      await page.getByRole('button', { name: /Save Task Plan|Resubmit Task Plan/ }).click();
      await page.getByRole('button', { name: 'Yes, submit tasks' }).click();
      await expect(submitted.first()).toBeVisible({ timeout: 45_000 });
    }

    // Read the id back through the app's own API, as this developer, with the
    // session the login created (cookie + bearer). /api/developer-gantt lists
    // developer_tasks for one project and one developer, scoped by the route
    // to the caller's organisation and, for a contributor, to themselves.
    const res = await apiRequest(page, `/api/developer-gantt?projectId=${projectId}`);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    const tasks = res.body?.tasks || [];
    expect(tasks.length, 'the saved plan must have produced at least one task').toBeGreaterThan(0);
    const task = tasks[0];
    expect(task.client_visible, 'an internal task must not be client_visible').toBe(false);
    remember([`E2E_INTERNAL_TASK_ID=${task.id}`]);
  });
});

test.describe('Seed organisation B', () => {
  test('owner B adds a developer and the project nobody in A may see', async ({ page }) => {
    test.skip(already('E2E_ORG_B_PROJECT_ID'), 'organisation B already seeded');
    await login(page, credentialsFor('orgBOwner'));
    await openSection(page, 'Employees', 'Employees');
    const password = newPassword();
    const email = emailFor('developer', 'b');
    await addEmployee(page, { name: 'QA Developer B', email, role: 'developer', password });
    const name = 'QA Org B Confidential Project';
    const id = await addProject(page, {
      name,
      description: 'Seeded by e2e/seed.spec.js. Belongs to organisation B only.',
      developerName: 'QA Developer B',
    });
    remember([
      `E2E_ORG_B_DEVELOPER_EMAIL=${email}`, `E2E_ORG_B_DEVELOPER_PASSWORD=${password}`,
      `E2E_ORG_B_PROJECT_ID=${id}`, `E2E_ORG_B_PROJECT_NAME=${name}`,
    ]);
  });
});
