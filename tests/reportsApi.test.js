import { describe, it, expect, vi, beforeEach } from 'vitest';
const m = vi.hoisted(() => ({ auth: null, refusal: null, permission: null, client: {}, loader: vi.fn() }));
vi.mock('@/utils/serverAuth', () => ({ getAuthedOrg: async () => m.auth, getBearerToken: () => 'verified-token', orgScopedClient: vi.fn(() => m.client), serviceClient: () => ({ billingOnly: true }) }));
vi.mock('@/utils/serverPermissions', () => ({ requirePermission: () => m.permission }));
vi.mock('@/utils/entitlements', () => ({ checkFeatureAccess: async () => m.refusal }));
vi.mock('@/utils/reportsData', () => ({ loadReportDataForClient: m.loader, defaultRange: () => ({ from: '2026-09-01', to: '2026-09-11' }) }));
import { GET } from '@/app/api/reports/route';
const req = query => new Request(`https://app.test/api/reports${query || ''}`);
beforeEach(() => { vi.clearAllMocks(); m.auth = { orgId: 'verified-org' }; m.permission = null; m.refusal = null; m.loader.mockResolvedValue({ projects: [] }); });
describe('reports API authority', () => {
  it('requires authentication', async () => { m.auth = null; expect((await GET(req())).status).toBe(401); expect(m.loader).not.toHaveBeenCalled(); });
  it('requires report permission before loading data', async () => { m.permission = new Response('{}', { status: 403 }); expect((await GET(req())).status).toBe(403); expect(m.loader).not.toHaveBeenCalled(); });
  it.each([402,503])('refuses when billing returns %s', async status => { m.refusal = { status, error: 'denied' }; expect((await GET(req())).status).toBe(status); expect(m.loader).not.toHaveBeenCalled(); });
  it.each(['?from=2026-02-30', '?from=bad', '?from=2026-10-01&to=2026-09-01'])('validates date range %s', async query => { expect((await GET(req(query))).status).toBe(400); expect(m.loader).not.toHaveBeenCalled(); });
  it('loads through the caller client and ignores forged organization', async () => { expect((await GET(req('?organizationId=foreign'))).status).toBe(200); expect(m.loader).toHaveBeenCalledWith({ from: '2026-09-01', to: '2026-09-11' }, m.client, 'verified-org'); });
  it('reports query failure instead of zero activity', async () => { m.loader.mockRejectedValueOnce(new Error('database unavailable')); expect((await GET(req())).status).toBe(503); });
});
