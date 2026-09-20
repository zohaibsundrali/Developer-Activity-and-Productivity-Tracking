// Uses mocked platform/Auth responses. Never mutates live data or billing.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.E2E_BASE_URL || 'http://127.0.0.1:3130';
const artifacts = 'test-results/platform-suite';
fs.mkdirSync(artifacts, { recursive: true });
const ORG = '33333333-3333-4333-8333-333333333333';
const MEMBER = '44444444-4444-4444-8444-444444444444';
const PROJECT = '55555555-5555-4555-8555-555555555555';
const USER = '66666666-6666-4666-8666-666666666666';
const INVOICE = '77777777-7777-4777-8777-777777777777';
const list = items => ({ items, total: items.length, page: 1, pageSize: 20 });
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(60000);
    const errors = [], actions = [], exports = [];
    let role = 'owner', requireMfa = false, suspended = false, archived = false, factorVerified = false;
    const env = fs.readFileSync('.env.local', 'utf8');
    const authUrl = env.match(/^NEXT_PUBLIC_SUPABASE_URL=[\"']?([^\"'\r\n]+)/m)?.[1];
    assert(authUrl, 'Public Supabase URL needed for mock session');
    const storageKey = `sb-${new URL(authUrl).hostname.split('.')[0]}-auth-token`;
    const token = aal => `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: USER, exp: Math.floor(Date.now()/1000)+3600, aal })).toString('base64url')}.mock-signature`;
    const mockUser = () => ({ id: USER, aud: 'authenticated', email: 'owner@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-09-01', factors: factorVerified ? [{ id: 'factor1', factor_type: 'totp', status: 'verified', friendly_name: 'Test authenticator' }] : [] });
    const session = aal => ({ access_token: token(aal), refresh_token: 'mock-refresh', token_type: 'bearer', expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600, user: mockUser() });
    await page.addInitScript(({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)), { key: storageKey, value: session('aal1') });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/auth/v1/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/factors') && route.request().method() === 'POST') return route.fulfill({ json: { id: 'factor1', type: 'totp', totp: { qr_code: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="white"/></svg>', secret: 'MOCKSETUPKEY' } } });
      if (path.endsWith('/challenge')) return route.fulfill({ json: { id: 'challenge1', expires_at: Math.floor(Date.now()/1000)+60 } });
      if (path.endsWith('/verify')) { assert.equal(route.request().postDataJSON().code, '123456'); factorVerified = true; requireMfa = false; return route.fulfill({ json: session('aal2') }); }
      return route.fulfill({ json: mockUser() });
    });
    await page.route('**/api/platform/**', async route => {
      const req = route.request(), url = new URL(req.url()), path = url.pathname.replace('/api/platform/', '');
      const supportPermissions = ['overview.read', 'organizations.read', 'organizations.manage', 'members.manage', 'projects.manage', 'projects.read', 'health.read', 'alerts.manage', 'activity.read'];
      let result = {};
      if (path === 'access') {
        result = { platformAccess: true, platformOwner: role === 'owner', role, permissions: role === 'owner' ? ['*'] : role === 'billing' ? ['organizations.read','billing.read','billing.manage','analytics.read','health.read','alerts.manage'] : supportPermissions, email: 'owner@example.test', mfaRequired: requireMfa, mfaSatisfied: !requireMfa };
        if (requireMfa) return route.fulfill({ status: 403, json: { ...result, code: 'MFA_REQUIRED', error: 'Verify your authenticator to continue.' } });
      } else if (req.method() === 'POST') {
        const body = req.postDataJSON(); actions.push({ path, body });
        if (body.action === 'organization.status') suspended = body.status === 'suspended';
        if (body.action === 'archive') archived = true;
        if (body.action === 'restore') archived = false;
        result = body.action === 'member.invite' ? { success: true, inviteLink: 'https://example.test/invite/mock', emailed: false } : { success: true, sync: 'webhook_pending' };
      } else if (path === 'overview') {
        result = { organizations: 128, projects: 846, memberships: 2490, tasks: 12480, admins: 154, developers: 2196, clients: 140, devices: 1680, screenshots: 284910, deletionsPending: 0, subscriptions: [{ status: 'active', count: 86 }], revenue: [{ currency: 'USD', paid_cents: 4869200 }], growth: [{ month: '2026-08', organizations: 28 }, { month: '2026-09', organizations: 36 }], generatedAt: new Date().toISOString() };
      } else if (path === 'organizations') result = list([{ id: ORG, name: 'Northstar Studio', projects: 24, members: 46, tasks: 240, created_at: '2026-09-01' }]);
      else if (path === `organizations/${ORG}`) result = url.searchParams.has('tab') ? list([]) : { organization: { id: ORG, name: 'Northstar Studio', created_at: '2026-09-01' }, stats: { projects: 24, members: 46 }, billingOrganizationId: ORG, subscription: { plan_code: 'business', status: 'active' } };
      else if (path === 'management') {
        const kind = url.searchParams.get('kind');
        result = kind === 'organization' ? { id: ORG, name: 'Northstar Studio', status: suspended ? 'suspended' : 'active' } : kind === 'team' ? list([{ auth_user_id: USER, email: 'support@example.test', role: 'support', mfa_required: true }]) : list([{ id: MEMBER, organization_id: ORG, organization_name: 'Northstar Studio', email: 'member@example.test', role: 'developer', status: 'active' }]);
      } else if (path === 'projects') result = list([{ id: PROJECT, name: 'Brand refresh', organization_id: ORG, status: 'active', archived, created_at: '2026-09-01' }]);
      else if (path === `projects/${PROJECT}`) result = { project: { id: PROJECT, name: 'Brand refresh', description: 'Design system update', status: 'active', archived }, tasks: 18, members: 4 };
      else if (path === 'billing') result = list(url.searchParams.get('tab') === 'invoices' ? [{ id: INVOICE, organization_id: ORG, organizations: { name: 'Northstar Studio' }, status: 'paid', currency: 'usd', amount_paid_cents: 15000, amount_due_cents: 0 }] : [{ id: 's1', organization_id: ORG, organizations: { name: 'Northstar Studio' }, plan_code: 'business', status: 'active' }]);
      else if (path === 'billing/actions') result = { plans: [{ code: 'business', name: 'Business', amount_cents: 15000, currency: 'usd', billing_interval: 'month' }], requests: [{id:'88888888-8888-4888-8888-888888888888',status:'failed',created_at:new Date(Date.now()-240000).toISOString(),can_retry:true,can_reconcile:true,payload:{action:'change_plan',organizationId:ORG,planCode:'business',reason:'Original billing change request',requestId:'88888888-8888-4888-8888-888888888888'}}] };
      else if (path === 'analytics') result = { currencies: [{ currency: 'usd', mrr_cents: 15000, arr_cents: 180000, paid_cents: 30000, refunded_cents: 1000, net_collected_cents: 29000, outstanding_cents: 5000 }], churn: { canceled: 1, starting_subscriptions: 20, rate: 0.05 }, notes: ['MRR is an estimate based on the current plan catalog.'] };
      else if (path === 'health') result = { summary: { failed_webhooks: 1, pending_cleanup: 0, stale_devices: 2, storage_bytes: 1234567, storage_objects: 450 }, alerts: [{ id: 'alert1', kind: 'failed_payment', organization_id: ORG, message: 'Invoice payment needs attention', created_at: '2026-09-01' }], webhooks: [], devices: [], jobs: [], notes: [] };
      else if (path === 'activity') result = { ...list([]), deletions: [], deletionsTotal: 0 };
      else if (path === 'export') {
        exports.push(Object.fromEntries(url.searchParams));
        return route.fulfill({ contentType: url.searchParams.get('format') === 'pdf' ? 'application/pdf' : 'text/csv', body: 'mock export' });
      }
      if (path === 'overview' && role === 'support') { delete result.revenue; delete result.subscriptions; }
      return route.fulfill({ json: result });
    });
    const nav = async name => { console.log('Checking',name); await page.getByRole('navigation').getByRole('button', { name, exact: true }).click(); };
    async function confirm() {
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Reason for this action').fill('Requested platform administration test');
      await dialog.getByRole('button', { name: 'Confirm action', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
    }
    console.log('Opening console'); await page.goto(base + '/admin'); console.log('Console loaded');
    await page.getByRole('heading', { name: 'Workspace growth' }).waitFor();
    await nav('Organizations');
    await page.getByRole('button', { name: /Northstar Studio/ }).first().click();
    await page.getByRole('button', { name: 'Suspend organization', exact: true }).click(); await confirm();
    await page.getByRole('button', { name: 'Reactivate organization', exact: true }).click(); await confirm();
    assert.deepEqual(actions.slice(0, 2).map(a => a.body.status), ['suspended', 'active']);
    await nav('Members');
    await page.getByRole('button', { name: 'Change role', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Workspace role').selectOption('manager'); await confirm();
    await page.getByRole('button', { name: 'Revoke sessions', exact: true }).click(); await confirm();
    await page.getByRole('button', { name: 'Invite member', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Organization ID').fill(ORG); await page.getByRole('dialog').getByLabel('Email', { exact: true }).fill('invite@example.test'); await confirm();
    await page.getByLabel('Invitation link').waitFor();
    assert.equal(actions.find(a => a.body.action === 'member.role').body.role, 'manager');
    assert.equal(actions.find(a => a.body.action === 'member.sessions').body.membershipId, MEMBER);
    await nav('Projects');
    await page.getByRole('button', { name: 'Inspect', exact: true }).click(); await page.getByText('Design system update').waitFor();
    await page.getByRole('button', { name: 'Archive', exact: true }).click(); await confirm();
    await page.getByRole('button', { name: 'Restore', exact: true }).click(); await confirm();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    assert(await page.getByRole('dialog').getByRole('button', { name: 'Confirm action' }).isDisabled());
    await page.getByRole('dialog').getByLabel('Type “Brand refresh” to confirm').fill('Brand refresh'); await confirm();
    await nav('Billing');
    await page.getByRole('button', { name: 'Change plan', exact: true }).click();
    await page.getByRole('dialog').getByLabel('New plan').selectOption('business'); await confirm();
    assert.match(actions.find(a => a.body.action === 'change_plan').body.requestId, /^[0-9a-f-]{36}$/);
    await page.getByRole('button', { name: 'Recent requests', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Resume original request' }).click();
    await page.getByRole('dialog').waitFor({state:'hidden'});
    assert(actions.some(a=>a.body.requestId==='88888888-8888-4888-8888-888888888888'));
    await page.getByRole('button', { name: 'invoices', exact: true }).click();
    await page.getByRole('button', { name: 'Refund', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Refund amount in smallest currency unit').fill('1000'); await confirm();
    assert.equal(actions.find(a => a.body.action === 'refund').body.amountCents, 1000);
    for (const format of ['CSV', 'PDF']) { const download = page.waitForEvent('download'); await page.getByRole('button', { name: format, exact: true }).click(); await download; }
    assert.deepEqual(exports.map(e => e.format), ['csv', 'pdf']);
    await nav('Revenue analytics'); await page.getByText('Subscription churn: 5.0%').waitFor();
    await nav('Health & alerts'); const alertResponse=page.waitForResponse(r=>r.url().endsWith('/api/platform/alerts')); await page.getByRole('button', { name: 'Acknowledge' }).click(); await alertResponse;
    assert.equal(actions.find(a => a.path === 'alerts').body.acknowledged, true);
    await page.screenshot({ path: artifacts + '/health-light.png', fullPage: true });
    await nav('Platform team'); await page.getByRole('button', { name: 'Add team member' }).click();
    await page.getByRole('dialog').getByLabel('Verified account email').fill('billing@example.test'); await page.getByRole('dialog').getByLabel('Platform role').selectOption('billing'); await confirm();
    assert.equal(actions.find(a => a.body.action === 'team.upsert').body.mfaRequired, true);
    await page.getByRole('button', { name: 'Use dark theme' }).click();
    await nav('Projects'); await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('heading', { name: 'Projects across your platform' }).waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: artifacts + '/projects-mobile-dark.png', fullPage: true });
    role = 'support'; await page.reload(); await page.getByRole('heading', { name: 'Workspace growth' }).waitFor();
    for (const label of ['Billing', 'Revenue analytics', 'Platform team']) assert.equal(await page.getByRole('navigation').getByRole('button', { name: label, exact: true }).count(), 0);
    await nav('Organizations'); await page.getByRole('button', { name: /Northstar Studio/ }).first().click();
    assert.equal(await page.getByRole('button', { name: 'Delete organization', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'invoices', exact: true }).count(), 0);
    role='billing'; await page.reload(); await page.getByRole('heading',{name:'Organization directory'}).waitFor();
    for (const label of ['Overview','Projects','Members','Platform team']) assert.equal(await page.getByRole('navigation').getByRole('button',{name:label,exact:true}).count(),0);
    await page.getByRole('button',{name:/Northstar Studio/}).first().click();
    await page.getByRole('heading',{name:'Workspace records'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'projects',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'members',exact:true}).count(),0);
    role='support'; requireMfa = true; await page.reload(); await page.getByRole('heading', { name: 'Verify platform access' }).waitFor();
    assert.equal(await page.getByRole('navigation').count(), 0);
    await page.getByRole('button', { name: 'Set up authenticator' }).click();
    await page.getByAltText('Scan this QR code with your authenticator app').waitFor();
    await page.getByLabel('Authenticator code').fill('123456');
    await page.getByRole('button', { name: 'Verify authenticator', exact: true }).click();
    await page.getByRole('navigation').waitFor();
    assert(factorVerified);
    assert.deepEqual(errors, []);
    console.log('PASS: suite organization lifecycle, memberships/invite, project lifecycle, billing/refund, exports, analytics, alerts, team roles, support restrictions, MFA gate and mobile overflow.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
