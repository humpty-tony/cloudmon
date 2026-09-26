import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright';
const stage=process.argv[2]||'baseline', label=process.env.POLISH_LABEL||stage;
const root=fileURLToPath(new URL('..',import.meta.url));
const out=new URL(`../test-results/desktop-polish/${label}/`,import.meta.url);await mkdir(out,{recursive:true});
const actions=[['DescribeInstances','ec2'],['GetObject','s3'],['ListBuckets','s3'],['GetSecretValue','secretsmanager']];
const records=Array.from({length:72},(_,i)=>({eventVersion:'1.11',eventID:`polish-${i}`,eventTime:new Date(Date.UTC(2026,8,26,10,i)).toISOString(),eventName:actions[i%4][0],eventSource:`${actions[i%4][1]}.amazonaws.com`,awsRegion:'us-east-1',sourceIPAddress:'198.51.100.44',userAgent:'aws-cli/2.20 synthetic-desktop-audit',recipientAccountId:'111122223333',readOnly:true,userIdentity:{type:'AssumedRole',userName:'AuditReader',principalId:'AROAPOLISH:alice-review',arn:'arn:aws:sts::111122223333:assumed-role/AuditReader/alice-review',accountId:'111122223333',sessionContext:{sessionIssuer:{type:'Role',arn:'arn:aws:iam::111122223333:role/AuditReader',userName:'AuditReader'}}},requestParameters:{bucketName:'synthetic-evidence',key:'reviews/access.json'},...(i===71?{errorCode:'AccessDenied',errorMessage:'Synthetic denied request for visual review.'}:{})}));
const server=await createServer({root,cacheDir:'node_modules/.vite-desktop-polish',server:{host:'127.0.0.1',port:5270,strictPort:true}});await server.listen();
const browser=await chromium.launch({headless:true});const observations={synthetic:true,browserPreview:true,palettes:[],screens:[]},errors=[];
const luminance=color=>{const values=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return values[0]*.2126+values[1]*.7152+values[2]*.0722};
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
try{
 for(const [width,height] of [[1280,800],[1440,960]]){
  const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:5270');assert.equal(await page.evaluate(()=>!!window.go),false);
  await page.getByRole('button',{name:/Import a dump/}).click();
  await page.locator('input[type=file]').setInputFiles({name:'synthetic-desktop.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({Records:records}))});
  await page.getByRole('button',{name:'Load dump',exact:true}).click();await page.locator('.workbench-results .row').first().waitFor();
  await page.locator('.workbench-results .row').first().locator('.c-time').click();await page.locator('.ei-review-intro h2').waitFor();await page.getByRole('button',{name:'Add to comparison',exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);
  const metrics=await page.evaluate(()=>{
   const selectors=['.workbench-results','.event-inspector--review','.workbench-results .row','.workbench-results .c-time-main','.workbench-results .eth','.workbench-action-meta','.ei-review-kind','.ei-review-stamp','.eo-section h3','.eo-origin dd','.ei-lineage-action','.ei-selected-pin button','.eo-evidence>summary','.facet-selector .facet-excl','.qbar-search','.workbench-search .tb-btn'];
   return Object.fromEntries(selectors.map(s=>{const e=document.querySelector(s);if(!e)return [s,null];const c=getComputedStyle(e),b=e.getBoundingClientRect();return [s,{text:e.textContent.slice(0,90),size:parseFloat(c.fontSize),font:c.fontFamily,color:c.color,radius:c.borderTopLeftRadius,x:b.x,y:b.y,width:b.width,height:b.height,bottom:b.bottom}]}));
  });
  observations.screens.push({width,height,metrics});await page.screenshot({path:fileURLToPath(new URL(`workbench-${width}.png`,out))});
  if(width===1280){
   const themes=await page.evaluate(async()=>(await import('/src/api/themes.ts')).THEMES.map(t=>t.key));
   for(const theme of themes){
    const values=await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;const style=getComputedStyle(document.documentElement),probe=document.createElement('span');document.body.append(probe);const read=key=>{probe.style.color=style.getPropertyValue(key);return getComputedStyle(probe).color};const result=Object.fromEntries(['--bg-0','--bg-1','--bg-2','--bg-3','--tx-1','--tx-2','--tx-3','--acc','--acc-hover','--on-acc','--acc-text'].map(key=>[key,read(key)]));probe.remove();return result},theme);
    const backgrounds=['--bg-0','--bg-1','--bg-2','--bg-3'];observations.palettes.push({theme,values,mutedMin:Math.min(...backgrounds.map(b=>contrast(values['--tx-3'],values[b]))),secondaryMin:Math.min(...backgrounds.map(b=>contrast(values['--tx-2'],values[b]))),primary:contrast(values['--on-acc'],values['--acc']),primaryHover:contrast(values['--on-acc'],values['--acc-hover'])});
   }
   await page.screenshot({path:fileURLToPath(new URL('workbench-light-1280.png',out))});await page.evaluate(()=>document.documentElement.dataset.theme='graphite');
  }
  const pin=page.getByRole('button',{name:'Add to comparison',exact:true});await pin.click();await page.getByRole('button',{name:'Next event',exact:true}).click();await page.getByRole('button',{name:'Add as second event',exact:true}).click();await page.getByRole('button',{name:'Compare events',exact:true}).click();
  await page.getByRole('dialog',{name:'Compare original records',exact:true}).locator('.comparison-change').first().waitFor();
  observations.screens.at(-1).comparison=await page.locator('.comparison-dialog').evaluate(e=>({radius:getComputedStyle(e).borderTopLeftRadius,target:e.querySelector('.comparison-value-action').getBoundingClientRect().height}));
  await page.screenshot({path:fileURLToPath(new URL(`comparison-${width}.png`,out))});await page.keyboard.press('Escape');await page.getByRole('button',{name:'Clear comparison',exact:true}).click();
  await page.getByRole('button',{name:'Hunt',exact:true}).click();await page.getByLabel('Indicator value',{exact:true}).fill('198.51.100.44');await page.getByRole('button',{name:'Add indicator',exact:true}).click();await page.screenshot({path:fileURLToPath(new URL(`hunt-${width}.png`,out))});
  const actionStyle=e=>{const s=getComputedStyle(e);return {background:s.backgroundColor,color:s.color,radius:s.borderTopLeftRadius,height:e.getBoundingClientRect().height}};
  observations.screens.at(-1).huntAction=await page.getByRole('button',{name:'Run hunt',exact:true}).evaluate(actionStyle);
  await page.getByRole('tab',{name:'Rules',exact:true}).click();await page.getByRole('button',{name:'Edit YAML',exact:true}).waitFor();await page.screenshot({path:fileURLToPath(new URL(`rules-${width}.png`,out))});
  observations.screens.at(-1).ruleAction=await page.getByRole('button',{name:'▶ Run',exact:true}).evaluate(actionStyle);
  await page.getByRole('button',{name:'Events',exact:true}).click();
  await page.locator('.qbar-input').fill('eventName=GetObject');await page.keyboard.press('Tab');
  const search=page.getByRole('button',{name:'Search',exact:true});await search.focus();
  const focus=await search.evaluate(e=>{const s=getComputedStyle(e);return {width:parseFloat(s.outlineWidth),style:s.outlineStyle,color:s.outlineColor,focused:e.matches(':focus-visible')}});
  observations.screens.at(-1).focus=focus;await page.screenshot({path:fileURLToPath(new URL(`focus-${width}.png`,out))});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.close();
 }
 await writeFile(new URL('observations.json',out),JSON.stringify({...observations,errors},null,2));assert.deepEqual(errors,[]);
 if(stage==='palette'||stage==='all')for(const p of observations.palettes){assert.ok(p.mutedMin>=4.5,`${p.theme} muted text worst-surface contrast ${p.mutedMin}`);assert.ok(p.primary>=4.5&&p.primaryHover>=4.5,`${p.theme} primary button normal/hover contrast ${p.primary}/${p.primaryHover}`)}
 if(stage==='typography'||stage==='all')for(const s of observations.screens){
  for(const selector of ['.workbench-results .c-time-main','.workbench-results .eth','.workbench-action-meta','.ei-review-kind','.ei-review-stamp','.eo-section h3','.eo-origin dd','.ei-lineage-action','.ei-selected-pin button','.eo-evidence>summary'])assert.ok(s.metrics[selector].size>=12,`${selector}: ${s.metrics[selector].size}px at ${s.width}`);
  assert.ok(s.metrics['.workbench-results .row'].height<=44,'Retain dense two-line rows');assert.ok(s.metrics['.workbench-results'].height>=650,'Preserve usable event-list height');
 }
 if(stage==='controls'||stage==='all')for(const s of observations.screens){
  for(const selector of ['.ei-lineage-action','.ei-selected-pin button','.qbar-search'])assert.ok(s.metrics[selector].height>=28,`${selector} target height ${s.metrics[selector].height}`);
  assert.ok(s.metrics['.facet-selector .facet-excl'].width>=24);assert.ok(s.comparison.target>=24);
  for(const selector of ['.qbar-search','.ei-selected-pin button','.workbench-search .tb-btn'])assert.equal(s.metrics[selector].radius,'4px',selector);
  assert.equal(s.comparison.radius,'8px');assert.equal(s.metrics['.workbench-results'].radius,'0px');
  assert.equal(s.huntAction.background,s.ruleAction.background,'Run actions use the same accent, not semantic-success green');assert.equal(s.huntAction.color,s.ruleAction.color);assert.equal(s.ruleAction.radius,'4px');
  assert.ok(s.focus.focused&&s.focus.width>=2&&s.focus.style==='solid','Visible keyboard focus ring');
 }
 console.log(JSON.stringify({stage,results:observations.palettes.map(({theme,mutedMin,primary,primaryHover})=>({theme,mutedMin,primary,primaryHover})),viewports:observations.screens.map(s=>s.width),pageErrors:errors.length,output:fileURLToPath(out)},null,2));
}finally{await browser.close();await server.close()}
