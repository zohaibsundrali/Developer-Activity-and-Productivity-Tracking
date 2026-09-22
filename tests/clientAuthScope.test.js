import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ client: null, scope: vi.fn(), feature: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mocks.client }));
vi.mock('@/utils/permissionOverrides', () => ({ loadOverrides: async () => ({}) }));
vi.mock('@/utils/systemEvents', () => ({ recordEvent: async () => true }));
vi.mock('@/utils/clientProjectScope', () => ({ loadClientProjectScope: mocks.scope }));
vi.mock('@/utils/entitlements', () => ({ checkFeatureAccess: mocks.feature }));
import { getAuthedClient } from '@/utils/serverAuth';
const request = new Request('http://localhost/api/client/projects', { headers: { Authorization: 'Bearer verified-test-token' } });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.feature.mockResolvedValue(null);
  mocks.scope.mockResolvedValue(['project-a', 'project-b']);
  mocks.client = {
    auth: { getUser: async () => ({ data: { user: { id: 'auth', app_metadata: { organization_id: 'org', user_type: 'client', app_user_id: 'client', role: 'client' } } } }) },
    from: table => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: table === 'organizations' ? { status: 'active' } : table === 'memberships' ? { status: 'active', role: 'client' } : { auth_user_id: 'auth' } }) };
      return q;
    },
  };
});
it('uses the complete project scope for the verified client and organization', async () => {
  expect(await getAuthedClient(request)).toMatchObject({ clientId: 'client', projectIds: ['project-a', 'project-b'] });
  expect(mocks.scope).toHaveBeenCalledWith(mocks.client, { clientId: 'client', orgId: 'org' });
});
it('returns an explicit unavailable refusal without any partial authorization on scope failure', async () => {
  mocks.scope.mockRejectedValue(new Error('private DB detail'));
  const result = await getAuthedClient(request);
  expect(result).toMatchObject({ projectIds: [], planRefusal: { status: 503 } });
  expect(JSON.stringify(result)).not.toContain('private DB detail');
});
it('preserves plan refusal without loading project access', async () => {
  mocks.feature.mockResolvedValue({ status: 403, error: 'Plan required' });
  expect(await getAuthedClient(request)).toMatchObject({ projectIds: [], planRefusal: { status: 403 } });
  expect(mocks.scope).not.toHaveBeenCalled();
});
