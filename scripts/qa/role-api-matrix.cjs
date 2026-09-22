// Read/deny probes only. Allowed writes receive invalid required input and must not mutate.
const fs=require('node:fs'), assert=require('node:assert/strict');
const {api,session,svc}=require('./live-context.cjs');
const rolesText=fs.readFileSync('src/utils/roles.js','utf8').replace(/^export /gm,'');
const catalogue=fs.readFileSync('src/utils/permissionCatalogue.js','utf8').replace(/^import .*;$/gm,'').replace(/^export /gm,'');
const {ROLES,PERMISSIONS,permissionsForRole}=new Function(rolesText+'\n'+catalogue+'\nreturn {ROLES,PERMISSIONS,permissionsForRole};')();
const matrix=[
 ['GET','/api/assets','asset.view'],['GET','/api/assets?view=licences','licence.view'],['GET','/api/contracts','contract.view'],
 ['GET','/api/recruitment','job.view'],['GET','/api/performance','review_cycle.manage|review.write'],['GET','/api/performance?view=mine','review.view_own'],
 ['GET','/api/quality','test_case.view'],['GET','/api/invitations','member.invite'],['GET','/api/invoicing','invoice.view'],
 ['GET','/api/capacity','capacity.view'],['GET','/api/signals','signal.view'],['GET','/api/admin/permissions','permissions.manage'],
 ['POST','/api/assets','asset.manage'],['POST','/api/assets?action=licence','licence.manage'],['POST','/api/assets?action=seat','licence.manage'],
 ['POST','/api/contracts','contract.manage'],['POST','/api/contracts?action=milestone','contract.manage'],
 ['POST','/api/recruitment?action=opening','job.manage'],['POST','/api/recruitment?action=candidate','candidate.manage'],
 ['POST','/api/performance?action=cycle','review_cycle.manage'],['POST','/api/performance?action=review','review.write'],['POST','/api/performance?action=goal','goal.manage'],
 ['POST','/api/quality?action=case','test_case.manage'],['POST','/api/quality?action=run','test_run.manage'],
 ['POST','/api/leave','leave.request_own'],['POST','/api/timesheets','timesheet.submit_own'],['POST','/api/invoicing','invoice.manage'],
];
const results=[];
(async()=>{
 const defined=new Set(PERMISSIONS.map(p=>p.key));for(const [,,key]of matrix)assert(key.split('|').every(k=>defined.has(k)),'Unknown matrix key '+key);
 async function probe(role){
  const expected=permissionsForRole(role);
  const check=await api(role,'GET','/api/me/permissions');
  results.push({role,method:'GET',path:'/api/me/permissions',status:check.status,pass:check.status===200&&JSON.stringify([...check.body.permissions].sort())===JSON.stringify([...expected].sort())});
  for(const [method,path,key] of matrix){
   const allowed=key.split('|').some(k=>expected.includes(k)), wanted=allowed?(method==='GET'?200:400):403;
   const r=await api(role,method,path,method==='GET'?undefined:{});
   const pass=r.status===wanted;results.push({role,method,path,key,expected:wanted,status:r.status,pass,...(!pass?{error:r.body.error}: {})});
  }
  const platform=await api(role,'GET','/api/platform/access');results.push({role,method:'GET',path:'/api/platform/access',expected:403,status:platform.status,pass:platform.status===403});
  console.log(role,results.filter(r=>r.role===role&&!r.pass).length?'FAIL':'PASS');
 }
 for(let i=0;i<ROLES.length;i+=3)await Promise.all(ROLES.slice(i,i+3).map(probe));
})().catch(e=>results.push({pass:false,error:e.message})).finally(()=>{fs.writeFileSync('artifacts/deep-qa-20260921/role-api-matrix.json',JSON.stringify(results,null,2),{mode:0o600});const failed=results.filter(r=>!r.pass);console.log(JSON.stringify({checks:results.length,failed:failed.length,failures:failed}));if(failed.length)process.exitCode=1;});
