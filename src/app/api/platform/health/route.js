import { requirePlatformPermission, platformJson } from '@/utils/platformOwner';
export const dynamic = 'force-dynamic';
export async function GET(request) { try { const a=await requirePlatformPermission(request,'health.read');if(a.error)return a.error;const r=await a.svc.rpc('platform_health',a.args);return r.error?platformJson({error:'Health data unavailable.'},503):platformJson(r.data);}catch{return platformJson({error:'Health data unavailable.'},503);} }
