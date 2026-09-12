import { describe, it, expect, vi, beforeEach } from 'vitest';
const m = vi.hoisted(() => ({ auth: null, permissions: new Set(), feature: null, rpc: vi.fn(), from: vi.fn(), project: vi.fn(), developer: vi.fn(), overall: vi.fn() }));
vi.mock('@/utils/serverAuth', () => ({ getAuthedOrg: async () => m.auth, orgScopedClient: () => ({ rpc: m.rpc, from: m.from }), serviceClient: () => ({ billing: true }) }));
vi.mock('@/utils/serverPermissions', () => ({ authCan: (_, key) => m.permissions.has(key), requirePermission: (_, key) => m.permissions.has(key) ? null : new Response('{}', { status: 403 }) }));
vi.mock('@/utils/entitlements', () => ({ checkFeatureAccess: async () => m.feature }));
vi.mock('@/utils/productivityData', () => ({ calculateProjectProductivity: m.project, calculateDeveloperProductivity: m.developer, calculateOverallProductivity: m.overall }));
import { GET, POST } from '@/app/api/productivity/route';
const org = '11111111-1111-4111-8111-111111111111';
const actor = '22222222-2222-4222-8222-222222222222';
const project = '33333333-3333-4333-8333-333333333333';
const other = '44444444-4444-4444-8444-444444444444';
const req = (q) => new Request(`https://app.test/api/productivity?${q}`);
const post = body => new Request('https://app.test/api/productivity', { method: 'POST', body: JSON.stringify(body) });
function query(result) { const q = { then: resolve => Promise.resolve(result).then(resolve) }; for (const name of ['select', 'eq', 'limit', 'maybeSingle']) q[name] = vi.fn(() => q); return q; }
beforeEach(() => { vi.clearAllMocks(); m.rpc.mockReset(); m.from.mockReset(); m.auth = { orgId: org, appUserId: actor, userType: 'admin', token: 'caller' }; m.permissions = new Set(['report.view', 'productivity.view_own', 'productivity.recalculate']); m.feature = null; m.project.mockResolvedValue({ projectId: project }); m.developer.mockResolvedValue({ developerId: actor }); m.overall.mockResolvedValue({ developersBreakdown: [] }); m.rpc.mockResolvedValue({ data: { orgId: org, updatedCount: 1, target: { developerId: actor, projectId: project, all: false } } }); });
describe('productivity GET scope', () => {
  it('does not filter a project report to the administrator', async () => { expect((await GET(req(`type=project&projectId=${project}`))).status).toBe(200); expect(m.project.mock.calls[0].slice(1)).toEqual([org, project, null, 'developer']); });
  it('normalizes valid uppercase UUID targets', async () => { const value = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'; await GET(req(`type=project&projectId=${value}`)); expect(m.project.mock.calls[0][2]).toBe(value.toLowerCase()); });
  it('preserves an explicit developer filter', async () => { await GET(req(`type=project&projectId=${project}&developerId=${other}`)); expect(m.project.mock.calls[0].slice(1)).toEqual([org, project, other, 'developer']); });
  it('keeps typed administrator personal metrics distinct from a colliding developer', async () => { await GET(req('type=developer')); expect(m.developer.mock.calls[0].slice(1)).toEqual([org, actor, 'admin']); });
  it('explicit developer targets remain developer typed', async () => { await GET(req(`type=developer&developerId=${actor}`)); expect(m.developer.mock.calls[0].slice(1)).toEqual([org, actor, 'developer']); });
  it('forces own-only users to their verified typed identity', async () => { m.auth.userType = 'developer'; m.permissions = new Set(['productivity.view_own']); await GET(req(`type=developer&developerId=${other}`)); expect(m.developer.mock.calls[0].slice(1)).toEqual([org, actor, 'developer']); });
  it('retains own delivery metrics when the reports plan is unavailable', async () => { m.feature = { status: 402 }; expect((await GET(req('type=developer'))).status).toBe(200); });
  it('enforces report plan for team/project scope', async () => { m.feature = { status: 402 }; expect((await GET(req(`type=project&projectId=${project}`))).status).toBe(402); expect(m.project).not.toHaveBeenCalled(); });
  it('honors typed roster membership for own project metrics', async () => { m.auth.userType = 'developer'; m.permissions = new Set(['productivity.view_own']); m.from.mockReturnValueOnce(query({ data: { id: project, assigned_developer_id: other } })).mockReturnValueOnce(query({ data: [{ id: 'membership' }] })); expect((await GET(req(`type=project&projectId=${project}`))).status).toBe(200); expect(m.from.mock.calls.map(c => c[0])).toEqual(['projects', 'project_members']); expect(m.project.mock.calls[0].slice(1)).toEqual([org, project, actor, 'developer']); });
  it('recognizes an own task assignment without legacy project assignment', async () => { m.auth.userType = 'developer'; m.permissions = new Set(['productivity.view_own']); m.from.mockReturnValueOnce(query({ data: { id: project } })).mockReturnValueOnce(query({ data: [] })).mockReturnValueOnce(query({ data: [{ id: 'task' }] })); expect((await GET(req(`type=project&projectId=${project}`))).status).toBe(200); });
  it.each(['type=other', 'type=project', 'type=developer&developerId=null', 'type=project&projectId=bad'])('rejects invalid input %s', async q => { expect((await GET(req(q))).status).toBe(400); });
  it('returns private noncached successful responses', async () => { const r = await GET(req('type=overall')); expect(r.headers.get('cache-control')).toBe('private, no-store'); expect((await r.json()).orgId).toBe(org); });
  it('sanitizes database details rather than returning zeros', async () => { m.overall.mockRejectedValueOnce(new Error('secret database detail')); const r = await GET(req('type=overall')); expect(r.status).toBe(503); expect(await r.text()).not.toContain('secret'); });
});
describe('productivity recalculation transaction', () => {
  it('uses one caller RPC with exact typed receipt', async () => { expect((await POST(post({ developerId: actor, projectId: project }))).status).toBe(200); expect(m.rpc).toHaveBeenCalledWith('recalculate_productivity', { p_developer: actor, p_project: project, p_all: false }); expect(m.from).not.toHaveBeenCalled(); });
  it('supports an empty complete all-organizations-scope result for this tenant only', async () => { m.rpc.mockResolvedValueOnce({ data: { orgId: org, updatedCount: 0, target: { developerId: null, projectId: null, all: true } } }); expect((await POST(post({ recalculateAll: true }))).status).toBe(200); });
  it.each([null, [], {}, { recalculateAll: 'true' }, { recalculateAll: true, developerId: actor }, { developerId: 'bad', projectId: project }, { developerId: [actor], projectId: project }, { developerId: actor, projectId: [project] }])('rejects malformed mutation %j', async body => { expect((await POST(post(body))).status).toBe(400); expect(m.rpc).not.toHaveBeenCalled(); });
  it('does not report success for a failed database transaction', async () => { m.rpc.mockResolvedValueOnce({ error: { message: 'internal details' } }); const r = await POST(post({ developerId: actor, projectId: project })); expect(r.status).toBe(503); expect(await r.text()).not.toContain('internal details'); });
  it.each([{ orgId: other }, { updatedCount: 0 }, { target: { developerId: other, projectId: project, all: false } }])('rejects mismatched transaction receipt %j', async patch => { m.rpc.mockResolvedValueOnce({ data: { orgId: org, updatedCount: 1, target: { developerId: actor, projectId: project, all: false }, ...patch } }); expect((await POST(post({ developerId: actor, projectId: project }))).status).toBe(503); });
});
describe('productivity authority failures', () => {
  it.each([GET, POST])('requires authenticated identity', async handler => { m.auth = null; expect((await handler(post({ recalculateAll: true }))).status).toBe(401); });
  it.each([GET, POST])('refuses unresolved overrides', async handler => { m.auth.overridesUnavailable = true; expect((await handler(post({ recalculateAll: true }))).status).toBe(503); });
  it.each([GET, POST])('refuses clients even with unexpected permissions', async handler => { m.auth.userType = 'client'; expect((await handler(post({ recalculateAll: true }))).status).toBe(403); });
  it('requires recalculation permission', async () => { m.permissions.delete('productivity.recalculate'); expect((await POST(post({ recalculateAll: true }))).status).toBe(403); expect(m.rpc).not.toHaveBeenCalled(); });
  it('requires reports subscription for recalculation', async () => { m.feature = { status: 402 }; expect((await POST(post({ recalculateAll: true }))).status).toBe(402); expect(m.rpc).not.toHaveBeenCalled(); });
});
