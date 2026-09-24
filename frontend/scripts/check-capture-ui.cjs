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
   const raw='{"eventID":"saved-1","eventTime":"2026-09-24T00:00:00Z","eventName":"RunInstances","eventSource":"ec2.amazonaws.com","awsRegion":"us-east-1","recipientAccountId":"111122223333","userIdentity":{"type":"IAMUser","userName":"analyst"},"opaque":9007199254740993}';
   const config={mode:'create-infra',profile:'investigator',region:'us-east-1',queueUrl:'',ruleArn:'',dumpPath:'',dumpText:'',capturePattern:''};
   const infra={owned:true,queueUrl:'https://sqs.us-east-1.amazonaws.com/111122223333/cloudmon-capture-saved',queueName:'cloudmon-capture-saved',queueArn:'arn:aws:sqs:us-east-1:111122223333:cloudmon-capture-saved',ruleName:'cloudmon-cloudtrail-saved',ruleArn:'arn:aws:events:us-east-1:111122223333:rule/cloudmon-cloudtrail-saved',region:'us-east-1',account:'111122223333',allManagement:true};
   const recovering=location.search.includes('recovery');
   const state=window.captureTest={delayIdentity:false,delayTrail:false,failTrail:false,startCalls:0,resumeCalls:0,removeCalls:0,cleanupFails:false,exportFails:false,exported:null,raw,
     recovery:{evidence:{events:recovering?1:0,observations:recovering?3:0,variantEvents:recovering?1:0,lossy:recovering?1:0},capture:recovering?{version:1,phase:'ready',config,infra}:null,captureError:'',active:false}};
   window.runtime={EventsOn:()=>()=>{}};
   window.go={main:{App:{
    Log:async()=>{},MaximizeWindow:async()=>{},
    GetRecoveryState:async()=>structuredClone(state.recovery),
    StartCapture:async()=>{state.startCalls++;throw Error('Unexpected provisioning')},
    ResumeCapture:async()=>{state.resumeCalls++;state.recovery.active=true;return infra},
    StopCapture:async()=>{state.recovery.active=false},
    TeardownCapture:async()=>{state.removeCalls++;state.recovery.active=false;if(state.cleanupFails){state.recovery.capture.phase='cleanup';throw Error('Queue deletion denied; saved resources retained')}state.recovery.capture=null},
    QueryAggregates:async()=>({total:1,facets:{},histogram:[],histFrom:0,histTo:0,histStep:60000,stats:{errors:0,principals:1,sources:1,regions:1,minMs:0,maxMs:0}}),
    QueryPage:async()=>[{seq:1,eventID:'saved-1',eventName:'RunInstances',eventSource:'ec2.amazonaws.com',eventTime:'2026-09-24T00:00:00Z',awsRegion:'us-east-1',identityType:'IAMUser',userName:'analyst',readOnly:false,managementEvent:true}],
    QueryNewer:async()=>[],GetEventRaw:async()=>raw,
    RawBySeqs:async()=>{if(state.exportFails)throw Error('Storage unavailable');return [raw]},
    ExportEventsJSON:async(data)=>{state.exported=data;return 'selection.json'},
    GetEventEvidence:async()=>({total:3,variants:3,observations:[1,2,3].map(id=>({id,source:id===3?'/evidence/history.csv':'/evidence/CloudTrail/2026/09/24/events.json.gz',ordinal:id,format:id===3?'event-history-csv':'cloudtrail-json',lossy:id===3,sha256:String(id).repeat(64),observedAt:'2026-09-24T00:01:00Z',displayed:id===1}))}),
    GetObservation:async(id)=>id===3?'Event name,Event ID,Recipient account ID\nRunInstances,saved-1,111122223333\n':id===2?raw.replace('9007199254740993','9007199254740995'):raw,
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
  // Recovery must stay local until the user explicitly resumes a saved queue.
  await page.goto('http://127.0.0.1:5181/?recovery');
  await page.getByRole('button',{name:'Open saved evidence',exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>[window.captureTest.startCalls,window.captureTest.resumeCalls,window.captureTest.removeCalls]),[0,0,0]);
  await page.screenshot({path:path.join(output,'recovery-start.png'),fullPage:true});
  await page.evaluate(()=>window.captureTest.cleanupFails=true);
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Remove infrastructure…',exact:true}).click();
  await page.getByText('Cleanup is incomplete.',{exact:false}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Resume capture',exact:true}).count(),0);
  await page.screenshot({path:path.join(output,'recovery-cleanup.png'),fullPage:true});
  await page.evaluate(()=>window.captureTest.cleanupFails=false);
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Remove infrastructure…',exact:true}).click();
  await page.waitForFunction(()=>window.captureTest.recovery.capture===null);
  await page.getByRole('button',{name:'Open saved evidence',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.captureTest.recovery.evidence.events),1);

  await page.goto('http://127.0.0.1:5181/?recovery');
  await page.getByRole('button',{name:'Open saved evidence',exact:true}).click();
  await page.getByText('RunInstances',{exact:true}).first().click();
  await page.getByRole('button',{name:'Sources & hashes',exact:true}).click();
  await page.getByRole('button',{name:'View source #1',exact:true}).click();
  await page.getByRole('region',{name:'Original source record'}).getByText('9007199254740993',{exact:false}).waitFor();
  assert.equal(await page.evaluate(()=>window.captureTest.resumeCalls),0);
  await page.screenshot({path:path.join(output,'evidence-sources.png'),fullPage:true});
  await page.getByRole('button',{name:'View source #3',exact:true}).click();
  await page.getByText('CSV includes only exported columns.',{exact:false}).waitFor();
  assert.ok((await page.getByRole('region',{name:'Original source record'}).locator('pre').textContent()).startsWith('Event name,Event ID,Recipient account ID\n'));
  await page.getByRole('button',{name:'Close source evidence',exact:true}).click();
  // Exercise the real export through the File menu, including the failure path.
  await page.getByRole('button',{name:'File',exact:true}).click();
  await page.getByRole('button',{name:'Export current selection…',exact:true}).click();
  await page.waitForFunction(()=>!!window.captureTest.exported);
  assert.ok((await page.evaluate(()=>window.captureTest.exported)).includes('9007199254740993'));
  await page.evaluate(()=>{window.captureTest.exportFails=true;window.captureTest.exported=null});
  const alertSeen=page.waitForEvent('dialog');
  await page.getByRole('button',{name:'File',exact:true}).click();
  await page.getByRole('button',{name:'Export current selection…',exact:true}).click();
  const alert=await alertSeen;assert.ok(alert.message().includes('Export cancelled'));await alert.accept();
  assert.equal(await page.evaluate(()=>window.captureTest.exported),null);
  await page.getByRole('button',{name:'▶ Capture',exact:true}).click();
  await page.waitForFunction(()=>window.captureTest.resumeCalls===1);
  await page.getByText('Capture running ·',{exact:false}).waitFor();
  assert.equal(await page.evaluate(()=>window.captureTest.startCalls),0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:['verified coverage','stale trail after region change','stale identity after profile change','unknown coverage warning','dedicated queue guidance','1024px layout','saved evidence stays offline','failed cleanup retains handles','cleanup preserves evidence','source variants and CSV provenance','raw export preserves large integers','export failure cancels output','explicit resume reuses capture'],errors}));
 } finally {await browser.close();await server.close()}
})().catch(e=>{console.error(e);process.exit(1)});
