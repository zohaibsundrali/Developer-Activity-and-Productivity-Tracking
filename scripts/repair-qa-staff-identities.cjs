// Restore only existing synthetic QA staff links through the audited RPC.
// Preview by default; --apply uses the same IDs after server-side revalidation.
const fs = require('node:fs');
const assert = require('node:assert/strict');
require('@next/env').loadEnvConfig(process.cwd());
const { createClient } = require('@supabase/supabase-js');
const apply = process.argv.includes('--apply');
const env = Object.fromEntries(fs.readFileSync('.env.e2e', 'utf8').split(/\r?\n/)
  .filter(line => /^E2E_[A-Z_]+=/.test(line)).map(line => {
    const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).replace(/^(['"])(.*)\1$/, '$2')];
  }));
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const roles = ['manager', 'team_lead', 'hr', 'finance', 'qa', 'developer', 'designer', 'devops', 'employee'];
(async () => {
  for (const role of roles) {
    const prefix = `E2E_${role.toUpperCase()}`;
    const email = env[`${prefix}_EMAIL`];
    assert.match(email || '', /^verisade-qa-[a-z0-9-]+@example\.com$/);
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password: env[`${prefix}_PASSWORD`] });
      if (error) throw new Error(`${role}: QA authentication failed (${error.code})`);
      const user = data.user, meta = user.app_metadata;
      assert.equal(user.email, email);
      assert(user.email_confirmed_at, `${role}: confirmed Auth identity required`);
      assert.equal(meta.role, role);
      assert.equal(meta.user_type, 'developer');
      const profile = await service.from('developers').select('id,email,auth_user_id,organization_id')
        .eq('id', meta.app_user_id).eq('organization_id', meta.organization_id).single();
      if (profile.error) throw new Error(`${role}: exact existing profile required (${profile.error.code})`);
      assert.equal(profile.data.email, email);
      if (profile.data.auth_user_id === user.id) {
        console.log(JSON.stringify({ role, status: 'already-linked' })); continue;
      }
      assert.equal(profile.data.auth_user_id, null, `${role}: conflicting identity must not be overwritten`);
      const args = { p_org: meta.organization_id, p_profile: meta.app_user_id, p_type: 'developer', p_auth: user.id,
        p_apply: false, p_allow_null_org: false };
      const preview = await service.rpc('operator_repair_profile_identity', args);
      if (preview.error) throw new Error(`${role}: preview unavailable (${preview.error.code})`);
      if (preview.data?.eligible !== true) throw new Error(`${role}: repair refused: ${(preview.data?.failures || []).join(', ')}`);
      if (!apply) { console.log(JSON.stringify({ role, eligible: true, applied: false })); continue; }
      const repaired = await service.rpc('operator_repair_profile_identity', { ...args, p_apply: true,
        p_ack: 'REPAIR VERIFIED EXISTING IDENTITY',
        p_operator_reference: 'QA-2026-09-21 user-requested repair; existing .env.e2e credential, confirmed Auth claims, exact typed profile and membership verified' });
      if (repaired.error || repaired.data?.applied !== true) throw new Error(`${role}: apply failed (${repaired.error?.code || 'not applied'})`);
      const verified = await service.from('developers').select('auth_user_id').eq('id', meta.app_user_id).eq('organization_id', meta.organization_id).single();
      assert.equal(verified.data?.auth_user_id, user.id);
      console.log(JSON.stringify({ role, applied: true, verified: true, auditId: repaired.data.auditId }));
    } finally { await client.auth.signOut({ scope: 'local' }); }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
