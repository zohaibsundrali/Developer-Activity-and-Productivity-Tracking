import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rows: [], action: null, calls: [] }));
vi.mock('@/utils/orgContext', () => ({ getOrgId: () => 'org-1', getOrgContext: () => ({ userId: 'dev-1', userType: 'developer' }) }));
vi.mock('@/utils/systemEvents', () => ({ recordEvent: vi.fn() }));
vi.mock('@/utils/authFetch', () => ({ authFetch: vi.fn() }));
vi.mock('@/utils/notifications', () => ({ notify: vi.fn(), windowedDedupeKey: () => 'key' }));
vi.mock('@/utils/supabaseClient', () => ({ supabase: { from(table) {
  const call = { table, op: 'select', filters: [] }; state.calls.push(call);
  const query = {
    select() { return query; },
    update(payload) { call.op = 'update'; call.payload = payload; return query; },
    insert() { call.op = 'insert'; return query; },
    eq(key, value) { call.filters.push([key, value]); return query; },
    then(resolve, reject) {
      const data = table === 'automation_rules'
        ? [{ name: 'Test rule', enabled: true, trigger: { event: 'task_created' }, actions: [state.action] }]
        : table === 'developer_tasks' ? state.rows : [];
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    },
  }; return query;
} } }));
import { runAutomations } from '@/utils/automation';
const actions = [
  { type: 'assign', userId: 'dev-2' },
  { type: 'set_status', status: 'in_progress' },
  { type: 'set_priority', priority: 'high' },
  { type: 'add_label', label: 'urgent' },
];
beforeEach(() => { state.rows = []; state.calls = []; });
const run = () => runAutomations({ event: 'task_created', task: { id: 'task-1', status: 'pending', project_id: 'project-1', labels: [] } });
describe('automation write confirmation', () => {
  it.each(actions)('reports denied $type as a failure rather than a successful mutation', async action => {
    state.action = action;
    const result = await run();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].action).toBe(action.type);
    expect(state.calls.find(c => c.op === 'update').filters).toContainEqual(['organization_id', 'org-1']);
  });
  it.each(actions)('retains confirmed $type execution', async action => {
    state.action = action; state.rows = [{ id: 'task-1' }];
    const result = await run();
    expect(result.ran).toBe(1);
    expect(result.errors).toEqual([]);
  });
});
