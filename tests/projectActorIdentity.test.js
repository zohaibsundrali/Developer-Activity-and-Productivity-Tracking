import { describe, expect, it, vi } from 'vitest';
import { projectActorIsOwner, projectActorCanReview, isOwnDeveloperWork, projectManagerMatches } from '@/utils/projectActorIdentity';
const auth = { orgId: 'org', appUserId: 'same', userType: 'admin' };
describe('typed project identities', () => {
  it('binds review authority to the verified profile and requested legacy mode', async () => {
    const svc = { rpc: vi.fn(async () => ({ data: true })) };
    expect(await projectActorIsOwner(svc, auth, 'project', { allowLegacy: true })).toBe(true);
    expect(svc.rpc).toHaveBeenCalledWith('project_actor_is_owner', { p_org: 'org', p_project: 'project', p_user: 'same', p_type: 'admin', p_allow_legacy: true });
  });
  it('fails closed on unavailable ownership', async () => {
    await expect(projectActorIsOwner({ rpc: async () => ({ error: {} }) }, auth, 'project')).rejects.toThrow();
    expect(await projectActorIsOwner({ rpc: async () => ({ data: null }) }, auth, 'project')).toBe(false);
  });
  it('only developer profiles can be the author of developer work', () => {
    expect(isOwnDeveloperWork(auth, 'same')).toBe(false);
    expect(isOwnDeveloperWork({ ...auth, userType: 'developer' }, 'other', 'same')).toBe(true);
  });
  it('delegates typed and historical manager authority to the same SQL predicate', async () => {
    const svc = { rpc: vi.fn(async () => ({ data: true })) };
    expect(await projectManagerMatches(svc, auth, { id: 'project' })).toBe(true);
    expect(svc.rpc).toHaveBeenCalledWith('project_actor_is_manager', { p_org: 'org', p_project: 'project', p_user: 'same', p_type: 'admin' });
    svc.rpc.mockResolvedValue({ data: false });
    expect(await projectManagerMatches(svc, auth, { id: 'project' })).toBe(false);
    svc.rpc.mockResolvedValue({ error: {} });
    await expect(projectManagerMatches(svc, auth, { id: 'project' })).rejects.toThrow();
  });
});

it('keeps review delegation separate from strict project ownership', async () => {
 const svc = { rpc: vi.fn(async name => ({ data: name === 'project_actor_can_review' })) };
 expect(await projectActorIsOwner(svc, auth, 'project')).toBe(false);
 expect(await projectActorCanReview(svc, auth, 'project', { allowLegacy: true })).toBe(true);
 expect(svc.rpc).toHaveBeenLastCalledWith('project_actor_can_review', { p_org:'org',p_project:'project',p_user:'same',p_type:'admin',p_allow_legacy:true });
 svc.rpc.mockResolvedValue({error:{}});await expect(projectActorCanReview(svc,auth,'project')).rejects.toThrow();
});
