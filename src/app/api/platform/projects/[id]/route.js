import { requirePlatformPermission, platformJson } from '@/utils/platformOwner';
import { isUuid } from '@/utils/workspaceIdentity';
export const dynamic = 'force-dynamic';
export async function GET(request, context) {
  try {
    const access = await requirePlatformPermission(request, 'projects.read'); if (access.error) return access.error;
    const { id } = await context.params;
    if (!isUuid(id)) return platformJson({error:'Invalid project.'},400);
    const result = await access.svc.from('projects').select('id,organization_id,name,description,status,archived,created_at,deadline,organizations(name)').eq('id',id).maybeSingle();
    if (result.error) return platformJson({error:'Project unavailable.'},503);
    if (!result.data) return platformJson({error:'Project not found.'},404);
    const counts = await Promise.all(['developer_tasks','project_members'].map(table => access.svc.from(table).select('id',{count:'exact',head:true}).eq('project_id',id).eq('organization_id',result.data.organization_id)));
    if (counts.some(count=>count.error)) return platformJson({error:'Project counts unavailable.'},503);
    return platformJson({project:result.data,tasks:counts[0].count,members:counts[1].count});
  } catch { return platformJson({error:'Project unavailable.'},503); }
}
export async function POST(request, context) {
  try {
    const access = await requirePlatformPermission(request, 'projects.manage'); if (access.error) return access.error;
    const { id } = await context.params, body = await request.json().catch(()=>null);
    if (!isUuid(id) || !['archive','restore','delete'].includes(body?.action) || typeof body?.reason !== 'string' || body.reason.trim().length<8 || body.reason.length>500 || body.action==='delete' && (typeof body.confirmName!=='string' || body.confirmName.length>200)) return platformJson({error:'Choose an action, supply a reason of 8–500 characters, and confirm the name for deletion.'},400);
    const result = await access.svc.rpc('platform_project_action',{...access.args,p_project:id,p_action:body.action,p_reason:body.reason.trim(),p_name:body.confirmName || null});
    if (result.error) {
      const status = ({'42501':403,'P0002':404,'22023':400,'23503':409,'55000':409})[result.error.code] || 503;
      return platformJson({error:status===409?'Project has protected dependencies or organization cleanup is in progress. Archive it or resolve dependencies first.':status===400?'Check the project name and reason.':'Project action could not be completed.'},status);
    }
    return platformJson({...result.data,message:body.action==='delete'?'Project and its dependent database records deleted. Stored attachments are retained under the organization storage lifecycle.':`Project ${body.action==='archive'?'archived':'restored'}.`});
  } catch { return platformJson({error:'Project action could not be completed.'},503); }
}
