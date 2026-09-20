import { requirePlatformPermission, platformJson } from '@/utils/platformOwner';
export const dynamic = 'force-dynamic';
export async function GET(request) {
 try {
  const a=await requirePlatformPermission(request,'analytics.read'); if(a.error)return a.error;
  const q=new URL(request.url).searchParams, to=q.get('to')||new Date().toISOString().slice(0,10), from=q.get('from')||new Date(Date.now()-30*86400000).toISOString().slice(0,10);
  if(![from,to].every(v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!isNaN(Date.parse(v)))||from>to) return platformJson({error:'Invalid date range.'},400);
  const r=await a.svc.rpc('platform_revenue',{...a.args,p_from:from,p_to:to});
  return r.error?platformJson({error:'Revenue unavailable.'},503):platformJson(r.data);
 }catch{return platformJson({error:'Revenue unavailable.'},503);}
}
