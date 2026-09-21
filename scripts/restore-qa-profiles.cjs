// Reconstruct missing synthetic test profiles from confirmed Auth metadata AND
// an existing matching typed membership. Never creates memberships or Auth users.
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
(async () => {
  for (const key of ['OWNER', 'ADMIN', 'CLIENT', 'ORG_B_OWNER']) {
    const email = env[`E2E_${key}_EMAIL`], role = key === 'ORG_B_OWNER' ? 'owner' : key.toLowerCase();
    assert.match(email || '', /^verisade-qa-[a-z0-9-]+@example\.com$/);
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password: env[`E2E_${key}_PASSWORD`] });
      if (error) throw new Error(`${key}: authentication failed (${error.code})`);
      const user = data.user, meta = user.app_metadata, kind = role === 'client' ? 'client' : 'admin';
      assert.equal(user.email, email); assert(user.email_confirmed_at);
      assert.equal(meta.role, role); assert.equal(meta.user_type, kind);
      const org = await service.from('organizations').select('id,name,status').eq('id', meta.organization_id).single();
      assert.equal(org.error, null); assert.match(org.data.name, /^QA Test Org [AB]$/); assert.equal(org.data.status, 'active');
      const members = await service.from('memberships').select('organization_id,user_id,user_type,email,role,status,deletion_blocked')
        .eq('user_id', meta.app_user_id).eq('user_type', kind);
      assert.equal(members.error, null); assert.equal(members.data.length, 1);
      const member = members.data[0];
      assert.equal(member.organization_id, meta.organization_id); assert.equal(member.email, email);
      assert.equal(member.role, role); assert.equal(member.status, 'active'); assert.notEqual(member.deletion_blocked, true);
      const table = kind === 'client' ? 'clients' : 'admin_users';
      const existing = await service.from(table).select('id,auth_user_id,organization_id,email').eq('id', meta.app_user_id);
      assert.equal(existing.error, null);
      if (existing.data.length) {
        const profile = existing.data[0];
        assert.equal(profile.email, email); assert.equal(profile.organization_id, meta.organization_id); assert.equal(profile.auth_user_id, user.id);
        console.log(JSON.stringify({ role: key, status: 'already-restored' })); continue;
      }
      const conflicts = await service.from(table).select('id').eq('organization_id', meta.organization_id).or(`email.eq.${email},auth_user_id.eq.${user.id}`);
      assert.equal(conflicts.error, null); assert.equal(conflicts.data.length, 0, 'Existing conflicting QA identity must not be overwritten');
      if (!apply) { console.log(JSON.stringify({ role: key, eligible: true })); continue; }
      const profile = { id: meta.app_user_id, organization_id: meta.organization_id, auth_user_id: user.id, email, password: null, company: org.data.name,
        ...(kind === 'client' ? { name: 'QA Client', status: 'active' } : { full_name: `QA ${role === 'owner' ? 'Owner' : 'Admin'}`, role: 'admin', is_verified: true }) };
      const inserted = await service.from(table).insert(profile).select('id,auth_user_id,organization_id').single();
      if (inserted.error) throw new Error(`${key}: profile restoration failed (${inserted.error.code})`);
      assert.equal(inserted.data.id, meta.app_user_id); assert.equal(inserted.data.auth_user_id, user.id);
      console.log(JSON.stringify({ role: key, restored: true, verified: true }));
    } finally { await client.auth.signOut({ scope: 'local' }); }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
