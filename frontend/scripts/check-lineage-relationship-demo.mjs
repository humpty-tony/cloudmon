import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('..',import.meta.url));
const dir=process.env.CLOUDMON_DEMO_DIR;
if(!dir)throw Error('Set CLOUDMON_DEMO_DIR to private real AWS demo evidence.');
const cases=[['role-chain',['AssumeRole','AssumeRole'],1700,640],['session-token',['GetSessionToken'],1440,600],['federation-token',['GetFederationToken'],1440,600]];
const server=await createServer({root,cacheDir:path.join(dir,'browser-cache'),server:{host:'127.0.0.1',port:5227,strictPort:true}});await server.listen();
const browser=await chromium.launch({headless:true});const observations=[];const labelErrors=[];
try{
 for(const [name,wanted,width,height] of cases){
  const target=path.join(dir,name);const report=JSON.parse(await fs.readFile(path.join(target,'live-result.json'),'utf8'));const seed=JSON.parse(await fs.readFile(path.join(target,'seed.json'),'utf8'));
  assert.equal(seed.eventName,'GetCallerIdentity');assert.deepEqual(report.graph.edges.map(e=>e.viaEvent).sort(),[...wanted].sort());
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:2});page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:5227');
  await page.evaluate(async({report,seed})=>{const {backend}=await import('/src/api/backend.ts');
   backend.queryLineageGraph=async(_seq,snapshot)=>({...report.graph,snapshot});
   backend.queryLineageRaw=async seq=>{if(seq===1)return JSON.stringify(seed);const raw=report.raw[String(seq)];if(!raw)throw Error('Missing saved original');return raw};
   backend.getLineageAttribution=async(_seq,snapshot)=>({...report,cached:true,graph:{...report.graph,snapshot}});
   backend.resolveLineageAttribution=async()=>{throw Error('Saved actual-App result replay; no new AWS calls')};
  },{report,seed});
  await page.getByRole('button',{name:/Import a dump/}).click();await page.locator('input[type=file]').setInputFiles({name:`real-${name}.json`,mimeType:'application/json',buffer:Buffer.from(JSON.stringify({Records:[seed]}))});await page.getByRole('button',{name:'Load dump',exact:true}).click();
  await page.locator('.workbench-results .row').first().locator('.c-time').click();await page.getByRole('button',{name:/^View lineage/}).click();
  const dialog=page.getByRole('dialog',{name:'Credential lineage',exact:true});await dialog.getByRole('button',{name:'Inspect activity: GetCallerIdentity',exact:true}).waitFor();
  await dialog.locator('[data-relationship=issuance]').first().waitFor();assert.equal(await dialog.locator('[data-relationship=issuance]').count(),wanted.length);
  const current=dialog.locator('.lgv-g').filter({has:page.locator('.lgv-rect.cur')});
  if(name==='session-token'){
   if(await current.locator('.lgv-kind').textContent()!=='TEMPORARY USER SESSION')labelErrors.push('GetSessionToken credential needs an explicit temporary-user-session label');
   if(await dialog.locator('.lgv-kind').filter({hasText:/^IAM USER$/}).count()!==1)labelErrors.push('Long-term IAM user must be distinguishable from the issued session');
  }
  if(name==='federation-token'){
   const expected=seed.userIdentity.arn.split('/').at(-1);
   if(await current.getAttribute('aria-label')!==`Inspect credential: ${expected}`)labelErrors.push('Federated session must use its recorded ARN name, not the issuing IAM username');
   if(await current.locator('.lgv-kind').textContent()!=='FEDERATED SESSION')labelErrors.push('Federated credential needs an explicit session-type label');
  }
  assert.equal(await dialog.locator('.lgv-detail,.lgv-notes,.la-message,.la-source').count(),0);
  const geometry=await dialog.locator('.lgv-canvas').evaluate(svg=>{const r=svg.getBoundingClientRect();return [...svg.querySelectorAll('.lgv-g')].map(n=>{const b=n.getBoundingClientRect();return {inside:b.x>=r.x&&b.y>=r.y&&b.right<=r.right&&b.bottom<=r.bottom,width:b.width}})});
  assert(geometry.every(n=>n.inside&&n.width>175),'Every actual graph node must fit without clipping');
  const links=await dialog.locator('[data-relationship=issuance]').allTextContents();assert(links.every(t=>t.includes('Issued accessKeyId match')));
  // Redact display text only. Native graph, relation labels, IDs, and originals remain untouched.
  await dialog.locator('.lgv-canvas').evaluate((svg,account)=>{for(const el of svg.querySelectorAll('text')){el.dataset.originalText=el.textContent;el.textContent=el.textContent.replaceAll(account,'[account redacted]').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[email redacted]')}},seed.recipientAccountId||seed.userIdentity.accountId);
  const visible=(await dialog.locator('svg text').allTextContents()).join('\n');assert(!/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(visible));assert(!visible.includes(seed.userIdentity.accountId));
  await page.mouse.move(1,1);await dialog.screenshot({path:path.join(target,'demo.png')});
  await dialog.locator('.lgv-canvas').evaluate(svg=>{for(const el of svg.querySelectorAll('text')){el.textContent=el.dataset.originalText;delete el.dataset.originalText}});
  const originalIds=new Set();
  for(let i=0;i<wanted.length;i++){
   await dialog.locator('[data-relationship=issuance]').nth(i).click();await dialog.getByRole('button',{name:'Open issuance event',exact:true}).click();
   const fields=page.getByRole('dialog',{name:'Lineage event',exact:true});await fields.getByRole('button',{name:'Original JSON',exact:true}).click();
   const original=page.getByRole('dialog',{name:'Raw JSON',exact:true});await original.waitFor();const text=await original.innerText();
   const ids=report.graph.edges.filter(e=>text.includes(e.viaEventId)).map(e=>e.viaEventId);assert.equal(ids.length,1);originalIds.add(ids[0]);
   await page.keyboard.press('Escape');await original.waitFor({state:'detached'});await page.keyboard.press('Escape');await fields.waitFor({state:'detached'});await dialog.getByRole('button',{name:'Close details',exact:true}).click();
  }
  assert.equal(originalIds.size,wanted.length);await dialog.getByRole('button',{name:'✕ Close',exact:true}).click();assert.equal(await page.locator('.workbench-results .row--selected').count(),1);assert.deepEqual(errors,[]);
  observations.push({case:name,width,height,provenIssuanceEdges:wanted.length,methods:wanted,presentationNodes:geometry.length,originalsOpened:originalIds.size,browseReturnPreserved:true,redactedFields:['account ID','email if present'],geometry,screenshot:path.join(target,'demo.png')});await fs.writeFile(path.join(dir,'browser-observations.json'),JSON.stringify(observations,null,2),{mode:0o600});await page.close();
 }
 assert.equal(observations.length,cases.length);assert.deepEqual(labelErrors,[]);console.log(JSON.stringify({source:'real AWS calls + live CloudTrail + actual native App resolver; browser replay of saved result',observations}));
}finally{await browser.close();await server.close()}
