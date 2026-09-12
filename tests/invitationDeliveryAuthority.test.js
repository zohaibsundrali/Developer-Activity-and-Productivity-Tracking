import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ role: 'hr', overrides: {}, inserts: [], filters: [], send: vi.fn(), insertError: null, listError: null }));
vi.mock('@/utils/serverAuth', () => ({
  getAuthedOrg: async () => ({ orgId: 'org', appUserId: 'actor', role: state.role, userType: 'developer', overrides: state.overrides }),
  serviceClient: () => ({ from(table) {
    let inserted;
    const q = {
      select: () => q, eq: () => q, order: () => q,
      in: (column, values) => { state.filters.push({ column, values }); return q; },
      insert: value => { state.inserts.push(value); inserted = value; return q; },
      single: async () => ({ data: { id: 'invite', ...inserted }, error: state.insertError }),
      maybeSingle: async () => ({ data: table === 'organizations' ? { name: 'Test org' } : null, error: null }),
      then: resolve => Promise.resolve({ data: [], error: state.listError }).then(resolve),
    }; return q;
  } }),
}));
vi.mock('@/utils/emailService', async original => ({ ...await original(), sendTemplatedEmail: state.send }));
vi.mock('@/utils/entitlements', () => ({ checkSeatLimitForRole: async () => null, checkFeatureAccess: async () => null }));
import { GET, POST } from '@/app/api/invitations/route';
const req = body => new Request('https://request.test/api/invitations', { method: 'POST', headers: { origin: 'https://attacker.test', host: 'attacker.test' }, body: JSON.stringify({ email: 'Member@Example.Test', role: 'developer', ...body }) });
beforeEach(() => { state.role = 'hr'; state.overrides = {}; state.inserts = []; state.filters = []; state.insertError = null; state.listError = null; state.send.mockReset().mockResolvedValue({ delivered: true, mode: 'smtp' }); vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://configured.test'); });
afterEach(() => vi.unstubAllEnvs());
describe('invitation delivery and token authority', () => {
  it('builds email links from configuration instead of attacker-controlled headers', async () => {
    expect((await POST(req())).status).toBe(200);
    expect(state.send.mock.calls[0][0].data.inviteUrl).toMatch(/^https:\/\/configured\.test\/invite\//);
    expect(state.inserts[0].email).toBe('member@example.test');
  });
  it.each(['', 'javascript:alert(1)', 'http://insecure.test', 'https://user:password@example.test'])('refuses invalid production origin %s before creating an invitation', async configured => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('NEXT_PUBLIC_APP_URL', configured);
    expect((await POST(req())).status).toBe(503);
    expect(state.inserts).toEqual([]); expect(state.send).not.toHaveBeenCalled();
  });
  it('uses the request URL only in development, never Origin/Host headers', async () => {
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    expect((await POST(req())).status).toBe(200);
    expect(state.send.mock.calls[0][0].data.inviteUrl).toMatch(/^https:\/\/request\.test\/invite\//);
  });
  it.each(['bad', 'a@example.test\r\nbcc:evil@example.test', 123])('rejects invalid email before database writes: %j', async email => {
    expect((await POST(req({ email }))).status).toBe(400); expect(state.inserts).toEqual([]);
  });
  it('returns duplicate conflict without sending another invitation', async () => {
    state.insertError = { message: 'INVITATION_EXISTS: duplicate', code: '23505' };
    expect((await POST(req())).status).toBe(409); expect(state.send).not.toHaveBeenCalled();
  });
  it('keeps a usable invitation but does not claim delivery when the provider fails', async () => {
    state.send.mockRejectedValue(new Error('provider unavailable'));
    const response = await POST(req());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, emailed: false, invitation: { id: 'invite' } });
  });
  it('does not expose higher-rank invitation tokens through the service API', async () => {
    expect((await GET(new Request('https://app.test/api/invitations'))).status).toBe(200);
    const roles = state.filters.find(f => f.column === 'role').values;
    expect(roles).toContain('developer');
    for (const forbidden of ['owner', 'admin', 'manager', 'hr']) expect(roles).not.toContain(forbidden);
  });
  it('honors an explicit invitation deny before reading tokens', async () => {
    state.overrides['member.invite'] = false;
    expect((await GET(new Request('https://app.test/api/invitations'))).status).toBe(403);
    expect(state.filters).toEqual([]);
  });
});

it('does not expose private database errors from creation or listing', async () => {
 state.insertError={message:'private table and secret token'};
 let response=await POST(req()); expect(response.status).toBe(500);
 expect(JSON.stringify(await response.json())).not.toContain('private');
 state.listError={message:'private query details'};
 response=await GET(new Request('https://app.test/api/invitations'));
 expect(response.status).toBe(500);expect(JSON.stringify(await response.json())).not.toContain('private');
 expect(response.headers.get('cache-control')).toBe('private, no-store');
});
it('marks successful invitation token responses private and non-cacheable',async()=>{
 for(const response of [await POST(req()),await GET(new Request('https://app.test/api/invitations'))]) {
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
 }
});
it.each(['{', 'null', '[]', '"text"'])('rejects malformed invitation body %s before writes',async body=>{
 const response=await POST(new Request('https://app.test/api/invitations',{method:'POST',body}));
 expect(response.status).toBe(400);expect(state.inserts).toEqual([]);expect(state.send).not.toHaveBeenCalled();
});
