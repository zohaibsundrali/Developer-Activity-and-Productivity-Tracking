import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ ctx: null, fetch: vi.fn() }));
vi.mock('@/utils/orgContext', () => ({ getOrgContext: () => state.ctx }));
vi.mock('@/utils/authFetch', () => ({ authFetch: state.fetch }));
beforeEach(() => { vi.resetModules(); state.ctx = { organizationId: 'org', userId: 'actor', userType: 'developer' }; state.fetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ ran: 1, errors: [], pending: 0 }) }); });
it('deduplicates concurrent wakeups and throttles repeated session polling', async () => {
  const { processPendingAutomations } = await import('@/utils/automationDispatch');
  await Promise.all([processPendingAutomations(), processPendingAutomations()]);
  await processPendingAutomations();
  expect(state.fetch).toHaveBeenCalledTimes(1);
  await processPendingAutomations({ force: true });
  expect(state.fetch).toHaveBeenCalledTimes(2);
});
it('separates colliding typed identities and does not dispatch clients', async () => {
  const { processPendingAutomations } = await import('@/utils/automationDispatch');
  await processPendingAutomations();
  state.ctx.userType = 'admin'; await processPendingAutomations();
  state.ctx.userType = 'client'; await processPendingAutomations();
  expect(state.fetch).toHaveBeenCalledTimes(2);
});
it('leaves failure recovery to persisted server queue without throwing into task mutation', async () => {
  const { processPendingAutomations } = await import('@/utils/automationDispatch');
  state.fetch.mockRejectedValue(new Error('Offline'));
  expect((await processPendingAutomations()).errors[0].message).toBe('Offline');
});
