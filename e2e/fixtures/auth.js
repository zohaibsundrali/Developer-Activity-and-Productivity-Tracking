/**
 * Login / logout helpers and the authenticated-request helper.
 *
 * Selector policy: everything here is addressed by role + accessible name, or
 * by placeholder where the app gives an input no other accessible name. The
 * login form's <label>s carry no `htmlFor` and the inputs no `id`/`aria-label`
 * (src/app/login/page.js), so the placeholder IS the accessible name for the
 * email and password fields today. The one CSS selector below is used purely to
 * quote the app's own error text in a failure message — never as an assertion.
 */

import { expect } from '@playwright/test';

/** Sign in through the real login form and wait for the role's landing area. */
export async function login(page, credentials) {
  if (!credentials?.ok) {
    throw new Error(`login() called without usable credentials: ${credentials?.reason || 'unknown'}`);
  }

  await page.goto('/login');

  // Pick the portal tab (Team Member / Admin / Client).
  await page.getByRole('button', { name: credentials.tab, exact: true }).click();

  await page.getByPlaceholder('you@example.com').fill(credentials.email);
  await page.getByPlaceholder('Enter your password').fill(credentials.password);

  await page.getByRole('button', { name: /^Sign in as/ }).click();

  try {
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

  // The shell is up once the topbar heading renders.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

/** Sign out via the sidebar control and confirm we are back on /login. */
export async function logout(page) {
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await page.waitForURL((url) => url.pathname === '/login');
}

/**
 * The Supabase access token the app is holding for the current session.
 *
 * supabase-js stores it under a `sb-<project-ref>-auth-token` key. Returns null
 * for a user who only passed the legacy plaintext check and therefore has no
 * JWT — callers must treat that as "unauthenticated", not as a failure.
 */
export async function accessToken(page) {
  return page.evaluate(() => {
    const key = Object.keys(window.localStorage).find(
      (k) => k.startsWith('sb-') && k.includes('auth-token')
    );
    if (!key) return null;
    try {
      const parsed = JSON.parse(window.localStorage.getItem(key));
      return parsed?.access_token || parsed?.currentSession?.access_token || null;
    } catch {
      return null;
    }
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
