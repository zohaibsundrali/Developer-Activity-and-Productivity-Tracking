import { NextResponse } from 'next/server';
import { getAuthedOrg, orgScopedClient } from '@/utils/serverAuth';
import { githubReference, validGithubLink } from '@/utils/githubRepository';
import { GithubFailure, readGithubRepository, readGithubActivity } from '@/utils/githubProvider';
export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply = (data, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization, Cookie' } });
function databaseFailure(error) {
  if (error?.code === '42501' || error?.code === 'P0002') return new GithubFailure('This project integration is not available to your account.', 403);
  if (['PT409', '40001'].includes(error?.code)) return new GithubFailure('The repository link changed. Refresh before trying again.', 409);
  if (error?.code === '22023') return new GithubFailure('Check the repository link and version.', 400);
  if (error?.message === 'BILLING_LOCKED') return new GithubFailure('Your subscription requires attention before this link can change.', 402);
  return new GithubFailure('The project integration is temporarily unavailable.');
}
async function context(client, auth, projectId) {
  const { data, error } = await client.rpc('project_github_context', { p_project: projectId });
  if (error) throw databaseFailure(error);
  if (!data || data.project_id !== projectId || data.organization_id !== auth.orgId || typeof data.can_manage !== 'boolean'
    || (data.link !== null && !validGithubLink(data.link, auth.orgId, projectId))) throw databaseFailure();
  return data;
}
async function handle(request, params, mutate) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return reply({ success: false, error: 'Unauthorized' }, 401);
    if (!['admin', 'developer'].includes(auth.userType)) throw new GithubFailure('Forbidden', 403);
    if (auth.overridesLoaded === false) throw databaseFailure();
    const projectId = (await params).id;
    if (!UUID.test(projectId || '')) throw new GithubFailure('Invalid project.', 400);
    const client = orgScopedClient(auth.token), before = await context(client, auth, projectId);
    if (!mutate) return reply({ success: true, ...before });
    let body; try { body = await request.json(); } catch { throw new GithubFailure('Invalid request.', 400); }
    if (!body || !Number.isSafeInteger(body.version) || body.version < 0 || body.version >= 2147483647 || !['activity', 'link', 'unlink'].includes(body.action)) throw new GithubFailure('Invalid integration action.', 400);
    if ((before.link?.version ?? 0) !== body.version && body.action === 'activity') throw new GithubFailure('The repository link changed. Refresh the integration.', 409);
    if (body.action === 'activity') {
      if (!before.link?.repository_id) throw new GithubFailure('Link a repository first.', 400);
      const page = body.page ?? 1;
      if (!Number.isSafeInteger(page) || page < 1 || page > 1000) throw new GithubFailure('Invalid activity page.', 400);
      const activity = await readGithubActivity(before.link, page, body.githubToken, body.after ?? null);
      const after = await context(client, auth, projectId);
      if (after.link?.version !== before.link.version) throw new GithubFailure('The repository link changed. Refresh the integration.', 409);
      return reply({ success: true, ...after, ...activity, page });
    }
    if (!before.can_manage) throw new GithubFailure('Project team management permission is required to change its repository.', 403);
    let repository = { repository_id: null, owner: null, repository: null };
    if (body.action === 'link') {
      let reference; try { reference = githubReference(body.repository); } catch (e) { throw new GithubFailure(e.message, 400); }
      repository = await readGithubRepository(reference.owner, reference.repository, body.githubToken);
    }
    const { data, error } = await client.rpc('save_project_github', { p_project: projectId, p_version: body.version, p_repository_id: repository.repository_id, p_owner: repository.owner, p_repository: repository.repository });
    if (error) throw databaseFailure(error);
    if (!validGithubLink(data, auth.orgId, projectId) || data.version !== body.version + 1 || ['repository_id', 'owner', 'repository'].some(key => data[key] !== repository[key])) throw databaseFailure();
    const after = await context(client, auth, projectId);
    if (after.link?.version !== data.version) throw new GithubFailure('The link changed again. Refresh the integration.', 409);
    return reply({ success: true, ...after });
  } catch (e) { const failure = e instanceof GithubFailure ? e : databaseFailure(); return reply({ success: false, error: failure.message }, failure.status); }
}
export const GET = (request, { params }) => handle(request, params, false);
export const POST = (request, { params }) => handle(request, params, true);
