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
  await page.evaluate(async response=>{const {backend}=await import('/src/api/backend.ts');backend.queryLineage=async()=>response;},lineage);
  await page.getByRole('button',{name:/Import a dump/}).click();
  await page.locator('input[type=file]').setInputFiles({name:'synthetic-vector.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({Records:records}))});
  await page.getByRole('button',{name:'Load dump',exact:true}).click();
  await page.locator('.workbench-results .row').first().waitFor();
  await page.locator('.workbench-results .row').nth(3).locator('.c-time').click();
  await page.locator('.ei-heading h2').waitFor();
  const measure=async()=>page.evaluate(()=>{
   const rect=s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}};
   return {grid:rect('.workbench-results'),dock:rect('.workbench-body > .event-inspector'),row:rect('.workbench-results .row'),rail:rect('.facet-selector'),overflow:document.documentElement.scrollWidth>innerWidth};
  });
  let geometry=await measure();
  assert.ok(geometry.dock.y>=geometry.grid.bottom-1,`Inspector must sit BELOW the grid, not beside it: ${JSON.stringify(geometry)}`);
  assert.ok(Math.abs(geometry.dock.width-geometry.grid.width)<2);
  assert.ok(geometry.grid.width>=1000 && geometry.grid.height>=280,`Useful wide log grid: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.row.height<=36,`Vector default rows must be dense, not old 52px cards: ${JSON.stringify(geometry)}`);
  assert.equal(geometry.overflow,false);
  assert.ok(geometry.grid.y<=158,`Review chrome should not push the grid down to the old stacked layout: ${JSON.stringify(geometry)}`);
  const readablePrincipal=await page.locator('.workbench-results .c-ident-name').first().evaluate(e=>e.scrollWidth<=e.clientWidth+1);
  assert.ok(readablePrincipal,'Default principal name must not be squeezed by a second truncated ARN');
  assert.ok(geometry.rail.bottom>=geometry.dock.bottom-1,'Facets must remain full height beside grid and dock');
  assert.equal(await page.getByRole('tab',{name:'Context',exact:true}).getAttribute('aria-selected'),'true');
  assert.equal(await page.getByRole('button',{name:/Inspect observed caller/}).count(),2);
  for(const name of ['Principal','Service','Region']) assert.ok(await page.locator('.workbench-results .ethead').getByText(name,{exact:true}).isVisible(),`Default grid must show ${name}`);
  await page.getByRole('tab',{name:'Original JSON',exact:true}).click();
  await page.locator('.ei-source').waitFor();
  const id=JSON.parse(await page.locator('.ei-source').textContent()).eventID;
  await page.getByRole('tab',{name:'Context',exact:true}).click();
  await page.getByRole('button',{name:'Inspect observed caller 2: SecurityAudit',exact:true}).click();
  await page.getByRole('region',{name:'Focused credential'}).waitFor();
  await page.getByRole('button',{name:'Close credential details',exact:true}).click();
  await page.screenshot({path:fileURLToPath(new URL(`workbench-${width}.png`,out))});
  observations.push({width,height,geometry,selectedEventID:id});
  await page.getByRole('button',{name:'Close inspector',exact:true}).click();
  assert.equal(await page.locator('.event-inspector.has-event').count(),0);
  assert.ok((await measure()).grid.height>=geometry.grid.height,'Closing inspection must not shrink the grid');
  assert.deepEqual(errors,[]);
  console.log(`PASS ${width}x${height}: wide dense grid; bottom context/lineage dock; full-height facets; exact selected source; keyboard-reachable credential details`);
  await page.close();
 }
 await fs.writeFile(new URL('layout.json',out),JSON.stringify({scope:'Production App with synthetic imported events and a synthetic lineage response; no native resolver or AWS',observations},null,2));
} catch(error) {for(const page of browser.contexts().flatMap(c=>c.pages())) await page.screenshot({path:fileURLToPath(new URL(`failure-${page.viewportSize().width}.png`,out))});throw error;}
finally {await browser.close();await server.close();}
