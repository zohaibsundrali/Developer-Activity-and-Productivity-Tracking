import { test, expect } from '@playwright/test';
import { credentialsFor, skipUnless } from './fixtures/credentials.js';
import { login } from './fixtures/auth.js';

// No database writes: intercept only the display permission payload, then
// verify the browser honours it on a full reload and a direct section URL.
test('a per-user deny survives a dashboard reload and direct navigation', async ({ page }) => {
  const creds = credentialsFor('owner');
  skipUnless(creds);
  await login(page, creds);
  await page.route('**/api/me/permissions', async route => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, permissions: body.permissions.filter(k => k !== 'billing.view') } });
  });
  await page.goto('/admin/dashboard?section=billing');
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Billing', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Billing & Subscription', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Billing & Subscription', exact: true })).toHaveCount(0);
});

test('unreadable permissions do not render privileged controls', async ({ page }) => {
  const creds = credentialsFor('owner');
  skipUnless(creds);
  await login(page, creds);
  await page.route('**/api/me/permissions', route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }));
  await page.reload();
  await expect(page.getByRole('alert').filter({ hasText: 'could not load your permissions' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Sections' })).toHaveCount(0);
  await page.unroute('**/api/me/permissions');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
});
