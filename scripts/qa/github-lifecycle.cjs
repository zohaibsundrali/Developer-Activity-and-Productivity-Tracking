const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {api,session,svc}=require('./live-context.cjs');
if(process.env.E2E_ALLOW_WRITES!=='1')throw Error('E2E_ALLOW_WRITES=1 required');
const name='deepqa-github-'+Date.now(),results=[];let project,step='setup';
const save=()=>fs.writeFileSync(`${process.env.QA_ARTIFACT_DIR || 'artifacts/deep-qa-20260921'}/github-lifecycle.json`,JSON.stringify({name,results,projectId:project?.id},null,2),{mode:0o600});
async function call(role,method,path,body,status=200){const r=await api(role,method,path,body);assert.equal(r.status,status,`${body?.action||method} ${path}: ${JSON.stringify(r.body)}`);return r.body;}
function pass(){results.push({name:step,status:'PASS'});console.log('PASS',step);save();}
(async()=>{
 const owner=await session('owner'),staff=await session('developer');
 const date=new Date().toISOString().slice(0,10);
 const made=await owner.client.from('projects').insert({organization_id:owner.org,name,description:name,deadline:date,assigned_developer_id:staff.id,created_by:owner.id,created_by_type:owner.type,added_by:owner.id,added_by_type:owner.type,status:'active',task_plan_status:'draft'}).select().single();assert.equal(made.error,null,JSON.stringify(made.error));project=made.data;save();
 const base='/api/projects/'+project.id+'/github';
 step='repository context, real public GitHub read and project link';
 assert.equal((await call('owner','GET',base)).link,null);
 const linked=await call('owner','POST',base,{action:'link',version:0,repository:'supabase/supabase'});assert.equal(linked.link.version,1);pass();
 step='link permission and stale-version denial';
 await call('org_b_owner','GET',base,undefined,403);
 await call('developer','POST',base,{action:'unlink',version:1},403);
 await call('owner','POST',base,{action:'unlink',version:0},409);pass();
 step='preview and import public issue as an actual internal task';
 // GitHub is read-only: all imported data is written only to this new QA project.
 const response=await fetch('https://api.github.com/search/issues?q=repo%3Asupabase%2Fsupabase%20is%3Aissue%20is%3Aopen&per_page=1',{headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(20000)});assert.equal(response.status,200);
 const issue=(await response.json()).items?.find(x=>!x.pull_request);assert(issue,'A public issue is required');
 const preview=await call('owner','POST',base+'/issues',{action:'preview',number:issue.number,version:1});
 const request={action:'import',number:issue.number,version:1,fingerprint:preview.fingerprint,start:date,end:date};
 const imported=await call('owner','POST',base+'/issues',request);assert(imported.task.id);assert.equal(imported.unchanged,false);
 const replay=await call('owner','POST',base+'/issues',request);assert.equal(replay.task.id,imported.task.id);assert.equal(replay.unchanged,true);pass();
 step='sync preview, application, idempotent replay and stale evidence';
 const sync=await call('owner','POST',base+'/sync',{action:'preview',number:issue.number,version:1});
 const input={action:'sync',number:issue.number,version:1,id:crypto.randomUUID(),importId:sync.snapshot.import_id,expected:sync.expected,fingerprint:sync.fingerprint,title:'auto',description:'auto'};
 const saved=await call('owner','POST',base+'/sync',input);assert.equal(saved.revision,1);
 const twice=await call('owner','POST',base+'/sync',input);assert.equal(twice.unchanged,true);
 await call('owner','POST',base+'/sync',{...input,id:crypto.randomUUID()},409);pass();
 step='unlink removes repository access without touching external GitHub';
 const unlinked=await call('owner','POST',base,{action:'unlink',version:1});assert.equal(unlinked.link.repository_id,null);pass();
})().catch(e=>{results.push({name:step,status:'FAIL',error:e.message});console.log('FAIL',step,e.message)}).finally(async()=>{
 if(project){for(const table of ['notifications','activity_logs','pm_activity']){const r=await svc.from(table).delete().eq('organization_id',project.organization_id).eq('project_id',project.id);if(r.error)results.push({name:'cleanup '+table,status:'FAIL',error:r.error.message});}
 const r=await svc.from('projects').delete().eq('id',project.id).eq('organization_id',project.organization_id);if(r.error)results.push({name:'cleanup project',status:'FAIL',error:r.error.message});else results.push({name:'remove synthetic project and dependent records',status:'PASS'});}
 save();if(results.some(x=>x.status==='FAIL'))process.exitCode=1;
});
