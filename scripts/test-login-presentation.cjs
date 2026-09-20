// Presentation regression only; no live credentials or Auth mutations.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async()=>{
 const browser = await chromium.launch({args:['--no-sandbox']});
 try {
  const page = await browser.newPage(); page.setDefaultTimeout(90000); page.setDefaultNavigationTimeout(90000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('devtrack.theme','dark'));
  await page.goto((process.env.E2E_BASE_URL||'http://127.0.0.1:3131')+'/login');
  await page.getByRole('heading',{name:'Welcome back'}).waitFor();
  await page.waitForTimeout(700);
  for(const [width,height] of [[1440,900],[1366,768],[1280,720],[390,844],[375,667]]){
   await page.setViewportSize({width,height});
   assert(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1),`Document overflow at ${width}x${height}`);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Horizontal overflow at ${width}`);
  }
  await page.setViewportSize({width:1366,height:768});
  assert.equal(await page.getByRole('button',{name:'Team Member',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Admin',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Client',exact:true}).count(),0);
  for(const name of ['Sign in','Back to home']) assert.equal(await page.getByRole('button',{name,exact:true}).evaluate(el=>getComputedStyle(el).color),'rgb(255, 255, 255)');
  for(const text of ['Automatic time capture','Reports people actually read','Isolated by organization','Hours, apps and activity recorded without anyone filling in a timesheet.']) assert.equal(await page.getByText(text,{exact:true}).evaluate(el=>getComputedStyle(el).color),'rgb(255, 255, 255)');
  assert.equal(await page.locator('aside svg').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)');
  assert(await page.locator('main').evaluate(el=>el.scrollHeight<=el.clientHeight+1),'Desktop form overflow');
  fs.mkdirSync('test-results/login',{recursive:true});
  await page.screenshot({path:'test-results/login/dark.png',fullPage:true});
  await page.evaluate(()=>document.documentElement.classList.remove('dark'));
  await page.screenshot({path:'test-results/login/light.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS login viewport, automatic-role form, dark text and white logo knockout');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
