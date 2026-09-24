const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results', 'capture');
fs.mkdirSync(output, {recursive:true});
(async()=>{
 const vite=await import('vite');
 const server=await vite.createServer({root,server:{host:'127.0.0.1',port:5181,strictPort:true}}); await server.listen();
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.addInitScript(()=>{
   const state=window.captureTest={delayIdentity:false,delayTrail:false,failTrail:false};
   window.runtime={EventsOn:()=>()=>{}};
   window.go={main:{App:{
    Log:async()=>{},
    RequiredPermissions:async()=>[{action:'sqs:ChangeMessageVisibility',reason:'Keep messages leased until the local commit completes.'},{action:'cloudtrail:GetEventSelectors',reason:'Verify management-event coverage.'}],
    ListProfiles:async()=>[{name:'default',kind:'sso',region:'us-east-1'},{name:'alternate',kind:'sso',region:'eu-west-1'}],
    VerifyIdentity:async(profile,region)=>{const id={account:'111122223333',arn:`arn:aws:sts::111122223333:assumed-role/Investigator/${profile}`,userId:'test',profile,region};if(state.delayIdentity)return new Promise(resolve=>{state.resolveIdentity=()=>resolve(id)});return id;},
    CheckTrail:async(profile,region)=>{const status={hasLoggingTrail:true,trailCount:1,globalCovered:false,coverageKnown:true,coverageComplete:true,readManagement:true,writeManagement:true,summary:`Management selectors in ${region}: reads true, writes true; global-service logging enabled false. EventBridge delivery is regional and best-effort.`};if(state.failTrail)throw Error('Access denied');if(state.delayTrail)return new Promise(resolve=>{state.resolveTrail=()=>resolve(status)});return status;}
   }}};
  });
  await page.goto('http://127.0.0.1:5181');
  await page.getByRole('button',{name:'Verify identity',exact:true}).click();
  await page.getByText('Management selectors in us-east-1:',{exact:false}).waitFor();
  const coverage=page.locator('b',{hasText:'CloudTrail:'}).locator('../..');
  assert.ok((await coverage.getAttribute('style')).includes('--sev-ok'));
  await page.screenshot({path:path.join(output, 'capture-wide.png'),fullPage:true});
  await page.evaluate(()=>{window.captureTest.delayTrail=true});
  await page.getByRole('button',{name:'Re-verify',exact:true}).click();
  await page.waitForFunction(()=>!!window.captureTest.resolveTrail);
  await page.getByLabel('AWS region').selectOption('eu-west-1');
  await page.evaluate(()=>window.captureTest.resolveTrail());
  await page.waitForTimeout(60);
  assert.equal(await page.getByText('Management selectors in us-east-1:',{exact:false}).count(),0);
  await page.evaluate(()=>{window.captureTest.delayTrail=false;window.captureTest.delayIdentity=true});
  await page.getByRole('button',{name:'Verify identity',exact:true}).click();
  await page.waitForFunction(()=>!!window.captureTest.resolveIdentity);
  await page.getByPlaceholder('Search 2 profiles…').click();
  await page.getByRole('button',{name:/alternate.*sso/}).click();
  await page.evaluate(()=>window.captureTest.resolveIdentity());
  await page.waitForTimeout(60);
  assert.equal(await page.getByText('arn:aws:sts::111122223333:assumed-role/Investigator/default',{exact:true}).count(),0);
  await page.evaluate(()=>{window.captureTest.delayIdentity=false;window.captureTest.failTrail=true});
  await page.getByRole('button',{name:'Verify identity',exact:true}).click();
  await page.getByText('Coverage unknown:',{exact:false}).waitFor();
  await page.setViewportSize({width:1024,height:768});
  await page.screenshot({path:path.join(output, 'capture-unknown.png'),fullPage:true});
  await page.getByText('Connect to existing SQS',{exact:true}).click();
  await page.getByText('Use a dedicated queue;',{exact:false}).waitFor();
  await page.screenshot({path:path.join(output, 'capture-sqs.png'),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:['verified coverage','stale trail after region change','stale identity after profile change','unknown coverage warning','dedicated queue guidance','1024px layout'],errors}));
 } finally {await browser.close();await server.close()}
})().catch(e=>{console.error(e);process.exit(1)});
