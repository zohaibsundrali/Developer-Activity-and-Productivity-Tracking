// Real synthetic QA data; rejected network operations are simulated only for recovery checks.
const {chromium,expect:baseExpect}=require('@playwright/test');
const expect=baseExpect.configure({timeout:45000});
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
const {session,svc}=require('./live-context.cjs');
if(process.env.E2E_ALLOW_WRITES!=='1')throw Error('E2E_ALLOW_WRITES=1 required');
const base=process.env.E2E_BASE_URL||'http://127.0.0.1:3132';
const name='qa-views-'+Date.now(),results=[];let browser,project;
const ok=r=>{assert.equal(r.error,null,r.error?.message);return r.data;};
const pass=message=>{results.push(message);console.log('PASS',message);};
(async()=>{
 const owner=await session('owner'),dev=await session('developer');
 const profile=ok(await svc.from('admin_users').select('*').eq('id',owner.id).single());
 const day=new Date().toISOString().slice(0,10),end=new Date(Date.now()+86400000*7).toISOString().slice(0,10);
 project=ok(await owner.client.from('projects').insert({organization_id:owner.org,name,created_by:owner.id,created_by_type:owner.type,added_by:owner.id,added_by_type:owner.type,status:'active',deadline:end}).select().single());
 const titles=[name+' owner',name+' employee',name+' unassigned'];
 ok(await owner.client.from('developer_tasks').insert(titles.map((task_title,index)=>({organization_id:owner.org,project_id:project.id,task_title,status:'pending',start_date:day,end_date:end,due_date:end,story_points:index+1,...(index===0?{assignee_admin_id:owner.id}:index===1?{developer_id:dev.id}:{})}))).select());
 browser=await chromium.launch({args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const auth=(await owner.client.auth.getSession()).data.session;
 const user={...profile,membership_role:owner.role,role:owner.type,organization_id:owner.org,loginTime:new Date().toISOString(),lastActivity:new Date().toISOString()};
 const payload=Buffer.from(JSON.stringify({t:owner.type,r:owner.role,o:owner.org,e:Math.floor(Date.now()/1000)+3600})).toString('base64url');
 const cookie=payload+'.'+crypto.createHmac('sha256',process.env.SESSION_COOKIE_SECRET||process.env.SUPABASE_SERVICE_ROLE_KEY).update(payload).digest('base64url');
 await context.addCookies([{name:'dt_session',value:cookie,url:base,httpOnly:true}]);
 const key='sb-'+new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]+'-auth-token';
 await context.addInitScript(({auth,user,key})=>{if(!sessionStorage.getItem('qa-views-init')){sessionStorage.setItem(key,JSON.stringify(auth));sessionStorage.setItem('adminUser',JSON.stringify(user));sessionStorage.setItem('qa-views-init','1');}},{auth,user,key});
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 page.setDefaultTimeout(45000);
 await page.goto(base+'/organization/dashboard?section=views');
 await page.locator('#views-project').selectOption(project.id);
 await expect(page.getByText(titles[0],{exact:true})).toBeVisible();
 await page.locator('#views-assignee').selectOption('unassigned');
 await expect(page.getByText(titles[0],{exact:true})).toHaveCount(0);
 await expect(page.getByText(titles[2],{exact:true})).toBeVisible();
 await page.locator('#views-assignee').selectOption('admin:'+owner.id);
 await expect(page.getByText(titles[0],{exact:true})).toBeVisible();
 await expect(page.getByText(titles[1],{exact:true})).toHaveCount(0);
 await expect(page.getByText(titles[2],{exact:true})).toHaveCount(0);
 pass('Owner filter and Unassigned filter preserve typed assignment');
 for(const view of ['Kanban','List','Table','Workload']){
  await page.getByRole('tab',{name:view,exact:true}).click();
  await expect(page.locator('main').getByText(profile.full_name,{exact:true}).filter({visible:true}).first()).toBeVisible();
  pass(view+' displays the owner assignee');
 }
 for(const label of ['Kanban','List','Table','Calendar','Timeline','Workload']){
  await page.getByRole('tab',{name:label,exact:true}).click();
  const savedName=name+' '+label;
  page.once('dialog',dialog=>dialog.accept(savedName));
  await page.getByRole('button',{name:'Save view',exact:true}).click();
  const option=page.locator('#views-saved option').filter({hasText:savedName});
  await expect(option).toHaveCount(1);
  const savedId=await option.getAttribute('value');
  const record=ok(await owner.client.from('saved_views').select('view_type').eq('id',savedId).single());
  assert.equal(record.view_type,label==='Kanban'?'board':label.toLowerCase());
  await page.reload();await page.locator('#views-project').selectOption(project.id);await page.locator('#views-saved').selectOption(savedId);
  await expect(page.getByRole('tab',{name:label,exact:true})).toHaveAttribute('aria-selected','true');
  pass(label+' saved view restores its tab after reload');
 }
 await page.getByRole('tab',{name:'Table',exact:true}).click();
 page.once('dialog',dialog=>dialog.accept(name));
 await page.getByRole('button',{name:'Save view',exact:true}).click();
 await expect(page.locator('#views-saved option').filter({hasText:new RegExp('^'+name+'$')})).toHaveCount(1);
 const viewId=await page.locator('#views-saved option').filter({hasText:new RegExp('^'+name+'$')}).getAttribute('value');
 const stored=ok(await owner.client.from('saved_views').select('config').eq('id',viewId).single());
 assert.equal(stored.config.filters.assignee,'admin:'+owner.id);
 await page.reload();await page.locator('#views-project').selectOption(project.id);await page.locator('#views-saved').selectOption(viewId);
 await expect(page.locator('#views-assignee')).toHaveValue('admin:'+owner.id);
 await expect(page.getByText(titles[0],{exact:true})).toBeVisible();pass('Saved typed filter persists after reload');
 await page.route('**/rest/v1/saved_views*',route=>route.request().method()==='DELETE'?route.fulfill({status:200,json:[]}):route.continue());
 await page.getByRole('button',{name:'Delete saved view',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Delete',exact:true}).click();
 await expect(page.getByText('The view was not deleted. Refresh and check your access.',{exact:true})).toBeVisible();
 await expect(page.locator('#views-saved')).toHaveValue(viewId);pass('Denied zero-row delete shows error and preserves selection');
 await page.unroute('**/rest/v1/saved_views*');
 assert.equal(ok(await owner.client.from('saved_views').select('id').eq('id',viewId)).length,1);
 assert.deepEqual(errors,[]);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
 if(browser)await browser.close();
 if(project){for(const table of ['saved_views','notifications','pm_activity','activity_logs'])ok(await svc.from(table).delete().eq('organization_id',project.organization_id).eq('project_id',project.id));ok(await svc.from('projects').delete().eq('organization_id',project.organization_id).eq('id',project.id));}
 const out=process.env.QA_ARTIFACT_DIR||'test-results';fs.mkdirSync(out,{recursive:true});fs.writeFileSync(out+'/project-views-browser.json',JSON.stringify({results,passed:!process.exitCode,projectId:project?.id},null,2));
});
