import { test, expect } from '@playwright/test';
import { credentialsFor, skipUnless } from './fixtures/credentials.js';
import { login } from './fixtures/auth.js';

test('notification badge and mark-all-read agree across a reload', async ({ page }) => {
  const creds = credentialsFor('owner');
  skipUnless(creds);
  await login(page, creds);
  const user = await page.evaluate(() => JSON.parse(sessionStorage.getItem('adminUser')));
  let read = false;
  let patches = 0;
  await page.route('**/rest/v1/notification_inbox?*', async route => {
    const method = route.request().method();
    if (method === 'HEAD') return route.fulfill({ status: 200, headers: { 'content-range': `0-0/${read ? 0 : 1}`, 'access-control-expose-headers': 'Content-Range' }, body: '' });
    return route.fulfill({ json: [{
      id: '00000000-0000-0000-0000-000000000099', organization_id: user.organization_id,
      admin_id: user.id, admin_email: user.email, title: 'Audit notification fixture',
      message: 'This message is a local browser fixture.', category: 'general', type: 'general',
      created_at: new Date().toISOString(), read, read_at: read ? new Date().toISOString() : null,
    }] });
  });
  await page.route('**/rest/v1/rpc/mark_notification_inbox_read', async route => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({ p_category: null });
    patches += 1;
    read = true;
    return route.fulfill({ json: 1 });
  });
  await page.reload();
  const bell = page.getByRole('button', { name: 'Notifications, 1 unread', exact: true });
  await expect(bell).toBeVisible();
  await bell.click();
  await expect(page.getByRole('banner').getByText('Audit notification fixture', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mark all as read', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
  await expect.poll(() => patches).toBe(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notifications, 1 unread', exact: true })).toHaveCount(0);
});
