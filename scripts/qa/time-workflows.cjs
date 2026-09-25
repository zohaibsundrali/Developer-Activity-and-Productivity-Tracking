const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {api,session,svc,env,row}=require('./live-context.cjs');
if(process.env.E2E_ALLOW_WRITES!=='1')throw Error('E2E_ALLOW_WRITES=1 required');
const run='deepqa-time-'+Date.now(),results=[],records=[],reopen=[];
const out=`${process.env.QA_ARTIFACT_DIR || 'artifacts/deep-qa-20260921'}/time-workflows.json`;
function save(){fs.writeFileSync(out,JSON.stringify({run,results,records},null,2),{mode:0o600});}
async function check(name,fn){try{await fn();results.push({name,status:'PASS'});console.log('PASS',name)}catch(e){results.push({name,status:'FAIL',error:e.message});console.log('FAIL',name,e.message)}save();}
async function call(role,method,path,body,status=200){const r=await api(role,method,path,body);assert.equal(r.status,status,`${method} ${path}: ${JSON.stringify(r.body)}`);return r.body;}
function track(table,id,org){records.push({table,id,org});save();}
async function inserted(client,table,body){const r=await client.from(table).insert(body).select().single();assert.equal(r.error,null,JSON.stringify(r.error));track(table,r.data.id,body.organization_id);return r.data;}
(async()=>{
 const owner=await session('owner'),staff=await session('developer'),other=await session('org_b_owner');
 const weekDate=new Date(Date.UTC(2030,0,7)+crypto.randomInt(0,400)*7*86400000),week=weekDate.toISOString().slice(0,10);
 await check('leave type/create, half-day validation, overlap, self-decision denial, HR approval and tenant denial',async()=>{
  const type=await inserted(owner.client,'leave_types',{organization_id:owner.org,code:run,name:run,is_paid:true});
  const body={leaveTypeId:type.id,startDate:week,endDate:week,days:0.5,reason:run};
  await call('developer','POST','/api/leave',{...body,days:0.3},400);
  const request=(await call('developer','POST','/api/leave',body)).request;track('leave_requests',request.id,owner.org);
  assert.equal(Number((await row('leave_requests',request.id)).days),0.5);
  await call('developer','POST','/api/leave',body,409);
  await call('developer','PATCH','/api/leave',{requestId:request.id,decision:'approved'},403);
  await call('org_b_owner','PATCH','/api/leave',{requestId:request.id,decision:'approved'},404);
  await call('hr','PATCH','/api/leave',{requestId:request.id,decision:'approved',note:run});assert.equal((await row('leave_requests',request.id)).status,'approved');
  await call('hr','PATCH','/api/leave',{requestId:request.id,decision:'rejected'},409);
 });
 await check('attendance check-in/check-out idempotency and protected other-person writes',async()=>{
  const existing=await svc.from('attendance_records').select('id').eq('organization_id',staff.org).eq('user_id',staff.id).eq('work_date',week);assert.equal(existing.error,null);assert.equal(existing.data.length,0);
  const first=await call('developer','POST','/api/attendance',{action:'check_in',workDate:week,note:run});track('attendance_records',first.record.id,staff.org);
  const repeat=await call('developer','POST','/api/attendance',{action:'check_in',workDate:week});assert.equal(repeat.unchanged,true);assert.equal(repeat.record.check_in_at,first.record.check_in_at);
  await call('developer','POST','/api/attendance',{action:'check_in',workDate:week,userId:owner.id,userType:owner.type},403);
  const end=await call('developer','POST','/api/attendance',{action:'check_out',workDate:week});assert(end.record.check_out_at);
  const end2=await call('developer','POST','/api/attendance',{action:'check_out',workDate:week});assert.equal(end2.unchanged,true);assert.equal(end2.record.check_out_at,end.record.check_out_at);
 });
 await check('shift create, stale-version conflict, staff read, forbidden edit and cancellation',async()=>{
  const shift={id:crypto.randomUUID(),version:0,userId:staff.id,userType:staff.type,start:week+'T09:00:00Z',end:week+'T17:00:00Z',timezone:'UTC',title:run,status:'published',note:run};
  const roster=await call('hr','GET','/api/shifts?view=staff');assert(roster.staff.some(x=>x.id===staff.id));
  const saved=(await call('hr','POST','/api/shifts',shift)).shift;track('work_shifts',saved.id,staff.org);assert.equal(saved.version,1);
  await call('developer','POST','/api/shifts',{...shift,version:1,status:'cancelled'},403);
  const conflictStart=Date.now();await call('hr','POST','/api/shifts',{...shift,title:run+' stale'},409);assert(Date.now()-conflictStart<15000,'Stale edits must return promptly');
  const own=await staff.client.from('work_shifts').select('id').eq('id',saved.id);assert.equal(own.error,null);assert.equal(own.data.length,1);
  const foreign=await other.client.from('work_shifts').select('id').eq('id',saved.id);assert.equal(foreign.error,null);assert.deepEqual(foreign.data,[]);
  await call('hr','POST','/api/shifts',{...shift,version:1,status:'cancelled'});assert.equal((await row('work_shifts',saved.id)).status,'cancelled');
 });
 await check('manual time, submitted-week lock, approval, self/tenant denial and reopening',async()=>{
  const existing=await svc.from('timesheets').select('id').eq('organization_id',staff.org).eq('user_id',staff.id).eq('user_type',staff.type).eq('week_start',week);assert.equal(existing.error,null);assert.equal(existing.data.length,0);
  const log=await inserted(staff.client,'task_time_logs',{organization_id:staff.org,developer_id:staff.id,user_type:staff.type,task_id:env.E2E_INTERNAL_TASK_ID,project_id:env.E2E_INTERNAL_PROJECT_ID,started_at:week+'T10:00:00Z',ended_at:week+'T11:00:00Z',seconds:3600,source:'manual',note:run});
  const sheet=(await call('developer','POST','/api/timesheets',{weekStart:week})).timesheet;track('timesheets',sheet.id,staff.org);reopen.push(sheet.id);assert.equal(Number(sheet.total_seconds),3600);
  const locked=await staff.client.from('task_time_logs').update({seconds:4000}).eq('id',log.id).select('id');assert(locked.error,'A submitted week must refuse edits');
  await call('developer','PATCH','/api/timesheets',{timesheetId:sheet.id,decision:'approved'},403);
  await call('org_b_owner','PATCH','/api/timesheets',{timesheetId:sheet.id,decision:'approved'},404);
  await call('owner','PATCH','/api/timesheets',{timesheetId:sheet.id,decision:'approved'});assert.equal((await row('timesheets',sheet.id)).status,'approved');
  const exportResult=await owner.client.rpc('approved_time_export',{p_from:week,p_to:week});assert.equal(exportResult.error,null,JSON.stringify(exportResult.error));assert(exportResult.data.count>=1);
  await call('owner','PATCH','/api/timesheets',{timesheetId:sheet.id,decision:'reopen'});assert.equal((await row('timesheets',sheet.id)).status,'draft');
 });
 await check('work-site create/update, stale edit rejection and unauthorized write',async()=>{
  const site={id:crypto.randomUUID(),version:0,name:run,latitude:31.5,longitude:74.3,radius_m:200,active:true};
  await call('developer','POST','/api/mobile/sites',site,403);
  await call('hr','POST','/api/mobile/sites',site);track('work_sites',site.id,staff.org);
  await call('hr','POST','/api/mobile/sites',{...site,name:run+' stale'},409);
  await call('hr','POST','/api/mobile/sites',{...site,version:1,active:false});assert.equal((await row('work_sites',site.id)).active,false);
 });
 await check('mobile work upload, idempotent receipt, GPS history and cross-tenant denial',async()=>{
  const id=crypto.randomUUID(),segment=crypto.randomUUID(),end=new Date(Date.now()-120000),start=new Date(end.getTime()-60000);
  const payload={id,segments:[{id:segment,start:start.toISOString(),end:end.toISOString()}],points:[{at:start.toISOString(),lat:31.5,lon:74.3,accuracy:5,mock:true}],recovered:false};
  const first=await call('developer','POST','/api/mobile/sessions',payload);track('task_time_logs',segment,staff.org);track('mobile_work_sessions',id,staff.org);assert.equal(first.work_seconds,60);
  const repeat=await call('developer','POST','/api/mobile/sessions',payload);assert.equal(repeat.unchanged,true);
  await call('developer','POST','/api/mobile/sessions',{...payload,recovered:true},409);
  const detail=await call('developer','GET','/api/mobile/history?id='+id);assert.equal(detail.session.id,id);assert.equal(detail.session.payload.points[0].geofence.state,'uncertain');
  await call('org_b_owner','GET','/api/mobile/history?id='+id,undefined,404);
  const raw=await other.client.from('mobile_work_sessions').select('id').eq('id',id);assert.equal(raw.error,null);assert.deepEqual(raw.data,[]);
 });
})().catch(e=>{results.push({name:'setup',status:'FAIL',error:e.message});console.log(e.message)}).finally(async()=>{
 for(const id of reopen){try{const r=await row('timesheets',id);if(['submitted','approved','rejected'].includes(r.status))await call('owner','PATCH','/api/timesheets',{timesheetId:id,decision:'reopen'});}catch(e){results.push({name:'reopen for cleanup',status:'FAIL',error:e.message});}}
 for(const r of [...records].reverse()){const d=await svc.from(r.table).delete().eq('id',r.id).eq('organization_id',r.org);if(d.error)results.push({name:'cleanup '+r.table,status:'FAIL',error:d.error.message});else r.cleaned=true;}
 save();const failed=results.filter(x=>x.status==='FAIL');console.log(JSON.stringify({passed:results.length-failed.length,failed:failed.length}));if(failed.length)process.exitCode=1;
});
