import { expect, it, vi } from 'vitest';
vi.mock('@/utils/emailService', () => ({ sendTemplatedEmail: vi.fn(), emailMode: () => 'mock' }));
import { processUnattendedAutomations } from '@/utils/unattendedAutomations';
const actors = [
 { organization_id: 'org-a', actor_id: 'same-id', actor_type: 'admin', role: 'owner' },
 { organization_id: 'org-b', actor_id: 'same-id', actor_type: 'developer', role: 'developer' },
];
it('dispatches bounded actor jobs through fixed service RPC, never tokens or task table writes', async () => {
 const svc = { rpc: vi.fn().mockResolvedValue({ data: actors }) };
 const readOverrides = vi.fn().mockResolvedValue({ 'task.manage': false });
 const processActor = vi.fn(async ({ auth, executeStep, maxJobs, caller }) => {
  expect(caller).toBeUndefined(); expect(auth.token).toBeUndefined(); expect(maxJobs).toBe(2);
  expect(auth.overrides).toEqual({ 'task.manage': false });
  await executeStep({ id: 'job', lease: 'lease', actions: ['untrusted extra'] }, 'apply');
  return { ran: 1, errors: [] };
 });
 expect(await processUnattendedAutomations(svc, { processActor, readOverrides })).toEqual({ actors: 2, ran: 2, errors: [] });
 expect(svc.rpc).toHaveBeenCalledWith('pending_automation_actors', { p_limit: 25 });
 expect(svc.rpc).toHaveBeenCalledWith('run_unattended_automation_step', { p_job: 'job', p_lease: 'lease', p_operation: 'apply' });
 expect(processActor.mock.calls[1][0].auth).toMatchObject({ orgId: 'org-b', userType: 'developer' });
});
it('isolates actor failures and fails closed on unreadable overrides', async () => {
 const svc = { rpc: vi.fn().mockResolvedValue({ data: actors }) };
 const readOverrides = vi.fn().mockRejectedValueOnce(new Error('Overrides unavailable')).mockResolvedValue({});
 const processActor = vi.fn().mockResolvedValue({ ran: 2, errors: [] });
 const result = await processUnattendedAutomations(svc, { readOverrides, processActor });
 expect(processActor).toHaveBeenCalledTimes(1); expect(result.ran).toBe(2);
 expect(result.errors[0]).toMatchObject({ actorId: 'same-id', userType: 'admin', message: 'Overrides unavailable' });
});
it('reports a queue lookup outage instead of claiming successful empty work', async () => {
 const svc = { rpc: vi.fn().mockResolvedValue({ error: new Error('Queue unavailable') }) };
 await expect(processUnattendedAutomations(svc)).rejects.toThrow('Queue unavailable');
});
