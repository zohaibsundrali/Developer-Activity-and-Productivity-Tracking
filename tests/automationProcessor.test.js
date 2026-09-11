import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/utils/serverPermissions', () => ({ authCan: () => true }));
vi.mock('@/utils/permissionOverrides', () => ({ loadOverrides: async () => ({}) }));
vi.mock('@/utils/taskNotificationAccess', () => ({ canReceiveTaskNotification: () => true }));
vi.mock('@/utils/emailService', () => ({ sendTemplatedEmail: vi.fn(), emailMode: () => 'mock' }));
import { processActorAutomations } from '@/utils/automationProcessor';
const auth = { orgId: 'org', appUserId: 'actor', userType: 'developer', role: 'owner' };
let patches; let svc; let caller; let job; let claimed; let rpcError; let noticeError; let enabled;
function chain(table, isCaller) {
  let patch = null;
  const q = { eq: () => q, in: () => q, select: () => q, insert: () => { patch = 'notice'; return q; },
    update: value => { patch = value; return q; }, maybeSingle: () => q,
    then(resolve, reject) {
      if (isCaller) return Promise.resolve(table === 'notifications' ? { error: noticeError } : { data: { id: 'task', developer_id: 'recipient', organization_id: 'org', task_title: 'Task' } }).then(resolve, reject);
      if (table === 'automation_rules') return Promise.resolve({ data: { enabled } }).then(resolve, reject);
      if (table === 'memberships') return Promise.resolve({ data: { user_id: 'recipient', user_type: 'developer', role: 'developer', status: 'active', email: 'recipient@example.test' } }).then(resolve, reject);
      if (patch) { patches.push(patch); Object.assign(job, patch); return Promise.resolve({ data: [{ id: 'job' }] }).then(resolve, reject); }
      return Promise.resolve({ count: 0 }).then(resolve, reject);
    } };
  return q;
}
beforeEach(() => {
  patches = []; claimed = false; rpcError = null; noticeError = null; enabled = true;
  job = { id: 'job', lease: 'lease', rule_id: 'rule', next_action: 0, attempts: 1, task_id: 'task', actions: [{ type: 'set_priority', priority: 'high' }] };
  svc = { from: vi.fn(table => chain(table, false)), rpc: vi.fn(async () => {
    if (claimed) return { data: null };
    claimed = true; return { data: structuredClone(job) };
  }) };
  caller = { from: vi.fn(table => chain(table, true)), rpc: vi.fn(async () => rpcError ? { error: rpcError } : { data: { id: 'task', priority: 'high' } }) };
});
describe('actor-scoped server automation processor', () => {
  it('executes task writes only through caller JWT and checkpoints confirmed progress', async () => {
    const result = await processActorAutomations({ auth, svc, caller });
    expect(result.ran).toBe(1);
    expect(caller.rpc).toHaveBeenCalledWith('apply_actor_automation_action', { p_job: 'job', p_lease: 'lease' });
    expect(svc.rpc.mock.calls[0]).toEqual(['claim_actor_automation_job', { p_org: 'org', p_actor: 'actor', p_type: 'developer', p_retry: false }]);
    expect(patches.some(p => p.next_action === 1)).toBe(true);
    expect(patches.at(-1).status).toBe('completed');
  });
  it('persists permission failure without automatic retry or marking action complete', async () => {
    rpcError = { code: '42501', message: 'Permission revoked' };
    const result = await processActorAutomations({ auth, svc, caller });
    expect(result.errors[0].message).toBe('Permission revoked');
    expect(patches.at(-1)).toMatchObject({ status: 'failed', next_attempt_at: null });
    expect(patches.some(p => p.next_action)).toBe(false);
  });
  it('schedules transient failures with backoff', async () => {
    rpcError = { code: '503', message: 'Unavailable' };
    await processActorAutomations({ auth, svc, caller });
    expect(Date.parse(patches.at(-1).next_attempt_at)).toBeGreaterThan(Date.now());
  });
  it('treats an existing deduplicated notice as delivered', async () => {
    job.actions = [{ type: 'notify' }]; noticeError = { code: '23505' };
    expect((await processActorAutomations({ auth, svc, caller })).ran).toBe(1);
    expect(caller.from).toHaveBeenCalledWith('notifications');
  });
  it('quarantines uncertain external delivery rather than retrying an email', async () => {
    job.actions = [{ type: 'email' }];
    await processActorAutomations({ auth, svc, caller, getEmailMode: () => 'resend', sendEmail: async () => ({ delivered: false }) });
    expect(patches[0]).toMatchObject({ external_started: true });
    expect(patches.at(-1)).toMatchObject({ status: 'delivery_unknown', external_started: true, next_attempt_at: null });
  });
  it('keeps missing-provider work retryable only after deliberate recovery', async () => {
    job.actions = [{ type: 'email' }];
    await processActorAutomations({ auth, svc, caller, getEmailMode: () => 'mock' });
    expect(patches.at(-1)).toMatchObject({ status: 'failed', external_started: false, next_attempt_at: null });
  });
  it('cancels disabled rules before executing their snapshot', async () => {
    enabled = false;
    await processActorAutomations({ auth, svc, caller });
    expect(caller.rpc).not.toHaveBeenCalled();
    expect(patches.at(-1).status).toBe('cancelled');
  });
});
