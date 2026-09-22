const { chromium, expect: baseExpect } = require('@playwright/test');
const expect = baseExpect.configure({ timeout: 60000 });
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { session, svc } = require('./live-context.cjs');
if (process.env.E2E_ALLOW_WRITES !== '1') throw Error('E2E_ALLOW_WRITES=1 required');
const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:3193';
const name = `qa-owner-browser-${Date.now()}`;
let browser, project, task;
const results = [];
const ok = result => { assert.equal(result.error, null, JSON.stringify(result.error)); return result.data; };
const pass = name => { results.push(name); console.log('PASS', name); };
(async () => {
  const owner = await session('owner'), dev = await session('developer');
  const start = new Date().toISOString().slice(0, 10), end = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  project = ok(await owner.client.from('projects').insert({ organization_id: owner.org, name: `${name}-project`, created_by: owner.id,
    created_by_type: owner.type, added_by: owner.id, added_by_type: owner.type, status: 'active', deadline: end }).select().single());
  task = ok(await owner.client.from('developer_tasks').insert({ organization_id: owner.org, project_id: project.id,
    task_title: name, status: 'pending', start_date: start, end_date: end, assignee_admin_id: owner.id }).select().single());
  browser = await chromium.launch({ args: ['--no-sandbox'] });
  async function pageFor(member) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const auth = (await member.client.auth.getSession()).data.session;
    const profile = ok(await svc.from(member.type === 'admin' ? 'admin_users' : 'developers').select('*').eq('id', member.id).single());
    const user = { ...profile, membership_role: member.role, role: member.type, organization_id: member.org,
      loginTime: new Date().toISOString(), lastActivity: new Date().toISOString() };
    const payload = Buffer.from(JSON.stringify({ t: member.type, r: member.role, o: member.org, e: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
    const cookie = `${payload}.${crypto.createHmac('sha256', process.env.SESSION_COOKIE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY).update(payload).digest('base64url')}`;
    await context.addCookies([{ name: 'dt_session', value: cookie, url: base, httpOnly: true }]);
    const key = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
    await context.addInitScript(({ auth, user, key, type }) => {
      if (!sessionStorage.getItem('qa-my-work-initialized')) {
        sessionStorage.setItem(key, JSON.stringify(auth));
        sessionStorage.setItem(type === 'admin' ? 'adminUser' : 'developerUser', JSON.stringify(user));
        sessionStorage.setItem('qa-my-work-initialized', 'yes');
      }
    }, { auth, user, key, type: member.type });
    const page = await context.newPage();
    page.on('pageerror', error => console.error('Browser error:', error.message));
    page.on('requestfailed', request => { if (request.failure()?.errorText !== 'net::ERR_ABORTED') console.error('Request failed:', new URL(request.url()).pathname, request.failure()?.errorText); });
    page.on('response', response => { if (response.status() >= 400) console.error('HTTP', response.status(), new URL(response.url()).pathname); });
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(120000);
    await page.goto(`${base}/${member.type === 'admin' ? 'organization' : 'developer'}/dashboard?section=my-work`);
    return page;
  }
  const page = await pageFor(owner);
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  pass('Owner My Work renders persisted self-assignment after browser reload');
  const taskRow = page.locator('li').filter({ has: page.getByText(name, { exact: true }) });
  await taskRow.getByRole('button', { name: 'View task', exact: true }).click();
  const assignee = page.locator(`#task-assignee-${task.id}`);
  await expect(assignee).toHaveValue(`admin:${owner.id}`);
  await expect(assignee.locator(`option[value="admin:${owner.id}"]`)).toHaveCount(1);
  await expect(assignee.locator(`option[value="developer:${dev.id}"]`)).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Submit work for review', exact: true })).toBeVisible();
  await assignee.selectOption(`developer:${dev.id}`);
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  pass('Typed assignee dropdown delegates to Developer and removes Owner personal row');
  const devPage = await pageFor(dev);
  await expect(devPage.getByText(name, { exact: true })).toBeVisible();
  await devPage.reload();
  await expect(devPage.getByText(name, { exact: true })).toBeVisible();
  pass('Developer My Work shows delegated task after reload');
  ok(await owner.client.from('developer_tasks').update({ developer_id: null, assignee_admin_id: owner.id }).eq('id', task.id));
  await page.getByRole('button', { name: /Refresh/ }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await devPage.getByRole('button', { name: /Refresh/ }).click();
  await expect(devPage.getByText(name, { exact: true })).toHaveCount(0);
  pass('Refresh reflects reassignment in both personal lists');
  // Deliberately return the same {error} shape as a rejected database timer write.
  const timerRoute = '**/rest/v1/task_time_logs*';
  await page.route(timerRoute, route => route.request().method() === 'POST'
    ? route.fulfill({ status: 403, json: { code: '42501', message: 'QA timer start denied' } }) : route.continue());
  await taskRow.getByRole('button', { name: /Start timing/i }).click();
  await expect(page.getByText('QA timer start denied', { exact: true })).toBeVisible();
  await expect(page.getByText(`Timing "${name}"`, { exact: true })).toHaveCount(0);
  await page.unroute(timerRoute);
  pass('Timer start errors are displayed without a false success message');
  await taskRow.getByRole('button', { name: /Start timing/i }).click();
  await expect(taskRow.getByRole('button', { name: /Stop timing/i })).toBeVisible();
  await page.route(timerRoute, route => route.request().method() === 'PATCH'
    ? route.fulfill({ status: 403, json: { code: '42501', message: 'QA timer stop denied' } }) : route.continue());
  await taskRow.getByRole('button', { name: /Stop timing/i }).click();
  await expect(page.getByText('QA timer stop denied', { exact: true })).toBeVisible();
  await expect(taskRow.getByRole('button', { name: /Stop timing/i })).toBeVisible();
  await page.unroute(timerRoute);
  await taskRow.getByRole('button', { name: /Stop timing/i }).click();
  await expect(taskRow.getByRole('button', { name: /Start timing/i })).toBeVisible();
  pass('Timer stop errors preserve running state; retry stops the real timer');
  fs.mkdirSync('test-results/owner-my-work', { recursive: true });
  await page.screenshot({ path: 'test-results/owner-my-work/owner.png', fullPage: true });
  await devPage.screenshot({ path: 'test-results/owner-my-work/delegated-away.png', fullPage: true });
})().catch(async error => {
  if (browser) for (const [i, context] of browser.contexts().entries()) {
    const page = context.pages()[0];
    if (page) { await page.screenshot({ path: `test-results/owner-my-work-failure-${i}.png`, fullPage: true }).catch(() => {});
      fs.writeFileSync(`test-results/owner-my-work-failure-${i}.txt`, await page.locator('body').innerText().catch(() => 'No body')); }
  }
  console.error(error); process.exitCode = 1;
})
.finally(async () => {
  if (browser) await browser.close();
  if (project) {
    for (const table of ['notifications', 'activity_logs', 'pm_activity', 'task_time_logs']) ok(await svc.from(table).delete().eq('organization_id', project.organization_id).eq('project_id', project.id));
    ok(await svc.from('notifications').delete().eq('organization_id', project.organization_id).eq('metadata->>taskTitle', name));
    ok(await svc.from('projects').delete().eq('organization_id', project.organization_id).eq('id', project.id));
  }
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/owner-my-work-browser.json', JSON.stringify({ results, passed: !process.exitCode }, null, 2));
});
