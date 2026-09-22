// Read-only QA-account diagnostics. Never prints credentials or tokens.
const fs = require('node:fs');
require('@next/env').loadEnvConfig(process.cwd());
const env = Object.fromEntries(fs.readFileSync('.env.e2e', 'utf8').split(/\r?\n/)
  .filter(line => line && !line.startsWith('#') && line.includes('='))
  .map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
const base = env.E2E_BASE_URL;
const roles = ['OWNER', 'ADMIN', 'MANAGER', 'TEAM_LEAD', 'HR', 'FINANCE', 'QA', 'DEVELOPER', 'DESIGNER', 'DEVOPS', 'EMPLOYEE', 'CLIENT', 'ORG_B_OWNER'];
(async () => {
  for (const role of roles) {
    const auth = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: env[`E2E_${role}_EMAIL`], password: env[`E2E_${role}_PASSWORD`] }),
    });
    const session = await auth.json();
    const result = { role: role.toLowerCase(), authStatus: auth.status };
    if (session.access_token) {
      const claims = session.user.app_metadata;
      const headers = { Authorization: `Bearer ${session.access_token}` };
      const orgsResponse = await fetch(`${base}/api/organizations`, { headers });
      const orgs = await orgsResponse.json();
      const permissionsResponse = await fetch(`${base}/api/me/permissions`, { headers });
      const permissions = await permissionsResponse.json();
      Object.assign(result, {
        claimRole: claims.role,
        claimUserType: claims.user_type,
        organizationsStatus: orgsResponse.status,
        workspaceCount: orgs.organizations?.length,
        claimWorkspaceAvailable: orgs.organizations?.some(org => (org.id || org.organization_id) === claims.organization_id),
        workspaces: orgs.organizations?.map(org => ({ role: org.role, projects: org.projects, members: org.members })),
        permissionsStatus: permissionsResponse.status,
        permissionCount: permissions.permissions?.length,
        error: permissions.error || orgs.error,
      });
      const serviceHeaders = { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` };
      const table = claims.user_type === 'admin' ? 'admin_users' : claims.user_type === 'client' ? 'clients' : 'developers';
      const matchResponse = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}?email=eq.${encodeURIComponent(env[`E2E_${role}_EMAIL`])}&select=id,auth_user_id,organization_id`, { headers: serviceHeaders });
      const matches = await matchResponse.json();
      result.emailProfiles = Array.isArray(matches) ? matches.map(row => ({ matchesClaim: row.id === claims.app_user_id, identityLinked: row.auth_user_id === session.user.id, orgMatchesClaim: row.organization_id === claims.organization_id })) : { status: matchResponse.status };
      for (const [label, query] of [
        ['profile', `${table}?id=eq.${claims.app_user_id}&select=id,auth_user_id,organization_id`],
        ['membership', `memberships?user_id=eq.${claims.app_user_id}&organization_id=eq.${claims.organization_id}&select=status,role,deletion_blocked`],
        ['organization', `organizations?id=eq.${claims.organization_id}&select=status`],
      ]) {
        const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${query}`, { headers: serviceHeaders });
        const rows = await response.json();
        result[label] = { status: response.status, count: Array.isArray(rows) ? rows.length : undefined };
        if (Array.isArray(rows) && rows.length) {
          result[label].details = label === 'profile' ? { identityLinked: rows[0].auth_user_id === session.user.id, identityMissing: rows[0].auth_user_id == null, orgMatchesClaim: rows[0].organization_id === claims.organization_id } : rows;
        }
      }
    } else result.error = session.error_description || session.msg;
    console.log(JSON.stringify(result));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
