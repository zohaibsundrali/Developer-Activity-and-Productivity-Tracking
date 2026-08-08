import { defineConfig, devices } from '@playwright/test';
import { loadE2EEnvFile } from './e2e/fixtures/env.js';

// Seed process.env from an (git-ignored) .env.e2e before anything reads it.
// CI secrets already in the environment always win.
loadE2EEnvFile();

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3000';
const isCI = !!process.env.CI;

// When E2E_BASE_URL points somewhere (a preview deploy, a running `npm run
// dev`), do not build and boot a second server on top of it.
const useOwnServer = !process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './e2e',

  // Playwright owns *.spec.js. Vitest owns tests/**/*.test.js and is never
  // collected here — the two suites cannot see each other's files.
  testMatch: '**/*.spec.js',

  // The suite runs against ONE seeded pair of organisations. Files run in
  // parallel, tests within a file run in order, so a login-heavy spec does not
  // race itself.
  fullyParallel: false,
  workers: isCI ? 1 : undefined,

  forbidOnly: isCI,
  retries: isCI ? 2 : 0,

  // A cold Next.js route compile plus a Supabase round trip is slow the first
  // time; these are generous on purpose so a first-hit compile is not a flake.
  timeout: 90_000,
  expect: { timeout: 15_000 },

  reporter: isCI
    ? [['github'], ['list'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],

  outputDir: 'test-results',

  use: {
    baseURL,
    // Sidebar is permanently visible from the `lg` breakpoint (1024px) up.
    // Below it the shell hides navigation behind a hamburger and every nav
    // assertion would need a different path.
    viewport: { width: 1440, height: 900 },
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Add firefox/webkit here once the suite is green on chromium; the specs
    // are engine-agnostic (roles and accessible names only).
  ],

  ...(useOwnServer
    ? {
        webServer: {
          // Production build, not `next dev` — E2E should exercise what ships.
          command: 'npm run build && npm start',
          url: baseURL,
          // A cold `next build` of this app is minutes, not seconds.
          timeout: 600_000,
          reuseExistingServer: !isCI,
          stdout: 'pipe',
          stderr: 'pipe',
        },
      }
    : {}),
});
