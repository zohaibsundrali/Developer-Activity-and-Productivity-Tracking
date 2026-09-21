// Live, QA-only API/database checks. No external messages or billing-provider mutations.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {api,session,svc,row}=require('./live-context.cjs');
if(process.env.E2E_ALLOW_WRITES!=='1') throw Error('E2E_ALLOW_WRITES=1 is required');
const run='deepqa-'+Date.now(), records=[], results=[];
const output='artifacts/deep-qa-20260921/live-workflows.json';
function save(){fs.writeFileSync(output,JSON.stringify({run,results,records},null,2),{mode:0o600});}
async function check(name,fn){try{await fn();results.push({name,status:'PASS'});console.log('PASS',name)}catch(e){results.push({name,status:'FAIL',error:e.message});console.log('FAIL',name,e.message)}save();}
async function expectApi(role,method,path,body,status=200){const r=await api(role,method,path,body);assert.equal(r.status,status,`${method} ${path}: ${JSON.stringify(r.body)}`);return r.body;}
async function create(role,path,body,key,table){const response=await api(role,'POST',path,body);if(response.body[key]?.id){records.push({table,id:response.body[key].id,org:(await session(role)).org});save();}assert.equal(response.status,200,`${path}: ${JSON.stringify(response.body)}`);return response.body[key];}
(async()=>{
 const owner=await session('owner'), staff=await session('developer'), other=await session('org_b_owner');
 await check('invalid calendar dates rejected before database writes',async()=>{
  for(const [path,body,key,table] of [
   ['/api/assets',{assetTag:run+'-bad',name:run,purchaseDate:'2026-02-30'},'asset','assets'],
   ['/api/assets?action=licence',{name:run+'-bad',seatsTotal:1,renewalDate:'2026-02-30'},'licence','software_licences'],
   ['/api/contracts',{reference:run+'-bad',title:run,startDate:'2026-02-30'},'contract','contracts'],
   ['/api/performance?action=cycle',{name:run+'-bad',periodStart:'2026-02-30',periodEnd:'2026-03-31'},'cycle','review_cycles'],
  ]) {const response=await api('owner','POST',path,body);if(response.body[key]?.id)records.push({table,id:response.body[key].id,org:owner.org});assert.equal(response.status,400,`${path}: ${JSON.stringify(response.body)}`);}
 });
 await check('asset create, duplicate validation, assign, holdings, cross-tenant deny, return and event history',async()=>{
  const asset=await create('owner','/api/assets',{assetTag:run,name:run,category:'laptop',purchaseCost:123},'asset','assets');
  assert.equal((await row('assets',asset.id)).purchase_cost,123);
  await expectApi('owner','POST','/api/assets',{assetTag:run,name:run},409);
  await expectApi('developer','PATCH','/api/assets',{assetId:asset.id,status:'assigned',userId:staff.id},403);
  await expectApi('owner','PATCH','/api/assets',{assetId:asset.id,status:'assigned',userId:other.id},404);
  await expectApi('owner','PATCH','/api/assets',{assetId:asset.id,status:'assigned',userId:staff.id,note:run});
  assert.equal((await row('assets',asset.id)).assigned_user_id,staff.id);
  const mine=await expectApi('developer','GET','/api/assets?view=holdings');assert(mine.holdings.some(x=>x.item_id===asset.id));
  await expectApi('org_b_owner','PATCH','/api/assets',{assetId:asset.id,status:'retired'},404);
  const leaked=await other.client.from('assets').select('id').eq('id',asset.id);assert.equal(leaked.error,null);assert.deepEqual(leaked.data,[]);
  await expectApi('owner','PATCH','/api/assets',{assetId:asset.id,status:'in_stock'});assert.equal((await row('assets',asset.id)).assigned_user_id,null);
  const events=await svc.from('asset_events').select('to_status').eq('asset_id',asset.id);assert.equal(events.error,null);assert.equal(events.data.length,3);
 });
 await check('licence create, assignment, duplicate conflict, usage, release and tenant isolation',async()=>{
  const licence=await create('owner','/api/assets?action=licence',{name:run,seatsTotal:1,annualCost:100},'licence','software_licences');
  const seat=await create('owner','/api/assets?action=seat',{licenceId:licence.id,userId:staff.id},'seat','licence_seats');
  await expectApi('owner','POST','/api/assets?action=seat',{licenceId:licence.id,userId:staff.id},409);
  await expectApi('org_b_owner','POST','/api/assets?action=seat',{licenceId:licence.id,userId:other.id},404);
  const usage=await expectApi('owner','GET','/api/assets?view=licences');assert(usage.licences.some(x=>x.licence_id===licence.id));
  await expectApi('owner','PATCH','/api/assets',{seatId:seat.id});assert((await row('licence_seats',seat.id)).released_at);
 });
 await check('contract draft, signing, protected amendment and milestone lifecycle',async()=>{
  const contract=await create('finance','/api/contracts',{reference:run,title:run,value:1000,currency:'USD'},'contract','contracts');
  assert.equal((await row('contracts',contract.id)).status,'draft');
  await expectApi('developer','POST','/api/contracts',{reference:run+'-denied',title:run},403);
  await expectApi('org_b_owner','PATCH','/api/contracts',{contractId:contract.id,status:'signed'},404);
  await expectApi('finance','PATCH','/api/contracts',{contractId:contract.id,status:'signed'});assert((await row('contracts',contract.id)).signed_at);
  await expectApi('finance','PATCH','/api/contracts',{contractId:contract.id,amend:{field:'value',value:1200},reason:run},403);
  const milestone=await create('owner','/api/contracts?action=milestone',{contractId:contract.id,title:run,amount:300},'milestone','contract_milestones');
  await expectApi('owner','PATCH','/api/contracts',{milestoneId:milestone.id,status:'delivered'});assert.equal((await row('contract_milestones',milestone.id)).status,'delivered');
  await expectApi('owner','PATCH','/api/contracts',{milestoneId:milestone.id,status:'invoiced'},400);
 });
 await check('recruitment opening, candidate, stage change, outcome and database persistence',async()=>{
  const opening=await create('hr','/api/recruitment?action=opening',{title:run,status:'open',openingsCount:1},'opening','job_openings');
  const candidate=await create('hr','/api/recruitment?action=candidate',{openingId:opening.id,fullName:run,email:run+'@example.com'},'candidate','candidates');
  await expectApi('finance','PATCH','/api/recruitment',{candidateId:candidate.id,stage:'interview'},403);
  await expectApi('org_b_owner','PATCH','/api/recruitment',{candidateId:candidate.id,stage:'interview'},404);
  await expectApi('hr','PATCH','/api/recruitment',{candidateId:candidate.id,stage:'interview',note:run});assert.equal((await row('candidates',candidate.id)).stage,'interview');
  await expectApi('hr','PATCH','/api/recruitment',{candidateId:candidate.id,outcome:'rejected'});assert.equal((await row('candidates',candidate.id)).outcome,'rejected');
 });
 await check('performance review draft privacy, submit/share and goals',async()=>{
  const cycle=await create('hr','/api/performance?action=cycle',{name:run,periodStart:'2026-09-01',periodEnd:'2026-09-30',status:'open'},'cycle','review_cycles');
  const review=await create('owner','/api/performance?action=review',{cycleId:cycle.id,subjectUserId:staff.id,rating:4,strengths:run},'review','performance_reviews');
  const privateRows=await staff.client.from('performance_reviews').select('id').eq('id',review.id);assert.equal(privateRows.error,null);assert.deepEqual(privateRows.data,[]);
  const before=await expectApi('developer','GET','/api/performance?view=mine');assert(!before.reviews.some(x=>x.id===review.id));
  await expectApi('owner','PATCH','/api/performance',{reviewId:review.id,action:'submit'});
  await expectApi('owner','PATCH','/api/performance',{reviewId:review.id,action:'share'});assert.equal((await row('performance_reviews',review.id)).status,'shared');
  const after=await expectApi('developer','GET','/api/performance?view=mine');assert(after.reviews.some(x=>x.id===review.id));
  const goal=await create('hr','/api/performance?action=goal',{userId:staff.id,cycleId:cycle.id,title:run},'goal','performance_goals');
  await expectApi('hr','PATCH','/api/performance',{goalId:goal.id,status:'met'});assert.equal((await row('performance_goals',goal.id)).status,'met');
 });
})().catch(e=>{results.push({name:'setup',status:'FAIL',error:e.message});console.error(e.message)}).finally(async()=>{
 for(const record of [...records].reverse()) {const deleted=await svc.from(record.table).delete().eq('id',record.id).eq('organization_id',record.org);if(deleted.error){results.push({name:`cleanup ${record.table} ${record.id}`,status:'FAIL',error:deleted.error.message});}else record.cleaned=true;}
 save();const fail=results.filter(r=>r.status==='FAIL');console.log(JSON.stringify({passed:results.length-fail.length,failed:fail.length}));if(fail.length)process.exitCode=1;
});
