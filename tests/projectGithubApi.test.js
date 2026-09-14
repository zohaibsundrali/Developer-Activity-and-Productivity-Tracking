import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ auth: null, contexts: [], result: null, rpc: vi.fn(), readRepo: vi.fn(), activity: vi.fn() }));
vi.mock('@/utils/serverAuth', () => ({ getAuthedOrg: async () => h.auth, orgScopedClient: token => ({ rpc: async (name, args) => { h.rpc(token, name, args); return name === 'project_github_context' ? h.contexts.shift() : h.result; } }) }));
vi.mock('@/utils/githubProvider', async () => ({ ...(await vi.importActual('@/utils/githubProvider')), readGithubRepository: h.readRepo, readGithubActivity: h.activity }));
const { GET, POST } = await import('@/app/api/projects/[id]/github/route');
const id = '99100000-0000-0000-0000-000000000011', org = '99100000-0000-0000-0000-000000000001';
const link = version => ({ project_id: id, organization_id: org, version, repository_id: 123, owner: 'octocat', repository: 'Hello-World' });
const context = (version = 1, manage = true) => ({ data: { project_id: id, organization_id: org, link: link(version), can_manage: manage }, error: null });
const get = () => GET(new Request('https://app.test/api/projects/' + id + '/github'), { params: Promise.resolve({ id }) });
const post = body => POST(new Request('https://app.test/api/projects/' + id + '/github', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
beforeEach(() => { h.auth = { token: 'caller-token', orgId: org, userType: 'admin', overridesLoaded: true }; h.contexts = [context(), context()]; h.result = { data: link(2), error: null }; h.rpc.mockClear(); h.readRepo.mockReset(); h.readRepo.mockResolvedValue({ repository_id: 123, owner: 'octocat', repository: 'Hello-World' }); h.activity.mockReset(); h.activity.mockResolvedValue({ items: [], nextPage: null }); });
it('uses caller permissions for context and never asks GitHub before access is resolved', async () => {
  expect((await get()).status).toBe(200); expect(h.rpc).toHaveBeenCalledWith('caller-token', 'project_github_context', { p_project: id }); expect(h.readRepo).not.toHaveBeenCalled();
  h.contexts = [{ error: { code: '42501' } }]; expect((await post({ action: 'activity', version: 1 })).status).toBe(403); expect(h.activity).not.toHaveBeenCalled();
});
it('refuses unauthenticated and client contexts', async () => {
  h.auth = null; expect((await get()).status).toBe(401); h.auth = { userType: 'client' }; expect((await get()).status).toBe(403); expect(h.rpc).not.toHaveBeenCalled();
});
it('rechecks project access after the external request', async () => {
  h.contexts = [context(), { error: { code: '42501' } }]; const response = await post({ action: 'activity', version: 1, githubToken: 'private-token' });
  expect(response.status).toBe(403); expect(await response.text()).not.toContain('private-token');
});
it('refuses changed repository versions before and after activity loading', async () => {
  expect((await post({ action: 'activity', version: 0 })).status).toBe(409); expect(h.activity).not.toHaveBeenCalled();
  h.contexts = [context(), context(2)]; expect((await post({ action: 'activity', version: 1 })).status).toBe(409);
});
it('requires management authority before verifying a new repository', async () => {
  h.contexts = [context(1, false)]; expect((await post({ action: 'link', version: 1, repository: 'octocat/Hello-World' })).status).toBe(403); expect(h.readRepo).not.toHaveBeenCalled();
});
it('stores only verified repository identity and never persists GitHub tokens', async () => {
  h.contexts = [context(), context(2)]; const response = await post({ action: 'link', version: 1, repository: 'octocat/Hello-World', githubToken: 'github_pat_example' });
  expect(response.status).toBe(200); const mutation = h.rpc.mock.calls.find(call => call[1] === 'save_project_github');
  expect(mutation[2]).toEqual({ p_project: id, p_version: 1, p_repository_id: 123, p_owner: 'octocat', p_repository: 'Hello-World' });
  expect(await response.text()).not.toContain('github_pat_example');
});
it('rejects forged context and mutation receipts', async () => {
  h.contexts = [{ data: { ...context().data, organization_id: 'foreign' } }]; expect((await get()).status).toBe(503);
  h.contexts = [context()]; h.result.data.repository_id = 456; expect((await post({ action: 'link', version: 1, repository: 'octocat/Hello-World' })).status).toBe(503);
});
it('disconnects without contacting GitHub', async () => {
  const disconnected = { ...link(2), repository_id: null, owner: null, repository: null };
  h.result.data = disconnected; h.contexts = [context(), { data: { ...context().data, link: disconnected } }];
  expect((await post({ action: 'unlink', version: 1 })).status).toBe(200); expect(h.readRepo).not.toHaveBeenCalled(); expect(h.activity).not.toHaveBeenCalled();
});
