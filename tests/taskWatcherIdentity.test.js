import { beforeEach, expect, it, vi } from 'vitest';
const s = vi.hoisted(() => ({ calls: [], data: { id: 'row' }, error: null }));
vi.mock('@/utils/orgContext', () => ({ getOrgId: () => 'org', getOrgContext: () => ({}) }));
vi.mock('@/utils/notifications', () => ({ notify: vi.fn(), windowedDedupeKey: vi.fn() }));
vi.mock('@/utils/automation', () => ({ runAutomations: vi.fn() }));
vi.mock('@/utils/authFetch', () => ({ authFetch: vi.fn() }));
vi.mock('@/utils/supabaseClient', () => ({ supabase: { from: () => { const q = {
  upsert: (row, options) => { s.calls.push(['upsert', row, options]); return q; },
  delete: () => q, eq: (key, value) => { s.calls.push([key, value]); return q; },
  select: () => q, maybeSingle: async () => ({ data: s.data, error: s.error }),
}; return q; } } }));
import { toggleWatcher } from '@/utils/pmData';
beforeEach(() => { s.calls = []; s.data = { id: 'row' }; s.error = null; });
it('upserts on the full typed watcher identity', async () => {
  expect((await toggleWatcher('task', 'same-id', 'admin', 'reviewer')).error).toBeNull();
  expect(s.calls[0][2]).toEqual({ onConflict: 'task_id,user_type,user_id,role' });
});
it('never deletes a developer watcher while unwatching a colliding admin profile', async () => {
  expect((await toggleWatcher('task', 'same-id', 'admin', 'watcher', false)).error).toBeNull();
  expect(s.calls).toEqual([['organization_id', 'org'], ['task_id', 'task'], ['user_id', 'same-id'], ['user_type', 'admin'], ['role', 'watcher']]);
});
it.each([true, false])('reports a zero-row watcher mutation (insert=%s)', async on => {
  s.data = null; expect((await toggleWatcher('task', 'person', 'developer', 'watcher', on)).error).toBeInstanceOf(Error);
});
it('preserves a database refusal', async () => { s.error = { message: 'Reviewer no longer eligible' }; expect((await toggleWatcher('task', 'person', 'developer', 'reviewer')).error).toBe(s.error); });
it('refuses missing typed identity before a write', async () => { expect((await toggleWatcher('task', 'person', null)).error).toBeInstanceOf(Error); expect(s.calls).toEqual([]); });
