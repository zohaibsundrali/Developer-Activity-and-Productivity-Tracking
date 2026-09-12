import { describe, it, expect, vi } from 'vitest';
import { runBackgroundMaintenance } from '../src/utils/backgroundMaintenance';

describe('background maintenance isolation', () => {
  it('continues independent queues and reports failure and retry states', async () => {
    const svc = {};
    const deletion = vi.fn().mockResolvedValue({ processed: true, retry: true });
    const automation = vi.fn().mockRejectedValue(new Error('private provider detail'));
    const retention = vi.fn().mockResolvedValue({ organizations: 1, errors: [] });
    const signup = vi.fn().mockResolvedValue({ completed: 1, errors: [] });
    const result = await runBackgroundMaintenance(svc, { deletion, automation, retention, signup, provisioning: async () => ({ errors: [] }) });
    expect(result.errors.map(error => error.job)).toEqual(['organization_cleanup', 'actor_automation']);
    expect(JSON.stringify(result)).not.toContain('private provider detail');
    expect(retention).toHaveBeenCalledWith(svc, expect.objectContaining({ maxOrganizations: 2 }));
    expect(result.tracking_retention.organizations).toBe(1);
    expect(signup).toHaveBeenCalledWith(svc, { limit: 10 });
    expect(result.signup_recovery.completed).toBe(1);
  });
  it('reports individual worker failures to cron monitoring', async () => {
    const result = await runBackgroundMaintenance({}, {
      provisioning: async () => ({ errors: [] }),
      signup: async () => ({ completed: 0, errors: [] }),
      deletion: async () => ({ processed: false }),
      automation: async () => ({ errors: [{ message: 'Actor revoked' }] }),
      retention: async () => ({ errors: [{ message: 'Storage retry' }] }),
    });
    expect(result.errors).toEqual([
      { message: 'Actor revoked', job: 'actor_automation' },
      { message: 'Storage retry', job: 'tracking_retention' },
    ]);
  });
  it('continues existing queues when signup finalization is unavailable', async () => {
    const deletion = vi.fn().mockResolvedValue({ processed: false });
    const result = await runBackgroundMaintenance({}, {
      provisioning: async () => ({ errors: [] }),
      signup: async () => { throw new Error('private Auth details'); },
      deletion, automation: async () => ({}), retention: async () => ({}),
    });
    expect(deletion).toHaveBeenCalledOnce();
    expect(result.errors).toEqual([{ job: 'signup_recovery', message: 'Background worker unavailable; durable work remains queued.' }]);
  });
});
