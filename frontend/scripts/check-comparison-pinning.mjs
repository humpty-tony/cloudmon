import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright';

const root=fileURLToPath(new URL('..',import.meta.url));
const out=fileURLToPath(new URL('../test-results/comparison-pinning/',import.meta.url));
const action='/requestParameters/policy/Statement/0/Action';
const principal='/requestParameters/policy/Statement/0/Principal';
const tests=[];
const test=(name,run)=>tests.push({name,run});
const select=(page,index)=>page.evaluate(async index=>{window.comparisonPinning.select(index);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))},index);
const update=(page,props)=>page.evaluate(async props=>{window.comparisonPinning.update(props);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))},props);
const dialog=page=>page.getByRole('dialog',{name:'Compare original records',exact:true});
const row=(page,path)=>dialog(page).locator('.comparison-change').filter({has:page.locator('code').filter({hasText:path})});
async function pin(page,label) {
  const button=page.getByRole('button',{name:label,exact:true});
  if(!await button.isVisible()) await page.getByText('Evidence & provenance',{exact:true}).click();
  await button.click();
}
async function inspect(page,path,side) {
  const button=row(page,path).getByRole('button',{name:`Inspect ${side} value at ${path}`,exact:true});
  assert.equal(await button.count(),1,`RESEARCH-01: ${side} ${path} is only a summary; no path-focused value action`);
  await button.focus(); await page.keyboard.press('Enter');
  const preview=page.getByRole('dialog',{name:`JSON value · ${side}`,exact:true});
  await preview.locator('.source-text').waitFor();
  assert.ok(await preview.getByText(path,{exact:true}).isVisible());
  return {preview,button};
}
async function closeValue(page,button) {
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(),1,'Escape closed comparison instead of only value');
  assert.ok(await button.evaluate(el=>el===document.activeElement),'value close lost initiating focus');
}

test('comparison',async page=>{
  await pin(page,'Add to comparison'); await select(page,1); await pin(page,'Add as second event');
  await page.getByRole('button',{name:'Compare events',exact:true}).click();
  await dialog(page).locator('.comparison-change').first().waitFor();
  let opened=await inspect(page,action,'B');
  assert.deepEqual(JSON.parse(await opened.preview.locator('.source-text').textContent()),['s3:GetObject','s3:PutObject']);
  await page.setViewportSize({width:1280,height:800});
  const previewBox=await opened.preview.boundingBox();
  assert.ok(previewBox.width<=860&&previewBox.height<=620,'path-focused preview CSS lost to the shared comparison dialog');
  await page.screenshot({path:out+'comparison-value-1280.png'});
  await closeValue(page,opened.button);
  opened=await inspect(page,principal,'A');
  assert.equal(JSON.parse(await opened.preview.locator('.source-text').textContent()).AWS,'arn:aws:iam::111122223333:user/alice-review');
  await closeValue(page,opened.button);
  opened=await inspect(page,'/value','B');
  const exact=await opened.preview.locator('.source-text').textContent();
  for(const value of ['9007199254740993','0.123456789012345678901','1e3','invented','<img src=x onerror=alert(1)>']) assert.ok(exact.includes(value),`lost exact value: ${value}`);
  assert.equal(await opened.preview.locator('img').count(),0,'source HTML became live markup');
  const controls=opened.preview.getByRole('button');
  await controls.last().focus(); await page.keyboard.press('Tab');
  assert.ok(await controls.first().evaluate(el=>el===document.activeElement),'value dialog Tab escaped');
  await page.keyboard.press('Shift+Tab'); assert.ok(await controls.last().evaluate(el=>el===document.activeElement));
  await closeValue(page,opened.button);
  await dialog(page).getByRole('button',{name:'Swap A/B',exact:true}).click();
  await dialog(page).locator('.comparison-change').first().waitFor();
  opened=await inspect(page,action,'A');
  assert.ok((await opened.preview.locator('.source-text').textContent()).includes('s3:PutObject'));
  await closeValue(page,opened.button);
  opened=await inspect(page,principal,'B');
  assert.ok((await opened.preview.locator('.source-text').textContent()).includes('alice-review'));
  await closeValue(page,opened.button);
  const originals=await page.evaluate(async()=> (await import('/scripts/fixtures/comparison-pinning.tsx')).records);
  for(const [side,index] of [['A',1],['B',0]]) {
    const button=dialog(page).getByRole('button',{name:`Open original ${side}`,exact:true});
    await button.click();
    const original=page.getByRole('dialog',{name:'Raw JSON',exact:true});
    assert.equal(await original.locator('.source-text').textContent(),originals[index],'pinned original bytes changed');
    await page.keyboard.press('Escape'); assert.ok(await button.evaluate(el=>el===document.activeElement));
  }
  await page.keyboard.press('Escape');
  assert.ok(await page.getByRole('button',{name:'Compare events',exact:true}).evaluate(el=>el===document.activeElement));
  const {readComparisonValue,COMPARE_MAX_CHARS}=await server.ssrLoadModule('/src/api/compareModel.ts');
  assert.equal(readComparisonValue('{"a/b~c":{"n":9007199254740993}}',['a/b~c']),'{"n":9007199254740993}');
  assert.equal(readComparisonValue('{"empty":[],"nil":null}',['empty']),'[]');
  assert.equal(readComparisonValue('{"nil":null}',['nil']),'null');
  assert.throws(()=>readComparisonValue('{"n":1,"n":2}',[]),/Duplicate/);
  assert.throws(()=>readComparisonValue('{"__proto__":{"n":1}}',[]),/Raw JSON/);
  assert.throws(()=>readComparisonValue('{}',['constructor']),/not present/);
  assert.throws(()=>readComparisonValue('{"n":1}',['n','value']),/not present/);
  assert.throws(()=>readComparisonValue(' '.repeat(COMPARE_MAX_CHARS+1),[]),/limit/);
  assert.throws(()=>readComparisonValue('['+'0,'.repeat(50000)+'0]',[]),/bound/);
  assert.throws(()=>readComparisonValue('['.repeat(66)+'0'+']'.repeat(66),[]),/bound/);
});

test('pinning',async page=>{
  const inspector=page.getByRole('complementary',{name:'Event inspector',exact:true});
  const names=/^(Add to comparison|Add as second event|Replace second event|Selected as [AB])$/;
  const pinButton=()=>inspector.getByRole('button',{name:names});
  assert.ok(await pinButton().isVisible(),'RESEARCH-02: selected-event pin action is hidden in collapsed provenance');
  for(const viewport of [{width:1440,height:960},{width:1280,height:800}]) {
    await page.setViewportSize(viewport);
    for(const mode of ['Overview','Fields','Original JSON']) {
      await inspector.getByRole('tab',{name:mode,exact:true}).click();
      assert.equal(await inspector.locator('button').filter({hasText:names}).count(),1,'duplicate pin controls');
      assert.ok(await pinButton().isVisible(),`pin action hidden in ${mode}`);
      assert.ok(await pinButton().isEnabled());
      assert.equal(await pinButton().evaluate(el=>!!el.closest('details')),false,'pin action remains in disclosure');
      const pane=await inspector.boundingBox(),button=await pinButton().boundingBox();
      assert.ok(button.x>=pane.x&&button.x+button.width<=pane.x+pane.width&&button.y>=pane.y&&button.y+button.height<=(await inspector.locator('.ei-tabs').boundingBox()).y,'compact selected-event action is clipped or buried');
    }
    await inspector.getByRole('tab',{name:'Overview',exact:true}).click();
    await page.screenshot({path:out+`pinning-${viewport.width}.png`});
  }
  await pinButton().focus();await page.keyboard.press('Enter');
  assert.equal(await pinButton().textContent(),'Selected as A');assert.ok(await pinButton().isDisabled());
  await select(page,1);
  const raw=await page.evaluate(async()=>(await import('/scripts/fixtures/comparison-pinning.tsx')).records[1]);
  for(const state of [{rawLoading:true},{rawLoading:false,rawError:'Synthetic original failure'},{rawError:false,rawJSON:''}]) {
    await update(page,state);
    for(const mode of ['Overview','Fields','Original JSON']) {
      await inspector.getByRole('tab',{name:mode,exact:true}).click();
      assert.ok(await pinButton().isVisible());assert.ok(await pinButton().isDisabled(),'unavailable/stale raw source was pinnable');
    }
    assert.equal(await page.locator('.comparison-pin').count(),1,'unsafe source altered pins');
  }
  await update(page,{rawJSON:raw,rawLoading:false,rawError:false});
  assert.equal(await pinButton().textContent(),'Add as second event');
  await pinButton().click();assert.equal(await pinButton().textContent(),'Selected as B');
  await select(page,2);assert.equal(await pinButton().textContent(),'Replace second event');
  await pinButton().click();
  assert.ok((await page.locator('.comparison-pin').nth(1).textContent()).includes('research-c'));
  await page.getByRole('button',{name:'Compare events',exact:true}).click();
  await dialog(page).getByRole('button',{name:'Open original B',exact:true}).click();
  const original=page.getByRole('dialog',{name:'Raw JSON',exact:true});
  assert.equal(await original.locator('.source-text').textContent(),await page.evaluate(async()=>(await import('/scripts/fixtures/comparison-pinning.tsx')).records[2]));
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Remove event A',exact:true}).click();
  assert.equal(await pinButton().textContent(),'Selected as A');
  await page.getByRole('button',{name:'Clear comparison',exact:true}).click();
  assert.equal(await pinButton().textContent(),'Add to comparison');
});

const server=await createServer({root,cacheDir:'node_modules/.vite-comparison-pinning',server:{host:'127.0.0.1',port:5251,strictPort:true}});
await server.listen();
const browser=await chromium.launch({headless:true});
try {
  await mkdir(out,{recursive:true});
  let passed=0;
  for(const {name,run} of tests) {
    if(process.argv[2]&&!name.includes(process.argv[2])) continue;
    const page=await browser.newPage({viewport:{width:1440,height:960}}); page.setDefaultTimeout(5000);
    const errors=[];page.on('pageerror',e=>errors.push(String(e)));
    await page.goto('http://127.0.0.1:5251/scripts/fixtures/comparison-pinning.html');
    await page.getByRole('tab',{name:'Overview',exact:true}).waitFor();
    try {await run(page);assert.deepEqual(errors,[]);passed++;console.log(`PASS ${name}`)}
    catch(error){await page.screenshot({path:out+`${name}-failure.png`});throw error}
    finally{await page.close()}
  }
  assert.ok(passed,'no tests ran');console.log(`Comparison/pinning: ${passed} checks passed. Screenshots: ${out}`);
} finally {await browser.close();await server.close()}
