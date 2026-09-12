import { expect, it, vi } from 'vitest';
import { recurringOccurrence, spawnRecurringTasks } from '@/utils/recurringTasks';
const task = (changes = {}) => ({ id: 'template', organization_id: 'org', due_date: '2024-01-31', recurrence: { freq: 'monthly', interval: 1 }, ...changes });
it('preserves monthly overflow across leap and non-leap February', () => {
  expect(recurringOccurrence(task())).toEqual({ anchor: '2024-01-31', next: '2024-03-02' });
  expect(recurringOccurrence(task({ due_date: '2025-01-31' })).next).toBe('2025-03-03');
});
it('anchors later runs on the cursor and uses UTC calendar dates', () => {
  expect(recurringOccurrence(task({ recurrence: { freq: 'weekly', interval: 2, last_spawned: '2024-03-01' } })).next).toBe('2024-03-15');
});
it.each([0, -1, 1.5, null, 'Infinity', 3651, {}, true])('refuses invalid intervals %s', interval => {
  expect(() => recurringOccurrence(task({ recurrence: { freq: 'daily', interval } }))).toThrow();
});
it.each(['2024-02-31', 'bad', '2024-01-01T00:00:00Z'])('refuses invalid date %s', due_date => {
  expect(() => recurringOccurrence(task({ due_date }))).toThrow();
});
it('passes only the exact snapshot to the atomic RPC, never a child insert', async () => {
  const svc = { rpc: vi.fn().mockResolvedValue({ data: { spawned: true } }) };
  const original = task();
  expect(await spawnRecurringTasks(svc, [original], '2024-03-02', async () => true)).toEqual({ spawned: 1, errors: [] });
  expect(svc.rpc).toHaveBeenCalledWith('spawn_recurring_task', { p_template: 'template', p_expected_recurrence: original.recurrence, p_expected_anchor: '2024-01-31', p_expected_next: '2024-03-02' });
  expect(original.recurrence.last_spawned).toBeUndefined();
});
it('does not count a competing worker or changed template as another spawn', async () => {
  const svc = { rpc: vi.fn().mockResolvedValue({ data: { spawned: false, reason: 'template_changed' } }) };
  expect(await spawnRecurringTasks(svc, [task()], '2024-03-02', async () => true)).toEqual({ spawned: 0, errors: [] });
});
it('continues other templates after transaction failure without direct fallback writes', async () => {
  const svc = { rpc: vi.fn().mockResolvedValueOnce({ error: { message: 'quota unavailable' } }).mockResolvedValueOnce({ data: { spawned: true } }) };
  const result = await spawnRecurringTasks(svc, [task(), task({ id: 'other' })], '2024-03-02', async () => true);
  expect(result.spawned).toBe(1);
  expect(result.errors).toEqual([{ job: 'recurring', taskId: 'template', message: 'quota unavailable' }]);
  expect(svc.rpc).toHaveBeenCalledTimes(2);
});
it('skips future and disallowed templates', async () => {
  const svc = { rpc: vi.fn() };
  await spawnRecurringTasks(svc, [task()], '2024-03-01', async () => true);
  await spawnRecurringTasks(svc, [task()], '2024-03-02', async () => false);
  expect(svc.rpc).not.toHaveBeenCalled();
});
it('reports missing confirmation rather than claiming success', async () => {
  const svc = { rpc: vi.fn().mockResolvedValue({ data: null }) };
  const result = await spawnRecurringTasks(svc, [task()], '2024-03-02', async () => true);
  expect(result.spawned).toBe(0);
  expect(result.errors).toHaveLength(1);
});
