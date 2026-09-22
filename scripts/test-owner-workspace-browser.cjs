// Local navigation cookie and mocked APIs only; no live account or database writes.
const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');

(async () => {
  const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter(line => line.includes('=')).map(line => {
    const at = line.indexOf('=');
    return [line.slice(0, at), line.slice(at + 1).trim().replace(/^["']|["']$/g, '')];
  }));
  const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:3187';
  const orgA = '11111111-1111-4111-8111-111111111111', orgB = '33333333-3333-4333-8333-333333333333';
  const profileA = '22222222-2222-4222-8222-222222222222', profileB = '44444444-4444-4444-8444-444444444444';
  const authId = '55555555-5555-4555-8555-555555555555';
  let selected = orgA, clients = 7, signalsReads = 0, selection = null, failSelection = false;
  const names = { [orgA]: 'Northstar Studio', [orgB]: 'Harbor Labs' };
  const organizations = [orgA, orgB].map(id => ({ id, name: names[id], role: 'owner', userType: 'admin', profileId: id === orgA ? profileA : profileB }));
  const appMetadata = () => ({ organization_id: selected, app_user_id: selected === orgA ? profileA : profileB, user_type: 'admin', role: 'owner' });
  const authUser = () => ({ id: authId, email: 'owner@example.test', aud: 'authenticated', app_metadata: appMetadata(), user_metadata: {} });
  const session = () => ({
    access_token: `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: authId, app_metadata: appMetadata(), exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.mock`,
    refresh_token: 'mock', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer', user: authUser(),
  });
  const cookie = () => {
    const payload = Buffer.from(JSON.stringify({ t: 'admin', r: 'owner', o: selected, e: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
    return `${payload}.${crypto.createHmac('sha256', env.SESSION_COOKIE_SECRET || env.SUPABASE_SERVICE_ROLE_KEY).update(payload).digest('base64url')}`;
  };
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(90000);
    page.setDefaultNavigationTimeout(90000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // Public signup and anonymous dashboard gate.
    await page.goto(`${base}/register`);
    assert.equal(new URL(page.url()).pathname, '/register');
    await page.goto(`${base}/admin/registration`);
    await expect(page).toHaveURL(/\/register$/);
    await page.goto(`${base}/organization/dashboard`);
    await expect(page).toHaveURL(/\/login\?redirect=/);

    const user = { id: profileA, auth_user_id: authId, full_name: 'Alex Owner', email: 'owner@example.test', role: 'admin', membership_role: 'owner', organization_id: orgA, organization_name: names[orgA], loginTime: new Date().toISOString(), lastActivity: new Date().toISOString() };
    const authKey = `sb-${new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
    await page.context().addCookies([{ name: 'dt_session', value: cookie(), url: base, httpOnly: true }]);
    await page.addInitScript(({ user, authKey, session }) => {
      if (!sessionStorage.getItem('owner-browser-test-initialized')) {
        sessionStorage.setItem('adminUser', JSON.stringify(user));
        sessionStorage.setItem(authKey, JSON.stringify(session));
        sessionStorage.setItem('owner-browser-test-initialized', '1');
      }
    }, { user, authKey, session: session() });

    await page.route('**/auth/v1/**', route => route.fulfill({ json: route.request().url().includes('/token') ? session() : authUser() }));
    const permissions = [...fs.readFileSync('src/utils/permissionCatalogue.js', 'utf8').matchAll(/key:\s*["']([^"']+)["']/g)].map(match => match[1]);
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      let json = { success: true, data: [] };
      if (path === '/api/organizations') json = { organizations, currentOrganizationId: selected, ownerAccount: true };
      if (path === '/api/organizations/select') {
        selection = route.request().postDataJSON();
        if (failSelection) return route.fulfill({ status: 503, json: { error: 'Workspace temporarily unavailable' } });
        selected = selection.organizationId;
        json = { context: appMetadata() };
      }
      if (path === '/api/me/permissions') json = { success: true, permissions };
      if (path === '/api/billing/access') json = { locked: false, onTrial: false };
      if (path === '/api/signals') { signalsReads++; json = { signals: [], counts: {}, degraded: false }; }
      return route.fulfill({ json, ...(path === '/api/auth/session' && route.request().method() === 'POST' ? { headers: { 'set-cookie': `dt_session=${cookie()}; Path=/; HttpOnly; SameSite=Lax` } } : {}) });
    });
    await page.route('**/rest/v1/**', route => {
      const url = new URL(route.request().url());
      const table = url.pathname.split('/').pop();
      const profileId = selected === orgA ? profileA : profileB;
      const profile = { id: profileId, auth_user_id: authId, organization_id: selected, full_name: 'Alex Owner', email: 'owner@example.test' };
      let rows = [];
      if (table === 'admin_users') rows = [profile];
      if (table === 'memberships') rows = [{ user_id: profileId, user_type: 'admin', organization_id: selected, role: 'owner', status: 'active' }];
      if (table === 'organizations') rows = [{ id: selected, name: names[selected], timezone: 'UTC' }];
      if (route.request().method() === 'HEAD') {
        const counts = { clients: selected === orgA ? clients : 2, change_requests: 4, leave_requests: 3, task_submissions: 5 };
        return route.fulfill({ status: 200, headers: { 'content-range': `*/${counts[table] || 0}`, 'access-control-expose-headers': 'content-range' }, body: '' });
      }
      const single = route.request().headers().accept?.includes('vnd.pgrst.object');
      return route.fulfill({ json: single ? rows[0] || null : rows });
    });

    await page.goto(`${base}/organization/dashboard`);
    const switcher = page.getByRole('combobox', { name: 'Active organization' });
    await expect(switcher).toHaveValue(orgA);
    const card = label => page.locator('main a').filter({ has: page.getByText(label, { exact: true }) }).first();
    for (const label of ['Clients', 'Change requests', 'Leave requests', 'Total organizations', 'Awaiting review', 'Open bugs']) await expect(card(label)).toBeVisible();
    await expect(card('Clients')).toContainText('7');
    await expect(card('Total organizations')).toContainText('2');
    assert.equal(await page.locator('main a').filter({ has: page.locator('[aria-busy]') }).count(), 0);

    const previousSignalsReads = signalsReads;
    clients = 11;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(card('Clients')).toContainText('11');
    await expect(page.getByText(/Last updated at/)).toBeVisible();
    assert(signalsReads > previousSignalsReads, 'Refresh must update attention signals too');

    fs.mkdirSync('test-results/owner-workspace', { recursive: true });
    for (const [width, theme] of [[1440, 'light'], [1440, 'dark'], [390, 'light']]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal overflow at ${width}`);
      await expect(switcher).toBeVisible();
      await page.screenshot({ path: `test-results/owner-workspace/${width}-${theme}.png`, animations: 'disabled' });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await switcher.selectOption(orgB);
    await expect(switcher).toHaveValue(orgB);
    await expect(card('Clients')).toContainText('2');
    assert.deepEqual(selection, { organizationId: orgB, profileId: profileB, userType: 'admin' });
    assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('adminUser')).organization_id), orgB);
    assert.equal(new URL(page.url()).pathname, '/organization/dashboard');

    await page.goto(`${base}/admin/dashboard?section=overview`);
    await expect(page).toHaveURL(/\/organization\/dashboard\?section=overview$/);
    await expect(switcher).toHaveValue(orgB);
    failSelection = true;
    await switcher.selectOption(orgA);
    await expect(page.getByRole('alert').filter({ hasText: 'Workspace temporarily unavailable' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Choose an organization' })).toBeVisible();
    await expect(page.getByText('Total organizations', { exact: true })).toHaveCount(0);
    assert.deepEqual(errors, []);
    console.log('PASS public/legacy routes, protected dashboard, owner KPIs, refresh, responsive themes, verified organization switch and safe failure recovery');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
