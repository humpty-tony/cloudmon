import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright';
const stage=process.argv[2]||'all';
const root=fileURLToPath(new URL('..',import.meta.url));
const out=new URL('../test-results/discovery-flow/',import.meta.url);await mkdir(out,{recursive:true});
const records=Array.from({length:48},(_,i)=>({eventVersion:'1.11',eventID:`discovery-${i}`,eventTime:new Date(Date.UTC(2026,8,26,12,i)).toISOString(),eventName:i%2?'GetObject':'ListBuckets',eventSource:'s3.amazonaws.com',awsRegion:'us-east-1',sourceIPAddress:'198.51.100.44',userAgent:'aws-cli/2 synthetic-flow-review',recipientAccountId:'111122223333',readOnly:true,userIdentity:{type:'AssumedRole',arn:'arn:aws:sts::111122223333:assumed-role/AuditReader/alice-review',principalId:'AROAREVIEW:alice-review',accountId:'111122223333',sessionContext:{sessionIssuer:{type:'Role',arn:'arn:aws:iam::111122223333:role/AuditReader',userName:'AuditReader'}}},requestParameters:{bucketName:'synthetic-evidence',key:'reviews/access.json'}}));
const server=await createServer({root,cacheDir:fileURLToPath(new URL('vite-cache',out)),server:{host:'127.0.0.1',port:5280,strictPort:true}});await server.listen();
const browser=await chromium.launch({headless:true});const observations=[];
try{
 for(const [width,height] of [[1280,800],[1440,960]]){
  const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(6000);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:5280');assert.equal(await page.evaluate(()=>!!window.go),false);
  await page.getByRole('button',{name:/Import a dump/}).click();await page.locator('input[type=file]').setInputFiles({name:'synthetic-discovery.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({Records:records}))});await page.getByRole('button',{name:'Load dump',exact:true}).click();
  const rows=page.locator('.workbench-results .row');await rows.first().waitFor();
  if(stage==='shell'||stage==='all'){
   await page.getByRole('button',{name:'Events',exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Data sources…',exact:true}).isVisible(),true);
   await page.getByRole('button',{name:/^Quick filters/}).click();assert.equal(await page.getByRole('button',{name:'Errors only',exact:true}).isVisible(),true);await page.keyboard.press('Escape');
   await page.getByRole('group',{name:'Display options'}).getByRole('button',{name:/^Columns/}).click();assert.equal(await page.getByText('Shown - grip to reorder, click to hide',{exact:true}).isVisible(),true);await page.keyboard.press('Escape');
   const search=page.getByRole('button',{name:'Search',exact:true}),query=page.getByRole('textbox',{name:'Search query',exact:true});
   assert.equal(await search.evaluate(e=>!!e.closest('.qbar')),false,'Search must sit outside the input border');
   const inputBox=await page.locator('.qbar').boundingBox(),buttonBox=await search.boundingBox();
   assert.ok(buttonBox.x>=inputBox.x+inputBox.width+6,'Search needs a visible gap to the right');
   assert.ok(Math.abs(buttonBox.y-inputBox.y)<=1&&Math.abs(buttonBox.height-inputBox.height)<=1,'Search and input should align in height');
   await query.focus();await query.press('ArrowLeft');
   const focus=await query.evaluate(e=>({inner:getComputedStyle(e).outlineStyle,outer:getComputedStyle(e.closest('.qbar')).outlineWidth,keyboard:e.matches(':focus-visible')}));
   assert.ok(focus.keyboard);assert.equal(focus.inner,'none','The text input must not draw a smaller nested focus rectangle');
   assert.ok(parseFloat(focus.outer)>=2,'Keyboard focus must visibly follow the outer query bar');
   await query.press('Tab');assert.equal(await search.evaluate(e=>e.matches(':focus-visible')&&parseFloat(getComputedStyle(e).outlineWidth)>=2),true,'Search retains its own keyboard focus ring');
   await query.fill('eventName=GetObject');await search.click();await page.getByRole('region',{name:'Event results',exact:true}).getByText('24 events',{exact:true}).waitFor();
   await query.fill('(');assert.equal(await search.isDisabled(),true,'Invalid drafts must not submit');
   await query.fill('');await query.press('Enter');await page.getByRole('region',{name:'Event results',exact:true}).getByText('48 events',{exact:true}).waitFor();
   await page.screenshot({path:fileURLToPath(new URL(`browse-${width}.png`,out))});
  }
  await rows.first().locator('.c-time').click();const inspector=page.getByRole('complementary',{name:'Event inspector'});await inspector.locator('.ei-review-intro h2').waitFor();
  if(stage==='inspect'||stage==='all'){
   const actions=inspector.getByRole('group',{name:'Investigate selected event'});
   assert.equal(await actions.getByRole('button',{name:'Related events',exact:true}).isVisible(),true);
   assert.equal(await actions.getByRole('button',{name:'Credential chain',exact:true}).isVisible(),true);
   const ip=inspector.getByRole('button',{name:'Filter current results by sourceIPAddress: 198.51.100.44',exact:true});assert.equal(await ip.isVisible(),true);
   await inspector.getByRole('tab',{name:'Original JSON',exact:true}).click();const raw=await inspector.locator('.ei-source').textContent();assert.equal(JSON.parse(raw).eventID,'discovery-47');
   assert.equal(await actions.getByRole('button',{name:'Related events',exact:true}).isVisible(),true);await inspector.getByRole('tab',{name:'Overview',exact:true}).click();
   await page.screenshot({path:fileURLToPath(new URL(`selected-${width}.png`,out))});
   await page.evaluate(async()=>{const {backend}=await import('/src/api/backend.ts');window.relatedCalls=[];backend.investigate=async options=>{window.relatedCalls.push(options);return {snapshot:options.snapshot,total:0,events:[],notes:['Synthetic related-query response: checks UI scope and return, not native matching.']}}});
   await page.locator('.qbar-input').fill('eventName=unapplied');const seq=await page.locator('.row--selected').getAttribute('data-event-seq');
   await actions.getByRole('button',{name:'Related events',exact:true}).click();const context=page.getByRole('region',{name:'Contextual event results',exact:true});await context.getByText('0 matching events',{exact:true}).waitFor();
   assert.match(await context.innerText(),/browsing filters not applied/);assert.equal(await page.evaluate(()=>window.relatedCalls.at(-1).eventID),'discovery-47');
   assert.equal(await inspector.getByRole('button',{name:'Return and filter Events by sourceIPAddress: 198.51.100.44',exact:true}).isVisible(),true);
   await context.getByText('No related events in this window.',{exact:true}).waitFor();assert.equal(await context.getByRole('button',{name:'Widen time window',exact:true}).isVisible(),true);
   await page.screenshot({path:fileURLToPath(new URL(`related-${width}.png`,out))});await context.getByRole('button',{name:'Back to Events',exact:true}).click();assert.equal(await page.locator('.qbar-input').inputValue(),'eventName=unapplied');assert.equal(await page.locator('.row--selected').getAttribute('data-event-seq'),seq);
   await page.locator('.qbar-input').fill('');
  }
  if(stage==='compare'||stage==='all'){
   await inspector.getByRole('button',{name:'Add to comparison',exact:true}).click();const tray=page.getByRole('region',{name:'Event comparison',exact:true});await tray.getByText('1 of 2 selected',{exact:true}).waitFor();assert.match(await tray.innerText(),/Select another event/);
   await inspector.getByRole('button',{name:'Next event',exact:true}).click();await inspector.getByRole('button',{name:'Add as second event',exact:true}).click();await tray.getByText('2 of 2 selected',{exact:true}).waitFor();
   await page.screenshot({path:fileURLToPath(new URL(`compare-ready-${width}.png`,out))});await tray.getByRole('button',{name:'Compare events',exact:true}).click();const comparison=page.getByRole('dialog',{name:'Compare original records',exact:true});await comparison.locator('.comparison-change').first().waitFor();assert.match(await comparison.innerText(),/discovery-47/);assert.match(await comparison.innerText(),/discovery-46/);await page.keyboard.press('Escape');await tray.getByRole('button',{name:'Clear comparison',exact:true}).click();
  }
  const geometry=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,row:document.querySelector('.workbench-results .row').getBoundingClientRect().height,grid:document.querySelector('.workbench-results').getBoundingClientRect().height}));assert.equal(geometry.overflow,false);assert.ok(geometry.row<=44&&geometry.grid>=600);assert.deepEqual(errors,[]);observations.push({width,height,stage,geometry,errors});await page.close();
 }
 await writeFile(new URL('verification.json',out),JSON.stringify({scope:'Actual React App; synthetic browser backend; related-query response stubbed; no native/AWS claim',observations},null,2));console.log(`PASS ${stage}: task labels, visible actions, scope/return, comparison and dense geometry at both desktop sizes`);
}finally{await browser.close();await server.close()}
