import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {installHuntBridge} from './fixtures/hunt-workspace-bridge.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const output=new URL('../test-results/hunt-saved-selection/',import.meta.url);
await mkdir(output,{recursive:true});
const server=await createServer({root,cacheDir:fileURLToPath(new URL('node_modules/.vite/',output)),server:{host:'127.0.0.1',port:5194,strictPort:true},plugins:[{
  name:'hunt-saved-selection-fixture',configureServer(server){server.middlewares.use('/hunt-saved-selection-fixture',async (_req,res)=>{
    res.setHeader('Content-Type','text/html');
    res.end(await server.transformIndexHtml('/hunt-saved-selection-fixture','<!doctype html><html><head><title>Saved hunt selection fixture</title></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/hunt-workspace.tsx"></script></body></html>'));
  });},
}]});
const observations=[],failures=[],errors=[];
let browser;
try {
  await server.listen();
  browser=await chromium.launch({headless:true});
  // Each action starts with a fresh origin store and its own real UI-created A/B/sequence.
  // Soft checks retain the exact visible mismatch AND the persisted wrong-target write.
  for(const action of ['Update','Rename','Delete']) {
    const context=await browser.newContext({viewport:{width:1440,height:960}});
    try {
      const page=await context.newPage();
      page.setDefaultTimeout(10000);
      page.on('pageerror',error=>errors.push(String(error)));
      await page.addInitScript(installHuntBridge);
      const panel=()=>page.locator('.hw-panel:visible');
      const mode=name=>page.getByRole('tab',{name,exact:true});
      const button=name=>panel().getByRole('button',{name,exact:true});
      const field=name=>panel().getByLabel(name,{exact:true});
      const stored=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('cloudmon.savedHunts')).items);
      const check=(label,actual,expected)=>{
        try {assert.deepEqual(actual,expected,label)}
        catch(error){failures.push(`${action}: ${error.message}`)}
      };
      const create=async name=>{
        await field('Hunt name').fill(name);
        await button('Save new hunt').click();
        await panel().getByText('Hunt saved on this device with a copy of its filter scope.').waitFor();
      };
      await page.goto('http://127.0.0.1:5194/hunt-saved-selection-fixture');
      await field('Typed indicators').fill('ip 192.0.2.10');
      await panel().getByText(/^Saved hunts \(/).click();
      await create('Indicator A');
      await field('Typed indicators').fill('ip 198.51.100.20');
      await field('Hunt scope').selectOption('workbench');
      await create('Indicator B');
      await field('Saved hunt').selectOption({label:'Indicator A'});
      await button('Load hunt').click();
      await page.waitForFunction(()=>document.querySelector('.hw-panel:not([hidden]) [aria-label="Typed indicators"]')?.value==='ip 192.0.2.10');
      assert.equal(await field('Hunt name').inputValue(),'Indicator A');
      await mode('Event sequences').click();
      await field('Step A search').fill('eventName="CreateUser"');
      await field('Step B search').fill('eventName="CreateAccessKey"');
      await field('Sequence grouping').selectOption('principal');
      await field('Sequence interval').selectOption('60');
      await panel().getByText(/^Saved hunts \(/).click();
      await create('Sequence C');
      await button('Run hunt').click();
      await panel().getByText('1 sequence · 8 events in scope').waitFor();
      await field('Step B search').fill('eventName="AttachUserPolicy"');
      const sequenceDraft=await field('Step B search').inputValue();
      const sequenceResult=await panel().locator('.analysis-result-head').innerText();
      await mode('Rules').click();
      await panel().getByRole('button',{name:'Edit YAML',exact:true}).click();
      await panel().locator('.cm-content:visible').fill('title: Unrelated retained rule');
      await button('▶ Run').click();
      await panel().getByText('✓ Ran · 8 matches',{exact:true}).waitFor();
      await mode('Event sequences').click();
      await page.getByRole('button',{name:'Change Workbench filter',exact:true}).click();
      const before=await stored();
      const a=before.find(item=>item.name==='Indicator A'),b=before.find(item=>item.name==='Indicator B');
      const sequence=before.find(item=>item.name==='Sequence C');
      assert.equal(before.length,3);
      await field('Saved hunt').selectOption(b.id);
      const calls=await page.evaluate(()=>window.huntFixture.hunts.length);
      await button('Load hunt').click();
      await page.waitForFunction(()=>document.querySelector('.hw-panel:not([hidden]) [aria-label="Typed indicators"]')?.value==='ip 198.51.100.20');
      const visible={
        mode:await mode('Indicators').getAttribute('aria-selected'),
        selectedId:await field('Saved hunt').inputValue(),
        selectedName:await field('Saved hunt').locator('option:checked').innerText(),
        name:await field('Hunt name').inputValue(),
        indicators:await field('Typed indicators').inputValue(),
        scope:JSON.parse(await panel().locator('.saved-hunt-scope pre').textContent()),
      };
      check('automatically routes to Indicators',visible.mode,'true');
      check('visible saved selection targets B',visible.selectedId,b.id);
      check('visible selected definition is B',visible.selectedName,'Indicator B');
      check('visible name agrees with loaded B inputs',visible.name,'Indicator B');
      check('loaded inputs are B',visible.indicators,b.config.indicatorText);
      check('copied scope remains exact after Workbench changes',visible.scope,b.config.filter);
      check('load must not autorun',await page.evaluate(()=>window.huntFixture.hunts.length),calls);
      await page.screenshot({path:fileURLToPath(new URL(`${action.toLowerCase()}-loaded.png`,output))});
      check('load notice agrees with B',await panel().locator('.saved-hunt-notice').innerText(),'Loaded “Indicator B”. Press Run hunt to search.');
      let dialog='',afterInitialUpdate;
      if(action==='Update') {
        // The untouched Update click must not copy B over the previously selected A.
        await button('Update saved hunt').click();
        afterInitialUpdate=await stored();
        check('untouched Update leaves A exact',afterInitialUpdate.find(item=>item.id===a.id),a);
        check('untouched Update keeps B exact',afterInitialUpdate.find(item=>item.id===b.id),b);
        // A manual management choice/name must survive ordinary authoring edits.
        await field('Saved hunt').selectOption(a.id);
        await field('Hunt name').fill('Unsaved management name');
        await field('Typed indicators').fill('ip 203.0.113.40');
        await field('Hunt scope').selectOption('all');
        await mode('Event sequences').click();await mode('Indicators').click();
        check('manual choice is not reset by edits or navigation',await field('Saved hunt').inputValue(),a.id);
        check('manual name is not reset by edits or navigation',await field('Hunt name').inputValue(),'Unsaved management name');
        check('ordinary edited inputs survive',await field('Typed indicators').inputValue(),'ip 203.0.113.40');
        await mode('Event sequences').click();
        await field('Saved hunt').selectOption(b.id);
        await button('Load hunt').click();
        await page.waitForFunction(()=>document.querySelector('.hw-panel:not([hidden]) [aria-label="Typed indicators"]')?.value==='ip 198.51.100.20');
        check('a repeated load of the same B resynchronizes selection',await field('Saved hunt').inputValue(),b.id);
        check('a repeated load of the same B resynchronizes name',await field('Hunt name').inputValue(),'Indicator B');
        await field('Typed indicators').fill('ip 203.0.113.30');
        check('ordinary input edits keep B selected',await field('Saved hunt').inputValue(),b.id);
        await button('Update saved hunt').click();
      } else if(action==='Rename') {
        await field('Hunt name').fill('Indicator B renamed');
        await button('Rename hunt').click();
      } else {
        page.once('dialog',async prompt=>{dialog=prompt.message();await prompt.accept()});
        await button('Delete hunt').click();
        check('delete confirmation names B',dialog,'Delete saved hunt “Indicator B” from this device?');
      }
      const after=await stored();
      check('A is never changed or removed',after.find(item=>item.id===a.id),a);
      check('saved sequence is never changed or removed',after.find(item=>item.id===sequence.id),sequence);
      if(action==='Update') {
        check('only B receives updated inputs',after.find(item=>item.id===b.id),{...b,config:{...b.config,indicatorText:'ip 203.0.113.30'}});
      } else if(action==='Rename') {
        check('only B is renamed; saved config stays exact',after.find(item=>item.id===b.id),{...b,name:'Indicator B renamed'});
      } else {
        check('only B is deleted',after.find(item=>item.id===b.id),undefined);
      }
      check('save actions do not run',await page.evaluate(()=>window.huntFixture.hunts.length),calls);
      await mode('Event sequences').click();
      check('source draft survives cross-mode load',await field('Step B search').inputValue(),sequenceDraft);
      check('source results survive cross-mode load',await panel().locator('.analysis-result-head').innerText(),sequenceResult);
      await mode('Rules').click();
      check('unrelated rule draft survives',await panel().locator('.cm-content:visible').innerText(),'title: Unrelated retained rule');
      check('unrelated rule result survives',await panel().getByText('✓ Ran · 8 matches',{exact:true}).count(),1);
      observations.push({action,before,visible,dialog,after,calls});
    } finally {await context.close()}
  }
  assert.deepEqual(errors,[],'No browser exceptions');
  assert.deepEqual(failures,[],'Cross-mode loaded definitions and mutation targets must agree');
  console.log('PASS cross-mode B selection/name/inputs, Update/Rename/Delete target isolation, exact scope, no autorun and unrelated draft/result retention');
} finally {
  await writeFile(new URL('observations.json',output),JSON.stringify({observations,failures,errors},null,2));
  if(browser)await browser.close();
  await server.close();
}
