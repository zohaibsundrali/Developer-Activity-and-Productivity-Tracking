import { createHash } from 'node:crypto';
import { getAuthedOrg, orgScopedClient } from '@/utils/serverAuth';
import { mobileReply as reply, mobileFail } from '@/utils/mobileServer';
import { readMobileJson } from '@/utils/mobileFieldTracking';
import { GithubFailure, readGithubIssue } from '@/utils/githubProvider';
import { validGithubLink } from '@/utils/githubRepository';
import { validReportDate } from '@/utils/reportDates';
import { SHIFT_UUID, shiftInstant } from '@/utils/workShifts';
export const dynamic = 'force-dynamic';
function databaseFailure(error) {
  const code = error?.code;
  const status = code === '42501' || code === 'P0002' ? 403 : ['PT409', '40001','23505','55000'].includes(code) ? 409 : ['22023','23514'].includes(code) ? 400 : String(error?.message || '').startsWith('BILLING_LOCKED') ? 402 : String(error?.message || '').startsWith('PLAN_LIMIT_REACHED') ? 409 : 503;
  return new GithubFailure(status === 403 ? 'Project access and task management/read permission are required.' : status === 409 ? 'The repository, project or task limit changed. Refresh before importing.' : status === 400 ? 'Check the issue content and planned dates.' : status === 402 ? 'Your subscription requires attention before importing.' : 'Issue import is temporarily unavailable.', status);
}
async function context(client, auth, id, version) {
  const { data, error } = await client.rpc('project_github_context', { p_project: id });
  if (error) throw databaseFailure(error);
  if (!data || data.project_id !== id || data.organization_id !== auth.orgId || typeof data.can_import !== 'boolean' || !validGithubLink(data.link, auth.orgId, id)) throw databaseFailure();
  if (!data.can_import) throw databaseFailure({ code: '42501' });
  if (!data.link.repository_id || data.link.version !== version) throw databaseFailure({ code: '40001' });
  return data;
}
function validMapping(row, auth, project, issue) {
  return row && SHIFT_UUID.test(row.id) && row.organization_id === auth.orgId && row.project_id === project && row.repository_id === issue.repository_id
    && row.issue_id === issue.id && row.issue_number === issue.number && SHIFT_UUID.test(row.original_task_id)
    && (row.task_id === null || row.task_id === row.original_task_id) && validReportDate(row.start_date) && validReportDate(row.end_date)
    && row.end_date >= row.start_date && SHIFT_UUID.test(row.imported_by) && ['admin','developer'].includes(row.imported_by_type) && shiftInstant(row.imported_at);
}
export async function POST(request, { params }) {
  try {
    const auth = await getAuthedOrg(request);
    if (!auth) return mobileFail('Unauthorized', 401);
    if (!['admin','developer'].includes(auth.userType)) return mobileFail('Forbidden', 403);
    if (auth.overridesLoaded === false) throw databaseFailure();
    const project = (await params).id;
    if (!SHIFT_UUID.test(project || '')) return mobileFail('Invalid project.');
    let body; try { body = await readMobileJson(request); } catch { return mobileFail('Invalid import request.'); }
    if (!body || !['preview','import'].includes(body.action) || !Number.isSafeInteger(body.number) || body.number < 1 || !Number.isSafeInteger(body.version) || body.version < 1
        || Object.keys(body).some(k => !['action','number','version','githubToken','fingerprint','start','end'].includes(k))) return mobileFail('Invalid issue import request.');
    if (body.action === 'import' && (!validReportDate(body.start) || !validReportDate(body.end) || body.end < body.start || typeof body.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(body.fingerprint))) return mobileFail('Select planned start/end dates and preview the issue first.');
    const client = orgScopedClient(auth.token), before = await context(client, auth, project, body.version);
    const issue = await readGithubIssue(before.link, body.number, body.githubToken);
    const digest = createHash('sha256').update(JSON.stringify({ project, version: body.version, issue })).digest('hex');
    await context(client, auth, project, body.version);
    if (body.action === 'preview') {
      const { data, error } = await client.from('github_issue_task_imports').select('id,organization_id,project_id,repository_id,issue_id,issue_number,task_id,original_task_id,start_date,end_date,imported_by,imported_by_type,imported_at').eq('organization_id', auth.orgId).eq('project_id', project).eq('repository_id', issue.repository_id).eq('issue_id', issue.id).maybeSingle();
      if (error || (data && !validMapping(data, auth, project, issue))) throw databaseFailure(error);
      return reply({ success: true, project_id: project, organization_id: auth.orgId, version: body.version, issue, fingerprint: digest, existing: data });
    }
    if (digest !== body.fingerprint) throw new GithubFailure('The GitHub issue changed after preview. Preview it again before importing.', 409);
    const { data, error } = await client.rpc('import_github_issue_task', { p_project: project, p_version: body.version, p_issue: issue, p_start: body.start, p_end: body.end });
    if (error) throw databaseFailure(error);
    if (!data || typeof data.unchanged !== 'boolean' || !validMapping(data.import, auth, project, issue)
        || (data.import.task_id === null ? data.task !== null : !data.task || data.task.id !== data.import.task_id || data.task.project_id !== project || data.task.organization_id !== auth.orgId || typeof data.task.title !== 'string' || typeof data.task.status !== 'string')) throw databaseFailure();
    if (!data.unchanged && (data.task?.status !== 'pending' || data.task?.title !== issue.title || data.task?.start_date !== body.start || data.task?.end_date !== body.end || data.import.imported_by !== auth.appUserId || data.import.imported_by_type !== auth.userType)) throw databaseFailure();
    return reply({ success: true, project_id: project, organization_id: auth.orgId, version: body.version, unchanged: data.unchanged, task: data.task, deleted: data.import.task_id === null });
  } catch (e) { const failure = e instanceof GithubFailure ? e : databaseFailure(); return mobileFail(failure.message, failure.status); }
}
