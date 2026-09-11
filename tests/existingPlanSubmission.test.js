import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ auth: null, rpc: vi.fn(), notice: vi.fn(), blocked: null }));
vi.mock('@/utils/serverAuth', () => ({ getAuthedOrg: async () => state.auth, serviceClient: () => ({ rpc: state.rpc }) }));
vi.mock('@/utils/entitlements', () => ({ requireUnlocked: async () => state.blocked }));
vi.mock('@/utils/taskPlanNotifications', () => ({ notifyTaskPlanReviewers: state.notice }));
import { POST } from '../src/app/api/task-plan/submit/route';
const projectId = '10000000-0000-0000-0000-000000000001';
const call = (body = { projectId }) => POST(new Request('http://localhost/api/task-plan/submit', { method: 'POST', body: JSON.stringify(body) }));
beforeEach(() => { state.auth = { orgId: 'org', appUserId: 'actor', userType: 'developer', role: 'developer', overrides: {} }; state.blocked = null;
 state.rpc.mockReset().mockResolvedValue({ data: { success: true, project: { id: projectId } } }); state.notice.mockReset().mockResolvedValue({ notified: 1 }); });
it('submits existing tasks with trusted developer identity and one RPC', async () => {
 expect((await call({ projectId, developerId: 'forged', tasks: [{ title: 'replace' }] })).status).toBe(200);
 expect(state.rpc).toHaveBeenCalledExactlyOnceWith('submit_existing_task_plan', { p_org: 'org', p_project: projectId, p_developer: 'actor' });
});
it.each(['admin','client'])('denies colliding %s identity even with own-update permission', async type => {
 state.auth.userType = type; state.auth.overrides = { 'task.update_own': true };
 expect((await call()).status).toBe(403); expect(state.rpc).not.toHaveBeenCalled();
});
it('honors explicit permission denial', async () => { state.auth.overrides = { 'task.update_own': false }; expect((await call()).status).toBe(403); expect(state.rpc).not.toHaveBeenCalled(); });
it('requires authentication and valid project ID', async () => { expect((await call({ projectId: 'bad' })).status).toBe(400); state.auth = null; expect((await call()).status).toBe(401); expect(state.rpc).not.toHaveBeenCalled(); });
it.each([['42501','PLAN_FORBIDDEN: detail',403],['P0002','PLAN_NOT_FOUND: detail',404],['22023','PLAN_INVALID: detail',400],['P0001','PLAN_CONFLICT: detail',409],['P0001','BILLING_LOCKED: detail',402],['XX000','secret database detail',503]])('sanitizes %s %s', async (code,message,status) => {
 state.rpc.mockResolvedValue({ error: { code,message } }); const res = await call(); expect(res.status).toBe(status); expect((await res.json()).error).not.toContain('detail'); expect(state.notice).not.toHaveBeenCalled();
});
it('preserves committed success on notification failure', async () => { state.notice.mockRejectedValue(new Error('secret')); const res = await call(); expect(res.status).toBe(200); expect(await res.json()).toMatchObject({ success: true, notificationWarning: expect.any(String) }); });
it('does not claim success for an empty transaction response', async () => { state.rpc.mockResolvedValue({ data: null }); expect((await call()).status).toBe(503); });
