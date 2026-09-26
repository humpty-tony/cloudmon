import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('..',import.meta.url));
const server=await createServer({root,cacheDir:'node_modules/.vite-typography',server:{host:'127.0.0.1',port:5197,strictPort:true}});
await server.listen();
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1280,height:800}}),external=[];
 page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:5197/')&&!r.url().startsWith('data:'))external.push(r.url());});
 await page.goto('http://127.0.0.1:5197');
 assert.equal(await page.evaluate(()=>!!window.go),false);
 const event={eventVersion:'1.09',eventID:'typography-fixture',eventTime:'2026-09-26T00:47:30Z',eventSource:'secretsmanager.amazonaws.com',eventName:'GetSecretValue',awsRegion:'us-east-1',sourceIPAddress:'203.0.113.42',userIdentity:{type:'IAMUser',userName:'typography-fixture',principalId:'AIDAEXAMPLE',accountId:'111122223333'},requestParameters:{secretId:'prod/payments'},responseElements:null,readOnly:true};
 await page.getByRole('button',{name:/^Import a dump/}).click();
 await page.locator('input[type=file]').setInputFiles({name:'typography-fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({Records:[event]}))});
 await page.getByRole('button',{name:'Load dump',exact:true}).click();
 await page.locator('.workbench-results .row').first().waitFor();
 const fonts=await page.evaluate(async()=>{const result=[];for(const w of [400,500,600])result.push((await document.fonts.load(`${w} 13px "Fira Code"`)).length);return result;});
 assert.ok(fonts.every(n=>n>0),`Bundled Fira Code weights must load, got ${fonts}`);
 const styles=await page.evaluate(()=>Object.fromEntries(['.workbench-action-name','.qbar-input','.qbar-hl'].map(s=>{const e=document.querySelector(s),c=getComputedStyle(e);return [s,{family:c.fontFamily,size:c.fontSize,features:c.fontFeatureSettings,ligatures:c.fontVariantLigatures}]})));
 for(const [selector,c] of Object.entries(styles)){
  assert.match(c.family,/^"?Fira Code"?,/,selector);
  assert.equal(c.size,'13px',selector);
  assert.equal(c.ligatures,'none',selector);
  assert.match(c.features,/"calt" 0/,selector);
 }
 await page.locator('.row .c-time').first().click();
 await page.getByRole('tab',{name:'Original',exact:true}).click();
 const source=page.locator('.ei-source');await source.waitFor();
 assert.equal(JSON.parse(await source.textContent()).eventID,event.eventID);
 assert.match(await source.evaluate(e=>getComputedStyle(e).fontFamily),/^"?Fira Code"?,/);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(external,[],'Fonts must not contact a CDN');
 console.log('PASS bundled Fira Code 400/500/600; 13px rows and aligned query overlay; literal glyphs; original evidence retained; no external requests');
}finally{await browser.close();await server.close();}
