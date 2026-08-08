/**
 * Environment loading for the end-to-end suite.
 *
 * Credentials are NEVER hardcoded and never committed. They come from the
 * process environment, optionally seeded from a local `.env.e2e` file at the
 * repo root (`.env*` is already git-ignored, so that file cannot be committed
 * by accident).
 *
 * This is a deliberately tiny parser rather than a `dotenv` dependency: the
 * suite only needs `KEY=value` lines and adding a runtime dep to read six
 * variables is not worth it.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Repo root, found by walking up from the working directory to the nearest
 * package.json.
 *
 * Deliberately not `import.meta.url`: Playwright compiles these ES modules to
 * CommonJS (package.json has no `"type": "module"`), and `import.meta` does not
 * survive that transform. Walking up works under either module system.
 */
function findRepoRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

export const REPO_ROOT = findRepoRoot();

/**
 * Load `<root>/.env.e2e` into process.env if it exists.
 *
 * Existing process.env values always win, so CI secrets are never clobbered by
 * a stale local file.
 */
export function loadE2EEnvFile(root = REPO_ROOT) {
  const file = path.join(root, '.env.e2e');
  if (!fs.existsSync(file)) return { loaded: false, file, keys: [] };

  const keys = [];
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (!key) continue;

    let value = line.slice(eq + 1).trim();
    // Strip one layer of matching quotes, so values with spaces work.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
      keys.push(key);
    }
  }

  return { loaded: true, file, keys };
}

/** Trimmed value of `name`, or null when unset/blank. */
export function envValue(name) {
  const raw = process.env[name];
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value === '' ? null : value;
}

/** Truthy-ish flag: `1`, `true`, `yes` (case-insensitive). */
export function envFlag(name) {
  const value = envValue(name);
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

/** Base URL under test. Matches the default used by playwright.config.js. */
export function baseURL() {
  return envValue('E2E_BASE_URL') || 'http://localhost:3000';
}

/**
 * Opt-in switch for the handful of tests that write to the database
 * (timers, comments). Off by default so a normal run cannot mutate the
 * seeded organisations.
 */
export function writesAllowed() {
  return envFlag('E2E_ALLOW_WRITES');
}
