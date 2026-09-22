import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rows: [], calls: [], projectError: null }));
vi.mock('@/utils/supabaseClient', () => ({ supabase: { from(table) {
  const call = { table, filters: [], cursor: null, limit: 500 };
  state.calls.push(call);
  const q = {
    select() { return q; }, eq(key, value) { call.filters.push([key, value]); return q; },
    in() { return q; }, order(key, options) { call.order = [key, options]; return q; },
    limit(n) { call.limit = n; return q; }, gt(key, value) { call.cursor = value; return q; },
    then(resolve) {
      const rows = table === 'projects' ? [{ id: 'project', name: 'Project' }] : state.rows
        .filter(row => !call.cursor || row.id > call.cursor).slice(0, call.limit);
      return Promise.resolve({ data: rows, error: table === 'projects' ? state.projectError : null }).then(resolve);
    },
  };
  return q;
} } }));
import { loadMyWork, bucketMyWork } from '@/utils/myWork';
beforeEach(() => { state.rows = []; state.calls = []; state.projectError = null; });
describe('personal work loading', () => {
  it('loads older active work beyond 500 newer completed tasks with stable keyset pages', async () => {
    state.rows = Array.from({ length: 1201 }, (_, i) => ({ id: String(i).padStart(5, '0'), status: i === 1200 ? 'pending' : 'completed', project_id: 'project' }));
    const tasks = await loadMyWork('org', 'owner', 'admin');
    expect(tasks).toHaveLength(1201);
    expect(bucketMyWork(tasks).total).toBe(1);
    const calls = state.calls.filter(call => call.table === 'developer_tasks');
    expect(calls).toHaveLength(3);
    for (const call of calls) expect(call.filters).toEqual([['organization_id', 'org'], ['assignee_admin_id', 'owner']]);
    expect(calls[1].cursor).toBe('00499');
    expect(state.calls.at(-1).filters).toContainEqual(['organization_id', 'org']);
  });
  it('keeps Developer/Employee filtering on their existing profile foreign key', async () => {
    await loadMyWork('org', 'employee', 'developer');
    expect(state.calls[0].filters).toContainEqual(['developer_id', 'employee']);
  });
  it('rejects missing and client identities and reports project lookup failures', async () => {
    await expect(loadMyWork('org', null, 'admin')).rejects.toThrow('session');
    await expect(loadMyWork('org', 'client', 'client')).rejects.toThrow('session');
    state.rows = [{ id: '1', project_id: 'project' }];
    state.projectError = { message: 'Unavailable' };
    await expect(loadMyWork('org', 'owner', 'admin')).rejects.toThrow('Unavailable');
  });
});
