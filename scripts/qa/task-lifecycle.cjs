const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {api,session,svc,row}=require('./live-context.cjs');
if(process.env.E2E_ALLOW_WRITES!=='1')throw Error('E2E_ALLOW_WRITES=1 required');
const name='deepqa-task-'+Date.now(),results=[],files=[],created=[];let project,step='setup';
const save=()=>fs.writeFileSync('artifacts/deep-qa-20260921/task-lifecycle.json',JSON.stringify({name,results,created,files},null,2),{mode:0o600});
async function call(role,path,body,status=200){const r=await api(role,'POST',path,body);assert.equal(r.status,status,`${path}: ${JSON.stringify(r.body)}`);return r.body;}
function pass(name){results.push({name,status:'PASS'});console.log('PASS',name);save();}
(async()=>{
 const owner=await session('owner'),staff=await session('developer'),client=await session('client');
 const start=new Date().toISOString().slice(0,10),end=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
 step='owner creates assigned project';
 const made=await owner.client.from('projects').insert({organization_id:owner.org,name,description:name,deadline:end,assigned_developer_id:staff.id,created_by:owner.id,created_by_type:owner.type,added_by:owner.id,added_by_type:owner.type,status:'active',task_plan_status:'draft',task_plan_submitted:false}).select().single();
 assert.equal(made.error,null,JSON.stringify(made.error));project=made.data;created.push({table:'projects',id:project.id,org:owner.org});pass(step);
 step='developer saves plan; notifications and pending status persist';
 let tasks=[{task_title:name,task_description:'Synthetic task lifecycle audit',start_date:start,end_date:end,estimated_hours:1,priority:'medium'}];
 const saved=await call('developer','/api/task-plan/save-submit',{projectId:project.id,tasks});assert.equal(saved.success,true);assert.equal((await row('projects',project.id)).task_plan_status,'pending');
 tasks=saved.tasks.map(t=>({id:t.id,task_title:t.task_title,task_description:t.task_description,start_date:t.start_date,end_date:t.end_date,estimated_hours:t.estimated_hours}));
 assert.equal(tasks.length,1);const taskId=tasks[0].id;
 const notice=await svc.from('notifications').select('id').eq('organization_id',owner.org).eq('project_id',project.id);assert.equal(notice.error,null);assert(notice.data.length>0);pass(step);
 step='unauthorized plan review denied; owner rejection and resubmission preserve task';
 await call('developer','/api/task-plan/review',{projectId:project.id,action:'approve'},403);
 await call('owner','/api/task-plan/review',{projectId:project.id,action:'reject',rejectionReason:'QA: clarify the plan'});
 assert.equal((await row('projects',project.id)).task_plan_status,'rejected');
 const retry=await call('developer','/api/task-plan/save-submit',{projectId:project.id,tasks});assert.equal(retry.tasks[0].id,taskId);
 await call('owner','/api/task-plan/review',{projectId:project.id,action:'approve'});assert.equal((await row('projects',project.id)).task_plan_status,'approved');pass(step);
 step='developer starts own task; client cannot read internal work';
 const started=await staff.client.from('developer_tasks').update({status:'in_progress',updated_at:new Date().toISOString()}).eq('id',taskId).select('id,status');assert.equal(started.error,null,JSON.stringify(started.error));assert.equal(started.data[0].status,'in_progress');
 const hidden=await client.client.from('developer_tasks').select('id').eq('id',taskId);assert.equal(hidden.error,null);assert.deepEqual(hidden.data,[]);pass(step);
 async function submit(attempt){
  const storagePath=`submissions/${staff.id}/${project.id}/${taskId}/${crypto.randomUUID()}.txt`;
  const upload=await staff.client.storage.from('task-submissions').upload(storagePath,Buffer.from(name+' proof '+attempt),{contentType:'text/plain',upsert:false});assert.equal(upload.error,null,JSON.stringify(upload.error));files.push(storagePath);save();
  const request={taskId,projectId:project.id,fileName:'qa-proof.txt',storagePath,submissionNotes:name};
  await call('designer','/api/task-submission',request,403);
  const receipt=await call('developer','/api/task-submission',request);assert(receipt.submission?.id);assert.equal((await row('developer_tasks',taskId)).status,'awaiting_approval');return receipt.submission;
 }
 step='proof upload, assignee validation and rejected submission';
 const first=await submit(1);
 await call('owner','/api/admin-review',{taskId,submissionId:first.id,action:'reject',rejectionReason:'QA: add verification',comments:name});assert.equal((await row('developer_tasks',taskId)).status,'rejected');pass(step);
 step='resubmission, approval, immutable completion and scoring';
 const second=await submit(2);assert.notEqual(second.id,first.id);
 await call('owner','/api/admin-review',{taskId,submissionId:second.id,action:'approve',comments:name});
 const completed=await row('developer_tasks',taskId);assert.equal(completed.status,'completed');
 await call('owner','/api/admin-review',{taskId,submissionId:second.id,action:'approve'},409);
 assert.equal((await row('developer_tasks',taskId)).productivity_points,completed.productivity_points);
 await call('developer','/api/task-submission',{taskId,projectId:project.id,fileName:'qa-proof.txt',storagePath:files[1]},409);pass(step);
})().catch(e=>{results.push({name:step,status:'FAIL',error:e.message});console.log('FAIL',step,e.message)}).finally(async()=>{
 if(project){
  // Only the project created in this run and its dependent QA events are removed.
  for(const table of ['notifications','activity_logs','pm_activity']){const r=await svc.from(table).delete().eq('organization_id',project.organization_id).eq('project_id',project.id);if(r.error)results.push({name:'cleanup '+table,status:'FAIL',error:r.error.message});}
  const removed=await svc.from('projects').delete().eq('organization_id',project.organization_id).eq('id',project.id);if(removed.error)results.push({name:'cleanup project',status:'FAIL',error:removed.error.message});else created[0].cleaned=true;
 }
 if(files.length){const deleted=await svc.storage.from('task-submissions').remove(files);if(deleted.error)results.push({name:'cleanup uploaded QA proof',status:'FAIL',error:deleted.error.message});}
 save();if(results.some(r=>r.status==='FAIL'))process.exitCode=1;
});
