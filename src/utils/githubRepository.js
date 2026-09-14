export const githubOwner = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(value);
export const githubRepo = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(value) && !['.', '..'].includes(value);
export function githubReference(value) {
  if (typeof value !== 'string') throw new Error('Use owner/repository.');
  const parts = value.trim().split('/');
  if (parts.length !== 2 || !githubOwner(parts[0]) || !githubRepo(parts[1])) throw new Error('Use owner/repository, for example octocat/Hello-World.');
  return { owner: parts[0], repository: parts[1] };
}
export const githubUrl = (owner, repository, number, kind = 'issue') => `https://github.com/${owner}/${repository}${number ? `/${kind === 'pull' ? 'pull' : 'issues'}/${number}` : ''}`;
export function validGithubLink(link, organizationId, projectId) {
  return link && link.organization_id === organizationId && link.project_id === projectId && Number.isSafeInteger(link.version) && link.version > 0
    && (link.repository_id === null ? link.owner === null && link.repository === null : Number.isSafeInteger(link.repository_id) && link.repository_id > 0 && githubOwner(link.owner) && githubRepo(link.repository));
}
