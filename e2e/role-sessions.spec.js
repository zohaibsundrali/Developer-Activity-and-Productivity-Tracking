import { test, expect } from '@playwright/test';
import { ROLES, credentialsFor, skipUnless } from './fixtures/credentials.js';
import { login, logout, apiRequest } from './fixtures/auth.js';

// A password alone does not establish application access. Verify the typed
// profile/membership, browser session, effective role and logout for every seed.
for (const role of Object.keys(ROLES)) {
  test(`${role}: login establishes the correct role and logout closes the portal`, async ({ page }) => {
    const credentials = credentialsFor(role);
    skipUnless(credentials);
    await login(page, credentials);
    const result = await apiRequest(page, '/api/me/permissions');
    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.role).toBe(['orgBOwner', 'admin'].includes(role) ? 'owner' : role);
    expect(result.body.overridesUnavailable).toBe(false);
    if (role === 'client') expect(result.body.permissions).toEqual([]);
    else expect(result.body.permissions.length).toBeGreaterThan(0);
    await logout(page);
    await page.goto(credentials.landing);
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
  });
}
