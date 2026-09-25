const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');

// Synthetic evidence, imported through the real browser backend (never Wails).
const records = Array.from({length:80}, (_, i) => ({
  eventVersion:'1.09', eventID:`overlay-fixture-${i}`,
  eventTime:new Date(Date.UTC(2026,8,24,9,0,i)).toISOString(),
  eventName:i%2 ? 'DescribeSecret' : 'GetSecretValue',
  eventSource:'secretsmanager.amazonaws.com', awsRegion:'us-east-1',
  sourceIPAddress:'198.51.100.24', recipientAccountId:'111122223333',
  userIdentity:{type:'IAMUser',userName:'reviewer',accountId:'111122223333',
    arn:'arn:aws:iam::111122223333:user/reviewer',principalId:'DEMO-REVIEWER'},
  readOnly:true, managementEvent:true,
}));

async function importEvidence(page, role=false) {
  await page.goto('http://127.0.0.1:5196');
  assert.equal(await page.evaluate(()=>Boolean(window.go)),false,'No native/cloud bridge allowed');
  await page.getByRole('button',{name:/Import a dump/}).click();
  const input=role?records.map(record=>({...record,userIdentity:{...record.userIdentity,type:'AssumedRole',arn:'arn:aws:sts::111122223333:assumed-role/reviewer/session',accessKeyId:'ASIAFIXTURE',sessionContext:{sessionIssuer:{type:'Role',arn:'arn:aws:iam::111122223333:role/reviewer',userName:'reviewer'}}}})):records;
  await page.locator('input[type=file]').setInputFiles({name:'overlays.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({Records:input}))});
  await page.getByRole('button',{name:'Load dump',exact:true}).click();
  await page.locator('.workbench-results .row').first().waitFor();
}

async function settle(page) {
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}

async function popoverRegression(page) {
  await page.getByRole('button',{name:'Columns',exact:false}).click();
  await page.locator('.colmenu').waitFor();
  // Follow the reported keyboard route without depending on a viewport-specific
  // count of Shift+Tabs. Pointer clicks would dismiss the backdrop first.
  let reached = false;
  for (let i=0;i<40;i++) {
    await page.keyboard.press('Shift+Tab');
    reached = await page.evaluate(()=>document.activeElement?.matches('.tbar-views button') && document.activeElement.textContent==='Hunt');
    if (reached) break;
  }
  assert.ok(reached,'Hunt navigation must be reachable with the Columns menu open');
  await page.keyboard.press('Enter');
  await page.getByRole('textbox',{name:'Typed indicators',exact:true}).waitFor();
  assert.equal(await page.locator('.workbench-page').isVisible(),false);
  await settle(page);
  assert.equal(await page.locator('.pop-menu, .pop-backdrop').count(),0,'Deactivated Workbench leaked its Columns portal/backdrop over Hunt');
  await page.getByRole('button',{name:'Workbench',exact:true}).click();
  await settle(page);
  assert.equal(await page.locator('.pop-menu, .pop-backdrop').count(),0,'Columns must not reopen on reactivation');
}

async function installBackend(page) {
  await page.evaluate(async()=>{
    const {backend}=await import('/src/api/backend.ts');
    const {installWorkspaceBackend}=await import('/scripts/fixtures/workspace-backend.mjs');
    window.workspaceFixture=await installWorkspaceBackend(backend);
  });
}

async function standaloneOverlay(page,kind) {
  await page.goto(`http://127.0.0.1:5196/scripts/fixtures/workspace-overlays.html?kind=${encodeURIComponent(kind)}`);
  await page.waitForFunction(()=>window.overlayFixture);
  if(kind==='popover') await page.getByRole('button',{name:/Fixture menu/}).click();
  if(kind==='select') await page.getByRole('combobox').click();
  const portal=page.locator('.pop-menu, .themed-select-list, [role=dialog], .lgv-scrim');
  await portal.first().waitFor();
  await page.evaluate(()=>{
    window.escaped=0;
    window.addEventListener('keydown',event=>{if(event.key==='Escape')window.escaped++});
    window.overlayFixture.setActive(false);
  });
  await settle(page);
  const leaked=await portal.count();
  await page.locator('#destination').focus();
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>window.escaped),1,`${kind}: inactive overlay consumed destination Escape`);
  assert.equal(leaked,0,`${kind}: portal remains after owner deactivation`);
  await page.evaluate(()=>window.overlayFixture.setActive(true));
  await settle(page);
  assert.equal(await portal.count(),0,`${kind}: dismissed overlay reappeared after return`);
}

async function enterOwner(page, owner) {
  if(owner==='Hunt') await page.getByRole('button',{name:'Hunt',exact:true}).click();
  else await page.getByRole('button',{name:'Summarize',exact:true}).click();
}

async function workbenchDialog(page,kind) {
  await page.locator('.workbench-results .row').nth(2).locator('.c-time').click();
  await page.getByRole('tab',{name:'Original JSON',exact:true}).click();
  await page.locator('.ei-source').waitFor();
  const eventID=JSON.parse(await page.locator('.ei-source').textContent()).eventID;
  if(kind==='raw') await page.getByRole('button',{name:'Open full JSON',exact:true}).click();
  if(kind==='evidence') await page.getByRole('button',{name:'Sources & hashes',exact:true}).click();
  if(kind==='investigation') await page.getByRole('button',{name:'Around this event',exact:true}).click();
  if(kind==='lineage') {
    await page.getByRole('tab',{name:'Context',exact:true}).click();
    await page.getByRole('button',{name:'Expand selected-event lineage',exact:true}).click();
  }
  const portals=page.locator('[role=dialog], .lgv-scrim');
  await portals.first().waitFor();
  // Programmatic navigation also occurs independently of modal focus traps.
  await page.locator('.tbar-views button').filter({hasText:/^Hunt$/}).evaluate(button=>button.click());
  await settle(page);
  assert.equal(await portals.count(),0,`${kind}: Workbench-owned dialog leaked over Hunt`);
  await page.getByRole('button',{name:'Workbench',exact:true}).click();
  await settle(page);
  assert.equal(await portals.count(),0,`${kind}: Workbench-owned dialog reopened on return`);
  await page.getByRole('tab',{name:'Original JSON',exact:true}).click();
  assert.equal(JSON.parse(await page.locator('.ei-source').textContent()).eventID,eventID,'Closing a workspace dialog must not clear selection');
}

async function sourceFocusRegression(page) {
  await page.locator('.workbench-results .row').nth(2).locator('.c-time').click();
  const opener=page.getByRole('button',{name:'Sources & hashes',exact:true});
  const openerHandle=await opener.elementHandle();
  await opener.click();
  const dialog=page.getByRole('dialog',{name:'Source evidence',exact:true});
  await dialog.getByRole('button',{name:/View source #/}).first().click();
  const source=dialog.getByRole('region',{name:'Original source record',exact:true});
  await source.waitFor();
  await page.waitForFunction(()=>document.activeElement?.matches('.evidence-original'));
  for(const direction of ['Tab','Shift+Tab']) {
    await source.focus();
    for(let i=0;i<12;i++) {
      await page.keyboard.press(direction);
      assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)),true,`Source evidence focus escaped on ${direction} ${i+1}`);
    }
  }
  assert.equal(await openerHandle.evaluate(el=>!!el.closest('[inert]')),true,'Source evidence must make background controls inert');
  await page.keyboard.press('Escape');
  await dialog.waitFor({state:'detached'});
  assert.equal(await opener.evaluate(el=>document.activeElement===el),true,'Source evidence must return focus to its opener');
  assert.equal(await opener.evaluate(el=>!!el.closest('[inert]')),false,'Closing source evidence must restore background controls');
}

async function prepareRaw(page, owner) {
  await enterOwner(page,owner);
  if(owner==='Hunt') {
    await page.getByRole('textbox',{name:'Typed indicators',exact:true}).fill('ip 198.51.100.24');
    await page.getByRole('button',{name:'Run hunt',exact:true}).click();
    await page.locator('.hunt-detail code').waitFor();
  } else {
    await page.getByRole('button',{name:'Run analysis',exact:true}).click();
    await page.locator('.analysis-entity').first().click();
  }
  await page.getByRole('button',{name:'Original record',exact:true}).first().waitFor();
}

async function rawNavigationRegression(page, owner, returnFirst) {
  await prepareRaw(page,owner);
  const resultBefore=await page.locator('.workspace-page:not([hidden]) .analysis-result-head').textContent();
  const selectedID=await page.locator(owner==='Hunt'?'.hunt-detail code':'.analysis-record > span').first().textContent();
  const completedBefore=await page.evaluate(()=>window.workspaceFixture.gate.completed);
  await page.evaluate(()=>window.workspaceFixture.gate.deferNext());
  await page.getByRole('button',{name:'Original record',exact:true}).first().click();
  await page.waitForFunction(()=>window.workspaceFixture.gate.pending===1);
  await page.getByRole('button',{name:'Workbench',exact:true}).click();
  if(returnFirst) await enterOwner(page,owner);
  await page.evaluate(()=>window.workspaceFixture.gate.release());
  await page.waitForFunction(before=>window.workspaceFixture.gate.completed===before+1,completedBefore);
  await settle(page);
  assert.equal(await page.getByRole('dialog',{name:'Raw JSON',exact:true}).count(),0,`${owner}: stale raw completion opened a dialog after ${returnFirst?'leaving and returning':'leaving'}`);
  if(!returnFirst) await enterOwner(page,owner);
  await settle(page);
  assert.equal(await page.getByRole('dialog',{name:'Raw JSON',exact:true}).count(),0,`${owner}: stale raw dialog reappeared on return`);
  assert.equal(await page.locator('.workspace-page:not([hidden]) .analysis-result-head').textContent(),resultBefore,'Results must remain retained');
  const original=page.getByRole('button',{name:'Original record',exact:true}).first();
  assert.equal(await original.isEnabled(),true,'Obsolete raw request must not leave the retained view busy');
  await original.click();
  await page.getByRole('dialog',{name:'Raw JSON',exact:true}).waitFor();
  assert.equal(JSON.parse(await page.locator('.rawmodal-body').textContent()).eventID,selectedID,'Retained selection must open the same unique source eventID');
  await page.getByRole('button',{name:'Close raw JSON',exact:true}).click();
}

(async()=>{
  const {createServer}=await import('vite');
  const server=await createServer({root,cacheDir:path.join(root,'test-results/.vite-workspace-overlays'),server:{host:'127.0.0.1',port:5196,strictPort:true}});
  let browser;
  try {
    await server.listen();
    browser=await chromium.launch({headless:true});
    const failures=[];
    for(const viewport of [{width:1440,height:960},{width:1280,height:800}]) {
      const cases=[['popovers',popoverRegression],['source focus',sourceFocusRegression],...['raw','evidence','investigation','lineage'].map(kind=>[
        `Workbench ${kind}`,page=>workbenchDialog(page,kind),
      ]),...['popover','select','raw','evidence','investigation','lineage','lineage event'].map(kind=>[
        `standalone ${kind}`,page=>standaloneOverlay(page,kind),
      ]),...['Hunt','Analysis'].flatMap(owner=>[false,true].map(returnFirst=>[
        `${owner} raw ${returnFirst?'return':'leave'}`,page=>rawNavigationRegression(page,owner,returnFirst),
      ]))];
      for(const [name,run] of cases) {
        if(process.env.OVERLAY_CASE&&!name.includes(process.env.OVERLAY_CASE)) continue;
        const page=await browser.newPage({viewport});
        page.setDefaultTimeout(10000);
        const errors=[];page.on('pageerror',error=>errors.push(String(error)));
        try {
          if(!name.startsWith('standalone')) {
            await importEvidence(page,name==='Workbench lineage');
            if(name!=='popovers') await installBackend(page);
          }
          await run(page);
          assert.deepEqual(errors,[]);
          console.log(`PASS ${viewport.width}x${viewport.height}: ${name}`);
        } catch(error) {console.error(`FAIL ${viewport.width}x${viewport.height}: ${name}: ${error.message}`);failures.push(error);}
        finally {await page.close();}
      }
    }
    if(failures.length) throw new AggregateError(failures,`${failures.length} workspace overlay regression(s)`);
  } finally {await browser?.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
