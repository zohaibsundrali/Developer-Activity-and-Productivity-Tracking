import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ client: null }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mocks.client }));
vi.mock('@/utils/permissionOverrides', () => ({ loadOverrides: async () => ({}) }));
vi.mock('@/utils/systemEvents', () => ({ recordEvent: async () => true }));
import { getAuthedOrg } from '@/utils/serverAuth';
import { workspaceIdentity } from '@/utils/workspaceIdentity';
const uid = '00000000-0000-0000-0000-000000000001', sid = '00000000-0000-0000-0000-000000000002';
const selected = { organization_id: 'org-b', app_user_id: 'profile-b', user_type: 'admin', role: 'owner' };
const primary = { ...selected, organization_id: 'org-a', app_user_id: 'profile-a' };
const request = (context = selected, subject = uid) => {
  const jwt = `header.${Buffer.from(JSON.stringify({ sub: subject, session_id: sid, app_metadata: context })).toString('base64url')}.signature`;
  return new Request('http://localhost/api/test', { headers: { Authorization: `Bearer ${jwt}` } });
};
beforeEach(() => {
  mocks.client = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: uid, app_metadata: primary } } })) },
    rpc: vi.fn(async name => ({ data: name === 'platform_session_active' ? true : selected })),
    from: vi.fn(table => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: table === 'memberships'
        ? { status: 'active', role: 'owner', deletion_blocked: false } : table === 'organizations' ? { status: 'active' } : { auth_user_id: uid } }) };
      return q;
    }),
  };
});
it('uses verified session context instead of the Auth identity primary workspace', async () => {
  expect(await getAuthedOrg(request())).toMatchObject({ userId: uid, orgId: 'org-b', appUserId: 'profile-b', role: 'owner' });
});
it('rejects a stale JWT immediately after workspace selection', async () => {
  expect(await getAuthedOrg(request(primary))).toBeNull();
});
it('never uses decoded claims before Supabase verifies the exact token', async () => {
  mocks.client.auth.getUser.mockResolvedValue({ error: { name: 'Invalid token', status: 401 } });
  expect(await getAuthedOrg(request())).toBeNull();
  expect(mocks.client.rpc).not.toHaveBeenCalled();
});
it('rejects mismatched Auth subject', async () => {
  expect(await getAuthedOrg(request(selected, 'different-subject'))).toBeNull();
  expect(mocks.client.rpc).not.toHaveBeenCalled();
});
it('fails closed on context lookup failure or revoked Auth session', async () => {
  mocks.client.rpc.mockResolvedValue({ error: { message: 'unavailable' } });
  expect(await getAuthedOrg(request())).toBeNull();
  mocks.client.rpc.mockResolvedValue({ data: null });
  expect(await getAuthedOrg(request())).toBeNull();
});
it('preserves the explicit deletion-recovery context option', async () => {
  await getAuthedOrg(request(), { allowDeletion: true });
  expect(mocks.client.rpc).toHaveBeenCalledWith('workspace_context', { p_auth: uid, p_session: sid, p_allow_deletion: true });
});
it('allows identity-only organization listing when the prior workspace is no longer accessible', async () => {
  expect(await workspaceIdentity(request())).toMatchObject({ user: { id: uid }, sessionId: sid });
});
it('does not authenticate malformed or anonymous chooser identities', async () => {
  expect(await workspaceIdentity(new Request('http://localhost'))).toBeNull();
  mocks.client.auth.getUser.mockResolvedValue({ data: { user: { id: uid, is_anonymous: true } } });
  expect(await workspaceIdentity(request())).toBeNull();
});

it('rejects a suspended organization even with valid membership and JWT', async () => {
  const original = mocks.client.from;
  mocks.client.from = table => table === 'organizations' ? { select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{status:'suspended'}}) } : original(table);
  expect(await getAuthedOrg(request())).toBeNull();
});

it('rejects an application-revoked session before identity-only workspace actions', async () => {
  mocks.client.rpc.mockResolvedValue({data:false});
  expect(await workspaceIdentity(request())).toBeNull();
  expect(mocks.client.rpc).toHaveBeenCalledWith('platform_session_active',{p_auth:uid,p_session:sid});
});
