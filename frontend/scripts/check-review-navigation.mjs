import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('..',import.meta.url));
const out=new URL('../test-results/review-navigation/',import.meta.url);
const records=[['legacy-alice','','arn:aws:iam::111122223333:user/legacy-alice'],['legacy-bob','','arn:aws:iam::111122223333:user/legacy-bob'],['principal-only','AIDAREVIEWPRINCIPAL',''],['unknown','','']].map(([name,principalId,arn],i)=>({eventID:name,eventTime:`2026-09-26T13:0${i}:00Z`,eventName:'ListBuckets',eventSource:'s3.amazonaws.com',awsRegion:'us-east-1',sourceIPAddress:i<2?'198.51.100.44':'192.0.2.10',userIdentity:{type:'IAMUser',userName:name,principalId,arn,accountId:'111122223333'},recipientAccountId:'111122223333',readOnly:true,requestParameters:{}}));
records.push(...Array.from({length:40},(_,i)=>({...records[2],userIdentity:{...records[2].userIdentity,userName:'noise-reader',principalId:'AIDANOISE'},eventID:`noise-${i}`,eventName:'DescribeInstances',eventSource:'ec2.amazonaws.com',eventTime:new Date(Date.UTC(2026,8,26,10,i)).toISOString()})));
await mkdir(out,{recursive:true});
const server=await createServer({root,cacheDir:fileURLToPath(new URL('vite-cache',out)),server:{host:'127.0.0.1',port:5250,strictPort:true}});
await server.listen();const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:960}});page.setDefaultTimeout(6000);
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
try{
 await page.goto('http://127.0.0.1:5250');
 await page.evaluate(async()=>{const {backend}=await import('/src/api/backend.ts');const original=backend.querySearch.bind(backend);window.reviewQueries=[];backend.querySearch=async(...args)=>{window.reviewQueries.push(args[0]);return original(...args)}});
 await page.getByRole('button',{name:/Import a dump/}).click();
 await page.locator('input[type=file]').setInputFiles({name:'synthetic-review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({Records:records}))});
 await page.getByRole('button',{name:'Load dump',exact:true}).click();
 const rows=page.locator('.workbench-results .row');await rows.first().waitFor();
 const cell=name=>rows.filter({hasText:name}).locator('.c-identity');
 await cell('legacy-alice').hover();await cell('legacy-alice').getByTitle(/^Filter for/).click();
 await page.waitForTimeout(300);
 assert.deepEqual(await page.evaluate(()=>window.reviewQueries.at(-1).includes),{identityArn:['arn:aws:iam::111122223333:user/legacy-alice']},'Actor include must use its recorded ARN when principalId is absent');
 assert.equal(await rows.count(),1);assert.match(await rows.first().innerText(),/legacy-alice/);
 await page.getByRole('button',{name:'clear',exact:true}).click();await cell('legacy-bob').waitFor();
 await cell('legacy-alice').hover();await cell('legacy-alice').getByTitle(/^Filter out/).click();
 await page.waitForTimeout(300);
 assert.deepEqual(await page.evaluate(()=>window.reviewQueries.at(-1).excludes),{identityArn:['arn:aws:iam::111122223333:user/legacy-alice']});
 assert.equal(await rows.filter({hasText:'legacy-alice'}).count(),0);assert.equal(await rows.filter({hasText:'legacy-bob'}).count(),1);
 await page.getByRole('button',{name:'clear',exact:true}).click();await cell('legacy-alice').waitFor();
 assert.equal(await cell('unknown').getByRole('button').count(),0,'No identifier: no misleading actor pivot');
 await cell('principal-only').hover();await cell('principal-only').getByTitle(/^Filter for/).click();await page.waitForTimeout(300);
 assert.deepEqual(await page.evaluate(()=>window.reviewQueries.at(-1).includes),{principalId:['AIDAREVIEWPRINCIPAL']},'Existing populated principal pivots remain unchanged');
 await page.getByRole('button',{name:'clear',exact:true}).click();await cell('legacy-alice').waitFor();
 await page.screenshot({path:fileURLToPath(new URL('actor-pivots.png',out))});
 assert.deepEqual(errors,[]);console.log('PASS SOC-01: ARN include/exclude isolation, absent identifier controls, populated principal pivot');
 // Synthetic Hunt response only; Workbench/pivot searches use the actual browser query implementation.
 await page.evaluate(async()=>{const {backend}=await import('/src/api/backend.ts');backend.hunt=async options=>{const all=await backend.queryPage(options.filter,0,2000),matched=all.filter(e=>e.sourceIPAddress==='198.51.100.44');const row=e=>({...e,identityType:e.userIdentity.type,identityArn:e.userIdentity.arn,userName:e.userIdentity.userName,accountId:e.userIdentity.accountId,principalId:e.userIdentity.principalId,rawJSON:''});return {snapshot:await backend.getEvidenceSnapshot(),scanned:all.length,total:matched.length,limit:2000,invalidTimes:0,missingPrincipal:0,missingCredential:0,indicators:options.indicators.map(i=>({...i,matches:matched.length})),matches:matched.map(e=>({event:row(e),indicators:[0]})),pairs:[],sequences:[],notes:['Synthetic Hunt response for UI navigation; not a native IOC-engine check.']}}});
 await page.locator('.qbar-input').fill('eventName=DescribeInstances');await page.locator('.qbar-input').press('Enter');
 await page.getByText('40 events',{exact:true}).waitFor();
 const grid=page.locator('.workbench-results .etbody');await grid.evaluate(e=>e.scrollTop=440);await page.waitForTimeout(120);await rows.nth(7).locator('.c-time').click();
 await page.locator('.qbar-input').fill('eventName=unapplied');
 const before=await grid.evaluate(e=>({scroll:e.scrollTop,selected:e.querySelector('.row--selected')?.getAttribute('data-event-seq')}));
 await page.getByRole('button',{name:'Hunt',exact:true}).click();await openIndicatorBulk(page);await page.getByLabel('Typed indicators',{exact:true}).fill('ip 198.51.100.44');await page.getByRole('button',{name:'Run hunt',exact:true}).click();
 await page.getByText('2 matched events · 44 events in scope',{exact:true}).waitFor();
 const hunt=page.getByRole('main',{name:'Hunt workspace'});await hunt.getByRole('listitem').filter({hasText:'legacy-alice'}).click();
 await hunt.getByRole('button',{name:'Search all evidence by sourceIPAddress: 198.51.100.44',exact:true}).click();await page.waitForTimeout(250);
 const pivot=page.getByRole('region',{name:'Hunt pivot results',exact:true});
 assert.equal(await pivot.isVisible(),true,'Hunt pivot must visibly open a scoped Workbench result, not mutate hidden browsing');
 await pivot.getByText('2 matching events',{exact:true}).waitFor();assert.match(await pivot.innerText(),/Event filters are not applied/);
 const applied=await page.evaluate(()=>window.reviewQueries.at(-1));assert.deepEqual(applied.includes,{sourceIPAddress:['198.51.100.44']});assert.equal(applied.expr,null);
 await page.screenshot({path:fileURLToPath(new URL('hunt-pivot.png',out))});
 await pivot.getByRole('button',{name:'Back to Hunt',exact:true}).click();await hunt.getByText('2 matched events · 44 events in scope',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Events',exact:true}).click();
 assert.equal(await page.locator('.qbar-input').inputValue(),'eventName=unapplied');assert.equal(await page.getByText('40 events',{exact:true}).count(),1);
 await page.waitForTimeout(120);assert.deepEqual(await grid.evaluate(e=>({scroll:e.scrollTop,selected:e.querySelector('.row--selected')?.getAttribute('data-event-seq')})),before,'Hunt pivot must preserve exact Workbench selection and nonzero scroll');
 assert.deepEqual(errors,[]);console.log('PASS IR-01: explicit full-evidence pivot, Hunt return and untouched Workbench query/draft/selection/scroll');
}finally{await browser.close();await server.close()}

async function openIndicatorBulk(page) {
  const choices=page.getByRole('button',{name:/^(Paste multiple indicators|Back to indicator list)$/});
  await choices.waitFor();
  const toggle=page.getByRole('button',{name:'Paste multiple indicators',exact:true});
  if(await toggle.isVisible())await toggle.click();
}
