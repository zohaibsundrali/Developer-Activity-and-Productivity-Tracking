import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ invite: null, inviteError: null, org: null, orgError: null, fail: false, reads: 0, reads: 0 }));
vi.mock('@/utils/serverAuth', () => ({ serviceClient: () => ({ from(table) {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => {
    state.reads++;
    if (state.fail) throw new Error('private upstream details');
    return table === 'invitations' ? { data: state.invite, error: state.inviteError } : { data: state.org, error: state.orgError };
  }};
  return q;
}}) }));
import { GET } from '@/app/api/invitations/lookup/route';
const lookup = () => GET(new Request('https://app.test/api/invitations/lookup?token=secret'));
beforeEach(() => Object.assign(state, {
  invite: { email: 'member@example.test', role: 'developer', status: 'pending', expires_at: new Date(Date.now()+60000).toISOString(), organization_id: 'org', project_id: null },
  inviteError: null, org: { name: 'Organization' }, orgError: null, fail: false, reads: 0,
}));
describe('invitation lookup reliability', () => {
  it.each(['inviteError', 'orgError', 'fail'])('distinguishes %s outage from a missing token', async key => {
    state[key] = true;
    const response = await lookup();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'lookup_unavailable' });
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it.each(['invite', 'org'])('returns not found only when %s is absent', async key => {
    state[key] = null;
    expect((await lookup()).status).toBe(404);
  });
  it.each([null, '', 'not-a-date', '2000-01-01T00:00:00Z'])('rejects unusable expiration %j', async expiry => {
    state.invite.expires_at = expiry;
    expect(await (await lookup()).json()).toMatchObject({ expired: true });
  });
  it('returns only presentation fields without allowing caching', async () => {
    const response = await lookup();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ email: 'member@example.test', role: 'developer', status: 'pending', expired: false, orgName: 'Organization', hasProject: false });
  });
});

it('rejects oversized lookup tokens before reaching the service database',async()=>{
 const response=await GET(new Request('https://app.test/api/invitations/lookup?token='+ 'x'.repeat(513)));
 expect(response.status).toBe(400);expect(state.reads).toBe(0);
});
