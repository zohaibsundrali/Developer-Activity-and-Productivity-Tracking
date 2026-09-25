const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({args:['--no-sandbox']});
 try {
  for (const width of [390,1440]) {
   const page = await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
   const errors=[]; page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if (!['localhost','127.0.0.1'].includes(url.hostname)) return route.fulfill({status:200,contentType:'application/json',body:'{}'});
    if(url.pathname==='/api/billing/plans') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({plans:[]})});
    if(url.pathname==='/api/send-verification') return route.fulfill({status:200,contentType:'application/json',body:'{"success":true}'});
    return route.continue();
   });
   await page.goto('http://127.0.0.1:3131',{timeout:180000});
   await expect(page.getByRole('button',{name:'Annual',exact:true})).toBeVisible({timeout:60000});
   await page.getByRole('button',{name:'Annual',exact:true}).click();
   await expect(page.locator('#pricing').getByText('$39',{exact:true})).toBeVisible();
   await expect(page.locator('#pricing').getByText('$119',{exact:true})).toBeVisible();
   await expect(page.locator('#pricing').getByText('$499',{exact:true})).toBeVisible();
   assert(await page.evaluate(()=>document.body.scrollWidth<=innerWidth),'page overflow');
   if(width===390) assert(await page.locator('[aria-label^="Plan comparison"]').evaluate(e=>e.scrollWidth>e.clientWidth));
   const colors=()=>page.evaluate(()=>({dot:getComputedStyle(document.querySelector('main section span.rounded-full')).backgroundColor, bg:getComputedStyle(document.querySelector('[data-final-cta]')).backgroundColor, text:getComputedStyle(document.querySelector('#final-cta-heading')).color}));
   const light=await colors();
   await page.getByRole('button',{name:'Dark mode',exact:true}).click();
   const dark=await colors(); assert.deepEqual(light,dark); assert.equal(light.text,'rgb(255, 255, 255)');
   await page.locator('#pricing').screenshot({path:`/tmp/verisade-pricing-${width}.png`});
   await page.evaluate(()=>{window.__navigationMarker='persisted';window.scrollTo(0,0)});
   if(width<1280) await page.getByRole('button',{name:'Open menu',exact:true}).click();
   await page.locator('header').getByRole('link',{name:'Download',exact:true}).click();
   await expect(page).toHaveURL(/\/download$/,{timeout:60000});
   await expect(page.getByRole('heading',{name:'Verisade Desktop',exact:true})).toBeVisible({timeout:60000});
   assert.equal(await page.evaluate(()=>window.__navigationMarker),'persisted','download caused full reload');
   await expect(page.locator('footer')).toBeAttached();
   await page.screenshot({path:`/tmp/verisade-download-${width}.png`,fullPage:true});
   await page.goto('http://127.0.0.1:3131/register?plan=professional',{timeout:120000});
   await expect(page.locator('#reg-name')).toBeVisible({timeout:60000});
   await expect(page.locator('#reg-company')).toHaveCount(0);
   await page.locator('#reg-name').fill('Test Person');
   await page.locator('#reg-email').fill('test@example.com');
   await page.locator('#reg-password').fill('TestPassword123!');
   await page.locator('#reg-confirm').fill('TestPassword123!');
   await page.getByRole('button',{name:'Continue to company details'}).click();
   await expect(page.locator('#reg-company')).toBeVisible();
   await page.locator('#reg-company').fill('Example Company');
   await page.getByRole('button',{name:'Back to account details'}).click();
   await expect(page.locator('#reg-email')).toHaveValue('test@example.com');
   await page.getByRole('button',{name:'Continue to company details'}).click();
   await expect(page.locator('#reg-company')).toHaveValue('Example Company');
   await page.locator('#reg-terms').click();
   await page.getByRole('button',{name:'Send verification code'}).click();
   await expect(page.getByRole('heading',{name:'Verify your email'})).toBeVisible();
   await page.goto('http://127.0.0.1:3131/contact',{timeout:120000});
   await expect(page.getByRole('button',{name:'Request a demo'})).toBeVisible({timeout:60000});
   assert(await page.evaluate(()=>document.body.scrollWidth<=innerWidth),'contact overflow');
   assert.deepEqual(errors,[]); console.log(`PASS ${width}px: pricing, themes, SPA download, registration, contact`);
   await page.close();
  }
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
