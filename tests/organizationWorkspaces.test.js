import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sameWorkspace, workspaceTokenClaims } from '@/utils/workspaceClaims';
const mocks = vi.hoisted(() => ({ identity: vi.fn(), rpc: vi.fn() }));
vi.mock('@/utils/workspaceIdentity', async importOriginal => ({ ...await importOriginal(), workspaceIdentity: mocks.identity }));
const { GET, POST } = await import('@/app/api/organizations/route');
const select = await import('@/app/api/organizations/select/route');
const UID = '00000000-0000-0000-0000-000000000001';
const ORG = '00000000-0000-0000-0000-000000000002';
const PROFILE = '00000000-0000-0000-0000-000000000003';
const SID = '00000000-0000-0000-0000-000000000004';
const context = { organization_id: ORG, app_user_id: PROFILE, user_type: 'admin', role: 'owner' };
const request = body => new Request('http://localhost/api/organizations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity.mockResolvedValue({ svc: { rpc: mocks.rpc }, user: { id: UID, email: 'owner@example.test', email_confirmed_at: '2026-01-01' }, sessionId: SID, claims: { app_metadata: context } });
  mocks.rpc.mockResolvedValue({ data: [], error: null });
});

describe('authorized organization routes', () => {
  it.each([GET, POST, select.POST])('requires authenticated identity', async handler => {
    mocks.identity.mockResolvedValue(null);
    expect((await handler(request({}))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('lists only memberships belonging to verified Auth identity, with no shared caching', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ id: ORG, role: 'owner' }], error: null });
    const response = await GET(new Request(`http://localhost/api/organizations?authId=${PROFILE}`));
    expect(mocks.rpc).toHaveBeenCalledWith('list_workspaces', { p_auth: UID });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ organizations: [{ id: ORG }] });
  });
  it('does not present database failures as an empty organization list', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'sensitive database detail' } });
    const response = await GET(request({}));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('sensitive');
  });
  it('reuses identity, whitelist details and existing catalogue rules without OTP/password', async () => {
    mocks.rpc.mockResolvedValue({ data: { organizationId: ORG, profileId: PROFILE, userType: 'admin' } });
    const response = await POST(request({ requestId: SID, company: ' Example ', termsAccepted: true, planCode: 'professional', authUserId: PROFILE, email: 'someone@else.test', password: 'do-not-use', role: 'owner', paid: true }));
    expect(response.status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('create_authenticated_workspace', expect.objectContaining({ p_auth: UID, p_request: SID, p_details: { company: 'Example', industry: undefined, companySize: undefined, country: undefined, timezone: 'UTC' }, p_plan: 'professional' }));
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toMatch(/do-not-use|someone@else|paid/);
  });
  it.each([{ company: '' }, { company: 'x', termsAccepted: false }, { company: 'x', termsAccepted: true, requestId: 'bad' }])('validates details and explicit terms', async body => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('retains required email verification for an unverified account', async () => {
    mocks.identity.mockResolvedValue({ user: { id: UID, email_confirmed_at: null }, svc: { rpc: mocks.rpc } });
    expect((await POST(request({ requestId: SID, company: 'X', termsAccepted: true }))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('bounds repeated creation', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'WORKSPACE_RATE_LIMIT' } });
    expect((await POST(request({ requestId: SID, company: 'X', termsAccepted: true }))).status).toBe(429);
  });
  it('selects only within the verified Auth session, never a caller-supplied one', async () => {
    mocks.rpc.mockResolvedValue({ data: context });
    expect((await select.POST(request({ organizationId: ORG, profileId: PROFILE, userType: 'admin', sessionId: UID, authUserId: PROFILE }))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('select_workspace', { p_auth: UID, p_session: SID, p_org: ORG, p_profile: PROFILE, p_type: 'admin' });
  });
  it('rejects another organization and masks private failures', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'WORKSPACE_FORBIDDEN' } });
    expect((await select.POST(request({ organizationId: ORG, profileId: PROFILE, userType: 'admin' }))).status).toBe(403);
  });
  it('rejects malformed selection without querying', async () => {
    expect((await select.POST(request({ organizationId: ORG, profileId: PROFILE, userType: 'owner' }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
describe('token context comparison', () => {
  it('requires every typed claim to match', () => {
    expect(sameWorkspace(context, { ...context })).toBe(true);
    for (const key of Object.keys(context)) expect(sameWorkspace(context, { ...context, [key]: 'different' })).toBe(false);
    expect(sameWorkspace({}, {})).toBe(false);
    expect(sameWorkspace(null, context)).toBe(false);
  });
  it('decodes only structure, and tolerates malformed tokens', () => {
    expect(workspaceTokenClaims('not-a-token')).toBeNull();
    const token = `header.${Buffer.from(JSON.stringify({ sub: UID, app_metadata: context })).toString('base64url')}.signature`;
    expect(workspaceTokenClaims(token)).toMatchObject({ sub: UID, app_metadata: context });
  });
});

it('lets a previously authenticated owner reach an empty chooser without granting old workspace access', async () => {
  mocks.identity.mockResolvedValue({ svc: { rpc: mocks.rpc }, user: { id: UID, app_metadata: { role: 'owner' } }, claims: {} });
  const response = await GET(request({}));
  expect(await response.json()).toMatchObject({ organizations: [], ownerAccount: true });
});
