import { expect, it } from 'vitest';
import { checkWorkerReadiness } from '../scripts/check-worker-readiness.mjs';
const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://db.example.com', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-token', SUPABASE_SERVICE_ROLE_KEY: 'private-token', CRON_SECRET: 'cron-token', NEXT_PUBLIC_APP_URL: 'https://app.example.com', STRIPE_SECRET_KEY: 'rk_test_example', STRIPE_WEBHOOK_SECRET: 'whsec_example', RESEND_API_KEY: 're_example', EMAIL_FROM: 'sender@example.com' };
const config = { crons: [{ path: '/api/cron', schedule: '0 6 * * *' }] };
it('passes configured shapes but warns about daily recovery and unconfigured dedicated secrets', () => {
  const result = checkWorkerReadiness(env, config);
  expect(result.ok).toBe(true);
  expect(result.checks).toContainEqual(expect.objectContaining({ code: 'daily_schedule_recovery_can_wait_until_next_run', status: 'warning' }));
});
it('never emits environment values including malformed URLs or credentials', () => {
  const poisoned = Object.fromEntries(Object.keys(env).map((key) => [key, 'unique-sensitive-canary']));
  expect(JSON.stringify(checkWorkerReadiness(poisoned, config))).not.toContain('unique-sensitive-canary');
});
it('rejects missing config, absent scheduler, unsafe origin and public service key', () => {
  expect(checkWorkerReadiness({}, {}).ok).toBe(false);
  for (const delta of [{ NEXT_PUBLIC_APP_URL: 'http://app.example.com' }, { NEXT_PUBLIC_APP_URL: 'https://app.example.com/path' }, { NEXT_PUBLIC_SUPABASE_ANON_KEY: env.SUPABASE_SERVICE_ROLE_KEY }, { EMAIL_FROM: 'onboarding@resend.dev' }]) expect(checkWorkerReadiness({ ...env, ...delta }, config).ok).toBe(false);
});
it('supports SMTP fallback only when both credentials are configured', () => {
  expect(checkWorkerReadiness({ ...env, RESEND_API_KEY: '', GMAIL_EMAIL: 'sender@example.com', GMAIL_APP_PASSWORD: 'smtp-secret' }, config).ok).toBe(true);
  expect(checkWorkerReadiness({ ...env, RESEND_API_KEY: '', GMAIL_EMAIL: 'sender@example.com' }, config).ok).toBe(false);
});
