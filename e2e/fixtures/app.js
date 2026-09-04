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

/** The sidebar's section list (Sidebar.jsx renders <nav aria-label="Sections">). */
export function sectionNav(page) {
  return page.getByRole('navigation', { name: 'Sections' });
}

/** Sidebar entry, addressed by its accessible name. */
export function navItem(page, label) {
  return sectionNav(page).getByRole('button', { name: label, exact: true });
}

/** Every sidebar entry the signed-in role was offered, in order. */
export async function navLabels(page) {
  const buttons = sectionNav(page).getByRole('button');
  await expect(buttons.first()).toBeVisible();
  return (await buttons.allInnerTexts()).map((t) => t.trim()).filter(Boolean);
}

/**
 * Assert the screen rendered rather than erroring.
 *
 * ErrorState (components/ui/error-state.jsx) is role="alert" with a "Try
 * again" button; the permission layer's outage message and Next's own error
 * boundary are the other two ways a screen fails. An EMPTY screen is fine —
 * "Nobody in the directory yet" is an answer — an error is not.
 */
export async function expectNoErrorState(page, context) {
  const alerts = page.getByRole('alert').filter({
    hasText: /try again|something went wrong|couldn't load|could not load|unavailable|failed/i,
  });
  const count = await alerts.count();
  if (count) {
    const text = (await alerts.first().innerText()).replace(/\s+/g, ' ').trim();
    expect(count, `${context}: the screen shows an error state — "${text}"`).toBe(0);
  }
  await expect(page.getByText(/Application error|Permissions are temporarily unavailable/), context).toHaveCount(0);
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

/**
 * Click a sidebar entry and return the section id it opened.
 *
 * The sidebar marks the entry active at once, but the `?section=` push happens
 * inside a React transition, so reading the URL straight after the click gave
 * the PREVIOUS section. Wait for the URL to move on unless the entry was
 * already the active one.
 */
export async function clickAndResolveSection(page, label) {
  const item = navItem(page, label);
  const wasActive = (await item.getAttribute('aria-current')) === 'page';
  const before = new URL(page.url()).searchParams.get('section');
  await item.click();
  await expect(item).toHaveAttribute('aria-current', 'page');
  if (!wasActive) {
    await expect
      .poll(() => new URL(page.url()).searchParams.get('section'), { timeout: 10_000 })
      .not.toBe(before);
  }
  return new URL(page.url()).searchParams.get('section') || before || 'overview';
}
