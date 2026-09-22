import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const publicRoutes = new Set([
  '/api/auth/forgot-password', '/api/auth/signup', '/api/auth/verify-code',
  '/api/invitations/accept', '/api/invitations/lookup', '/api/send-verification',
  '/api/billing/plans', '/api/billing/webhook', '/api/csp-report',
  // Android needs the public Supabase configuration before it can sign in.
  '/api/mobile/config',
]);
const root = path.resolve('src/app/api');
function routes(dir = root) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return routes(file);
    if (entry.name !== 'route.js') return [];
    const url = '/api/' + path.relative(root, path.dirname(file)).split(path.sep).join('/');
    if (publicRoutes.has(url)) return [];
    return [...readFileSync(file, 'utf8').matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)]
      .filter(m => !(url === '/api/auth/session' && m[1] === 'DELETE'))
      .map(m => ({ method: m[1], url: url.replace(/\[[^\]]+\]/g, '00000000-0000-0000-0000-000000000001') }));
  });
}

test('anonymous direct requests cannot use protected API handlers', async ({ request }, testInfo) => {
  test.setTimeout(180_000);
  const results = [];
  for (const route of routes()) {
    const probeUrl = route.url === '/api/developer-gantt' ? `${route.url}?projectId=00000000-0000-0000-0000-000000000001` : route.url;
    const response = await request.fetch(probeUrl, {
      method: route.method,
      ...(route.method === 'GET' ? {} : { data: {} }),
    });
    results.push({ ...route, status: response.status() });
  }
  await testInfo.attach('anonymous-api-statuses.json', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  expect(results.filter(r => ![401, 403].includes(r.status))).toEqual([]);
});

test('anonymous mobile bootstrap exposes only public configuration', async ({ request }) => {
  const response = await request.get('/api/mobile/config');
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(Object.keys(body).sort()).toEqual(['public_key', 'success', 'supabase_url']);
  expect(body.success).toBe(true);
  expect(new URL(body.supabase_url).protocol).toBe('https:');
  let isPublicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(body.public_key);
  if (!isPublicKey && typeof body.public_key === 'string' && body.public_key.split('.').length === 3) {
    try {
      isPublicKey = JSON.parse(Buffer.from(body.public_key.split('.')[1], 'base64url').toString('utf8')).role === 'anon';
    } catch { /* malformed configuration fails the assertion below */ }
  }
  // Assert a boolean so failure output cannot disclose a misconfigured secret.
  expect(isPublicKey, 'Mobile bootstrap must contain only a publishable or anon key').toBe(true);
});

test('middleware cannot be bypassed with the internal subrequest header', async ({ request }) => {
  for (const url of ['/organization/dashboard', '/developer/dashboard', '/client']) {
    const response = await request.get(url, { maxRedirects: 0, headers: { 'x-middleware-subrequest': 'src/middleware:src/middleware:src/middleware:src/middleware:src/middleware' } });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toContain('/login');
  }
});
