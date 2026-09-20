// Mocked browser regression checks. No live accounts or API writes.
// Start the production build, then run with E2E_BASE_URL pointing at it.
const {
  chromium
} = require('playwright');
const assert = require('node:assert/strict');
require('@next/env').loadEnvConfig(process.cwd());
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000';
const artifacts = path.resolve('test-results/organization-workspaces');
fs.mkdirSync(artifacts, {
  recursive: true
});
const storageKey = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
const uid = '00000000-0000-0000-0000-000000000001',
  org1 = '00000000-0000-0000-0000-000000000002',
  org2 = '00000000-0000-0000-0000-000000000003',
  profile = '00000000-0000-0000-0000-000000000004';
const context = {
  organization_id: org1,
  app_user_id: profile,
  user_type: 'admin',
  role: 'owner'
};
const user = {
  id: uid,
  email: 'owner@example.test',
  app_metadata: context
};
function session(meta = context) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: `${btoa(JSON.stringify({
      alg: 'HS256',
      typ: 'JWT'
    }))}.${btoa(JSON.stringify({
      sub: uid,
      exp,
      session_id: '00000000-0000-0000-0000-000000000005',
      role: 'authenticated',
      app_metadata: meta
    }))}.test`,
    refresh_token: 'test-only',
    expires_at: exp,
    expires_in: 3600,
    token_type: 'bearer',
    user
  };
}
(async () => {
  const browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {
      executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH
    } : {}),
    headless: true,
    args: ['--no-sandbox']
  });
  try {
    const page = await browser.newPage();
    let selected = context,
      mode = 'owner',
      createBody = null,
      verifyCalls = 0;
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(({
      session,
      user,
      storageKey
    }) => {
      localStorage.setItem('devtrack.theme', 'dark');
      if (sessionStorage.getItem('workspaceQaInitialized')) return;
      sessionStorage.setItem('workspaceQaInitialized', 'yes');
      sessionStorage.setItem(storageKey, JSON.stringify(session));
      sessionStorage.setItem('adminUser', JSON.stringify({
        ...user,
        id: session.user.app_metadata.app_user_id,
        role: 'admin',
        membership_role: 'owner',
        organization_id: session.user.app_metadata.organization_id,
        loginTime: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      }));
    }, {
      session: session(),
      user,
      storageKey
    });
    await page.route('https://**.supabase.co/**', async r => {
      const url = new URL(r.request().url());
      let body = [];
      if (url.pathname.endsWith('/token')) body = session(selected);else if (url.pathname.endsWith('/user')) body = user;else if (url.pathname.endsWith('/admin_users')) body = {
        id: profile,
        organization_id: selected.organization_id,
        auth_user_id: uid,
        email: user.email,
        full_name: 'Zohaib'
      };else if (url.pathname.endsWith('/memberships')) body = {
        organization_id: selected.organization_id,
        role: 'owner',
        status: 'active'
      };else if (url.pathname.endsWith('/organizations')) body = {
        id: selected.organization_id,
        name: 'Studio Two',
        timezone: 'UTC'
      };
      return r.fulfill({
        json: body
      });
    });
    await page.route('**/api/**', async r => {
      const p = new URL(r.request().url()).pathname;
      let body = {};
      if (p === '/api/organizations' && r.request().method() === 'GET') body = {
        email: user.email,
        emailVerified: true,
        organizations: mode === 'empty' ? [] : [{
          id: org1,
          profileId: profile,
          userType: 'admin',
          name: 'Verisade Studio',
          role: mode === 'staff' ? 'developer' : 'owner',
          industry: 'Technology',
          country: 'Pakistan',
          projects: mode === 'staff' ? null : 12,
          members: 8,
          timezone: 'Asia/Karachi'
        }, {
          id: org2,
          profileId: profile,
          userType: 'admin',
          name: 'Studio Two',
          role: mode === 'staff' ? 'developer' : 'admin',
          projects: mode === 'staff' ? null : 4,
          members: 3
        }]
      };else if (p === '/api/organizations') {
        createBody = r.request().postDataJSON();
        body = {
          organizationId: org2,
          profileId: profile,
          userType: 'admin'
        };
      } else if (p === '/api/organizations/select') {
        const input = r.request().postDataJSON();
        selected = {
          ...context,
          organization_id: input.organizationId
        };
        body = {
          context: selected
        };
      } else if (p === '/api/billing/plans') body = {
        plans: [{
          code: 'free',
          name: 'Free',
          description: 'The essentials for getting started.',
          amount_cents: 0,
          limits: {
            developers: 2,
            projects: 3,
            active_tasks: 20
          }
        }, {
          code: 'professional',
          name: 'Professional',
          description: 'For growing teams that need more visibility.',
          amount_cents: 1500,
          billing_interval: 'month',
          trial_days: 14,
          limits: {
            developers: 10,
            projects: 20,
            active_tasks: 200
          }
        }]
      };else if (p.includes('permissions')) body = {
        success: true,
        permissions: [],
        role: 'owner'
      };else if (p.includes('verification') || p.includes('verify-code')) verifyCalls++;
      return r.fulfill({
        json: body
      });
    });
    await page.route('**/admin/dashboard*', r => r.fulfill({
      contentType: 'text/html',
      body: '<h1>Workspace destination</h1>'
    }));
    await page.goto(root + '/', {
      waitUntil: 'networkidle'
    });
    await page.waitForURL('**/organizations');
    await page.getByRole('heading', {
      name: 'Organizations',
      exact: true
    }).waitFor();
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({
        width,
        height: 1000
      });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({
        path: path.join(artifacts, `organizations-${width}.png`),
        fullPage: true
      });
    }
    await page.getByRole('link', {
      name: 'New Organization',
      exact: true
    }).first().click();
    await page.getByRole('heading', {
      name: 'Create your organization',
      exact: true
    }).waitFor();
    assert.equal(await page.locator('input[type="password"],input[type="email"]').count(), 0);
    await page.locator('#workspace-name').fill('New Studio');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', {
      name: 'Continue to plans'
    }).click();
    await page.getByRole('radiogroup').waitFor();
    assert.equal(await page.getByRole('radio').count(), 2);
    await page.setViewportSize({
      width: 1440,
      height: 1000
    });
    await page.screenshot({
      path: path.join(artifacts, 'organization-plans.png'),
      fullPage: true
    });
    await page.getByRole('radio').first().focus();
    await page.keyboard.press('ArrowRight');
    assert(await page.getByRole('radio').nth(1).isChecked());
    await page.setViewportSize({
      width: 390,
      height: 1000
    });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({
      path: path.join(artifacts, 'organization-plans-mobile.png'),
      fullPage: true
    });
    // Confirm setup uses only the authenticated endpoint, without OTP/account fields.
    await page.getByRole('button', {
      name: 'Start free trial'
    }).click();
    await page.waitForURL('**/admin/dashboard');
    assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('adminUser')).organization_id), '00000000-0000-0000-0000-000000000003');
    assert(createBody);
    assert.equal(createBody.company, 'New Studio');
    assert.equal(createBody.planCode, 'professional');
    assert(!('email' in createBody));
    assert(!('password' in createBody));
    assert.equal(verifyCalls, 0);
    // Empty memberships, staff root and signed-out root remain usable.
    mode = 'empty';
    await page.goto(root + '/organizations', {
      waitUntil: 'networkidle'
    });
    await page.getByText('0 accessible workspaces').waitFor();
    mode = 'staff';
    await page.goto(root + '/', {
      waitUntil: 'networkidle'
    });
    assert.equal(new URL(page.url()).pathname, '/');
    const anon = await browser.newPage();
    await anon.route('https://**.supabase.co/**', r => r.fulfill({
      json: []
    }));
    await anon.route('**/api/**', r => r.fulfill({
      json: {
        plans: []
      }
    }));
    await anon.goto(root + '/', {
      waitUntil: 'networkidle'
    });
    assert.equal(new URL(anon.url()).pathname, '/');
    await anon.goto(root + '/admin/registration', {
      waitUntil: 'networkidle'
    });
    await anon.locator('#reg-email').waitFor();
    assert(await anon.locator('#reg-password').count());
    await page.goto(root + '/organizations', {
      waitUntil: 'networkidle'
    });
    await page.getByRole('button', {
      name: 'Sign out',
      exact: true
    }).click();
    await page.waitForURL('**/login');
    await page.goto(root + '/', {
      waitUntil: 'networkidle'
    });
    assert.equal(new URL(page.url()).pathname, '/');
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), storageKey), null);
    console.log(JSON.stringify({
      responsive: [1440, 768, 390],
      rootOwnerRedirect: true,
      staffRootPublic: true,
      anonymousRootPublic: true,
      authenticatedSetupNoCredentials: true,
      planKeyboard: true,
      verificationCalls: verifyCalls,
      pageErrors: errors
    }));
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
