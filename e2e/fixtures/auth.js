/**
 * Login / logout helpers and the authenticated-request helper.
 *
 * Inputs use their associated labels. The CSS error selector is diagnostic
 * only: it quotes the app's own message when login cannot reach its destination.
 */

import { expect } from '@playwright/test';

/** Sign in through the real login form and wait for the role's landing area. */
export async function login(page, credentials) {
  if (!credentials?.ok) {
    throw new Error(`login() called without usable credentials: ${credentials?.reason || 'unknown'}`);
  }

  await page.goto('/login');

  // The verified account determines its portal automatically.
  await page.getByLabel(/^Email address/).fill(credentials.email);
  await page.getByLabel(/^Password/).fill(credentials.password);

  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  try {
    if (credentials.area === 'admin') {
      await page.waitForURL(url => url.pathname === '/organizations' || url.pathname.startsWith(credentials.landing));
      if (new URL(page.url()).pathname === '/organizations') {
        // Workspace hooks stamp session-specific claims on the refreshed JWT;
        // the Auth user object's primary metadata can still name another org.
        const primaryOrg = credentials.organizationId || await page.evaluate(() => {
          const key = Object.keys(sessionStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
          if (!key) return null;
          try {
            const session = JSON.parse(sessionStorage.getItem(key));
            const segment = session?.access_token?.split('.')[1];
            if (!segment) return null;
            const encoded = segment.replace(/-/g, '+').replace(/_/g, '/');
            return JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')))?.app_metadata?.organization_id || null;
          } catch { return null; }
        });
        const available = page.getByRole('button', { name: /^Open .* workspace$/ });
        await available.first().waitFor({ state: 'visible' });
        // Match attributes without interpolating token text into a CSS selector.
        const ids = await available.evaluateAll(buttons => buttons.map(button => button.dataset.organizationId));
        const index = ids.indexOf(primaryOrg);
        if (credentials.organizationId && index < 0) {
          throw new Error('Configured QA organization is not accessible to this account.');
        }
        const button = available.nth(index >= 0 ? index : 0);
        await button.click();
      }
    }
    await page.waitForURL((url) => url.pathname.startsWith(credentials.landing), {
      timeout: 30_000,
    });
  } catch {
    // Diagnostic only: surface whatever the app told the user, so a bad seed
    // reads as "Invalid admin credentials" rather than a bare timeout.
    const shown = await page
      .locator('.auth-error-box')
      .first()
      .textContent()
      .catch(() => null);
    throw new Error(
      `Login as "${credentials.role}" (${credentials.portalName} portal) never reached ${credentials.landing}.\n` +
        `Currently at: ${page.url()}\n` +
        (shown ? `The app reported: "${shown.trim()}"` : 'The app showed no error message.') +
        '\nCheck the seeded user exists in Supabase Auth AND in the matching profile table, ' +
        'that the membership is active, and that SESSION_COOKIE_SECRET / SUPABASE_SERVICE_ROLE_KEY ' +
        'are set on the server (see docs/e2e-testing.md).'
    );
  }

  // The shell is up once its sidebar renders. Not the <h1>: the topbar no
  // longer carries one (each screen renders its own through PageHeader).
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  if (credentials.organizationId) {
    const inExpectedWorkspace = await page.evaluate(expected => {
      const key = Object.keys(sessionStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
      try {
        const segment = JSON.parse(sessionStorage.getItem(key))?.access_token?.split('.')[1];
        if (!segment) return false;
        const encoded = segment.replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')))?.app_metadata?.organization_id === expected;
      } catch { return false; }
    }, credentials.organizationId);
    expect(inExpectedWorkspace, 'Verified session must match the configured QA organization').toBe(true);
  }

}

/**
 * Sign out and confirm we are back on /login.
 *
 * Signing out moved: the sidebar's duplicate Logout button was removed, so the
 * Topbar account menu is now the single exit from the app. That makes this two
 * clicks — open the menu, then the item inside it.
 */
export async function logout(page) {
  await page.getByRole('button', { name: /^Account menu/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.waitForURL((url) => url.pathname === '/login');
}

/**
 * The Supabase access token the app is holding for the current session.
 *
 * supabase-js stores it under a `sb-<project-ref>-auth-token` key. Returns null
 * when no verified Auth token is present; callers treat that as unauthenticated.
 */
export async function accessToken(page) {
  return page.evaluate(() => {
    // src/utils/supabaseClient.js keeps the session in sessionStorage (so it
    // dies with the tab); localStorage is checked second for older builds.
    for (const store of [window.sessionStorage, window.localStorage]) {
      const key = Object.keys(store).find((k) => k.startsWith('sb-') && k.includes('auth-token'));
      if (!key) continue;
      try {
        const parsed = JSON.parse(store.getItem(key));
        const token = parsed?.access_token || parsed?.currentSession?.access_token || null;
        if (token) return token;
      } catch {
        // fall through to the next store
      }
    }
    return null;
  });
}

/**
 * Call an app API route as the signed-in user, from inside the page so the
 * Supabase bearer token and the HttpOnly session cookie both travel with it.
 *
 * Returns `{ status, ok, body }` where body is the parsed JSON when possible
 * and a truncated string otherwise. Used by the isolation spec to assert that
 * the API refuses another tenant's row — the UI is only half the story.
 */
export async function apiRequest(page, path, options = {}) {
  const token = await accessToken(page);
  return page.evaluate(
    async ({ path, token, options }) => {
      const headers = { ...(options.headers || {}) };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch(path, {
        method: options.method || 'GET',
        headers,
        body: options.body,
        credentials: 'include',
      });

      const text = await res.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = text.slice(0, 400);
      }
      return { status: res.status, ok: res.ok, body };
    },
    { path, token, options }
  );
}
