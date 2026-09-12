import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ maintenance: vi.fn(), svc: vi.fn() }));
vi.mock('@/utils/backgroundMaintenance', () => ({ runBackgroundMaintenance: state.maintenance }));
vi.mock('@/utils/serverAuth', () => ({ serviceClient: state.svc }));
vi.mock('@/utils/invitationRecovery', () => ({ recoverInvitations: async () => ({ cleaned: 0, errors: [] }) }));
vi.mock('@/utils/proposalDecisionEmails', () => ({ flushProposalDecisionEmails: async () => ({ delivered: 0, pending: 0 }) }));
vi.mock('@/utils/systemEvents', () => ({ recordEvent: vi.fn() }));
vi.mock('@/app/api/signals/route', () => ({ collect: vi.fn() }));
import { GET } from '@/app/api/cron/route';

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'test-only-cron-secret');
  state.maintenance.mockReset().mockResolvedValue({ errors: [] });
  state.svc.mockReset().mockImplementation(() => ({ from: () => {
    const query = {};
    for (const method of ['select', 'not', 'lte', 'eq', 'neq', 'limit', 'in', 'gte']) query[method] = () => query;
    query.then = (resolve, reject) => Promise.resolve({ data: [] }).then(resolve, reject);
    return query;
  } }));
});
const request = authorized => new Request('https://example.test/api/cron', { headers: authorized ? { authorization: 'Bearer test-only-cron-secret' } : {} });
describe('cron result reporting', () => {
  it('refuses unverified callers without running workers', async () => {
    expect((await GET(request(false))).status).toBe(401);
    expect(state.maintenance).not.toHaveBeenCalled();
    expect(state.svc).not.toHaveBeenCalled();
  });
  it('reports a successful quiet run accurately', async () => {
    const response = await GET(request(true));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, errors: [] });
  });
  it('makes partial worker failure observable to the scheduler', async () => {
    state.maintenance.mockResolvedValue({ errors: [{ job: 'signup_recovery', message: 'Retry required' }] });
    const response = await GET(request(true));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, errors: [{ job: 'signup_recovery' }] });
  });
  it('sanitizes unexpected failures without a false success', async () => {
    state.maintenance.mockRejectedValue(new Error('private connection details'));
    const response = await GET(request(true));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: expect.stringContaining('retry') });
  });
});
