import { beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
const state = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/utils/supabaseClient', () => ({ supabase: state }));
vi.mock('@/utils/orgContext', () => ({ getOrgId: () => 'org', getOrgContext: () => ({ userId: 'actor' }) }));
vi.mock('@/utils/authFetch', () => ({ authFetch: vi.fn() }));
vi.mock('@/utils/notifications', () => ({ notify: vi.fn(), windowedDedupeKey: vi.fn() }));
import { cloneProject } from '@/utils/pmData';
import { projectCloneFields } from '@/utils/projectCloneFields';
beforeEach(() => { vi.clearAllMocks(); state.rpc.mockResolvedValue({ data: { project: { id: 'clone', name: 'Clone' } } }); state.from.mockReturnValue({ insert: async () => ({ error: null }) }); });
it('clones through one authenticated transaction without browser row copies or compensation deletes', async () => {
 expect(await cloneProject('source', 'Clone')).toEqual({ project: { id: 'clone', name: 'Clone' }, error: null });
 expect(state.rpc).toHaveBeenCalledExactlyOnceWith('clone_project', { p_source: 'source', p_name: 'Clone', p_copy_tasks: true });
 expect(state.from).toHaveBeenCalledExactlyOnceWith('pm_activity');
});
it('preserves the no-task clone option and server fallback name', async () => {
 await cloneProject('source', '', { copyTasks: false });
 expect(state.rpc).toHaveBeenCalledExactlyOnceWith('clone_project', { p_source: 'source', p_name: null, p_copy_tasks: false });
});
it('returns failed transaction without reporting success or appending activity', async () => {
 const error = { message: 'PLAN_LIMIT_REACHED: tasks' }; state.rpc.mockResolvedValue({ error });
 expect(await cloneProject('source', 'Clone')).toEqual({ error }); expect(state.from).not.toHaveBeenCalled();
});
it('does not claim a clone succeeded without a confirmed returned project', async () => {
 state.rpc.mockResolvedValue({ data: null });
 expect((await cloneProject('source', 'Clone')).error.message).toContain('Could not confirm'); expect(state.from).not.toHaveBeenCalled();
});
it('keeps a committed clone successful even when activity logging throws', async () => {
 state.from.mockImplementation(() => { throw new Error('Feed unavailable'); });
 expect((await cloneProject('source', 'Clone')).project.id).toBe('clone');
});
it('keeps SQL clone exclusions aligned with established clone lifecycle semantics', () => {
 const sql = fs.readFileSync('supabase/migrations/20260911111253_production_project_clone_transaction.sql', 'utf8');
 const block = sql.match(/payload:=to_jsonb\(source_project\)-array\[([\s\S]*?)\];/)[1];
 const excluded = [...block.matchAll(/'([^']+)'/g)].map(m => m[1]);
 const source = Object.fromEntries(excluded.map(k => [k, 'old history']));
 expect(projectCloneFields({ ...source, description: 'Keep', created_by: 'creator' })).toEqual({ description: 'Keep', created_by: 'creator' });
});
