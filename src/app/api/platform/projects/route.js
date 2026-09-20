import { requirePlatformPermission, platformJson, platformPage } from '@/utils/platformOwner';
import { platformFilters, applyPlatformFilters } from '@/utils/platformFilters';
export const dynamic = 'force-dynamic';
export async function GET(request) {
  try {
    const access = await requirePlatformPermission(request, 'projects.read');
    if (access.error) return access.error;
    const search = new URL(request.url).searchParams, filters = platformFilters(search), page = platformPage(search);
    if (!filters || !page) return platformJson({ error: 'Invalid filters or page.' },400);
    let query = access.svc.from('projects').select('id,organization_id,name,status,archived,created_at,deadline,organizations(name)', { count:'exact' });
    query = applyPlatformFilters(query, filters, { searchColumn:'name', project:true });
    const result = await query.order('created_at',{ascending:false}).order('id').range((page-1)*20,page*20-1);
    if (result.error) return platformJson({ error:'Projects could not be loaded.' },503);
    return platformJson({items:result.data,total:result.count,page,pageSize:20});
  } catch { return platformJson({error:'Projects could not be loaded.'},503); }
}
