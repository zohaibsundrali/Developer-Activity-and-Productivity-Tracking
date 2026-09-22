import { createHash } from 'node:crypto';
import { getAuthedOrg, orgScopedClient } from '@/utils/serverAuth';
import { mobileReply, mobileFail } from '@/utils/mobileServer';
import { readMobileJson } from '@/utils/mobileFieldTracking';
import { GithubFailure, readGithubIssue } from '@/utils/githubProvider';
import { validGithubLink } from '@/utils/githubRepository';
import { SHIFT_UUID, shiftInstant } from '@/utils/workShifts';
import { githubSyncFields } from '@/utils/githubIssueSync';
export const dynamic = 'force-dynamic';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const choices = ['auto','local','github'];
function failure(error) {
  const status = ['42501','P0002'].includes(error?.code) ? 403 : ['PT409', '40001','40P01','23505','55000'].includes(error?.code) ? 409 : ['22023','23514'].includes(error?.code) ? 400 : String(error?.message).startsWith('BILLING_LOCKED') ? 402 : 503;
  return new GithubFailure(status === 403 ? 'This imported task is unavailable or your task access changed.' : status === 409 ? 'The task, repository or sync evidence changed. Preview again and resolve conflicts.' : status === 400 ? 'Check the sync choices and preview the task again.' : 'Task synchronization is temporarily unavailable.', status);
}
async function readContext(client, auth, project, version) {
  const {data,error} = await client.rpc('project_github_context',{p_project:project});
  if (error) throw failure(error);
  if (!data || data.project_id!==project || data.organization_id!==auth.orgId || typeof data.can_import!=='boolean' || !validGithubLink(data.link,auth.orgId,project)) throw failure();
  if (!data.can_import) throw failure({code:'42501'});
  if (!data.link.repository_id || data.link.version!==version) throw failure({code:'40001'});
  return data;
}
export async function POST(request,{params}) {
  try {
    const auth=await getAuthedOrg(request);
    if(!auth)return mobileFail('Unauthorized',401);
    if(!['admin','developer'].includes(auth.userType))return mobileFail('Forbidden',403);
    if(auth.overridesLoaded===false)throw failure();
    const project=(await params).id;
    if(!SHIFT_UUID.test(project||''))return mobileFail('Invalid project.');
    let b;try{b=await readMobileJson(request);}catch{return mobileFail('Invalid sync request.');}
    if(!b||!['preview','sync'].includes(b.action)||!Number.isSafeInteger(b.number)||b.number<1||!Number.isSafeInteger(b.version)||b.version<1||b.version>2147483647
       ||Object.keys(b).some(k=>!['action','number','version','githubToken','id','importId','expected','fingerprint','title','description'].includes(k)))return mobileFail('Invalid synchronization request.');
    if(b.action==='sync'&&(!SHIFT_UUID.test(b.id||'')||!SHIFT_UUID.test(b.importId||'')||!/^[a-f0-9]{32}$/.test(b.expected||'')||!/^[a-f0-9]{64}$/.test(b.fingerprint||'')||!choices.includes(b.title)||!choices.includes(b.description)))return mobileFail('Preview the task and resolve both fields before syncing.');
    const client=orgScopedClient(auth.token),before=await readContext(client,auth,project,b.version);
    const issue=await readGithubIssue(before.link,b.number,b.githubToken);
    const fingerprint=hash({project,version:b.version,issue});
    await readContext(client,auth,project,b.version);
    if(b.action==='preview') {
      const {data,error}=await client.rpc('github_issue_sync_context',{p_project:project,p_number:b.number});
      if(error)throw failure(error);
      const s=data?.snapshot;
      if(!s||s.organization_id!==auth.orgId||s.project_id!==project||s.repository_id!==issue.repository_id||s.issue_id!==issue.id||s.number!==b.number||s.link_version!==b.version||!SHIFT_UUID.test(s.import_id)||!SHIFT_UUID.test(s.task?.id)||!Number.isSafeInteger(s.revision)||s.revision<0||typeof s.task.status!=='string'||!/^[a-f0-9]{32}$/.test(data.fingerprint||''))throw failure();
      return mobileReply({success:true,project_id:project,organization_id:auth.orgId,version:b.version,snapshot:s,expected:data.fingerprint,fingerprint,fields:githubSyncFields(s,issue),issue});
    }
    if(fingerprint!==b.fingerprint)throw new GithubFailure('The GitHub issue changed after preview. Preview it again.',409);
    const {data,error}=await client.rpc('sync_github_issue_task',{p_project:project,p_id:b.id,p_import:b.importId,p_version:b.version,p_expected:b.expected,p_source:issue,p_title:b.title,p_description:b.description});
    if(error)throw failure(error);
    const e=data?.event;
    if(!e||typeof data.unchanged!=='boolean'||e.id!==b.id||e.import_id!==b.importId||e.project_id!==project||e.organization_id!==auth.orgId||e.actor_id!==auth.appUserId||e.actor_type!==auth.userType||e.link_version!==b.version||e.expected!==b.expected||e.title_choice!==b.title||e.description_choice!==b.description||!Number.isSafeInteger(e.revision)||e.revision<1||!shiftInstant(e.created_at)||!e.applied||['title','description'].some(k=>e.applied[k]!==null&&typeof e.applied[k]!=='string')||e.source?.id!==issue.id||e.source?.repository_id!==issue.repository_id||e.source?.number!==issue.number)throw failure();
    return mobileReply({success:true,project_id:project,organization_id:auth.orgId,version:b.version,id:e.id,revision:e.revision,unchanged:data.unchanged,applied:e.applied});
  }catch(e){const error=e instanceof GithubFailure?e:failure();return mobileFail(error.message,error.status);}
}
