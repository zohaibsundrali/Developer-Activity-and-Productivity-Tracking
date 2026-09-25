const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {api,session,svc,row}=require('./live-context.cjs');
if(process.env.E2E_ALLOW_WRITES!=='1')throw Error('E2E_ALLOW_WRITES=1 required');
const name='deepqa-invoice-'+Date.now(),results=[],records=[];let sheet,invoice,project,step='setup';
const save=()=>fs.writeFileSync(`${process.env.QA_ARTIFACT_DIR || 'artifacts/deep-qa-20260921'}/invoice-lifecycle.json`,JSON.stringify({name,results,records},null,2),{mode:0o600});
async function call(role,method,path,body,status=200){const r=await api(role,method,path,body);assert.equal(r.status,status,JSON.stringify(r.body));return r.body;}
async function insert(client,table,body){const r=await client.from(table).insert(body).select().single();assert.equal(r.error,null,JSON.stringify(r.error));records.push({table,id:r.data.id,org:body.organization_id});save();return r.data;}
function pass(){results.push({name:step,status:'PASS'});console.log('PASS',step);save();}
(async()=>{
 const owner=await session('owner'),staff=await session('developer'),client=await session('client'),other=await session('org_b_owner');
 const week=new Date(Date.UTC(2040,0,2)+crypto.randomInt(0,500)*7*86400000).toISOString().slice(0,10);
 step='prepare synthetic billable project and one hour of time';
 project=await insert(owner.client,'projects',{organization_id:owner.org,name,description:name,deadline:week,assigned_developer_id:staff.id,created_by:owner.id,created_by_type:owner.type,added_by:owner.id,added_by_type:owner.type,status:'active',task_plan_status:'draft',default_bill_rate:125});
 await insert(staff.client,'task_time_logs',{organization_id:staff.org,developer_id:staff.id,user_type:staff.type,project_id:project.id,started_at:week+'T10:00:00Z',ended_at:week+'T11:00:00Z',seconds:3600,source:'manual',note:name,is_billable:true});pass();
 step='submit and approve actual billable timesheet';
 sheet=(await call('developer','POST','/api/timesheets',{weekStart:week})).timesheet;records.push({table:'timesheets',id:sheet.id,org:staff.org});save();
 await call('owner','PATCH','/api/timesheets',{timesheetId:sheet.id,decision:'approved'});pass();
 step='invoice permission and tenant denial; real amount calculated from approved hours';
 const request={projectId:project.id,clientId:client.id,title:name,selections:[{userId:staff.id,userType:staff.type,weekStart:week}]};
 await call('developer','POST','/api/invoicing',request,403);
 await call('org_b_owner','POST','/api/invoicing',request,400);
 const created=await call('finance','POST','/api/invoicing',request);invoice=created.invoice;records.push({table:'invoices',id:invoice.id,org:owner.org});save();
 assert.equal(Number(created.total),125);assert.equal(Number((await row('invoices',invoice.id)).amount),125);assert.equal(created.lines,1);pass();
 step='duplicate billing denied; draft and foreign invoice hidden';
 await call('finance','POST','/api/invoicing',request,409);
 for(const actor of [client,other]){const hidden=await actor.client.from('invoices').select('id').eq('id',invoice.id);assert.equal(hidden.error,null);assert.deepEqual(hidden.data,[]);}pass();
 step='sent invoice visible only to its recipient; client mutation denied';
 const sent=await owner.client.from('invoices').update({status:'sent'}).eq('id',invoice.id).eq('status','draft').select('id,status');assert.equal(sent.error,null,JSON.stringify(sent.error));assert.equal(sent.data[0].status,'sent');
 const visible=await call('client','GET','/api/client/invoices');assert(visible.invoices.some(x=>x.id===invoice.id));
 const denied=await client.client.from('invoices').update({status:'paid'}).eq('id',invoice.id).select('id');assert(denied.error||denied.data.length===0);assert.equal((await row('invoices',invoice.id)).status,'sent');pass();
})().catch(e=>{results.push({name:step,status:'FAIL',error:e.message});console.log('FAIL',step,e.message)}).finally(async()=>{
 // Delete the new invoice first, so reopening cannot affect already billed work.
 if(invoice){const r=await svc.from('invoices').delete().eq('id',invoice.id).eq('organization_id',invoice.organization_id);if(r.error)results.push({name:'invoice cleanup',status:'FAIL',error:r.error.message});else records.find(x=>x.id===invoice.id).cleaned=true;}
 if(sheet)try{await call('owner','PATCH','/api/timesheets',{timesheetId:sheet.id,decision:'reopen'});}catch(e){results.push({name:'reopen cleanup',status:'FAIL',error:e.message});}
 for(const r of [...records].reverse().filter(x=>!x.cleaned)){const d=await svc.from(r.table).delete().eq('id',r.id).eq('organization_id',r.org);if(d.error)results.push({name:'cleanup '+r.table,status:'FAIL',error:d.error.message});else r.cleaned=true;}
 save();if(results.some(x=>x.status==='FAIL'))process.exitCode=1;
});
