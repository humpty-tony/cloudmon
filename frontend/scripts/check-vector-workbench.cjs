const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results/vector-workbench');
const port = Number(process.env.WORKBENCH_PORT || 5191);
fs.mkdirSync(output, {recursive:true});

// Synthetic CloudTrail input goes through the real browser import/search path.
const records = Array.from({length:160}, (_, i) => ({
  eventVersion:'1.09', eventID:`vector-fixture-${i}`,
  eventTime:new Date(Date.UTC(2026,8,24,9,0,i)).toISOString(),
  eventName:i%3===0?'GetSecretValue':i%3===1?'DescribeSecret':'ListSecrets',
  eventSource:'secretsmanager.amazonaws.com', awsRegion:'us-east-1',
  sourceIPAddress:'198.51.100.24', recipientAccountId:'111122223333',
  userIdentity:{type:'IAMUser',userName:'reviewer',accountId:'111122223333',
    arn:'arn:aws:iam::111122223333:user/reviewer',principalId:'DEMO-REVIEWER'},
  readOnly:true, managementEvent:true,
  ...(i%9===0?{errorCode:'AccessDenied',errorMessage:'Synthetic denied request'}:{})
}));

const settle = page => page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const visibleRows = page => page.locator('.workbench-results .etbody').evaluate(table=>{
  const bounds=table.getBoundingClientRect();
  return [...table.querySelectorAll('.row')].filter(row=>{
    const rect=row.getBoundingClientRect();return rect.bottom>bounds.top&&rect.top<bounds.bottom;
  }).map(row=>row.dataset.eventSeq);
});

// UX1-01: one successful return missed the fifth/sixth-cycle drift. Reproduce
// the audit's offscreen selection, 1040px scroll and 300ms settled returns.
async function repeatedNavigation(page) {
  await page.locator('.workbench-results .etbody').evaluate(el=>{el.scrollTop=0});
  await settle(page);
  await page.locator('.workbench-results .rowwrap[data-index="2"] .c-time').click();
  await page.getByRole('tab',{name:'Original JSON',exact:true}).click();
  await page.locator('.ei-source').waitFor();
  const selectedID=JSON.parse(await page.locator('.ei-source').textContent()).eventID;
  const draft='eventName=UnappliedDraft';
  await page.locator('.qbar-input').fill(draft);
  for(const dwell of [0,500]) {
    await page.locator('.workbench-results .etbody').evaluate(el=>{el.scrollTop=1040});
    await page.waitForTimeout(300);
    const before=await visibleRows(page);
    assert.ok(before.length>0);
    assert.equal(await page.locator('.workbench-results .etbody').evaluate(el=>el.scrollTop),1040);
    for(let cycle=1;cycle<=10;cycle++) {
      await page.getByRole('button',{name:'Hunt',exact:true}).click();
      if(dwell) await page.waitForTimeout(dwell);
      await page.getByRole('button',{name:'Workbench',exact:true}).click();
      await page.waitForTimeout(300);
      const label=`cycle ${cycle}, Hunt dwell ${dwell}ms`;
      assert.equal(await page.locator('.workbench-results .etbody').evaluate(el=>el.scrollTop),1040,`${label}: scroll offset drifted`);
      assert.deepEqual(await visibleRows(page),before,`${label}: visible event seqs drifted`);
      assert.equal(JSON.parse(await page.locator('.ei-source').textContent()).eventID,selectedID,`${label}: selected event changed`);
      assert.equal(await page.locator('.qbar-input').inputValue(),draft,`${label}: draft changed`);
      assert.equal(await page.getByRole('tab',{name:'Original JSON',exact:true}).getAttribute('aria-selected'),'true');
    }
    console.log(`PASS ${page.viewportSize().width}: 10 retained round trips at scrollTop 1040, ${dwell}ms Hunt dwell; exact visible seqs/source/draft`);
  }
}

(async () => {
  const vite = await import('vite');
  const server = await vite.createServer({root,cacheDir:path.join(root,'test-results',`.vite-vector-workbench-${port}`),server:{host:'127.0.0.1',port,strictPort:true}});
  await server.listen();
  const browser = await chromium.launch({headless:true});
  try {
    for (const viewport of [{width:1440,height:960},{width:1280,height:800}]) {
    const page = await browser.newPage({viewport});
    const errors=[];page.on('pageerror',e=>errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${port}`);
    assert.equal(await page.evaluate(()=>Boolean(window.go)),false,'Fixture must not connect to a native/cloud backend');
    await page.getByRole('button',{name:/Import a dump/}).click();
    await page.locator('input[type=file]').setInputFiles({name:'review-fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({Records:records}))});
    await page.getByRole('button',{name:'Load dump',exact:true}).click();
    await page.locator('.workbench-results .row').first().waitFor();
    assert.deepEqual(await page.locator('.tbar-views button').allTextContents(),['Workbench','Hunt'],'Only Workbench and Hunt should be primary destinations');
    await page.locator('.workbench-results .etbody').evaluate(el => {el.scrollTop=700});
    await settle(page);
    const browsedRows=await visibleRows(page);
    assert.ok(browsedRows.length>2,'Scrolled table must expose real visible rows');
    const selectedSeq=browsedRows[2];
    await page.locator(`.workbench-results .row[data-event-seq="${selectedSeq}"] .c-time`).click();
    await page.locator('.ei-heading h2').waitFor();
    await page.getByRole('tab',{name:'Original JSON',exact:true}).click();
    await page.locator('.ei-source').waitFor();
    const selectedID=JSON.parse(await page.locator('.ei-source').textContent()).eventID;
    assert.equal(records.filter(record=>record.eventID===selectedID).length,1,'Selected record must have a unique fixture eventID');
    const draft = 'eventName=GetSecretValue';
    await page.locator('.qbar-input').fill(draft);
    await settle(page);
    const scrollBefore = await page.locator('.workbench-results .etbody').evaluate(el=>el.scrollTop);
    const rowsBefore=await visibleRows(page);
    assert.ok(scrollBefore>0,'Retention must start from a nonzero scroll position');
    assert.ok(rowsBefore.includes(selectedSeq),`Selection must be in the visible scroll window: ${JSON.stringify({selectedSeq,scrollBefore,rowsBefore})}`);
    await page.getByRole('button',{name:'Hunt',exact:true}).click();
    await page.getByRole('textbox',{name:'Typed indicators',exact:true}).fill('ip 198.51.100.24');
    await page.getByRole('button',{name:'Workbench',exact:true}).click();
    assert.equal(await page.locator('.qbar-input').inputValue(),draft,'Leaving Workbench must retain an unapplied query draft');
    await settle(page);
    assert.equal(JSON.parse(await page.locator('.ei-source').textContent()).eventID,selectedID,'Selected eventID changed after return');
    assert.equal(await page.getByRole('tab',{name:'Original JSON',exact:true}).getAttribute('aria-selected'),'true','Inspector mode was reset');
    assert.equal(await page.locator('.workbench-results .etbody').evaluate(el=>el.scrollTop),scrollBefore,'Return must preserve the browsing scroll position');
    assert.deepEqual(await visibleRows(page),rowsBefore,'Return must restore the same visible row identities, not an empty virtual range');
    assert.equal(await page.locator('.workbench-results .row[aria-selected="true"]').getAttribute('data-event-seq'),selectedSeq,'Selected seq changed after return');
    await page.getByRole('button',{name:'Hunt',exact:true}).click();
    assert.equal(await page.getByRole('textbox',{name:'Typed indicators',exact:true}).inputValue(),'ip 198.51.100.24','Hunt draft was lost');
    await page.getByRole('button',{name:'Workbench',exact:true}).click();
    await repeatedNavigation(page);
    await page.getByRole('button',{name:'Hunt',exact:true}).click();
    // Retention is bounded to a dataset session; a replacement must not leave
    // a hidden old review/authoring session looking current over new evidence.
    await page.getByRole('button',{name:'File',exact:true}).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button',{name:'Open dataset…',exact:true}).click();
    await (await chooser).setFiles({name:'replacement.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({Records:records.slice(0,2)}))});
    await page.waitForFunction(()=>document.querySelector('.workbench-list-heading strong')?.textContent==='2 matches');
    assert.match(await page.getByRole('button',{name:'Workbench',exact:true}).getAttribute('class'),/\bon\b/,'A new dataset must open in Workbench');
    assert.equal(await page.locator('.qbar-input').inputValue(),'','New dataset retained the previous unapplied query draft');
    await page.getByRole('button',{name:'Hunt',exact:true}).click();
    assert.equal(await page.getByRole('textbox',{name:'Typed indicators',exact:true}).inputValue(),'','New dataset retained the previous unsaved hunt session');
    await page.getByRole('button',{name:'Workbench',exact:true}).click();
    assert.deepEqual(errors,[]);
    await page.screenshot({path:path.join(output,`navigation-${viewport.width}.png`)});
    console.log(`PASS ${viewport.width}×${viewport.height}: two destinations; review draft/selection/inspector/scroll and Hunt draft retention; clean new-dataset session.`);
    await page.close();
    }
  } finally {await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
