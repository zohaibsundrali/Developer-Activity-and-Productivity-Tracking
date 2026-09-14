import { afterEach, expect, it, vi } from 'vitest';
import { readGithubRepository, readGithubActivity } from '@/utils/githubProvider';
import { githubReference, githubUrl } from '@/utils/githubRepository';
const repo = { id: 123, owner: { login: 'octocat' }, name: 'Hello-World' };
const link = { repository_id: 123, owner: 'octocat', repository: 'Hello-World' };
const issue = (number = 1, patch = {}) => ({ number, title: '<script>plain text</script>', state: 'open', updated_at: '2026-09-14T10:00:00Z', repository_url: 'https://api.github.com/repos/octocat/Hello-World', ...patch });
const response = (data, headers = {}) => new Response(JSON.stringify(data), { headers });
afterEach(() => vi.unstubAllGlobals());
it('accepts only owner/repository references', () => {
  expect(githubReference('octocat/Hello-World')).toEqual({ owner: 'octocat', repository: 'Hello-World' });
  for (const bad of ['https://evil.test/a', '../x', 'a/..', 'a/b/c', 'a/b?token=x', 'a/b#part']) expect(() => githubReference(bad)).toThrow();
  expect(githubUrl('octocat', 'Hello-World', 2, 'pull')).toBe('https://github.com/octocat/Hello-World/pull/2');
});
it('sends credentials only to the fixed GitHub origin and disallows redirects', async () => {
  const fetch = vi.fn().mockResolvedValue(response(repo)); vi.stubGlobal('fetch', fetch);
  expect(await readGithubRepository('octocat', 'Hello-World', 'github_pat_test')).toEqual(link);
  expect(fetch).toHaveBeenCalledWith('https://api.github.com/repos/octocat/Hello-World', expect.objectContaining({ redirect: 'error', cache: 'no-store', headers: expect.objectContaining({ Authorization: 'Bearer github_pat_test' }) }));
});
it('omits authorization for public repository requests', async () => {
  const fetch = vi.fn().mockResolvedValue(response(repo)); vi.stubGlobal('fetch', fetch); await readGithubRepository('octocat', 'Hello-World');
  expect(fetch.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
});
it('rejects token header injection before any network call', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(readGithubRepository('octocat', 'Hello-World', 'token\r\nInjected: x')).rejects.toThrow('format'); expect(fetch).not.toHaveBeenCalled();
});
it.each([401, 404, 403, 429, 500])('returns bounded generic provider errors for %s', async status => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret diagnostic', { status })));
  await expect(readGithubRepository('octocat', 'Hello-World')).rejects.not.toThrow('secret');
});
it('rejects a repository name that now points to a different repository ID', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...repo, id: 456 })));
  await expect(readGithubActivity(link, 1)).rejects.toThrow('identity changed');
});
it('distinguishes issues and pull requests and validates provider pagination', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(repo)).mockResolvedValueOnce(response([issue(1), issue(2, { pull_request: {} })], { Link: '<https://api.github.com/repos/octocat/Hello-World/issues?page=2&per_page=30>; rel="next"' })));
  const result = await readGithubActivity(link, 1); expect(result.nextPage).toBe(2); expect(result.items.map(row => row.kind)).toEqual(['issue', 'pull']);
  expect(result.items[0]).not.toHaveProperty('repository_url');
});
it.each([[issue(1), issue(1)], [issue(1, { repository_url: 'https://api.github.com/repos/foreign/private' })], [issue(1, { number: -1 })]].map(rows => [rows]))('rejects malformed or foreign activity %j', async rows => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(repo)).mockResolvedValueOnce(response(rows)));
  await expect(readGithubActivity(link, 1)).rejects.toThrow('unexpected record');
});
it('does not follow an injected next-page link', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response(repo)).mockResolvedValueOnce(response([issue()], { Link: '<https://evil.test/issues?page=2>; rel="next"' })); vi.stubGlobal('fetch', fetch);
  await expect(readGithubActivity(link, 1, 'github_pat_test')).rejects.toThrow('pagination'); expect(fetch).toHaveBeenCalledTimes(2);
});
it('caps provider response bodies before parsing', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x'.repeat(2 * 1024 * 1024 + 1))));
  await expect(readGithubRepository('octocat', 'Hello-World')).rejects.toThrow('too much data');
});

it('accepts canonical repository-ID links and preserves GitHub cursor tokens', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response(repo)).mockResolvedValueOnce(response([issue()], { Link: '<https://api.github.com/repositories/123/issues?page=2&after=YWJj%3D>; rel="next"' }))
    .mockResolvedValueOnce(response(repo)).mockResolvedValueOnce(response([issue(2)])); vi.stubGlobal('fetch', fetch);
  const first = await readGithubActivity(link, 1); expect(first.nextAfter).toBe('YWJj=');
  await readGithubActivity(link, first.nextPage, undefined, first.nextAfter);
  expect(fetch.mock.calls[3][0]).toContain('after=YWJj%3D');
});
