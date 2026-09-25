import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('..',import.meta.url));
const fixture=JSON.parse(await fs.readFile(new URL('../../testdata/facets.json',import.meta.url),'utf8'));
const output=new URL('../test-results/facets-workbench/',import.meta.url);
const server=await createServer({root,cacheDir:'node_modules/.vite-facets-workbench',server:{host:'127.0.0.1',port:5197,strictPort:true}});
await server.listen();
const browser=await chromium.launch({headless:true});
await fs.mkdir(output,{recursive:true});
try {
 for(const [width,height] of [[1440,960],[1280,800]]) {
  const page=await browser.newPage({viewport:{width,height}}), errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  page.setDefaultTimeout(5000);
  const matches=async count=>page.waitForFunction(n=>document.querySelector('.workbench-list-heading strong')?.textContent===`${n} events`,count);
  await page.goto('http://127.0.0.1:5197');
  assert.equal(await page.evaluate(()=>Boolean(window.go)),false,'No native or cloud bridge allowed');
  await page.getByRole('button',{name:/Import a dump/}).click();
  await page.locator('input[type=file]').setInputFiles({name:'facets.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture.records))});
  await page.getByRole('button',{name:'Load dump',exact:true}).click();
  await matches(40);
  const rail=page.getByRole('complementary',{name:'Facets',exact:true});
  const group=field=>rail.locator(`.facet-group[data-field="${field}"]`);
  const identity=group('userName');
  assert.deepEqual(await rail.locator('.facet-group:not([hidden]) .facet-group-label').allTextContents(),['Service','User / issuer name','Source IP','Result']);
  assert.match(await identity.locator('.facet-presence').textContent(),/30 \/ 40/);
  // Excluded values disappear from applied-query aggregates but must remain
  // visible/removable in the real App, not just in a component harness.
  await rail.getByLabel('Add facet').selectOption('errorCode');
  const error=group('errorCode');
  await error.getByRole('button',{name:'Exclude AccessDenied',exact:true}).click();
  await matches(33);
  assert.equal(await error.locator('.facet-row.excluded').count(),1,'App must retain and identify an excluded value absent from the returned aggregate list');
  assert.equal(await error.getByRole('button',{name:'Exclude AccessDenied',exact:true}).getAttribute('aria-pressed'),'true');
  await error.getByRole('button',{name:'Clear Error code',exact:true}).click();
  await matches(40);
  await error.getByRole('button',{name:'Remove Error code facet',exact:true}).click();
  // Collapse must retain added groups, local value search and wrap choices.
  await rail.getByLabel('Add facet').selectOption('accountId');
  await identity.locator('.facet-details-toggle').click();
  await identity.getByLabel('Find returned User / issuer name values').fill('operator-03');
  await identity.getByLabel('Wrap full User / issuer name values').check();
  await page.getByRole('button',{name:'Collapse facets',exact:true}).click();
  assert.equal(await page.getByRole('complementary',{name:'Facets collapsed',exact:true}).count(),1,'Collapse should retain a reachable rail');
  await page.getByRole('button',{name:'Expand facets',exact:true}).click();
  assert.equal(await group('accountId').count(),1,'Added facets must survive rail collapse');
  assert.equal(await identity.locator('.facet-value-search').isVisible(),true,'Active local value search must stay obvious after collapse');
  assert.equal(await identity.getByLabel('Find returned User / issuer name values').inputValue(),'operator-03');
  assert.equal(await identity.getByLabel('Wrap full User / issuer name values').isChecked(),true);
  await identity.getByRole('button',{name:'Clear User / issuer name value search',exact:true}).click();
  await matches(40);
  await group('accountId').getByRole('button',{name:'Remove Account facet',exact:true}).click();
  await identity.getByLabel('Wrap full User / issuer name values').uncheck();
  await identity.locator('.facet-details-toggle').click();
  // Check actual allocated space: all four defaults visible without scrolling,
  // no page overflow, and the rail cannot overlap the event grid.
  const geometry=await page.evaluate(()=>{
   const rail=document.querySelector('.facet-selector'), list=rail.querySelector('.facets-scroll');
   const a=rail.getBoundingClientRect(),b=document.querySelector('.workbench-results').getBoundingClientRect();
   return {height:list.clientHeight,content:list.scrollHeight,railRight:a.right,gridLeft:b.left,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  assert.ok(geometry.content<=geometry.height,`Default groups should fit actual ${width}x${height} allocation: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.railRight<=geometry.gridLeft+1,`Facet rail overlaps event grid: ${JSON.stringify(geometry)}`);
  assert.equal(geometry.overflow,false);
  // Facet clearing must leave the separately applied query and its draft alone.
  const query='eventName=Operation03';
  const expected=fixture.records.filter(r=>r.eventName==='Operation03').length;
  await page.locator('.qbar-input').fill(query);
  await page.locator('.qbar-input').press('Enter');
  await matches(expected);
  await identity.getByRole('button',{name:'Exclude operator-03',exact:true}).click();
  await matches(expected-1);
  // The remaining sparse record has no service; its derived Result is present.
  await group('result').getByRole('button',{name:'No error recorded',exact:true}).click();
  await page.locator('.qbar-input').fill('eventName=unapplied');
  await rail.getByRole('button',{name:'Clear facet selections',exact:true}).click();
  await matches(expected);
  assert.equal(await rail.locator('.facet-row.active, .facet-row.excluded').count(),0);
  assert.equal(await page.locator('.qbar-input').inputValue(),'eventName=unapplied');
  await page.locator('.qbar-input').fill('');
  await page.locator('.qbar-input').press('Enter');
  await matches(40);
  await rail.locator('.facets-scroll').evaluate(e=>{e.scrollTop=0});
  await page.locator('.workbench-results .row .c-time').first().click();
  await page.locator('.ei-review-intro h2').waitFor();
  await page.screenshot({path:fileURLToPath(new URL(`integrated-${width}.png`,output))});
  assert.deepEqual(errors,[]);
  console.log(`PASS ${width}x${height}: real import/aggregate scope; removable exclusions; retained facet choices/search; rail geometry; event inspection`);
  await page.close();
 }
} finally {await browser.close();await server.close();}
