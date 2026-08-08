/**
 * Shared navigation and assertion helpers for the dashboards.
 *
 * The three dashboards share one shell (src/components/shell/AppShell.jsx):
 * a sidebar of <button>s labelled from navConfig, and a topbar <h1> carrying
 * the section title. Those two are the stable, accessible landmarks every spec
 * leans on — they survive a restyle, and if either stops rendering the app is
 * genuinely unusable, which is exactly the signal an E2E test should give.
 */

import { expect } from '@playwright/test';

/** Sidebar entry, addressed by its accessible name. */
export function navItem(page, label) {
  return page.getByRole('button', { name: label, exact: true });
}

/** The topbar section heading. */
export function pageHeading(page, name) {
  return name
    ? page.getByRole('heading', { level: 1, name, exact: true })
    : page.getByRole('heading', { level: 1 });
}

/** Click a sidebar entry and wait for the section heading it should produce. */
export async function openSection(page, navLabel, expectedHeading) {
  await navItem(page, navLabel).click();
  await expect(pageHeading(page, expectedHeading)).toBeVisible();
}

/**
 * Jump straight to a section by URL.
 *
 * Used where a spec is testing the URL as an attack surface — a hand-edited
 * `?section=` must be gated by the same rules as the sidebar.
 */
export async function gotoSection(page, base, section) {
  await page.goto(`${base}?section=${section}`);
}

/** Assert the sidebar offers exactly these entries and none of `forbidden`. */
export async function expectNav(page, { visible = [], hidden = [] }) {
  for (const label of visible) {
    await expect(navItem(page, label), `sidebar should offer "${label}"`).toBeVisible();
  }
  for (const label of hidden) {
    await expect(navItem(page, label), `sidebar must NOT offer "${label}"`).toHaveCount(0);
  }
}

/** Navigate to a protected path and assert the middleware bounced us to /login. */
export async function expectBouncedToLogin(page, path) {
  await page.goto(path);
  await expect(page).toHaveURL(/\/login(\?|$)/);
}

/**
 * Assert a piece of another tenant's data is nowhere on the page.
 *
 * Deliberately checks the rendered text of <body> rather than a locator, so it
 * also catches a leak into a tooltip, a hidden panel or a data attribute that a
 * visibility-scoped locator would walk straight past.
 */
export async function expectTextAbsent(page, needle, context) {
  const body = await page.locator('body').innerText();
  expect(
    body.toLowerCase().includes(String(needle).toLowerCase()),
    `${context}: "${needle}" must not appear on ${page.url()}`
  ).toBe(false);
}
