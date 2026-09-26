import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('..',import.meta.url));
const dir=process.env.CLOUDMON_STORY_REPLAY_DIR;
if(!dir)throw Error('Set CLOUDMON_STORY_REPLAY_DIR to private saved live S3 evidence (seed.json + live-result.json).');
const report=JSON.parse(await fs.readFile(path.join(dir,'live-result.json'),'utf8'));
const seed=JSON.parse(await fs.readFile(path.join(dir,'seed.json'),'utf8'));
assert.equal(seed.eventName,'ListBuckets');assert.equal(report.graph.edges.length,0);
const server=await createServer({root,cacheDir:path.join(dir,'story-replay-cache'),server:{host:'127.0.0.1',port:5218,strictPort:true}});await server.listen();
const browser=await chromium.launch({headless:true});const observations=[];
try{
 for(const [width,height] of [[1440,960],[1280,800]]){
  const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:5218');
  await page.evaluate(async({report,seed})=>{const {backend}=await import('/src/api/backend.ts');
   backend.queryLineageGraph=async(_seq,snapshot)=>({...report.graph,snapshot});
   backend.queryLineageRaw=async()=>JSON.stringify(seed);
   backend.getLineageAttribution=async(_seq,snapshot)=>({...report,cached:true,graph:{...report.graph,snapshot}});
   backend.resolveLineageAttribution=async()=>{throw Error('This is saved-live-evidence replay; do not query AWS')};
  },{report,seed});
  await page.getByRole('button',{name:/Import a dump/}).click();await page.locator('input[type=file]').setInputFiles({name:'saved-live-s3.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({Records:[seed]}))});await page.getByRole('button',{name:'Load dump',exact:true}).click();
  await page.locator('.workbench-results .row').first().locator('.c-time').click();await page.getByRole('button',{name:/^View lineage/}).click();
  const dialog=page.getByRole('dialog',{name:'Credential lineage',exact:true});await dialog.getByRole('button',{name:/Inspect identity:/}).waitFor();
  assert.equal(await dialog.locator('.lgv-g').count(),3);assert.equal(await dialog.locator('.lgv-link').count(),2);assert.equal(await dialog.locator('[data-relationship=issuance]').count(),0);
  assert.equal(await dialog.locator('.lgv-detail,.lgv-notes,.la-message,.la-source').count(),0);
  assert.match(await dialog.locator('[data-relationship=identity]').textContent(),/SSO role access.*issuance not recovered/s);
  await dialog.getByRole('button',{name:'Inspect credential: AdministratorAccess',exact:true}).waitFor();await dialog.getByRole('button',{name:'Inspect activity: ListBuckets',exact:true}).waitFor();assert.match(await dialog.locator('.lgv-canvas').textContent(),/aws s3 ls/);
  const geometry=await dialog.locator('.lgv-canvas').evaluate(svg=>{const r=svg.getBoundingClientRect();return [...svg.querySelectorAll('.lgv-g')].map(n=>{const b=n.getBoundingClientRect();return {inside:b.x>=r.x&&b.y>=r.y&&b.right<=r.right&&b.bottom<=r.bottom,width:b.width}})});
  assert(geometry.every(n=>n.inside&&n.width>260),'All three nodes fit at readable scale');
  await page.mouse.move(1,1);await dialog.screenshot({path:path.join(dir,`graph-first-s3-${width}.png`)});
  await dialog.getByRole('button',{name:'Inspect connection: SSO role access',exact:true}).focus();await page.keyboard.press('Enter');await dialog.locator('.lgv-detail').getByText(/exact event-recorded Identity Store/).waitFor();await dialog.getByRole('button',{name:'Close details',exact:true}).click();
  await dialog.getByRole('button',{name:'Inspect activity: ListBuckets',exact:true}).click();await dialog.getByRole('button',{name:'Open activity event',exact:true}).click();
  const fields=page.getByRole('dialog',{name:'Lineage event',exact:true});await fields.getByRole('button',{name:'Original JSON',exact:true}).click();const original=page.getByRole('dialog',{name:'Raw JSON',exact:true});await original.getByText(seed.eventID,{exact:false}).waitFor();await page.keyboard.press('Escape');await original.waitFor({state:'detached'});await page.keyboard.press('Escape');await fields.waitFor({state:'detached'});
  await dialog.getByRole('button',{name:'Close details',exact:true}).click();await dialog.getByRole('button',{name:'Show lookup details',exact:true}).click();assert.match(await dialog.innerText(),/CloudTrail/);await dialog.getByRole('button',{name:'Hide lookup details',exact:true}).click();
  await dialog.getByRole('button',{name:'✕ Close',exact:true}).click();assert.equal(await page.locator('.workbench-results .row--selected').count(),1);assert.deepEqual(errors,[]);
  observations.push({width,height,presentationNodes:3,presentationLinks:2,provenIssuanceEdges:0,defaultTextPanels:0,originalSelectedEvidenceOpened:true,browseReturnPreserved:true,geometry});await page.close();
 }
 await fs.writeFile(path.join(dir,'graph-first-observations.json'),JSON.stringify(observations,null,2),{mode:0o600});console.log(JSON.stringify({source:'unchanged saved real S3/native App result; offline UI replay',observations}));
}finally{await browser.close();await server.close()}
