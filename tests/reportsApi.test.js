import { describe, it, expect, vi, beforeEach } from 'vitest';
const m = vi.hoisted(() => ({ auth: null, refusal: null, permission: null, client: {}, loader: vi.fn() }));
vi.mock('@/utils/serverAuth', () => ({ getAuthedOrg: async () => m.auth, getBearerToken: () => 'verified-token', orgScopedClient: vi.fn(() => m.client), serviceClient: () => ({ billingOnly: true }) }));
vi.mock('@/utils/serverPermissions', () => ({ requirePermission: () => m.permission }));
vi.mock('@/utils/entitlements', () => ({ checkFeatureAccess: async () => m.refusal }));
vi.mock('@/utils/reportsData', () => ({ loadReportDataForClient: m.loader, defaultRange: () => ({ from: '2026-09-01', to: '2026-09-11' }) }));
import { GET } from '@/app/api/reports/route';
const req = query => new Request(`https://app.test/api/reports${query || ''}`);
const bundle = () => ({orgId:'verified-org', range:{from:'2026-09-01',to:'2026-09-11'}, projects:[], tasks:[], employees:[], timeLogs:[], sessions:[], truncated:{projects:false,tasks:false,timeLogs:false,sessions:false,employees:false}});
beforeEach(() => { vi.clearAllMocks(); m.auth = { orgId: 'verified-org' }; m.permission = null; m.refusal = null; m.loader.mockResolvedValue(bundle()); });
describe('reports API authority', () => {
  it('requires authentication', async () => { m.auth = null; expect((await GET(req())).status).toBe(401); expect(m.loader).not.toHaveBeenCalled(); });
  it('requires report permission before loading data', async () => { m.permission = new Response('{}', { status: 403 }); expect((await GET(req())).status).toBe(403); expect(m.loader).not.toHaveBeenCalled(); });
  it.each([402,503])('refuses when billing returns %s', async status => { m.refusal = { status, error: 'denied' }; expect((await GET(req())).status).toBe(status); expect(m.loader).not.toHaveBeenCalled(); });
  it.each(['?from=2026-02-30', '?from=bad', '?from=2026-10-01&to=2026-09-01'])('validates date range %s', async query => { expect((await GET(req(query))).status).toBe(400); expect(m.loader).not.toHaveBeenCalled(); });
  it('loads through the caller client and ignores forged organization', async () => { expect((await GET(req('?organizationId=foreign'))).status).toBe(200); expect(m.loader).toHaveBeenCalledWith({ from: '2026-09-01', to: '2026-09-11' }, m.client, 'verified-org'); });
  it('reports query failure instead of zero activity', async () => { m.loader.mockRejectedValueOnce(new Error('database unavailable')); expect((await GET(req())).status).toBe(503); });
});

describe('report response integrity', () => {
  it.each(['projects','tasks','timeLogs','sessions','employees'])('refuses truncated %s without partial data', async key => {
    const data = bundle(); data.truncated[key] = true; m.loader.mockResolvedValue(data);
    const response = await GET(req()); expect(response.status).toBe(413); expect(await response.json()).not.toHaveProperty('projects');
  });
  it.each([{}, {...bundle(),orgId:'foreign'}, {...bundle(),range:{from:'2020-01-01',to:'2020-01-02'}}, {...bundle(),tasks:null}, {...bundle(),truncated:{tasks:'false'}}])('rejects unconfirmed bundle %j', async data => {
    m.loader.mockResolvedValue(data); expect((await GET(req())).status).toBe(503);
  });
  it.each(['?from=', '?to=', '?from=0000-01-01', '?from=2020-01-01&to=2040-01-01'])('rejects unsafe range %s', async query => {
    expect((await GET(req(query))).status).toBe(400); expect(m.loader).not.toHaveBeenCalled();
  });
  it('never exposes database error detail', async () => {
    m.loader.mockRejectedValue(new Error('secret PostgreSQL connection detail'));
    const response = await GET(req()); expect(await response.text()).not.toContain('secret');
  });
  it.each([200,401,403,413,503])('marks status %s private and uncacheable', async status => {
    if(status===401)m.auth=null;
    if(status===403)m.permission=new Response('{}',{status});
    if(status===413)m.loader.mockResolvedValue({...bundle(),truncated:{...bundle().truncated,tasks:true}});
    if(status===503)m.loader.mockRejectedValue(new Error('failed'));
    const response=await GET(req());expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('private, no-store');expect(response.headers.get('vary')).toBe('Authorization, Cookie');
  });
});
