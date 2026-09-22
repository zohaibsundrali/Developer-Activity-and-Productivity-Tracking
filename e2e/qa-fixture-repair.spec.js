import { test, expect } from '@playwright/test';
import { credentialsFor, requireEnv, skipUnless } from './fixtures/credentials.js';
import { login } from './fixtures/auth.js';
import { writesAllowed } from './fixtures/env.js';

test('restore the synthetic QA client project link through the owner UI', async ({ page }) => {
  test.skip(!writesAllowed(), 'QA fixture repair requires E2E_ALLOW_WRITES=1.');
  const owner = credentialsFor('owner');
  const client = credentialsFor('client');
  const project = requireEnv('E2E_CLIENT_PROJECT_ID', 'E2E_CLIENT_PROJECT_NAME');
  skipUnless(owner, client, project);
  expect(client.email).toMatch(/^verisade-qa-.*@example\.com$/);
  expect(project.values.E2E_CLIENT_PROJECT_NAME).toBe('QA Client Project A');
  await login(page, owner);
  await page.goto('/organization/dashboard?section=clients');
  await page.getByRole('tab', { name: /^Project links\b/ }).click();
  const linked = page.getByRole('button', { name: 'Unlink QA Client from QA Client Project A', exact: true });
  await expect(page.locator('#link-client')).toBeVisible();
  if (await linked.count()) return;
  await page.locator('#link-client').selectOption({ label: 'QA Client' });
  await page.locator('#link-project').selectOption(project.values.E2E_CLIENT_PROJECT_ID);
  await expect(page.locator('#link-project option:checked')).toHaveText('QA Client Project A');
  await page.getByRole('button', { name: 'Add link', exact: true }).click();
  await expect(linked).toBeVisible();
});
