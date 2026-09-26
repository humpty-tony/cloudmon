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
  await openIndicatorBulk(page);await page.getByRole('textbox',{name:'Typed indicators',exact:true}).waitFor();
  assert.equal(await page.locator('.workbench-page').isVisible(),false);
  await settle(page);
  assert.equal(await page.locator('.pop-menu, .pop-backdrop').count(),0,'Deactivated Workbench leaked its Columns portal/backdrop over Hunt');
  await page.getByRole('button',{name:'Events',exact:true}).click();
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
  if(owner==='standalone Hunt') await page.getByRole('button',{name:'Toggle destination',exact:true}).click();
  else if(owner==='Hunt') await page.getByRole('button',{name:'Hunt',exact:true}).click();
  else {
    await page.getByRole('button',{name:'Events',exact:true}).click();
    const summary=page.getByRole('button',{name:'Summarize',exact:true});
    if(await summary.getAttribute('aria-expanded')!=='true') await summary.click();
  }
}

async function workbenchDialog(page,kind) {
  await page.locator('.workbench-results .row').nth(2).locator('.c-time').click();
  await page.getByRole('tab',{name:'Original JSON',exact:true}).click();
  await page.locator('.ei-source').waitFor();
  const eventID=JSON.parse(await page.locator('.ei-source').textContent()).eventID;
  if(kind==='raw') await page.getByRole('button',{name:'Open full JSON',exact:true}).click();
  if(kind==='evidence') {
    await exposeSources(page);
    await page.getByRole('button',{name:'Sources & hashes',exact:true}).click();
  }
  if(kind==='lineage') await page.getByRole('button',{name:'Credential chain',exact:true}).click();
  const portals=page.locator('[role=dialog], .lgv-scrim');
  await portals.first().waitFor();
  // Programmatic navigation also occurs independently of modal focus traps.
  await page.locator('.tbar-views button').filter({hasText:/^Hunt$/}).evaluate(button=>button.click());
  await settle(page);
  assert.equal(await portals.count(),0,`${kind}: Workbench-owned dialog leaked over Hunt`);
  await page.getByRole('button',{name:'Events',exact:true}).click();
  await settle(page);
  assert.equal(await portals.count(),0,`${kind}: Workbench-owned dialog reopened on return`);
  await page.getByRole('tab',{name:'Original JSON',exact:true}).click();
  assert.equal(JSON.parse(await page.locator('.ei-source').textContent()).eventID,eventID,'Closing a workspace dialog must not clear selection');
}

async function exposeSources(page) {
  await page.getByRole('tab',{name:'Overview',exact:true}).click();
  await page.locator('.eo-evidence > summary').click();
}

async function sourceFocusRegression(page) {
  await page.locator('.workbench-results .row').nth(2).locator('.c-time').click();
  await exposeSources(page);
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
  if(owner==='standalone Hunt') {
    // Preserve the still-supported standalone Original record request lifecycle.
    // App Hunt now preloads evidence into EventInspector, covered separately.
    await page.goto('http://127.0.0.1:5196/hunt-workspace-fixture?standalone');
    assert.equal(await page.evaluate(()=>Boolean(window.go)),false,'No native/cloud bridge allowed');
    await page.evaluate(async input=>{
      const {backend}=await import('/src/api/backend.ts');
      await backend.ingestText(JSON.stringify({Records:input}));
    },records);
    await installBackend(page);
  } else await enterOwner(page,owner);
  if(owner==='standalone Hunt') {
    await openIndicatorBulk(page);await page.getByRole('textbox',{name:'Typed indicators',exact:true}).fill('ip 198.51.100.24');
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
  const resultHead=page.locator(owner==='Analysis'?'.workbench-summary .analysis-result-head':'.hunt-view .analysis-result-head');
  const resultBefore=await resultHead.textContent();
  const selectedID=await page.locator(owner==='standalone Hunt'?'.hunt-detail code':'.analysis-record > span').first().textContent();
  const completedBefore=await page.evaluate(()=>window.workspaceFixture.gate.completed);
  await page.evaluate(()=>window.workspaceFixture.gate.deferNext());
  await page.getByRole('button',{name:'Original record',exact:true}).first().click();
  await page.waitForFunction(()=>window.workspaceFixture.gate.pending===1);
  await page.getByRole('button',{name:owner==='standalone Hunt'?'Toggle destination':'Hunt',exact:true}).click();
  if(returnFirst) await enterOwner(page,owner);
  await page.evaluate(()=>window.workspaceFixture.gate.release());
  await page.waitForFunction(before=>window.workspaceFixture.gate.completed===before+1,completedBefore);
  await settle(page);
  assert.equal(await page.getByRole('dialog',{name:'Raw JSON',exact:true}).count(),0,`${owner}: stale raw completion opened a dialog after ${returnFirst?'leaving and returning':'leaving'}`);
  if(!returnFirst) await enterOwner(page,owner);
  await settle(page);
  assert.equal(await page.getByRole('dialog',{name:'Raw JSON',exact:true}).count(),0,`${owner}: stale raw dialog reappeared on return`);
  assert.equal(await resultHead.textContent(),resultBefore,'Results must remain retained');
  const original=page.getByRole('button',{name:'Original record',exact:true}).first();
  assert.equal(await original.isEnabled(),true,'Obsolete raw request must not leave the retained view busy');
  await original.click();
  await page.getByRole('dialog',{name:'Raw JSON',exact:true}).waitFor();
  assert.equal(JSON.parse(await page.locator('.rawmodal-body').textContent()).eventID,selectedID,'Retained selection must open the same unique source eventID');
  await page.getByRole('button',{name:'Close raw JSON',exact:true}).click();
}

async function contextualReturnRegression(page) {
  const browse=page.getByRole('region',{name:'Event results',exact:true});
  const query=page.getByRole('textbox',{name:'Search query',exact:true});
  await query.fill('eventName=GetSecretValue');await query.press('Enter');
  await browse.getByText('40 events',{exact:true}).waitFor();
  const grid=browse.locator('.etbody');
  await grid.evaluate(el=>el.scrollTop=300);await settle(page);
  await browse.locator('.row').nth(3).locator('.c-time').click();
  await page.getByRole('tab',{name:'Original JSON',exact:true}).click();
  const source=page.locator('.ei-source');await source.waitFor();
  const raw=await source.textContent(),eventID=JSON.parse(raw).eventID;
  await query.fill('eventName=unapplied');
  const before=await grid.evaluate(el=>({scroll:el.scrollTop,selected:el.querySelector('.row--selected')?.getAttribute('data-event-seq')}));
  assert.ok(before.scroll>0&&before.selected,'Return fixture needs a scrolled, selected browsing event');
  await page.evaluate(async()=>{
    const {backend}=await import('/src/api/backend.ts');
    const investigate=backend.investigate;
    window.contextRequests=[];
    backend.investigate=(options,...args)=>{window.contextRequests.push(options);return investigate(options,...args)};
  });
  await page.getByRole('button',{name:'Related events',exact:true}).click();
  const context=page.getByRole('region',{name:'Contextual event results',exact:true});
  await context.getByText('1 matching events',{exact:true}).waitFor();
  assert.match(await context.innerText(),/All evidence in this snapshot · browsing filters not applied/);
  const request=await page.evaluate(()=>window.contextRequests[0]);
  assert.equal(request.eventID,eventID);assert.equal(String(request.seq),before.selected);
  assert.equal(request.relation,'all');assert.equal(request.minutes,2);assert.ok(request.snapshot.generation);
  const portals=page.locator('[role=dialog], .lgv-scrim');
  assert.equal(await portals.count(),0,'Related events now uses the contextual grid, not a dialog');
  await page.getByRole('button',{name:'Hunt',exact:true}).click();await settle(page);
  assert.equal(await context.isVisible(),false,'Contextual results must not leak over Hunt');
  assert.equal(await portals.count(),0);
  await page.getByRole('button',{name:'Events',exact:true}).click();
  await context.getByText('1 matching events',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.contextRequests.at(-1)),request,'Retained contextual scope must not change on return');
  assert.equal(await portals.count(),0,'Returning must not open a legacy investigation dialog');
  await context.getByRole('button',{name:'Back to Events',exact:true}).click();await settle(page);
  assert.equal(await context.count(),0);
  assert.equal(await query.inputValue(),'eventName=unapplied');
  await browse.getByText('40 events',{exact:true}).waitFor();
  assert.deepEqual(await grid.evaluate(el=>({scroll:el.scrollTop,selected:el.querySelector('.row--selected')?.getAttribute('data-event-seq')})),before,'Context return must preserve exact browsing scroll and selection');
  await source.waitFor();assert.equal(await source.textContent(),raw,'Context return must preserve exact selected evidence');
}

async function huntInspectorRegression(page) {
  await enterOwner(page,'Hunt');await openIndicatorBulk(page);
  await page.getByRole('textbox',{name:'Typed indicators',exact:true}).fill('ip 198.51.100.24');
  await page.getByRole('button',{name:'Run hunt',exact:true}).click();
  const hunt=page.getByRole('main',{name:'Hunt workspace',exact:true});
  const head=hunt.locator('.analysis-result-head');await head.waitFor();
  const resultBefore=await head.textContent();
  await hunt.getByRole('tab',{name:'Original JSON',exact:true}).click();
  const source=hunt.locator('.ei-source');await source.waitFor();
  const raw=await source.textContent(),eventID=JSON.parse(raw).eventID;
  assert.ok(eventID.startsWith('overlay-fixture-'));
  await hunt.getByRole('button',{name:'Open full JSON',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Raw JSON',exact:true});await dialog.waitFor();
  assert.equal(await dialog.locator('.rawmodal-body').textContent(),raw);
  await page.locator('.tbar-views button').filter({hasText:/^Events$/}).evaluate(button=>button.click());
  await settle(page);assert.equal(await dialog.count(),0,'Hunt inspector dialog must close on deactivation');
  await enterOwner(page,'Hunt');await settle(page);
  assert.equal(await dialog.count(),0,'Hunt inspector dialog must not reopen on return');
  assert.equal(await head.textContent(),resultBefore,'Hunt results must remain retained');
  assert.equal(await source.textContent(),raw,'Hunt selection and exact evidence must remain retained');
  const original=hunt.getByRole('button',{name:'Open full JSON',exact:true});
  assert.equal(await original.isEnabled(),true);await original.click();await dialog.waitFor();
  assert.equal(JSON.parse(await dialog.locator('.rawmodal-body').textContent()).eventID,eventID);
  assert.equal(await dialog.locator('.rawmodal-body').textContent(),raw);
  await page.getByRole('button',{name:'Close raw JSON',exact:true}).click();
}

(async()=>{
  const {createServer}=await import('vite');
  const server=await createServer({root,cacheDir:path.join(root,'test-results/.vite-workspace-overlays'),server:{host:'127.0.0.1',port:5196,strictPort:true},plugins:[{
    name:'overlay-hunt-fixture',configureServer(server){
      server.middlewares.use('/hunt-workspace-fixture',async (_req,res)=>{
        res.setHeader('Content-Type','text/html');
        res.end(await server.transformIndexHtml('/hunt-workspace-fixture','<!doctype html><html><head><title>Standalone Hunt overlay fixture</title></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/hunt-workspace.tsx"></script></body></html>'));
      });
    },
  }]});
  let browser;
  try {
    await server.listen();
    browser=await chromium.launch({headless:true});
    const failures=[];
    for(const viewport of [{width:1440,height:960},{width:1280,height:800}]) {
      const cases=[['popovers',popoverRegression],['source focus',sourceFocusRegression],['Workbench contextual return',contextualReturnRegression],['Hunt inspector raw',huntInspectorRegression],...['raw','evidence','lineage'].map(kind=>[
        `Workbench ${kind}`,page=>workbenchDialog(page,kind),
      ]),...['popover','select','raw','evidence','investigation','lineage','lineage event'].map(kind=>[
        `standalone ${kind}`,page=>standaloneOverlay(page,kind),
      ]),...['standalone Hunt','Analysis'].flatMap(owner=>[false,true].map(returnFirst=>[
        `${owner} raw ${returnFirst?'return':'leave'}`,page=>rawNavigationRegression(page,owner,returnFirst),
      ]))];
      for(const [name,run] of cases) {
        if(process.env.OVERLAY_CASE&&!name.includes(process.env.OVERLAY_CASE)) continue;
        const page=await browser.newPage({viewport});
        page.setDefaultTimeout(10000);
        const errors=[];page.on('pageerror',error=>errors.push(String(error)));
        try {
          if(!name.startsWith('standalone ')) {
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

async function openIndicatorBulk(page) {
  const choices=page.getByRole('button',{name:/^(Paste multiple indicators|Back to indicator list)$/});
  await choices.waitFor();
  const toggle=page.getByRole('button',{name:'Paste multiple indicators',exact:true});
  if(await toggle.isVisible())await toggle.click();
}
