import { NextResponse } from 'next/server';
import { getAuthedOrg, getBearerToken, orgScopedClient, serviceClient } from '@/utils/serverAuth';
import { requirePermission } from '@/utils/serverPermissions';
import { checkFeatureAccess } from '@/utils/entitlements';
import { reportDefaultRange, reportRangeBounds, reportRangeDays } from '@/utils/reportDates';

export const REPORT_VIEWS = ['overview', 'projects', 'team', 'time', 'delays'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function reportJson(body, status=200) {
  return NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store',Vary:'Authorization, Cookie'}});
}
export function reportFailure(error) {
  const token=String(error?.message || '').split(':')[0];
  const status=token==='REPORT_PLAN_REQUIRED' ? 402 : error?.code==='42501' ? 403 : error?.code==='22023' ? 400 : 503;
  return reportJson({error:status===402?'Your plan does not include reports.':status===403?'You do not have access to this report.':status===400?'Invalid report request. Check the dates and page.':'Reports are temporarily unavailable. Please retry.'},status);
}
export async function prepareReport(request,{exporting=false}={}) {
  const auth=await getAuthedOrg(request);
  if(!auth)return {response:reportJson({error:'Unauthorized'},401)};
  const denied=requirePermission(auth,'report.view');
  if(denied){
    const headers=new Headers(denied.headers);headers.set('Cache-Control','private, no-store');headers.set('Vary','Authorization, Cookie');
    return {response:new NextResponse(denied.body,{status:denied.status,headers})};
  }
  const feature=await checkFeatureAccess(serviceClient(),auth.orgId,'reports','Reports');
  if(feature)return {response:reportJson(feature,feature.status)};
  const q=new URL(request.url).searchParams, defaults=reportDefaultRange();
  const range={from:q.get('from')??defaults.from,to:q.get('to')??defaults.to};
  try{reportRangeBounds(range);}catch(error){return {response:reportJson({error:error.message},400)};}
  const view=q.get('view')??'overview';
  if(!REPORT_VIEWS.includes(view))return {response:reportJson({error:'Invalid report view'},400)};
  const rawLimit=q.get('limit'),rawOffset=q.get('offset');
  const limit=rawLimit===null?50:Number(rawLimit),offset=rawOffset===null?0:Number(rawOffset);
  if((rawLimit!==null&&!/^[1-9]\d{0,2}$/.test(rawLimit))||limit>500
    ||(rawOffset!==null&&!/^(0|[1-9]\d{0,9})$/.test(rawOffset))||offset>2147483647)
    return {response:reportJson({error:'Invalid report page'},400)};
  return {auth,range,view,limit:exporting?500:limit,offset:exporting?0:offset,client:orgScopedClient(getBearerToken(request)),signal:request.signal};
}
export function reportRowKey(row,view){
  if(view==='team')return ['admin','developer'].includes(row?.userType)&&UUID.test(row?.userId||'')?`${row.userType}:${row.userId}`:null;
  const value=view==='projects'?row?.projectId:row?.id;
  return UUID.test(value||'')?value:null;
}
const count=value=>Number.isSafeInteger(value)&&value>=0;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
export function validateDatabaseReport(data,context,offset=context.offset){
  const {auth,range,view,limit}=context;
  if(!data||data.orgId!==auth.orgId||data.view!==view||data.range?.from!==range.from||data.range?.to!==range.to)throw new Error('REPORT_RECEIPT_INVALID');
  if(view==='overview'){
    if(!data.kpis||!data.statusCounts||!data.totals||!data.trend
      ||!['projects','tasks','done','overdue'].every(k=>count(data.kpis[k]))
      ||!['completionRate','loggedHours','trackedHours'].every(k=>finite(data.kpis[k]))
      ||!['pending','in_progress','awaiting_approval','completed','rejected','total'].every(k=>count(data.statusCounts[k]))
      ||!['projects','team','time','delays'].every(k=>count(data.totals[k]))||!finite(data.totals.timedHours))throw new Error('REPORT_RECEIPT_INVALID');
    const days=reportRangeDays(range);
    if(JSON.stringify(data.trend.days)!==JSON.stringify(days)||!['completed','loggedHours','trackedHours'].every(k=>Array.isArray(data.trend[k])&&data.trend[k].length===days.length&&data.trend[k].every(finite)))throw new Error('REPORT_RECEIPT_INVALID');
    for(const [key,kind,max] of [['projectTop','projects',10],['teamTop','team',12]]){
      if(!Array.isArray(data[key])||data[key].length>max||data[key].some(r=>!reportRowKey(r,kind)))throw new Error('REPORT_RECEIPT_INVALID');
    }
    if(data.statusCounts.total!==data.kpis.tasks||data.statusCounts.completed!==data.kpis.done
      ||data.statusCounts.pending+data.statusCounts.in_progress+data.statusCounts.awaiting_approval+data.statusCounts.completed+data.statusCounts.rejected!==data.statusCounts.total)throw new Error('REPORT_RECEIPT_INVALID');
  }else{
    if(!Array.isArray(data.rows)||data.rows.length>limit||!count(data.total))throw new Error('REPORT_RECEIPT_INVALID');
    const keys=data.rows.map(r=>reportRowKey(r,view));
    if(keys.some(k=>!k)||new Set(keys).size!==keys.length)throw new Error('REPORT_RECEIPT_INVALID');
    if(data.rows.length!==Math.min(limit,Math.max(0,data.total-offset)))throw new Error('REPORT_RECEIPT_INVALID');
    const next=offset+data.rows.length<data.total?offset+data.rows.length:null;
    if(data.nextOffset!==next)throw new Error('REPORT_RECEIPT_INVALID');
  }
  return data;
}
export async function readDatabaseReport(context,offset=context.offset){
  if(context.signal?.aborted)throw new Error('REPORT_CANCELLED');
  let query=context.client.rpc('report_data',{p_from:context.range.from,p_to:context.range.to,p_view:context.view,p_limit:context.limit,p_offset:offset});
  if(context.signal&&typeof query.abortSignal==='function')query=query.abortSignal(context.signal);
  const {data,error}=await query;
  if(error)throw error;
  return validateDatabaseReport(data,context,offset);
}
