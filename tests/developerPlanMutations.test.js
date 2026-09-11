import { describe, expect, it, vi } from 'vitest';
import { requireTaskMutation, taskPlanPayload } from '../src/utils/developerPlanMutations';

const id = '10000000-0000-0000-0000-000000000001';
describe('developer plan mutations', () => {
  it('retains a database task identity when saving a revised plan', () => {
    expect(taskPlanPayload({ id: 42, supabaseId: id, title: 'Retained', startDate: '2026-01-01', endDate: '2026-01-02' }))
      .toEqual({ id, task_title: 'Retained', task_description: '', start_date: '2026-01-01', end_date: '2026-01-02' });
    expect(taskPlanPayload({ id }).id).toBe(id);
  });
  it.each([42, 'temporary', null, '', '10000000-0000-0000-0000-000000000001-extra'])('omits temporary identity %s', temporary => {
    expect(taskPlanPayload({ id: temporary })).not.toHaveProperty('id');
  });
  it('confirms a successful mutation with its returned identity', async () => {
    const select = vi.fn().mockResolvedValue({ data: [{ id }], error: null });
    await expect(requireTaskMutation({ select }, id)).resolves.toBeUndefined();
    expect(select).toHaveBeenCalledWith('id');
  });
  it.each([null, [], [{ id: 'another' }], [{ id }, { id }]])('refuses unconfirmed writes %j', async data => {
    await expect(requireTaskMutation({ select: async () => ({ data }) }, id)).rejects.toThrow('Task was not changed');
  });
  it('propagates database failures without pretending the mutation succeeded', async () => {
    const error = new Error('Subscription locked');
    await expect(requireTaskMutation({ select: async () => ({ error }) }, id)).rejects.toBe(error);
  });
});
