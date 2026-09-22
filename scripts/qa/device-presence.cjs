const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {session,svc,api}=require('./live-context.cjs');
if(process.env.E2E_ALLOW_WRITES!=='1')throw Error('E2E_ALLOW_WRITES=1 required');
const results=[];let device,staff,step='setup';
async function rpc(actor,name,body,code){const r=await actor.client.rpc(name,body);if(code)assert.equal(r.error?.code,code,JSON.stringify(r.error));else assert.equal(r.error,null,JSON.stringify(r.error));return r.data;}
function pass(){results.push({name:step,status:'PASS'});console.log('PASS',step);}
(async()=>{
 staff=await session('developer');const owner=await session('owner'),other=await session('org_b_owner');
 step='browser session cannot send device heartbeats before enrollment';await rpc(staff,'get_tracker_presence_epoch',{},'42501');pass();
 step='new QA device enrollment, epoch initialization, heartbeat and replay protection';
 device=await rpc(staff,'enroll_tracker_device',{p_name:'deepqa-presence-'+Date.now(),p_platform:'qa-browser'});assert(device);
 assert.equal((await rpc(staff,'get_tracker_presence_epoch',{})).epoch,null);
 const stream=crypto.randomUUID();const started=await rpc(staff,'start_tracker_presence_stream',{p_expected_epoch:null,p_stream_id:stream,p_state:'tracking'});assert(started.epoch);
 const pulse={p_epoch:started.epoch,p_sequence:1,p_state:'paused'};
 const beat=await rpc(staff,'heartbeat_tracker_presence',pulse);assert.equal(beat.sequence,1);assert.equal(beat.state,'paused');
 await rpc(staff,'heartbeat_tracker_presence',pulse,'PT409');
 await rpc(staff,'start_tracker_presence_stream',{p_expected_epoch:crypto.randomUUID(),p_stream_id:crypto.randomUUID(),p_state:'tracking'},'PT409');pass();
 step='monitoring snapshot respects organization and reveals no session secret';
 const snapshot=await rpc(owner,'monitoring_tracker_presence',{p_organization_id:staff.org,p_developer_id:staff.id});assert(snapshot.devices.some(x=>x.id===device));
 const safe=snapshot.devices.find(x=>x.id===device);for(const key of ['epoch','session_id','stream_id','auth_user_id'])assert(!Object.hasOwn(safe,key));
 await rpc(other,'monitoring_tracker_presence',{p_organization_id:staff.org,p_developer_id:staff.id},'42501');pass();
 step='device revocation blocks later heartbeats and enrollment replay';
 const denied=await api('org_b_owner','DELETE','/api/devices',{id:device});assert.equal(denied.status,404);
 const revoke=await api('owner','DELETE','/api/devices',{id:device});assert.equal(revoke.status,200);
 await rpc(staff,'heartbeat_tracker_presence',{...pulse,p_sequence:2},'42501');await rpc(staff,'enroll_tracker_device',{p_name:'QA replay',p_platform:'qa-browser'},'42501');pass();
})().catch(e=>{results.push({name:step,status:'FAIL',error:e.message});console.log('FAIL',step,e.message)}).finally(async()=>{
 if(device){const r=await svc.from('tracker_devices').delete().eq('id',device).eq('organization_id',staff.org);if(r.error)results.push({name:'cleanup only QA device',status:'FAIL',error:r.error.message});else results.push({name:'cleanup only QA device',status:'PASS'});}
 fs.writeFileSync('artifacts/deep-qa-20260921/device-presence.json',JSON.stringify({results,deviceId:device},null,2),{mode:0o600});if(results.some(x=>x.status==='FAIL'))process.exitCode=1;
});
