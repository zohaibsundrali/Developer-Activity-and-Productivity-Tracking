const fs=require('node:fs'),assert=require('node:assert/strict');const {svc,session}=require('./live-context.cjs');
(async()=>{const owner=await session('owner');const dir=process.env.QA_ARTIFACT_DIR || 'artifacts/deep-qa-20260921',seen=new Map();
for(const f of fs.readdirSync(dir).filter(x=>x.endsWith('.json'))){let v;try{v=JSON.parse(fs.readFileSync(dir+'/'+f))}catch{continue}
for(const r of [...(Array.isArray(v.records)?v.records:[]),...(Array.isArray(v.created)?v.created:[])])if(r.table&&r.id&&r.org===owner.org)seen.set(r.table+':'+r.id,r);
if(v.projectId)seen.set('projects:'+v.projectId,{table:'projects',id:v.projectId,org:owner.org});if(v.deviceId)seen.set('tracker_devices:'+v.deviceId,{table:'tracker_devices',id:v.deviceId,org:owner.org});}
const remaining=[];for(const r of seen.values()){const q=await svc.from(r.table).select('id',{head:true,count:'exact'}).eq('id',r.id).eq('organization_id',r.org);assert.equal(q.error,null,JSON.stringify(q.error));if(q.count)remaining.push({table:r.table,id:r.id});}
const result={checked:seen.size,remaining};fs.writeFileSync(dir+'/cleanup-verification.json',JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify({checked:seen.size,remaining:remaining.length}));if(remaining.length)process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1});
