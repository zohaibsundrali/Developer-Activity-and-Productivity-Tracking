const fs=require('node:fs');
const {session,svc}=require('./live-context.cjs');
const {createClient}=require('@supabase/supabase-js');
const tables=JSON.parse(fs.readFileSync(`${process.env.QA_ARTIFACT_DIR || 'artifacts/deep-qa-20260921'}/tenant-tables.json`,'utf8')).map(x=>x.table_name);
const rows=[];
(async()=>{
 const a=await session('owner'),b=await session('org_b_owner');
 const anonymous=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false}});
 for(let i=0;i<tables.length;i+=4)await Promise.all(tables.slice(i,i+4).map(async table=>{
  const baseline=await svc.from(table).select('organization_id',{head:true,count:'exact'}).eq('organization_id',a.org);
  for(const [actor,client] of [['other_tenant',b.client],['anonymous',anonymous]]){
   const result=await client.from(table).select('organization_id').eq('organization_id',a.org).limit(1);
   const pass=result.error?.code==='42501' || (!result.error && Array.isArray(result.data)&&result.data.length===0);
   rows.push({table,actor,baselineRows:baseline.count,baselineError:baseline.error?.code,status:result.status,error:result.error?.code,visibleRows:result.data?.length,pass});
  }
 }));
})().catch(e=>rows.push({pass:false,error:e.message})).finally(()=>{fs.writeFileSync(`${process.env.QA_ARTIFACT_DIR || 'artifacts/deep-qa-20260921'}/tenant-rest-isolation.json`,JSON.stringify(rows,null,2),{mode:0o600});const failed=rows.filter(r=>!r.pass);console.log(JSON.stringify({checks:rows.length,nonemptyChecks:rows.filter(r=>r.baselineRows>0).length,failed:failed.length,failures:failed}));if(failed.length)process.exitCode=1;});
