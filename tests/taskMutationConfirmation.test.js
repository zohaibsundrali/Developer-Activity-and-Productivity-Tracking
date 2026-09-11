import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ orgId: 'org-1', updatedRows: [], error: null, calls: [], automated: vi.fn(), notified: vi.fn() }));
vi.mock('@/utils/orgContext', () => ({ getOrgId: () => state.orgId, getOrgContext: () => ({ userId: 'dev-1', userType: 'developer' }) }));
vi.mock('@/utils/notifications', () => ({ notify: state.notified, windowedDedupeKey: () => 'key' }));
vi.mock('@/utils/automation', () => ({ runAutomations: state.automated }));
vi.mock('@/utils/authFetch', () => ({ authFetch: vi.fn() }));
vi.mock('@/utils/supabaseClient', () => ({ supabase: { from(table) {
  const call = { table, op: 'select', filters: [] }; state.calls.push(call);
  const query = {
    select() { return query; },
    update(payload) { call.op = 'update'; call.payload = payload; return query; },
    insert(payload) { call.op = 'insert'; call.payload = payload; return query; },
    eq(key, value) { call.filters.push([key, value]); return query; },
    single() { return query; },
    then(resolve, reject) {
      const response = table === 'developer_tasks' && call.op === 'update'
        ? { data: state.updatedRows, error: state.error }
        : { data: { id: 'task-1', status: 'pending', developer_id: 'dev-1', project_id: 'project-1' }, error: null };
      return Promise.resolve(response).then(resolve, reject);
    },
  }; return query;
} } }));
import { updateTask, changeTaskStatus, assignTask } from '@/utils/pmData';
beforeEach(() => { state.orgId = 'org-1'; state.updatedRows = []; state.error = null; state.calls = []; vi.clearAllMocks(); });
describe('task mutation confirmation', () => {
  it('does not log a successful edit when RLS returns no affected row', async () => {
    const result = await updateTask('task-1', { priority: 'high' }, { projectId: 'project-1' });
    expect(result.error).toBeInstanceOf(Error);
    expect(state.calls.filter(c => c.op === 'insert')).toHaveLength(0);
  });
  it('does not announce or automate a denied status change', async () => {
    const result = await changeTaskStatus('task-1', 'in_progress');
    expect(result.error).toBeInstanceOf(Error);
    expect(state.notified).not.toHaveBeenCalled();
    expect(state.automated).not.toHaveBeenCalled();
  });
  it('does not announce a denied reassignment', async () => {
    const result = await assignTask('task-1', 'dev-2');
    expect(result.error).toBeInstanceOf(Error);
    expect(state.calls.filter(c => c.table === 'notifications')).toHaveLength(0);
    expect(state.notified).not.toHaveBeenCalled();
    expect(state.automated).not.toHaveBeenCalled();
  });
  it('does not duplicate database assignment notices in the browser', async () => {
    state.updatedRows = [{ id: 'task-1' }];
    const result = await assignTask('task-1', 'dev-1');
    expect(result.error).toBeNull();
    expect(state.notified).not.toHaveBeenCalled();
    expect(state.calls.filter(call => call.table === 'notifications')).toHaveLength(0);
    expect(state.automated).toHaveBeenCalledOnce();
    expect(state.calls.filter(call => call.table === 'developer_tasks' && call.op === 'select')).toHaveLength(1);
  });
  it('does not automate a different assignee returned after a concurrent change', async () => {
    state.updatedRows = [{ id: 'task-1' }];
    expect((await assignTask('task-1', 'dev-2')).error).toBeNull();
    expect(state.automated).not.toHaveBeenCalled();
  });
  it('leaves unassignment delivery to the database transaction', async () => {
    state.updatedRows = [{ id: 'task-1' }];
    expect((await assignTask('task-1', null)).error).toBeNull();
    expect(state.calls).toHaveLength(1);
    expect(state.notified).not.toHaveBeenCalled();
  });
  it('retains successful status notifications and automation after confirmation', async () => {
    state.updatedRows = [{ id: 'task-1' }];
    expect((await changeTaskStatus('task-1', 'in_progress')).error).toBeNull();
    expect(state.notified).toHaveBeenCalledOnce();
    expect(state.automated).toHaveBeenCalledOnce();
    expect(state.calls.find(c => c.op === 'update').filters).toContainEqual(['organization_id', 'org-1']);
  });
  it('surfaces a database error without side effects', async () => {
    state.error = { message: 'Permission denied', code: '42501' };
    expect((await updateTask('task-1', { status: 'in_progress' })).error).toBe(state.error);
    expect(state.calls.filter(c => c.op === 'insert')).toHaveLength(0);
  });
  it('refuses mutation before writing without a verified organization', async () => {
    state.orgId = null;
    expect((await updateTask('task-1', { priority: 'high' })).error).toBeInstanceOf(Error);
    expect(state.calls).toHaveLength(0);
  });
});
