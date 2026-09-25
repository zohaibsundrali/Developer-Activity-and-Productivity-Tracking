const assert=require('node:assert/strict'),fs=require('node:fs');
const {session,svc,row}=require('./live-context.cjs');
if(process.env.E2E_ALLOW_WRITES!=='1')throw Error('E2E_ALLOW_WRITES=1 required');
const name='qa-planning-'+Date.now(),results=[];let project;
const ok=r=>{assert.equal(r.error,null,r.error?.message);return r.data;};
const out=process.env.QA_ARTIFACT_DIR||'test-results';fs.mkdirSync(out,{recursive:true});
const save=passed=>fs.writeFileSync(out+'/planning-workflows.json',JSON.stringify({name,results,passed,projectId:project?.id},null,2));
const pass=label=>{results.push(label);console.log('PASS',label);save(false);};
(async()=>{
 const owner=await session('owner'),staff=await session('developer'),other=await session('org_b_owner');
 const day=new Date().toISOString().slice(0,10),end=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
 project=ok(await owner.client.from('projects').insert({organization_id:owner.org,name,created_by:owner.id,created_by_type:owner.type,added_by:owner.id,added_by_type:owner.type,status:'active',deadline:end}).select().single());
 save(false);
 const sprint=ok(await owner.client.from('sprints').insert({organization_id:owner.org,project_id:project.id,name,status:'planned',start_date:day,end_date:end}).select().single());
 const epic=ok(await owner.client.from('epics').insert({organization_id:owner.org,project_id:project.id,name,status:'open',color:'#6C82FF'}).select().single());
 const tasks=ok(await owner.client.from('developer_tasks').insert([1,2].map(n=>({organization_id:owner.org,project_id:project.id,task_title:name+' '+n,status:'pending',start_date:day,end_date:end,assignee_admin_id:owner.id,sprint_id:sprint.id,epic_id:epic.id,story_points:n*3}))).select());
 assert.equal(tasks.reduce((sum,t)=>sum+t.story_points,0),9);
 pass('Project, sprint, epic and typed tasks persist with story points');
 ok(await owner.client.from('sprints').update({status:'active'}).eq('id',sprint.id));
 assert.equal((await row('sprints',sprint.id)).status,'active');
 const foreign=await other.client.from('sprints').select('id').eq('id',sprint.id);assert.deepEqual(ok(foreign),[]);
 const noWrite=await other.client.from('epics').update({name:'forbidden'}).eq('id',epic.id).select('id');assert(noWrite.error||noWrite.data.length===0);
 assert.equal((await row('epics',epic.id)).name,name);
 pass('Sprint activation persists and cross-organization planning access is denied');
 const checklist=ok(await owner.client.from('task_checklists').insert({organization_id:owner.org,task_id:tasks[0].id,text:name}).select().single());
 ok(await owner.client.from('task_checklists').update({done:true}).eq('id',checklist.id));assert.equal((await row('task_checklists',checklist.id)).done,true);
 const comment=ok(await owner.client.from('task_comments').insert({organization_id:owner.org,task_id:tasks[0].id,author_id:owner.id,author_type:owner.type,body:name}).select().single());assert.equal((await row('task_comments',comment.id)).body,name);
 pass('Task checklist completion and typed-author comment persist');
 ok(await owner.client.from('task_dependencies').insert({organization_id:owner.org,task_id:tasks[0].id,depends_on_task_id:tasks[1].id,type:'blocks'}));
 const cycle=await owner.client.from('task_dependencies').insert({organization_id:owner.org,task_id:tasks[1].id,depends_on_task_id:tasks[0].id,type:'blocks'});if(cycle.error?.code==='23514') pass('Task dependency persists and reverse cycle is rejected');
 else {results.push('FAIL: circular blocking dependency accepted by live database');console.error('FAIL: circular blocking dependency accepted by live database');process.exitCode=1;}
 try {
 const view=ok(await owner.client.from('saved_views').insert({organization_id:owner.org,project_id:project.id,user_id:owner.id,name,view_type:'table',config:{filters:{assignee:'admin:'+owner.id}},is_shared:false}).select().single());
 const hidden=await staff.client.from('saved_views').select('id').eq('id',view.id);assert.equal(ok(hidden).length,0,'personal saved view is private');
 ok(await owner.client.from('saved_views').update({name:name+' updated'}).eq('id',view.id));assert.equal((await row('saved_views',view.id)).name,name+' updated');
 pass('Saved view updates persist and personal view is hidden from other staff');
 } catch(error) {results.push('FAIL: saved-view check: '+error.message);console.error('FAIL: saved-view check:',error.message);process.exitCode=1;}
 ok(await owner.client.from('sprints').update({status:'completed'}).eq('id',sprint.id));
 const closed=await owner.client.from('developer_tasks').insert({organization_id:owner.org,project_id:project.id,task_title:name+' late',status:'pending',start_date:day,end_date:end,sprint_id:sprint.id});assert.equal(closed.error?.code,'23514','completed sprint must reject added work');
 pass('Completed sprint rejects new work that would rewrite its history');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
 if(project){for(const table of ['saved_views','notifications','pm_activity','activity_logs'])ok(await svc.from(table).delete().eq('organization_id',project.organization_id).eq('project_id',project.id));ok(await svc.from('projects').delete().eq('organization_id',project.organization_id).eq('id',project.id));}
 save(!process.exitCode);
});
