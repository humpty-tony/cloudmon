import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('..',import.meta.url));
const out=new URL('../test-results/vector-layout/',import.meta.url);
const operations=[['DescribeInstances','ec2'],['ListBuckets','s3'],['GetSecretValue','secretsmanager'],['GetObject','s3'],['AssumeRole','sts'],['PutObject','s3']];
const records=Array.from({length:84},(_,i)=>({eventVersion:'1.09',eventID:`vector-layout-${i}`,eventTime:new Date(Date.UTC(2026,8,24,9,0,i*15)).toISOString(),eventName:i<2?'AssumeRole':operations[i%operations.length][0],eventSource:`${i<2?'sts':operations[i%operations.length][1]}.amazonaws.com`,awsRegion:i%3?'us-east-1':'eu-west-1',sourceIPAddress:i%3?'198.51.100.24':'203.0.113.42',recipientAccountId:'111122223333',readOnly:i%6!==5,managementEvent:true,userIdentity:{type:'AssumedRole',userName:'ProdDeploy',accountId:'111122223333',arn:'arn:aws:sts::111122223333:assumed-role/ProdDeploy/cli-session',principalId:'AROAFIXTURE:cli-session',sessionContext:{sessionIssuer:{type:'Role',arn:'arn:aws:iam::111122223333:role/ProdDeploy',userName:'ProdDeploy'}}},...(i>1&&i%13===0?{errorCode:'AccessDenied',errorMessage:'Synthetic policy denial'}:{})}));
// Keep the displayed synthetic callers consistent with their source records.
Object.assign(records[0],{userIdentity:{type:'IAMUser',userName:'maya.chen',accountId:'444455556666',arn:'arn:aws:iam::444455556666:user/maya.chen',principalId:'AIDAFIXTURE'},requestParameters:{roleArn:'arn:aws:iam::444455556666:role/SecurityAudit',roleSessionName:'maya-session'}});
Object.assign(records[1],{userIdentity:{type:'AssumedRole',userName:'SecurityAudit',accountId:'444455556666',arn:'arn:aws:sts::444455556666:assumed-role/SecurityAudit/maya-session',principalId:'AROAAUDIT:maya-session'},requestParameters:{roleArn:'arn:aws:iam::111122223333:role/ProdDeploy',roleSessionName:'cli-session'}});
// Explicitly synthetic lineage response: production browser preview has no
// DuckDB resolver. This exercises the real App/inspector, not native correlation.
const lineage={applicable:true,complete:true,status:'complete',sourceIdentity:'',reason:'',nodes:[
 {identityType:'IAMUser',arn:'arn:aws:iam::444455556666:user/maya.chen',userName:'maya.chen',accountId:'444455556666',roleArn:'',sessionName:'',invokedBy:'',viaSeq:1,viaEvent:'AssumeRole',viaTime:records[0].eventTime,viaSourceIP:'198.51.100.24',evidence:'Synthetic fixture: qualified issuance response',evidenceSeqs:[1]},
 {identityType:'AssumedRole',arn:'arn:aws:sts::444455556666:assumed-role/SecurityAudit/maya-session',userName:'SecurityAudit',accountId:'444455556666',roleArn:'arn:aws:iam::444455556666:role/SecurityAudit',sessionName:'maya-session',invokedBy:'',viaSeq:2,viaEvent:'AssumeRole',viaTime:records[1].eventTime,viaSourceIP:'198.51.100.24',evidence:'Synthetic fixture: qualified issuance response',evidenceSeqs:[2]}
]};
Object.assign(records[80],{userAgent:'aws-cli/2.17.0',resources:[{ARN:'arn:aws:secretsmanager:us-east-1:111122223333:secret:prod/payments',type:'AWS::SecretsManager::Secret'}],requestParameters:{secretId:'prod/payments'},errorCode:'AccessDenied',errorMessage:'Caller is not authorized to read this secret.'});
const server=await createServer({root,cacheDir:'node_modules/.vite-vector-layout',server:{host:'127.0.0.1',port:5198,strictPort:true}});
await server.listen();
const browser=await chromium.launch({headless:true});
await fs.mkdir(out,{recursive:true});
const observations=[];
try {
 for(const [width,height] of [[1440,960],[1280,800]]) {
  const page=await browser.newPage({viewport:{width,height}}), errors=[];
  page.on('pageerror',e=>errors.push(String(e)));page.setDefaultTimeout(7000);
  await page.goto('http://127.0.0.1:5198');
  assert.equal(await page.evaluate(()=>Boolean(window.go)),false);
  await page.evaluate(async response=>{const {backend}=await import('/src/api/backend.ts');window.inlineLineageCalls=0;window.graphCalls=[];
   backend.queryLineage=async()=>{window.inlineLineageCalls++;return response};
   backend.queryLineageGraph=async(seq,snapshot)=>{
    window.graphCalls.push({seq,snapshot});
    const common={arn:'',roleArn:'',roleName:'',userName:'',sessionName:'',accountId:'',accessKeyId:'',invokedBy:'',events:0,childCount:0};
    return {snapshot,applicable:true,rootId:'origin',currentId:'current',notes:['Synthetic graph fixture — not a native correlation result.'],nodes:[
     {...common,...response.nodes[0],id:'origin',kind:'origin'},
     {...common,...response.nodes[1],id:'parent',kind:'parent',roleName:'SecurityAudit'},
     {...common,id:'current',kind:'current',identityType:'AssumedRole',roleName:'ProdDeploy',sessionName:'cli-session',arn:'arn:aws:sts::111122223333:assumed-role/ProdDeploy/cli-session',accountId:'111122223333'}
    ],edges:[{parent:'origin',child:'parent',viaSeq:1,viaEvent:'AssumeRole',evidence:'Synthetic issuance fixture'},{parent:'parent',child:'current',viaSeq:2,viaEvent:'AssumeRole',evidence:'Synthetic issuance fixture'}]};
   };},lineage);
  await page.getByRole('button',{name:/Import a dump/}).click();
  await page.locator('input[type=file]').setInputFiles({name:'synthetic-vector.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({Records:records}))});
  await page.getByRole('button',{name:'Load dump',exact:true}).click();
  await page.locator('.workbench-results .row').first().waitFor();
  await page.locator('.workbench-results .row').nth(3).locator('.c-time').click();
  await page.locator('.ei-review-intro h2').waitFor();
  const measure=async()=>page.evaluate(()=>{
   const rect=s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}};
   return {grid:rect('.workbench-results'),dock:rect('.workbench-body > .event-inspector'),row:rect('.workbench-results .row'),rail:rect('.facet-selector'),overflow:document.documentElement.scrollWidth>innerWidth};
  });
  let geometry=await measure();
  assert.ok(geometry.dock.x>=geometry.grid.right-1,`Selected event must open on the RIGHT: ${JSON.stringify(geometry)}`);
  assert.ok(Math.abs(geometry.dock.y-geometry.grid.y)<2);
  assert.ok(geometry.grid.height>=550 && geometry.grid.width>=500,'Keep a useful full-height event list');
  assert.ok(geometry.row.height<=44);assert.equal(geometry.overflow,false);
  assert.equal(await page.locator('.ls-chain, .event-inspector .lg').count(),0,'No inline lineage in the review panel');
  const inspector=page.getByRole('complementary',{name:'Event inspector'});
  await inspector.getByRole('tab',{name:'Overview',exact:true}).waitFor();
  await inspector.getByText('prod/payments',{exact:true}).first().waitFor();
  await inspector.getByText('Caller is not authorized to read this secret.',{exact:true}).waitFor();
  assert.ok(await inspector.getByText('aws-cli/2.17.0',{exact:true}).isVisible());
  assert.equal(await page.evaluate(()=>window.inlineLineageCalls),0,'Do not resolve lineage while simply browsing');
  assert.equal(await page.evaluate(()=>window.graphCalls.length),0);
  await page.screenshot({path:fileURLToPath(new URL(`workbench-${width}.png`,out))});
  await inspector.getByRole('tab',{name:'Original JSON',exact:true}).click();
  const source=await inspector.locator('.ei-source').textContent();
  const id=JSON.parse(source).eventID;assert.equal(id,'vector-layout-80');
  await inspector.getByRole('tab',{name:'Overview',exact:true}).click();
  const seq=Number(await page.locator('.workbench-results .row--selected').getAttribute('data-event-seq'));
  await inspector.getByRole('button',{name:/^Credential chain/}).click();
  const graph=page.getByRole('dialog',{name:'Credential lineage',exact:true});
  await graph.locator('.lgv-g').first().waitFor();
  assert.equal(await graph.locator('.lgv-g').count(),3);
  const calls=await page.evaluate(()=>window.graphCalls);assert.ok(calls.length>=1);assert.ok(calls.every(call=>call.seq===seq && call.snapshot.generation===calls[0].snapshot.generation && call.snapshot.maxSeq===calls[0].snapshot.maxSeq));assert.ok(calls[0].snapshot.generation); // Dev StrictMode may remount the graph effect.
  await page.screenshot({path:fileURLToPath(new URL(`lineage-popup-${width}.png`,out))});
  await page.keyboard.press('Escape');await graph.waitFor({state:'detached'});
  assert.equal(await inspector.getByRole('button',{name:/^Credential chain/}).evaluate(el=>el===document.activeElement),true);
  assert.equal(Number(await page.locator('.workbench-results .row--selected').getAttribute('data-event-seq')),seq);
  // AR-3 navigation retains the selected evidence mode.
  await inspector.getByRole('tab',{name:'Original JSON',exact:true}).click();
  await inspector.getByRole('button',{name:'Previous event',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.ei-source')?.textContent?.includes('vector-layout-81'));
  assert.equal(await inspector.getByRole('tab',{name:'Original JSON',exact:true}).getAttribute('aria-selected'),'true');
  await inspector.getByRole('button',{name:'Next event',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.ei-source')?.textContent?.includes('vector-layout-80'));
  await inspector.getByRole('tab',{name:'Overview',exact:true}).click();
  // Explicit fixture for the desktop-only context engine: test UI scope/ownership, not native correlation.
  await page.evaluate(async()=>{
   const {backend}=await import('/src/api/backend.ts');
   window.contextCalls=[];
   backend.investigate=async options=>{
    window.contextCalls.push(options);
    const data=await backend.queryPage({includes:{},excludes:{},text:'',errorsOnly:false,hideReadOnly:false,fromMs:0,toMs:0,expr:null},0,1000);
    const anchor=data.find(e=>e.seq===options.seq);
    const row=e=>({...e,rawJSON:'',identityType:e.userIdentity.type,identityArn:e.userIdentity.arn,userName:e.userIdentity.userName,accountId:e.userIdentity.accountId,principalId:e.userIdentity.principalId,roleArn:e.userIdentity.roleArn,sessionName:e.userIdentity.sessionName});
    const events=data.filter(e=>Math.abs(Date.parse(e.eventTime)-Date.parse(anchor.eventTime))<=options.minutes*60000 && (options.relation!=='ip' || e.sourceIPAddress===anchor.sourceIPAddress)).sort((a,b)=>Date.parse(a.eventTime)-Date.parse(b.eventTime)).map(e=>({event:row(e),reasons:[{label:'Synthetic context fixture'}]}));
    if(window.contextFail)throw new Error('Synthetic context query failure');
    return {snapshot:options.snapshot,anchor:row(anchor),total:events.length,events,notes:['Synthetic response; native correlation is tested separately.']};
   };
  });
  const browse=page.getByRole('region',{name:'Event results',exact:true});
  await browse.locator('.etbody').evaluate(el=>{el.scrollTop=630;});
  await page.waitForTimeout(100);
  await browse.locator('.row').nth(4).locator('.c-time').click();
  await inspector.getByRole('button',{name:/^Credential chain/}).waitFor();
  await page.locator('.qbar-input').fill('eventName=unapplied');
  const before=await browse.evaluate(el=>({scroll:el.querySelector('.etbody').scrollTop,seq:el.querySelector('.row--selected')?.getAttribute('data-event-seq'),heading:el.querySelector('.workbench-list-heading strong').textContent}));
  await inspector.getByRole('button',{name:'Same source IP',exact:false}).click();
  const context=page.getByRole('region',{name:'Contextual event results'});
  await context.locator('.row').first().waitFor();
  assert.ok(await page.locator('.qbar-input').isDisabled());
  assert.match(await context.innerText(),/browsing filters not applied/);
  const requests=await page.evaluate(()=>window.contextCalls);
  assert.ok(requests.every(r=>r.seq===Number(before.seq) && r.relation==='ip' && r.snapshot.generation));
  await context.locator('.row').first().locator('.c-time').click();
  await page.screenshot({path:fileURLToPath(new URL(`context-${width}.png`,out))});
  await context.getByRole('button',{name:'Back to Events',exact:true}).click();
  await page.waitForTimeout(120);
  assert.equal(await page.locator('.qbar-input').inputValue(),'eventName=unapplied');
  const restored=await browse.evaluate(el=>({scroll:el.querySelector('.etbody').scrollTop,seq:el.querySelector('.row--selected')?.getAttribute('data-event-seq'),heading:el.querySelector('.workbench-list-heading strong').textContent}));
  assert.deepEqual(restored,before,'Context return must restore selection, nonzero scroll and applied count');
  await page.evaluate(()=>{window.contextFail=true});
  await inspector.getByRole('button',{name:'Related events',exact:true}).click();
  await context.getByRole('alert').waitFor();
  await page.evaluate(()=>{window.contextFail=false});
  await context.getByRole('button',{name:'Retry context'}).click();
  await context.locator('.row').first().waitFor();
  await context.getByRole('button',{name:'Back to Events',exact:true}).click();
  // Sources wraps the existing form. Escape retains browsing and restores focus.
  await page.getByRole('button',{name:'Data sources…',exact:true}).click();
  const sources=page.getByRole('dialog',{name:'Sources',exact:true});
  await sources.getByRole('button',{name:'Open saved evidence',exact:true}).waitFor();
  assert.ok(await sources.locator('input[type=file]').isVisible());
  await page.screenshot({path:fileURLToPath(new URL(`sources-${width}.png`,out))});
  for(let i=0;i<12;i++){await page.keyboard.press('Tab');assert.ok(await sources.evaluate(el=>el.contains(document.activeElement)));}
  await page.keyboard.press('Escape'); await sources.waitFor({state:'detached'});
  assert.equal(await page.getByRole('button',{name:'Data sources…',exact:true}).evaluate(el=>el===document.activeElement),true);
  assert.equal(await browse.locator('.etbody').evaluate(el=>el.scrollTop),before.scroll);
  await page.getByRole('button',{name:'Data sources…',exact:true}).click();
  await sources.getByRole('button',{name:'Open saved evidence',exact:true}).click();
  await sources.waitFor({state:'detached'});
  assert.equal(await page.locator('.qbar-input').inputValue(),'eventName=unapplied','Opening the same saved evidence must not reset browsing');
  assert.equal(await browse.locator('.row--selected').getAttribute('data-event-seq'),before.seq);
  console.log(`PASS ${width}x${height}: navigation/tab retention, contextual scope and error/retry, exact browse return, Sources containment/cancel/offline reopen`);
  observations.push({width,height,geometry,selectedEventID:id,lineage:'on-demand popup, exact selected snapshot',context:'fixed selected snapshot, explicit scope, exact browse return',sources:'focus-contained, cancellation and offline reopen preserve browsing'});
  await page.getByRole('button',{name:'Close inspector',exact:true}).click();
  assert.equal(await page.locator('.event-inspector.has-event').count(),0);
  assert.ok((await measure()).grid.width>geometry.grid.width,'Closing selection must return the width to the logs');
  // Import failure keeps old evidence and browsing; successful replacement resets the session.
  await page.getByRole('button',{name:'Data sources…',exact:true}).click();
  await sources.getByRole('button',{name:'Load dump',exact:true}).waitFor();
  const replacement={...records[0],eventID:'replacement-review',eventName:'ListBuckets',eventSource:'s3.amazonaws.com'};
  await sources.locator('input[type=file]').setInputFiles({name:'replacement.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({Records:[replacement]}))});
  await page.evaluate(async()=>{const {backend}=await import('/src/api/backend.ts');window.originalIngest=backend.ingestText.bind(backend);backend.ingestText=async()=>{throw new Error('Synthetic import failure; old evidence retained')};});
  await sources.getByRole('button',{name:'Load dump',exact:true}).click();
  await sources.getByText('Synthetic import failure; old evidence retained',{exact:false}).waitFor();
  assert.equal(await browse.locator('.workbench-list-heading strong').textContent(),'84 events');
  assert.equal(await page.locator('.qbar-input').inputValue(),'eventName=unapplied');
  await page.evaluate(async()=>{const {backend}=await import('/src/api/backend.ts');backend.ingestText=window.originalIngest;});
  await sources.getByRole('button',{name:'Load dump',exact:true}).click();
  await sources.waitFor({state:'detached'});
  await page.waitForFunction(()=>document.querySelector('.workbench-list-heading strong')?.textContent==='1 events');
  assert.equal(await page.locator('.qbar-input').inputValue(),'');
  assert.equal(await page.locator('.event-inspector.has-event').count(),0);
  console.log(`PASS ${width}x${height}: failed import retains evidence; successful replacement resets dataset session`);
  assert.deepEqual(errors,[]);
  console.log(`PASS ${width}x${height}: right-hand event overview, resources/errors/source, on-demand lineage popup, exact evidence and close/return`);
  await page.close();
 }
 await fs.writeFile(new URL('layout.json',out),JSON.stringify({scope:'Production App with synthetic imported events and a synthetic lineage response; no native resolver or AWS',observations},null,2));
} catch(error) {for(const page of browser.contexts().flatMap(c=>c.pages())) await page.screenshot({path:fileURLToPath(new URL(`failure-${page.viewportSize().width}.png`,out))});throw error;}
finally {await browser.close();await server.close();}
