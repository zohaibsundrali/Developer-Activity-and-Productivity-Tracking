// Public landing only. External services and local API calls are stubbed.
const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    for (const width of (process.env.QA_WIDTHS || "375,768,1024,1280,1440,1600").split(",").map(Number)) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: 'light' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname.startsWith('/api/'))
          return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        return route.continue();
      });
      await page.goto(process.env.E2E_BASE_URL || 'http://127.0.0.1:3131', { timeout: 120000 });
      const toggle = page.getByRole('button', { name: 'Dark mode', exact: true });
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByRole('button', { name: 'Back to top', exact: true })).toHaveCount(0);
      const light = await page.locator('main').evaluate(el => getComputedStyle(el.parentElement).backgroundColor);
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      await page.waitForTimeout(300);
      const dark = await page.locator('main').evaluate(el => getComputedStyle(el.parentElement).backgroundColor);
      assert.notEqual(light, dark);
      await page.screenshot({ path: `/tmp/verisade-landing-dark-${width}.png` });
      await page.reload();
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}`);
      const box = await toggle.boundingBox();
      assert(box.x >= 0 && box.x + box.width <= width, `Toggle clipped at ${width}`);
      await page.evaluate(() => window.scrollTo(0, 1500));
      const back = page.getByRole('button', { name: 'Back to top', exact: true });
      await expect(back).toBeVisible();
      await back.focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      await expect(page.locator('#landing-home-link')).toBeFocused();
      await expect(back).toHaveCount(0);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await expect(back).toBeVisible();
      await back.click();
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
      if (width < 1280) {
        await page.getByRole('button', { name: 'Open menu', exact: true }).click();
        await expect(page.locator('#site-nav-panel')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#site-nav-panel')).toHaveCount(0);
      }
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      assert.deepEqual(errors, [], 'Browser errors');
      await page.screenshot({ path: `/tmp/verisade-landing-${width}.png` });
      console.log(`PASS ${width}px: theme, persistence, layout, keyboard return, reduced motion, navigation`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
