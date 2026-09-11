import { describe, it, expect, vi } from 'vitest';
import { runBackgroundMaintenance } from '../src/utils/backgroundMaintenance';

describe('background maintenance isolation', () => {
  it('continues independent queues and reports failure and retry states', async () => {
    const svc = {};
    const deletion = vi.fn().mockResolvedValue({ processed: true, retry: true });
    const automation = vi.fn().mockRejectedValue(new Error('private provider detail'));
    const retention = vi.fn().mockResolvedValue({ organizations: 1, errors: [] });
    const result = await runBackgroundMaintenance(svc, { deletion, automation, retention });
    expect(result.errors.map(error => error.job)).toEqual(['organization_cleanup', 'actor_automation']);
    expect(JSON.stringify(result)).not.toContain('private provider detail');
    expect(retention).toHaveBeenCalledWith(svc, expect.objectContaining({ maxOrganizations: 2 }));
    expect(result.tracking_retention.organizations).toBe(1);
  });
  it('reports individual worker failures to cron monitoring', async () => {
    const result = await runBackgroundMaintenance({}, {
      deletion: async () => ({ processed: false }),
      automation: async () => ({ errors: [{ message: 'Actor revoked' }] }),
      retention: async () => ({ errors: [{ message: 'Storage retry' }] }),
    });
    expect(result.errors).toEqual([
      { message: 'Actor revoked', job: 'actor_automation' },
      { message: 'Storage retry', job: 'tracking_retention' },
    ]);
  });
});
