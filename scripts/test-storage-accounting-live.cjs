// Uses only QA Test Org A and removes only its own newly created object.
// Usage: E2E_ALLOW_WRITES=1 node scripts/test-storage-accounting-live.cjs
require('@next/env').loadEnvConfig(process.cwd());
if (process.env.E2E_ALLOW_WRITES !== '1') throw new Error('Set E2E_ALLOW_WRITES=1 to run the QA-only upload test.');
const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
(async()=>{
 const assert=require('node:assert/strict');
 const {data:org,error}=await s.from('organizations').select('id,name').eq('name','QA Test Org A').single();
 assert.equal(error,null);assert.equal(org.name,'QA Test Org A');
 const usage=async()=>{const r=await s.rpc('organization_storage_usage',{p_org:org.id});assert.equal(r.error,null);return Number(r.data);};
 const before=await usage();
 const path=org.id+'/qa-storage-ledger/'+require('node:crypto').randomUUID()+'.txt';
 const contents=Buffer.from('Verisade QA storage accounting check');
 let uploaded=false;
 try {
  const result=await s.storage.from('org-files').upload(path,contents,{contentType:'text/plain',upsert:false});assert.equal(result.error,null);uploaded=true;
  assert.equal(await usage(),before+contents.length);
  const download=await s.storage.from('org-files').download(path);assert.equal(download.error,null);assert.equal(await download.data.text(),contents.toString());
  console.log('PASS: Storage API upload/download and exact billing byte increase');
 } finally {
  if(uploaded){const removed=await s.storage.from('org-files').remove([path]);assert.equal(removed.error,null);}
 }
 assert.equal(await usage(),before);
 console.log('PASS: only the newly created QA object removed; usage restored');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
