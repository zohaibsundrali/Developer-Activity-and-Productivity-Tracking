import { githubOwner, githubRepo } from '@/utils/githubRepository';
export class GithubFailure extends Error { constructor(message, status = 503) { super(message); this.status = status; } }
function tokenHeader(token) {
  if (token === undefined || token === '') return {};
  if (typeof token !== 'string' || token.length > 512 || !/^[A-Za-z0-9_]+$/.test(token)) throw new GithubFailure('The GitHub token format is invalid.', 400);
  return { Authorization: `Bearer ${token}` };
}
async function githubRead(path, token) {
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 12000);
  try {
    const response = await fetch(`https://api.github.com${path}`, { method: 'GET', redirect: 'error', cache: 'no-store', signal: abort.signal,
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'DevTrack-Project-Integration', ...tokenHeader(token) } });
    if ([401, 404].includes(response.status)) throw new GithubFailure('Repository access could not be verified. Check its current name and your GitHub read token.', 404);
    if ([403, 429].includes(response.status)) throw new GithubFailure('GitHub denied this request or its rate limit was reached. Check token access or retry later.', 429);
    if (!response.ok) throw new GithubFailure('GitHub is temporarily unavailable. Retry later.');
    // Abort also bounds body reading, and cap provider data before JSON parsing.
    const reader = response.body.getReader(); let size = 0, content = ''; const decoder = new TextDecoder();
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new GithubFailure('GitHub returned too much data for this page.'); } content += decoder.decode(value, { stream: true }); }
    content += decoder.decode();
    return { data: JSON.parse(content), link: response.headers.get('Link') || '' };
  } catch (e) { if (e instanceof GithubFailure) throw e; throw new GithubFailure('Could not complete the GitHub request. Retry using the repository’s current name.'); }
  finally { clearTimeout(timer); }
}
export async function readGithubRepository(owner, repository, token) {
  if (!githubOwner(owner) || !githubRepo(repository)) throw new GithubFailure('Invalid repository reference.', 400);
  const { data } = await githubRead(`/repos/${owner}/${repository}`, token);
  if (!Number.isSafeInteger(data?.id) || data.id <= 0 || !githubOwner(data.owner?.login) || !githubRepo(data.name)
    || `${data.owner.login}/${data.name}`.toLowerCase() !== `${owner}/${repository}`.toLowerCase()) throw new GithubFailure('GitHub repository identity did not match.');
  return { repository_id: data.id, owner: data.owner.login, repository: data.name };
}
export async function readGithubActivity(link, page, token, after = null) {
  if (after !== null && (typeof after !== 'string' || !/^[A-Za-z0-9_+/=-]{1,1024}$/.test(after))) throw new GithubFailure('Invalid GitHub cursor.', 400);
  const repo = await readGithubRepository(link.owner, link.repository, token);
  if (repo.repository_id !== link.repository_id) throw new GithubFailure('The repository identity changed. Ask a project manager to link it again.', 409);
  const path = `/repos/${repo.owner}/${repo.repository}/issues`;
  const query = new URLSearchParams({ state: 'all', sort: 'created', direction: 'desc', per_page: '30', page: String(page) });
  if (after) query.set('after', after);
  const { data, link: pagination } = await githubRead(`${path}?${query}`, token);
  if (!Array.isArray(data) || data.length > 30) throw new GithubFailure('GitHub activity could not be verified.');
  const seen = new Set();
  const items = data.map(row => {
    if (!Number.isSafeInteger(row?.number) || row.number <= 0 || seen.has(row.number) || typeof row.title !== 'string' || row.title.length > 1024
      || !['open', 'closed'].includes(row.state) || !Number.isFinite(Date.parse(row.updated_at))
      || row.repository_url?.toLowerCase() !== `https://api.github.com${`/repos/${repo.owner}/${repo.repository}`}`.toLowerCase()) throw new GithubFailure('GitHub activity contained an unexpected record.');
    seen.add(row.number);
    return { number: row.number, title: row.title, state: row.state, kind: row.pull_request ? 'pull' : 'issue', updated_at: new Date(row.updated_at).toISOString() };
  });
  const nextLink = pagination.split(',').find(part => /;\s*rel="next"/.test(part));
  let nextPage = null, nextAfter = null;
  if (nextLink) {
    try { const url = new URL(nextLink.match(/<([^>]+)>/)[1]);
      if (url.origin !== 'https://api.github.com' || ![path.toLowerCase(), `/repositories/${repo.repository_id}/issues`].includes(url.pathname.toLowerCase()) || url.searchParams.get('page') !== String(page + 1) || page >= 1000 || !items.length) throw new Error();
      nextPage = page + 1; nextAfter = url.searchParams.get('after');
      if (nextAfter !== null && !/^[A-Za-z0-9_+/=-]{1,1024}$/.test(nextAfter)) throw new Error();
    } catch { throw new GithubFailure('GitHub pagination could not be verified. Refresh the activity list.'); }
  }
  return { items, nextPage, nextAfter };
}
