#!/usr/bin/env node
// Read-only configuration shape checks. Never serialize environment values.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function checkWorkerReadiness(env, deployment) {
  const checks = [];
  const add = (name, status, code) => checks.push({ name, status, code });
  const present = (name) => typeof env[name] === 'string' && env[name].trim().length > 0;
  for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET', 'NEXT_PUBLIC_APP_URL']) {
    add(name, present(name) ? 'pass' : 'error', present(name) ? 'present_not_authenticated' : 'missing');
  }
  for (const name of ['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_SUPABASE_URL']) {
    if (!present(name)) continue;
    try {
      const url = new URL(env[name]);
      const valid = url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && /^\/*$/.test(url.pathname);
      if (!valid) add(name, 'error', 'production_https_origin_required');
    } catch { add(name, 'error', 'invalid_url'); }
  }
  const publicKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  let publicRole;
  try { publicRole = JSON.parse(Buffer.from(publicKey.split('.')[1], 'base64url').toString()).role; } catch { /* opaque modern keys */ }
  if (publicKey.startsWith('sb_secret_') || publicRole === 'service_role' || (present('SUPABASE_SERVICE_ROLE_KEY') && publicKey === env.SUPABASE_SERVICE_ROLE_KEY)) {
    add('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'error', 'server_credential_in_public_variable');
  }
  for (const name of ['SESSION_COOKIE_SECRET', 'VERIFICATION_CODE_PEPPER']) {
    add(name, present(name) ? 'pass' : 'warning', present(name) ? 'present_not_authenticated' : 'dedicated_secret_not_configured');
  }
  const cron = deployment?.crons?.filter((entry) => entry.path === '/api/cron') || [];
  add('vercel.crons./api/cron', cron.length === 1 && typeof cron[0].schedule === 'string' && cron[0].schedule.trim().split(/\s+/).length === 5 ? 'pass' : 'error', 'schedule_definition_only_verify_deployed_execution');
  if (cron[0]?.schedule === '0 6 * * *') add('vercel.crons./api/cron', 'warning', 'daily_schedule_recovery_can_wait_until_next_run');
  for (const name of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']) {
    const valid = name === 'STRIPE_SECRET_KEY' ? /^(sk|rk)_(test|live)_\S+$/.test(env[name] || '') : /^whsec_\S+$/.test(env[name] || '');
    add(name, valid ? 'pass' : 'error', valid ? 'shape_only_verify_provider_and_mode' : 'paid_billing_configuration_missing_or_invalid');
  }
  if (present('BILLING_GRACE_PERIOD_DAYS') && (!Number.isFinite(Number(env.BILLING_GRACE_PERIOD_DAYS)) || Number(env.BILLING_GRACE_PERIOD_DAYS) < 0)) add('BILLING_GRACE_PERIOD_DAYS', 'error', 'nonnegative_number_required');
  if (present('RESEND_API_KEY')) {
    add('RESEND_API_KEY', 'pass', 'selected_provider_not_authenticated');
    const sender = env.EMAIL_FROM || env.RESEND_FROM || '';
    add('EMAIL_FROM/RESEND_FROM', sender && !/resend\.dev/i.test(sender) ? 'pass' : 'error', 'verify_production_sender_domain_with_provider');
  } else {
    add('GMAIL_EMAIL/GMAIL_APP_PASSWORD', present('GMAIL_EMAIL') && present('GMAIL_APP_PASSWORD') ? 'pass' : 'error', 'both_required_without_resend_otherwise_email_is_mocked');
  }
  return { scope: 'local_configuration_only', ok: !checks.some((c) => c.status === 'error'), checks };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let deployment;
  try { deployment = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')); } catch { deployment = null; }
  const result = checkWorkerReadiness(process.env, deployment);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
