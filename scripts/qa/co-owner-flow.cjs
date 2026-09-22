// Synthetic QA organizations only. No outbound email; insert through real owner RLS.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const {createClient}=require('@supabase/supabase-js');
const {api,session,svc,env}=require('./live-context.cjs');
const run=crypto.randomUUID(), email=`verisade-qa-coowner-${run}@example.com`, password=crypto.randomBytes(24).toString('base64url');
const results=[];let invitation,created,profile;
const check=(label,condition)=>{assert(condition,label);results.push({check:label,pass:true});console.log('PASS:',label);};
async function call(token,method,path,body){const r=await fetch((process.env.E2E_BASE_URL||env.E2E_BASE_URL)+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(45000)});return {status:r.status,body:await r.json()};}
(async()=>{
 const owner=await session('owner'), converted=await session('admin'),hr=await session('hr'), foreign=await session('org_b_owner');
 check('legacy organization admin is now owner',converted.role==='owner');
 const standard=await api('owner','GET','/api/me/permissions'),second=await api('admin','GET','/api/me/permissions');
 check('both existing owners have identical effective permissions',standard.status===200&&second.status===200&&JSON.stringify(standard.body.permissions.slice().sort())===JSON.stringify(second.body.permissions.slice().sort()));
 check('organization owner cannot open Verisade platform statistics',(await api('admin','GET','/api/platform/overview')).status===403);
 const denied=await api('hr','POST','/api/invitations',{email,role:'owner'});
 check('HR cannot invite an owner through API',denied.status===403);
 check('retired admin role cannot be invited',(await api('owner','POST','/api/invitations',{email,role:'admin'})).status===400);
 const token=crypto.randomUUID();
 const input={organization_id:owner.org,email,role:'owner',invited_by:owner.id,status:'pending',token,expires_at:new Date(Date.now()+3600000).toISOString()};
 const hrInsert=await hr.client.from('invitations').insert({...input,id:crypto.randomUUID(),invited_by:hr.id});
 check('HR direct REST owner invitation denied',!!hrInsert.error);
 const cross=await foreign.client.from('invitations').insert({...input,id:crypto.randomUUID(),invited_by:foreign.id});
 check('cross-organization direct REST owner invitation denied',!!cross.error);
 const insert=await owner.client.from('invitations').insert(input).select('id').single();
 assert.equal(insert.error,null,insert.error?.message);invitation=insert.data.id;
 check('existing owner can create owner invitation through RLS',true);
 const accept=await call(null,'POST','/api/invitations/accept',{token,fullName:'QA Co-owner',password,termsAccepted:true});
 assert.equal(accept.status,200,JSON.stringify(accept.body));check('owner invitation acceptance completes',accept.body.role==='owner'&&accept.body.userType==='admin');
 const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const signed=await client.auth.signInWithPassword({email,password});assert.equal(signed.error,null);created=signed.data.user.id;profile=signed.data.user.app_metadata.app_user_id;
 check('invited owner signs in with owner role and admin profile',signed.data.user.app_metadata.role==='owner'&&signed.data.user.app_metadata.user_type==='admin');
 const current=await call(signed.data.session.access_token,'GET','/api/me/permissions');
 check('invited owner has the same organization permissions',current.status===200&&JSON.stringify(current.body.permissions.slice().sort())===JSON.stringify(standard.body.permissions.slice().sort()));
 check('invited owner cannot access platform admin',(await call(signed.data.session.access_token,'GET','/api/platform/overview')).status===403);
 const rows=await client.from('memberships').select('id,organization_id').eq('organization_id',foreign.org);assert.equal(rows.error,null);check('invited owner cannot read another organization',rows.data.length===0);
 check('invitation token cannot be reused',(await call(null,'POST','/api/invitations/accept',{token,password,termsAccepted:true})).status===409);
 // Verify another owner can issue an owner invitation without sending email.
 const peer=await client.from('invitations').insert({...input,id:crypto.randomUUID(),email:`verisade-qa-peer-${run}@example.com`,token:crypto.randomUUID(),invited_by:profile}).select('id').single();assert.equal(peer.error,null);
 assert.equal((await svc.from('invitations').delete().eq('id',peer.data.id)).error,null);
 check('invited owner can invite a further owner',true);
 await client.auth.signOut();
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{
 // Recover generated account identity even if a check failed after acceptance.
 const found=await svc.from('admin_users').select('id,auth_user_id,organization_id').eq('email',email).maybeSingle();
 if(found.data){profile=found.data.id;created=found.data.auth_user_id;
  for(const table of ['terms_acceptances','memberships'])assert.equal((await svc.from(table).delete().eq('user_id',profile).eq('organization_id',found.data.organization_id)).error,null,`cleanup ${table}`);
  assert.equal((await svc.from('admin_users').delete().eq('id',profile).eq('email',email)).error,null);
 }
 if(invitation)assert.equal((await svc.from('invitations').delete().eq('id',invitation).eq('email',email)).error,null);
 if(created)assert.equal((await svc.auth.admin.deleteUser(created)).error,null);
 fs.writeFileSync('artifacts/coowner-20260921/live-flow.json',JSON.stringify({results,cleanup:{invitation,profile,authUser:created}},null,2),{mode:0o600});
 console.log('Synthetic co-owner account and invitation cleanup complete');
});
