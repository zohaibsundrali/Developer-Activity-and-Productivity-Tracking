const assert=require('node:assert/strict'),fs=require('node:fs');
const {api,session,svc,row}=require('./live-context.cjs');
if(process.env.E2E_ALLOW_WRITES!=='1')throw Error('E2E_ALLOW_WRITES=1 required');
const name='deepqa-client-'+Date.now(),results=[],records=[];let project,step='setup';
const save=()=>fs.writeFileSync('artifacts/deep-qa-20260921/client-workflows.json',JSON.stringify({name,results,records},null,2),{mode:0o600});
async function call(role,method,path,body,status=200){const r=await api(role,method,path,body);assert.equal(r.status,status,`${method} ${path}: ${JSON.stringify(r.body)}`);return r.body;}
function track(table,id,org){records.push({table,id,org});save();}
function pass(){results.push({name:step,status:'PASS'});console.log('PASS',step);save();}
(async()=>{
 const owner=await session('owner'),staff=await session('developer'),client=await session('client');
 step='create and link a disposable client project';
 const made=await owner.client.from('projects').insert({organization_id:owner.org,name,description:name,deadline:'2027-01-31',budget:1000,assigned_developer_id:staff.id,created_by:owner.id,created_by_type:owner.type,added_by:owner.id,added_by_type:owner.type,status:'active',task_plan_status:'draft'}).select().single();assert.equal(made.error,null,JSON.stringify(made.error));project=made.data;track('projects',project.id,owner.org);
 const link=await owner.client.from('project_clients').insert({organization_id:owner.org,project_id:project.id,client_id:client.id}).select().single();assert.equal(link.error,null,JSON.stringify(link.error));pass();
 step='change estimate, separate approvals, exactly-once budget impact and private-note isolation';
 const cr=(await call('client','POST','/api/change-requests',{projectId:project.id,title:name,description:'Synthetic scope change'},201)).changeRequest;assert(cr?.id);track('change_requests',cr.id,owner.org);
 const path='/api/change-requests/'+cr.id+'/advance';
 await call('client','POST',path,{action:'client_approve'},409);
 await call('owner','POST',path,{action:'estimate',estimatedCost:250,estimatedHours:2,timelineImpactDays:2,pmNotes:'QA PRIVATE '+name});
 await call('manager','POST',path,{action:'admin_approve'},403);
 await call('owner','POST',path,{action:'admin_approve'});
 await call('owner','POST',path,{action:'client_approve'},403);
 const safe=await call('client','GET','/api/change-requests?projectId='+project.id);assert(!Object.hasOwn(safe.changeRequests.find(x=>x.id===cr.id),'pm_notes'));
 const direct=await client.client.from('change_requests').select('pm_notes').eq('id',cr.id);assert(direct.error||direct.data.length===0);
 await call('client','POST',path,{action:'client_approve'});assert.equal(Number((await row('projects',project.id)).budget),1250);
 await call('client','POST',path,{action:'client_approve'},409);assert.equal(Number((await row('projects',project.id)).budget),1250);
 await call('owner','POST',path,{action:'implement'});assert.equal((await row('change_requests',cr.id)).status,'implemented');pass();
 step='client support thread, reply, forbidden other-tenant read';
 const thread=(await call('client','POST','/api/client/support',{projectId:project.id,subject:name,body:'Synthetic support request'})).thread;assert(thread?.id);track('support_threads',thread.id,owner.org);
 await call('client','POST','/api/client/support/'+thread.id,{body:'Synthetic follow-up'});
 const detail=await call('client','GET','/api/client/support/'+thread.id);assert.equal(detail.messages.length,2);
 const foreign=await (await session('org_b_owner')).client.from('support_threads').select('id').eq('id',thread.id);assert.equal(foreign.error,null);assert.deepEqual(foreign.data,[]);pass();
 step='completion, client sign-off validation, close, reopen clears prior sign-off';
 const closure='/api/projects/'+project.id+'/closure';
 await call('client','POST',closure,{action:'sign_off',rating:5},409);
 await call('owner','POST',closure,{action:'complete'});
 await call('owner','POST',closure,{action:'sign_off',rating:5},403);
 await call('client','POST',closure,{action:'sign_off',rating:6},400);
 await call('client','POST',closure,{action:'sign_off',rating:5,feedback:name});
 await call('client','POST',closure,{action:'sign_off',rating:5},409);
 await call('owner','POST',closure,{action:'close',note:name});assert((await row('projects',project.id)).closed_at);
 await call('owner','POST',closure,{action:'reopen'});const reopened=await row('projects',project.id);for(const key of ['closed_at','completed_at','client_signed_off_at','client_rating','client_feedback'])assert.equal(reopened[key],null);pass();
 step='proposal date validation, submission, duplicate protection and private estimate notes';
 await call('client','POST','/api/proposals',{title:name,description:name,desiredDeadline:'2026-02-30'},400);
 const proposal=(await call('client','POST','/api/proposals',{title:name,description:'Synthetic proposal; no decision email',budget:300,desiredDeadline:'2027-01-31'},201)).proposal;assert(proposal?.id);track('project_proposals',proposal.id,owner.org);
 await call('client','POST','/api/proposals',{title:name,description:'Duplicate'},409);
 await call('owner','POST','/api/proposals/'+proposal.id+'/decide',{decision:'estimate',estimatedCost:300,internalNotes:'QA PRIVATE '+name});
 const proposals=await call('client','GET','/api/proposals');assert(!Object.hasOwn(proposals.proposals.find(x=>x.id===proposal.id),'internal_notes'));
 const raw=await client.client.from('project_proposals').select('internal_notes').eq('id',proposal.id);assert(raw.error||raw.data.length===0);pass();
})().catch(e=>{results.push({name:step,status:'FAIL',error:e.message});console.log('FAIL',step,e.message)}).finally(async()=>{
 if(project)for(const table of ['notifications','activity_logs','pm_activity']){const d=await svc.from(table).delete().eq('project_id',project.id).eq('organization_id',project.organization_id);if(d.error)results.push({name:'cleanup '+table,status:'FAIL',error:d.error.message});}
 for(const r of [...records].reverse()){const d=await svc.from(r.table).delete().eq('id',r.id).eq('organization_id',r.org);if(d.error)results.push({name:'cleanup '+r.table,status:'FAIL',error:d.error.message});else r.cleaned=true;}
 save();if(results.some(x=>x.status==='FAIL'))process.exitCode=1;
});
