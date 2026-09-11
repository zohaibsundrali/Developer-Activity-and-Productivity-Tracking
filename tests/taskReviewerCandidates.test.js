import { beforeEach, describe, expect, it, vi } from 'vitest';
const s = vi.hoisted(() => ({ auth: null, task: null, eligible: {}, calls: [], error: null }));
vi.mock('@/utils/serverAuth', () => ({
  getAuthedOrg: async () => s.auth,
  orgScopedClient: token => ({ from: () => { s.calls.push(['caller', token]); const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: s.task }) }; return q; } }),
  serviceClient: () => ({
    rpc: async (name, args) => { s.calls.push([name, args]); return { data: s.eligible[args.p_type], error: s.error }; },
    from: table => { s.calls.push(['service', table]); const q = {
      select: () => q, eq: () => q, in: (key, values) => { s.calls.push(['filter',key,values]); return q; },
      maybeSingle: async () => ({ data: table === 'projects' ? s.project : { name: 'Developer', full_name: 'Admin' } }),
      then: resolve => Promise.resolve({ data: [{ user_id: 'shared', user_type: 'admin' }, { user_id: 'shared', user_type: 'developer' }] }).then(resolve),
    }; return q; },
  }),
}));
import { GET } from '@/app/api/tasks/[id]/reviewers/route';
const id = '11111111-1111-1111-1111-111111111111';
const get = () => GET(new Request('https://app.test'), { params: Promise.resolve({ id }) });
beforeEach(() => { s.auth = { orgId: 'org', token: 'jwt', role: 'manager', userType: 'developer', overrides: {} }; s.task = { id, project_id: 'project' }; s.project = { created_by:'shared',added_by:'shared' }; s.eligible = { admin: false, developer: true }; s.calls = []; s.error = null; });
describe('reviewer candidates follow database review authority', () => {
  it('returns only eligible typed profiles, never a fictitious reviewer role', async () => {
    const response = await get(); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reviewers: [{ userId: 'shared', userType: 'developer', name: 'Developer' }] });
    expect(s.calls[0]).toEqual(['caller', 'jwt']);
    expect(s.calls.filter(c => c[0] === 'task_watcher_reviewer_eligible').map(c => c[1])).toEqual([
      { p_org: 'org', p_task: id, p_user: 'shared', p_type: 'admin' },
      { p_org: 'org', p_task: id, p_user: 'shared', p_type: 'developer' },
    ]);
  });
  it('does not use privileged candidate lookup for an unreadable task', async () => { s.task = null; expect((await get()).status).toBe(404); expect(s.calls).toEqual([['caller', 'jwt']]); });
  it('honors both effective permission denies', async () => { s.auth.overrides = { 'task.manage': false, 'task.review': false }; expect((await get()).status).toBe(403); expect(s.calls).toEqual([]); });
  it('accepts a review-only explicit grant', async () => { s.auth.role = 'developer'; s.auth.overrides = { 'task.review': true }; expect((await get()).status).toBe(200); });
  it('denies client profiles despite an owner role', async () => { s.auth.userType = 'client'; s.auth.role = 'owner'; expect((await get()).status).toBe(403); expect(s.calls).toEqual([]); });
  it('reports unavailable eligibility instead of presenting a partial list', async () => { s.error = { message: 'missing RPC' }; expect((await get()).status).toBe(503); });
  it('reports an honest empty list when no typed creator can review', async () => { s.eligible = {}; expect(await (await get()).json()).toEqual({ reviewers: [] }); });
  it('fails closed when permission overrides cannot load', async () => { s.auth.overridesUnavailable = true; expect((await get()).status).toBe(503); expect(s.calls).toEqual([]); });
});

it('includes an assigned manager even when the project has no creator candidate', async () => {
 s.project={manager_id:'shared',manager_type:'developer'};
 const response=await get();expect(response.status).toBe(200);
 expect(await response.json()).toEqual({reviewers:[{userId:'shared',userType:'developer',name:'Developer'}]});
 expect(s.calls).toContainEqual(['filter','user_id',['shared']]);
 expect(s.calls.some(c=>c[0]==='task_watcher_reviewer_eligible'&&c[1].p_type==='developer')).toBe(true);
});
