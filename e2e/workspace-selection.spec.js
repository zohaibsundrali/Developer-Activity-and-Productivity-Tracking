import { test, expect } from '@playwright/test';
import { credentialsFor, skipUnless } from './fixtures/credentials.js';
import { apiRequest } from './fixtures/auth.js';
import { navLabels, clickAndResolveSection, pageHeading, expectNoErrorState } from './fixtures/app.js';
import { SECTION_TITLES } from '../src/components/shell/sectionTitles.js';

// Exercise the chooser itself, independently of the old project seed and of
// the previous organization stored in Auth metadata. No data writes.
for (const role of ['owner', 'orgBOwner']) {
  test(`${role}: can select an available workspace and load its authorized console`, async ({ page }) => {
    test.setTimeout(300_000);
    const credentials = credentialsFor(role);
    skipUnless(credentials);
    await page.goto('/login');
    await page.getByRole('button', { name: 'Owner / Platform Admin', exact: true }).click();
    await page.getByPlaceholder('you@example.com').fill(credentials.email);
    await page.getByPlaceholder('Enter your password').fill(credentials.password);
    await page.getByRole('button', { name: /^Sign in as/ }).click();
    await expect(page).toHaveURL(/\/organizations(?:\?|$)/);
    const workspace = page.getByRole('button', { name: /^Open .* workspace$/ }).first();
    await expect(workspace).toBeVisible();
    await workspace.click();
    await expect(page).toHaveURL(/\/admin\/dashboard/);
    const permissions = await apiRequest(page, '/api/me/permissions');
    expect(permissions.status).toBe(200);
    expect(permissions.body.permissions).toContain('organization.view');
    const sections = await navLabels(page);
    expect(sections.length).toBeGreaterThan(3);
    if (role === 'owner') {
      const walked = [];
      const failures = [];
      const serverErrors = [];
      page.on('response', response => {
        const url = new URL(response.url());
        if (url.pathname.startsWith('/api/') && response.status() >= 500) {
          serverErrors.push({ path: url.pathname, status: response.status() });
        }
      });
      for (const label of sections) {
        try {
          const section = await clickAndResolveSection(page, label);
          const title = SECTION_TITLES[section]?.admin;
          expect(title, `Unknown console section: ${section}`).toBeTruthy();
          await expect(pageHeading(page)).toBeVisible();
          expect((await pageHeading(page).innerText()).toLowerCase()).toBe(title.toLowerCase());
          await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
          await expectNoErrorState(page, `selected workspace: ${label}`);
          walked.push({ label, status: 'passed' });
        } catch (error) {
          failures.push({ label, error: error.message });
          walked.push({ label, status: 'failed' });
        }
      }
      await test.info().attach('workspace-sections.json', { body: JSON.stringify({ walked, failures, serverErrors }), contentType: 'application/json' });
      expect(failures, 'Every selected-workspace section must load').toEqual([]);
      expect(serverErrors, 'Console APIs must not fail with server errors').toEqual([]);
    }
  });
}
