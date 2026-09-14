import { mobileAuth, readMobileContext, mobileReply, mobileFail, mobileDatabaseError } from '@/utils/mobileServer';
import { mobileUuid, validateMobilePayload, classifyGeofence } from '@/utils/mobileFieldTracking';
import { validReportDate } from '@/utils/reportDates';
import { shiftInstant } from '@/utils/workShifts';
export const dynamic = 'force-dynamic';
const valid = (row, org) => row && mobileUuid(row.id) && row.organization_id === org && mobileUuid(row.user_id) && ['admin','developer'].includes(row.user_type) && shiftInstant(row.started_at) && shiftInstant(row.ended_at) && Number.isSafeInteger(row.work_seconds) && row.work_seconds>0;
export async function GET(request) {
  try {const { auth, client, denied } = await mobileAuth(request);if(denied)return denied;
    const context=await readMobileContext(client,auth);if(context.denied)return context.denied;
    const q=new URL(request.url).searchParams,id=q.get('id');
    if(id!==null){
      if(!mobileUuid(id))return mobileFail('Invalid session.');
      const {data,error}=await client.from('mobile_work_sessions').select('*').eq('organization_id',auth.orgId).eq('id',id).maybeSingle();
      if(error)return mobileDatabaseError(error);if(!data)return mobileFail('Session not found.',404);
      if(!valid(data,auth.orgId)||(!context.data.can_view_all&&(data.user_id!==auth.appUserId||data.user_type!==auth.userType)))return mobileDatabaseError();
      let receipt;try{receipt=validateMobilePayload(data.payload);}catch{return mobileDatabaseError();}
      if(receipt.payload.id!==data.id||receipt.seconds!==data.work_seconds)return mobileDatabaseError();
      return mobileReply({success:true,session:{...data,payload:{...receipt.payload,points:receipt.payload.points.map(point=>({...point,geofence:classifyGeofence(point,context.data.sites)}))}},geofence_basis:'current_work_sites'});
    }
    const from=q.get('from'),to=q.get('to'),scope=q.get('scope')||'me';
    if(!validReportDate(from)||!validReportDate(to)||from>to||Date.parse(to)-Date.parse(from)>92*86400000)return mobileFail('Select up to 93 UTC dates.');
    if(!['me','all'].includes(scope))return mobileFail('Invalid history scope.');if(scope==='all'&&!context.data.can_view_all)return mobileFail('Organization GPS history is not allowed.',403);
    const binding={org:auth.orgId,user:auth.appUserId,type:auth.userType,from,to,scope};let cursor=null;
    if(q.has('cursor')){try{const raw=q.get('cursor');if(!raw||raw.length>2048||!/^[A-Za-z0-9_-]+$/.test(raw))throw new Error();cursor=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));if(!mobileUuid(cursor.id)||!shiftInstant(cursor.start)||Object.entries(binding).some(([key,value])=>cursor[key]!==value))throw new Error();}catch{return mobileFail('Invalid history cursor. Refresh the list.');}}
    const lower=`${from}T00:00:00.000Z`,upper=new Date(Date.parse(to)+86400000).toISOString();
    let query=client.from('mobile_work_sessions').select('id,organization_id,user_id,user_type,started_at,ended_at,work_seconds,uploaded_at',{count:'exact'}).eq('organization_id',auth.orgId).gte('started_at',lower).lt('started_at',upper).order('started_at',{ascending:false}).order('id',{ascending:false}).limit(50);
    if(scope==='me')query=query.eq('user_id',auth.appUserId).eq('user_type',auth.userType);
    if(cursor)query=query.or(`started_at.lt.${shiftInstant(cursor.start)},and(started_at.eq.${shiftInstant(cursor.start)},id.lt.${cursor.id})`);
    const {data,error,count}=await query;if(error)return mobileDatabaseError(error);
    if(!Array.isArray(data)||data.length>50||!Number.isSafeInteger(count)||count<data.length||(!data.length&&count!==0))return mobileDatabaseError();
    let previous=cursor?`${shiftInstant(cursor.start)}:${cursor.id}`:null;
    for(const row of data){const order=`${shiftInstant(row.started_at)}:${row.id}`;if(!valid(row,auth.orgId)||Date.parse(row.started_at)<Date.parse(lower)||Date.parse(row.started_at)>=Date.parse(upper)||(scope==='me'&&(row.user_id!==auth.appUserId||row.user_type!==auth.userType))||(previous!==null&&order>=previous))return mobileDatabaseError();previous=order;}
    const last=data.at(-1),nextCursor=count>data.length?Buffer.from(JSON.stringify({...binding,start:shiftInstant(last.started_at),id:last.id})).toString('base64url'):null;
    return mobileReply({success:true,sessions:data,nextCursor});
  }catch{return mobileDatabaseError();}
}
