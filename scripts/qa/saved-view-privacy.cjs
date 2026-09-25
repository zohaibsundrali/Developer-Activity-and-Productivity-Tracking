const assert=require('node:assert/strict'),fs=require('node:fs');
const {session,svc}=require('./live-context.cjs');
if(process.env.E2E_ALLOW_WRITES!=='1')throw Error('E2E_ALLOW_WRITES=1 required');
let view;const result={};
const ok=r=>{assert.equal(r.error,null,r.error?.message);return r.data;};
(async()=>{
 const owner=await session('owner'),staff=await session('developer');
 view=ok(await owner.client.from('saved_views').insert({organization_id:owner.org,user_id:owner.id,name:'qa-private-view-'+Date.now(),view_type:'table',config:{},is_shared:false}).select().single());
 result.created=true;
 const rows=ok(await staff.client.from('saved_views').select('id,is_shared').eq('id',view.id));
 result.privateViewHidden=rows.length===0;
 assert.equal(result.privateViewHidden,true,'Another staff member can read a personal saved view');
})().catch(e=>{result.error=e.message;console.error(e.message);process.exitCode=1;}).finally(async()=>{
 if(view)ok(await svc.from('saved_views').delete().eq('organization_id',view.organization_id).eq('id',view.id));
 const out=process.env.QA_ARTIFACT_DIR||'test-results';fs.mkdirSync(out,{recursive:true});fs.writeFileSync(out+'/saved-view-privacy.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
});
