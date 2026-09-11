import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ process: vi.fn(), from: vi.fn() }));
vi.mock('@/utils/automationDispatch', () => ({ processPendingAutomations: mocks.process }));
vi.mock('@/utils/supabaseClient', () => ({ supabase: { from: mocks.from } }));
vi.mock('@/utils/orgContext', () => ({ getOrgId: () => 'org', getOrgContext: () => ({}) }));
import { runAutomations } from '@/utils/automation';
beforeEach(() => vi.clearAllMocks());
describe('durable automation dispatch', () => {
  it('wakes server processing without executing client supplied event snapshots', async () => {
    mocks.process.mockResolvedValue({ ran: 1, errors: [], pending: 0 });
    expect(await runAutomations({ event: 'task_created', task: { id: 'forged', organization_id: 'other' } })).toEqual({ ran: 1, errors: [], pending: 0 });
    expect(mocks.process).toHaveBeenCalledWith({ force: true });
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('preserves actionable failed-action results from durable processing', async () => {
    const result = { ran: 0, errors: [{ jobId: 'job', action: 'assign', message: 'Permission revoked' }], pending: 0 };
    mocks.process.mockResolvedValue(result);
    expect(await runAutomations()).toEqual(result);
  });
});
