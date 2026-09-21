import { test, expect } from '@playwright/test';
import { credentialsFor, skipUnless } from './fixtures/credentials.js';
import { login } from './fixtures/auth.js';
import { openSection, waitForSectionReady, expectNoErrorState } from './fixtures/app.js';
import { writesAllowed } from './fixtures/env.js';
import live from '../scripts/qa/live-context.cjs';
const { api, session, svc } = live;
const cleanup = [];
const overrides = [];
test.setTimeout(120_000);
test.afterEach(async () => {
  for (const membershipId of overrides.splice(0)) {
    const response = await api('owner', 'POST', '/api/admin/permissions', { membershipId, permissionKey: 'review.view_all', allowed: null });
    expect(response.status).toBe(200);
  }
  for (const item of cleanup.splice(0).reverse()) {
    const result = await svc.from(item.table).delete().eq('id', item.id).eq('organization_id', item.org);
    expect(result.error, 'remove only this test record').toBeNull();
  }
});
async function start(page, role, section) {
  const creds = credentialsFor(role); skipUnless(creds);
  await login(page, creds); await openSection(page, section, section); await waitForSectionReady(page);
}
async function remember(table, id) { cleanup.push({ table, id, org: (await session('owner')).org }); }

test('manager contract reader is not offered contract mutations', async ({ page }) => {
  await start(page, 'manager', 'Contracts');
  await expectNoErrorState(page, 'manager contracts');
  await expect(page.getByRole('button', { name: 'New contract', exact: true })).toHaveCount(0);
});

test('finance can manage a contract but cannot amend signed terms', async ({ page }) => {
  test.skip(!writesAllowed(), 'QA-only contract creation requires E2E_ALLOW_WRITES=1');
  const name = `deepqa-ui-${Date.now()}`;
  const created = await api('owner', 'POST', '/api/contracts', { reference: name, title: name, value: 100 });
  if (created.body.contract?.id) await remember('contracts', created.body.contract.id);
  expect(created.status).toBe(200);
  const signed = await api('owner', 'PATCH', '/api/contracts', { contractId: created.body.contract.id, status: 'signed' });
  expect(signed.status).toBe(200);
  await start(page, 'finance', 'Contracts');
  await page.getByRole('row').filter({ hasText: name }).getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
  await expect(page.getByRole('button', { name: 'Complete', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Amend', exact: true })).toHaveCount(0);
});

test('owner creates equipment through the form and sees persisted data after reload', async ({ page }) => {
  test.skip(!writesAllowed(), 'QA-only equipment creation requires E2E_ALLOW_WRITES=1');
  const name = `deepqa-ui-${Date.now()}`;
  await start(page, 'owner', 'Assets');
  await page.getByRole('button', { name: 'Add equipment', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add equipment', exact: true });
  await dialog.getByLabel('Asset tag', { exact: true }).fill(name);
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByLabel('Purchase cost', { exact: true }).fill('123.45');
  const response = page.waitForResponse(r => r.url().endsWith('/api/assets?action=asset') && r.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  const res = await response, body = await res.json();
  if (body.asset?.id) await remember('assets', body.asset.id);
  expect(res.status()).toBe(200);
  const stored = await svc.from('assets').select('name,purchase_cost').eq('id', body.asset.id).single();
  expect(stored.error).toBeNull(); expect(Number(stored.data.purchase_cost)).toBe(123.45);
  await page.reload(); await waitForSectionReady(page);
  await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();
});

test('manager can read recruitment without administrative write controls', async ({ page }) => {
  await start(page, 'manager', 'Recruitment');
  await expect.soft(page.getByRole('button', { name: 'New opening', exact: true })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Performance', exact: true })).toHaveCount(0);
});

test('HR review-sharing override is enforced by both UI and API', async ({ page }) => {
  test.skip(!writesAllowed(), 'Requires a temporary override on the synthetic HR account');
  const hr = await session('hr'), staff = await session('developer'), name = `deepqa-review-${Date.now()}`;
  const membership = await svc.from('memberships').select('id').eq('organization_id', hr.org).eq('user_id', hr.id).eq('user_type', hr.type).single();
  expect(membership.error).toBeNull();
  const prior = await svc.from('user_permissions').select('id').eq('membership_id', membership.data.id).eq('permission_key', 'review.view_all');
  expect(prior.error).toBeNull(); expect(prior.data).toHaveLength(0);
  const cycle = await api('hr', 'POST', '/api/performance?action=cycle', { name, periodStart: '2026-09-01', periodEnd: '2026-09-30', status: 'open' });
  if (cycle.body.cycle?.id) await remember('review_cycles', cycle.body.cycle.id);
  expect(cycle.status).toBe(200);
  const review = await api('hr', 'POST', '/api/performance?action=review', { cycleId: cycle.body.cycle.id, subjectUserId: staff.id, rating: 4, strengths: name });
  if (review.body.review?.id) await remember('performance_reviews', review.body.review.id);
  expect(review.status).toBe(200);
  expect((await api('hr', 'PATCH', '/api/performance', { reviewId: review.body.review.id, action: 'submit' })).status).toBe(200);
  overrides.push(membership.data.id);
  expect((await api('owner', 'POST', '/api/admin/permissions', { membershipId: membership.data.id, permissionKey: 'review.view_all', allowed: false, note: name })).status).toBe(200);
  expect((await api('hr', 'PATCH', '/api/performance', { reviewId: review.body.review.id, action: 'share' })).status).toBe(403);
  await start(page, 'hr', 'Performance');
  await page.getByRole('row').filter({ hasText: name }).getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await waitForSectionReady(page);
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toHaveCount(0);
});
