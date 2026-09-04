import { test, expect } from '@playwright/test';
import { credentialsFor, skipUnless } from './fixtures/credentials.js';
import { login } from './fixtures/auth.js';
import { expectNav, navItem, openSection, pageHeading } from './fixtures/app.js';
import { writesAllowed } from './fixtures/env.js';

/**
 * DEVELOPER — an individual contributor doing the work.
 *
 * Covers the assigned-work surface: the dashboard, the project task plan, the
 * submit-for-review flow, the per-task start/complete lifecycle (the app's
 * timer), the notes channel on a submission and the admin feedback that comes
 * back on a reviewed task.
 *
 * Where a step would write to the database (submitting a plan, completing a
 * task) the spec asserts the control's presence and enabled/disabled state, and
 * only clicks through when E2E_ALLOW_WRITES=1.
 */

const developer = credentialsFor('developer');

/** Open the first assigned project's detail page, or skip if none is seeded. */
async function openFirstProject(page) {
  await openSection(page, 'My Projects', 'My Projects');

  const openDetail = page.getByRole('button', { name: /^View details for / });
  const count = await openDetail.count();
  test.skip(
    count === 0,
    'No project is assigned to the seeded developer — assign one so the task flows can be exercised.'
  );

  await openDetail.first().click();
  await expect(page).toHaveURL(/\/developer\/project-details/);
  await expect(pageHeading(page, 'Project Details')).toBeVisible();
}

test.describe('Developer', () => {
  test.beforeEach(async ({ page }) => {
    skipUnless(developer);
    await login(page, developer);
  });

  test('lands on the staff dashboard with the individual-contributor navigation', async ({ page }) => {
    await expect(page).toHaveURL(/\/developer\/dashboard/);
    // The staff overview is a profile card (no <h1>); the sidebar marks the
    // current section instead.
    await expect(navItem(page, 'Dashboard')).toHaveAttribute('aria-current', 'page');

    await expectNav(page, {
      visible: ['Dashboard', 'My Projects', 'Account'],
      // Supervisory oversight is not an IC's to see.
      hidden: ['Team'],
    });
  });

  test('assigned work: the dashboard summarises the projects assigned to them', async ({ page }) => {
    await expect(page.getByText(/^Total projects$/i)).toBeVisible();

    await openSection(page, 'My Projects', 'My Projects');
    // Either projects are listed, or the empty state says so — a silent blank
    // panel means the fetch failed.
    const projectCards = page.getByRole('button', { name: /^View details for / });
    const emptyState = page.getByText('No projects yet', { exact: true });
    await expect(projectCards.first().or(emptyState)).toBeVisible();
  });

  test('tasks: the project task plan renders with its schedule', async ({ page }) => {
    await openFirstProject(page);

    // The plan is the developer's task list; the page shows the scheduled count.
    await expect(page.getByText('Tasks scheduled', { exact: true })).toBeVisible();
  });

  test('submission: the task plan can be submitted for review', async ({ page }) => {
    await openFirstProject(page);

    const submit = page.getByRole('button', { name: /Save Task Plan|Resubmit Task Plan|Login Required/ });
    const alreadySubmitted = page.getByText(/Task Plan (Submitted|Approved)/);

    // Exactly one of the two states must be true: either the plan is still
    // editable and offers submission, or it is already in review/approved.
    await expect(submit.or(alreadySubmitted).first()).toBeVisible();

    if (await submit.count()) {
      // "Login Required" would mean the developer profile never resolved.
      await expect(submit).not.toHaveText(/Login Required/);
    }

    test.skip(!writesAllowed(), 'Submitting a plan writes to the database — set E2E_ALLOW_WRITES=1 to run it.');

    if (await submit.count()) {
      await submit.click();
      // A SweetAlert "Confirm Submission" stands between the button and the
      // write; a validation failure shows inline instead and no dialog opens.
      const confirm = page.getByRole('button', { name: 'Yes, submit tasks' });
      const asked = await confirm.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false);
      expect(asked, 'the plan must validate — no "Confirm Submission" dialog means a row was refused').toBe(true);
      await confirm.click();
      // page.jsx: setValidationSuccess('Tasks submitted successfully! …')
      // Several banners say it at once (inline toast, status card, log line).
      await expect(page.getByText(/Tasks submitted successfully|Work submitted|Task Plan (Submitted|Approved)/i).first()).toBeVisible();
    }
  });

  test('timer: an approved task exposes start and complete controls', async ({ page }) => {
    await openFirstProject(page);

    const start = page.getByRole('button', { name: /Start Task/ });
    const complete = page.getByRole('button', { name: /Mark as Completed/ });
    const locked = page.getByRole('button', { name: /Locked/ });
    const notYetSaved = page.getByText('Save task plan first to begin working');
    const awaitingApproval = page.getByText('Task plan awaiting admin approval');

    // The lifecycle control is always present in one of its five states; which
    // one depends on where the seeded plan sits in the review workflow. A plan
    // that has been submitted and not yet reviewed shows the awaiting banner
    // and no per-task control at all.
    await expect(start.or(complete).or(locked).or(notYetSaved).or(awaitingApproval).first()).toBeVisible();

    if (await complete.count()) {
      test.skip(!writesAllowed(), 'Completing a task writes to the database — set E2E_ALLOW_WRITES=1.');
      await complete.first().click();
      // The completion modal is where the developer attaches proof and notes.
      await expect(page.getByRole('heading', { name: 'Submit Task for Review' })).toBeVisible();
      await expect(page.getByPlaceholder('Add any notes about your work...')).toBeVisible();
      await page.keyboard.press('Escape');
    }
  });

  test('comments: review feedback from the admin is shown on the task', async ({ page }) => {
    await openFirstProject(page);

    // Authoring threaded comments lives in the PM drawer, which is an
    // owner/admin/manager surface. What a developer gets is the review comment
    // that comes back on a rejected or completed task — assert it renders when
    // the seed has one.
    const feedback = page.getByText('Admin comments:');
    const count = await feedback.count();
    test.skip(count === 0, 'No reviewed task with admin feedback in the seed — review one to cover this.');
    await expect(feedback.first()).toBeVisible();
  });

  test('time tracking: the developer can read their own session history', async ({ page }) => {
    await page.goto('/sessions');
    await expect(page.getByRole('heading', { name: 'Session history' })).toBeVisible();
    // The page is scoped to the signed-in identity, not a queryable user id.
    await expect(page.getByText(developer.email)).toBeVisible();
  });

  test('account: the developer can open their own profile', async ({ page }) => {
    // The staff Account screen is a card, not a PageHeader, so no <h1>.
    await navItem(page, 'Account').click();
    await expect(page.getByText('Account Information', { exact: true })).toBeVisible();
    await expect(page.getByText(developer.email).first()).toBeVisible();
  });
});
