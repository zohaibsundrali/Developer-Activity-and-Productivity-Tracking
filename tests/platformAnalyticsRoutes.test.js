import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn() }));
vi.mock('@/utils/platformOwner', () => ({
  requirePlatformPermission: mocks.access,
  platformJson: (body, status = 200) => Response.json(body, { status }),
}));
import { GET } from '@/app/api/platform/analytics/route';
const request = query => new Request(`http://localhost/api/platform/analytics?${query}`);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue({ svc: { rpc: mocks.rpc }, args: { p_auth: 'actor', p_session: 'session' } });
  mocks.rpc.mockResolvedValue({ data: { currencies: [] } });
});
describe('platform analytics date validation', () => {
  it.each(['2026-02-30', '2026-02-29', '2026-04-31', '2026-13-01', 'bad'])('rejects impossible from/to date %s before querying revenue', async date => {
    for (const query of [`from=${date}&to=2026-12-31`, `from=2026-01-01&to=${date}`]) {
      const response = await GET(request(query));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Invalid date range.' });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('accepts a real leap day and forwards exact dates', async () => {
    expect((await GET(request('from=2024-02-29&to=2024-03-01'))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('platform_revenue', { p_auth: 'actor', p_session: 'session', p_from: '2024-02-29', p_to: '2024-03-01' });
  });
  it('rejects reversed ranges', async () => {
    expect((await GET(request('from=2026-03-01&to=2026-02-28'))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('stops unauthorized requests before querying revenue', async () => {
    mocks.access.mockResolvedValue({ error: Response.json({ error: 'Denied' }, { status: 403 }) });
    expect((await GET(request('from=2026-01-01&to=2026-01-31'))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
